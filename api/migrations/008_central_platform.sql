-- Central cold-chain platform: HHR-001 room ids, remote commands, operators, cooperatives,
-- batch codes and collections, storage charges, simulated-data flag, solar and MQTT readings.

-- ---------- Room ids: HHR-001, HHR-002, ... ----------
-- Rooms that already exist are renamed once; the old id stays in legacy_id, and controllers that
-- still use it keep working (the API accepts either).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid) AS def
             FROM pg_constraint WHERE contype = 'f' AND confrelid = 'cold_rooms'::regclass LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s ON UPDATE CASCADE', r.tbl, r.conname, r.def);
  END LOOP;
END $$;

ALTER TABLE cold_rooms
  ADD COLUMN legacy_id text UNIQUE,
  ADD COLUMN last_upload_via text CHECK (last_upload_via IN ('https', 'mqtt')),
  ADD COLUMN mqtt_seen_at timestamptz,
  ADD COLUMN control jsonb NOT NULL DEFAULT '{}',          -- overrides the controller reports it is running
  ADD COLUMN peltier_modules integer NOT NULL DEFAULT 1 CHECK (peltier_modules BETWEEN 1 AND 8),
  ADD COLUMN storage_rate_kg_day integer CHECK (storage_rate_kg_day >= 0),       -- RWF; null = system rate
  ADD COLUMN storage_rate_crate_day integer CHECK (storage_rate_crate_day >= 0);

CREATE SEQUENCE cold_room_seq;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM cold_rooms WHERE id NOT LIKE 'HHR-%' ORDER BY created_at, id LOOP
    UPDATE cold_rooms SET legacy_id = r.id, id = 'HHR-' || lpad(nextval('cold_room_seq')::text, 3, '0') WHERE id = r.id;
  END LOOP;
END $$;

-- ---------- Readings: real or simulated, how they arrived, solar generation ----------
ALTER TABLE readings
  ADD COLUMN source text NOT NULL DEFAULT 'device' CHECK (source IN ('device', 'simulated')),
  ADD COLUMN via text NOT NULL DEFAULT 'https' CHECK (via IN ('https', 'mqtt')),
  ADD COLUMN solar_current real;      -- A from the panel, when a solar meter is installed

-- ---------- System settings (superadmin) ----------
CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);

-- ---------- Remote commands to a room ----------
-- Every override is timed and falls back to automatic control by itself. The controller checks
-- the values again and its safety limits (freeze guard, hot side, battery) always win.
CREATE TABLE room_commands (
  id                 bigserial PRIMARY KEY,
  room_id            text NOT NULL REFERENCES cold_rooms(id) ON UPDATE CASCADE,
  type               text NOT NULL CHECK (type IN ('set_target', 'cooling', 'inside_fan', 'hot_fan')),
  params             jsonb NOT NULL DEFAULT '{}',
  reason             text NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'done', 'failed', 'expired', 'cancelled')),
  requested_by       text,
  requested_by_name  text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,        -- not delivered by then = dropped
  sent_at            timestamptz,
  sent_via           text CHECK (sent_via IN ('https', 'mqtt')),
  completed_at       timestamptz,
  result             jsonb
);
CREATE INDEX room_commands_room_idx ON room_commands (room_id, created_at DESC);
CREATE INDEX room_commands_open_idx ON room_commands (room_id) WHERE status IN ('pending', 'sent');

-- ---------- Operators ----------
-- A cold room operator works only in the rooms assigned to them (the rooms are not theirs).
ALTER TABLE admins DROP CONSTRAINT admins_role_check;
ALTER TABLE admins ADD CONSTRAINT admins_role_check CHECK (role IN ('superadmin', 'support', 'operations', 'market', 'operator'));

CREATE TABLE operator_rooms (
  admin_id     text NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  room_id      text NOT NULL REFERENCES cold_rooms(id) ON UPDATE CASCADE,
  assigned_by  text,
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_id, room_id)
);
CREATE INDEX operator_rooms_room_idx ON operator_rooms (room_id);

-- ---------- Cooperatives and farmers ----------
CREATE TABLE cooperatives (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  district       text NOT NULL,
  sector         text NOT NULL DEFAULT '',
  contact_name   text NOT NULL DEFAULT '',
  contact_phone  text NOT NULL DEFAULT '',
  notes          text NOT NULL DEFAULT '',
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cooperatives_name_key ON cooperatives (lower(name));

ALTER TABLE users
  ADD COLUMN cooperative_id text REFERENCES cooperatives(id),
  ADD COLUMN registered_by text;          -- staff member who registered the account, if any

-- ---------- Batches: code, harvest date, location, who registered it ----------
ALTER TABLE batches
  ADD COLUMN code text UNIQUE,
  ADD COLUMN harvest_date date,
  ADD COLUMN storage_location text NOT NULL DEFAULT '',   -- spot inside the room, e.g. "Rack B, shelf 2"
  ADD COLUMN cooperative_id text REFERENCES cooperatives(id),
  ADD COLUMN initial_quantity integer,
  ADD COLUMN registered_by text,
  ADD COLUMN registered_by_name text,
  ADD COLUMN collection_requested_at timestamptz;

UPDATE batches b SET
  code = 'HHB-' || upper(substr(md5(b.id), 1, 4)) || '-' || upper(substr(md5(b.id), 5, 4)),
  initial_quantity = b.quantity + coalesce((SELECT sum(o.quantity) FROM orders o JOIN listings l ON l.id = o.listing_id WHERE l.batch_id = b.id AND o.status = 'accepted'), 0);
ALTER TABLE batches ALTER COLUMN code SET NOT NULL, ALTER COLUMN initial_quantity SET NOT NULL;

-- ---------- Stock in and out of each room ----------
CREATE TABLE stock_movements (
  id          bigserial PRIMARY KEY,
  room_id     text NOT NULL REFERENCES cold_rooms(id) ON UPDATE CASCADE,
  batch_id    text NOT NULL REFERENCES batches(id),
  kind        text NOT NULL CHECK (kind IN ('in', 'out')),
  reason      text NOT NULL CHECK (reason IN ('checkin', 'collection', 'sale', 'removed')),
  quantity    integer NOT NULL CHECK (quantity > 0),
  unit        text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_name  text,
  note        text NOT NULL DEFAULT ''
);
CREATE INDEX stock_movements_room_idx ON stock_movements (room_id, at DESC);
CREATE INDEX stock_movements_batch_idx ON stock_movements (batch_id, at);

INSERT INTO stock_movements (room_id, batch_id, kind, reason, quantity, unit, at, actor_name)
  SELECT cold_room_id, id, 'in', 'checkin', initial_quantity, unit, stored_at, 'Farmer' FROM batches WHERE initial_quantity > 0;
INSERT INTO stock_movements (room_id, batch_id, kind, reason, quantity, unit, at, actor_name, note)
  SELECT l.cold_room_id, l.batch_id, 'out', 'sale', o.quantity, o.unit, o.updated_at, 'Marketplace', 'Order ' || o.id
    FROM orders o JOIN listings l ON l.id = o.listing_id WHERE o.status = 'accepted';
INSERT INTO stock_movements (room_id, batch_id, kind, reason, quantity, unit, at, actor_name)
  SELECT cold_room_id, id, 'out', 'removed', quantity, unit, removed_at, 'Farmer' FROM batches WHERE status = 'removed' AND quantity > 0 AND removed_at IS NOT NULL;

-- ---------- Collections and storage charges ----------
-- One row each time produce leaves the room: collected by someone, or sold through the market.
-- The charge is frozen when the row is written (quantity x days x the day rate in force then).
CREATE TABLE collections (
  id                 text PRIMARY KEY,
  batch_id           text NOT NULL REFERENCES batches(id),
  room_id            text NOT NULL REFERENCES cold_rooms(id) ON UPDATE CASCADE,
  farmer_id          text NOT NULL REFERENCES users(id),
  quantity           integer NOT NULL CHECK (quantity > 0),
  unit               text NOT NULL,
  collected_at       timestamptz NOT NULL DEFAULT now(),
  collected_by_name  text NOT NULL,                -- the person who took it away
  kind               text NOT NULL DEFAULT 'collection' CHECK (kind IN ('collection', 'sale')),
  order_id           text REFERENCES orders(id),
  recorded_by        text,
  recorded_by_name   text NOT NULL,
  note               text NOT NULL DEFAULT '',
  days               integer NOT NULL CHECK (days >= 1),
  rate_rwf           integer,                       -- null: no rate had been set
  charge_rwf         integer,
  payment_status     text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'waived')),
  payment_method     text CHECK (payment_method IN ('cash', 'momo', 'bank', 'other')),
  payment_ref        text,
  paid_at            timestamptz,
  paid_recorded_by   text
);
CREATE INDEX collections_batch_idx ON collections (batch_id);
CREATE INDEX collections_farmer_idx ON collections (farmer_id, collected_at DESC);
CREATE INDEX collections_room_idx ON collections (room_id, collected_at DESC);

-- ---------- Orders: payment status (payment provider later) ----------
ALTER TABLE orders
  ADD COLUMN payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid')),
  ADD COLUMN payment_method text CHECK (payment_method IN ('cash', 'momo', 'bank', 'other')),
  ADD COLUMN payment_ref text,
  ADD COLUMN paid_at timestamptz;
