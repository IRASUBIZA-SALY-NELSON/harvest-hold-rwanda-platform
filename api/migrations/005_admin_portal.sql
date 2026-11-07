-- Admin portal: staff accounts, audit trail, incidents, photos, signed certificates,
-- listing moderation and staged firmware rollout.

-- ---------- Farmers and buyers ----------
ALTER TABLE users
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  ADD COLUMN status_reason text,
  ADD COLUMN photo_id text,
  ADD COLUMN last_seen_at timestamptz;

-- ---------- Staff (admin portal) ----------
-- superadmin: everything, including staff and settings.
-- support: farmers and buyers (unlock, suspend), alerts.
-- operations: cold rooms, controllers, firmware, crop profiles, incidents.
-- market: listings, orders, certificates, photos.
CREATE TABLE admins (
  id                text PRIMARY KEY,
  email             text NOT NULL UNIQUE CHECK (email = lower(email)),
  name              text NOT NULL,
  role              text NOT NULL CHECK (role IN ('superadmin', 'support', 'operations', 'market')),
  password_hash     text NOT NULL,
  totp_secret       text,            -- encrypted with the server SECRET (AES-256-GCM)
  totp_enabled      boolean NOT NULL DEFAULT false,
  totp_last_step    bigint NOT NULL DEFAULT 0,       -- a code cannot be used twice
  recovery_codes    text[] NOT NULL DEFAULT '{}',  -- SHA-256 hashes, each usable once
  failed_attempts   integer NOT NULL DEFAULT 0,
  locked_at         timestamptz,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  must_change_password boolean NOT NULL DEFAULT true,
  created_by        text REFERENCES admins(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_login_at     timestamptz
);

CREATE TABLE admin_sessions (
  token_hash  text PRIMARY KEY,
  admin_id    text NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  -- false until the authenticator code was given (a password alone opens nothing)
  mfa_passed  boolean NOT NULL DEFAULT false,
  ip          text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX admin_sessions_admin_idx ON admin_sessions (admin_id);

-- ---------- Audit trail ----------
-- Append-only and hash-chained: each entry includes the hash of the one before it, so editing
-- or deleting any past entry breaks the chain, and the portal shows it.
CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  actor_type   text NOT NULL CHECK (actor_type IN ('admin', 'user', 'device', 'system')),
  actor_id     text,
  actor_name   text,
  action       text NOT NULL,           -- e.g. user.suspend, certificate.revoke
  entity_type  text,
  entity_id    text,
  summary      text NOT NULL,
  before       jsonb,
  after        jsonb,
  ip           text,
  prev_hash    text NOT NULL,
  hash         text NOT NULL UNIQUE
);
CREATE INDEX audit_entity_idx ON audit_log (entity_type, entity_id, id DESC);
CREATE INDEX audit_actor_idx ON audit_log (actor_type, actor_id, id DESC);
CREATE INDEX audit_action_idx ON audit_log (action, id DESC);

-- The database itself refuses changes to past entries.
CREATE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- ---------- Incidents ----------
-- Each room problem (too warm, overheating, offline, ...) from start to end, with who handled it.
CREATE TABLE room_incidents (
  id               bigserial PRIMARY KEY,
  room_id          text NOT NULL REFERENCES cold_rooms(id),
  type             text NOT NULL,
  started_at       timestamptz NOT NULL,
  ended_at         timestamptz,
  details          jsonb NOT NULL DEFAULT '{}',
  acknowledged_by  text REFERENCES admins(id),
  acknowledged_at  timestamptz,
  note             text
);
CREATE UNIQUE INDEX room_incidents_open_idx ON room_incidents (room_id, type) WHERE ended_at IS NULL;
CREATE INDEX room_incidents_room_idx ON room_incidents (room_id, started_at DESC);

-- ---------- Cold rooms and controllers ----------
ALTER TABLE cold_rooms
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'retired')),
  ADD COLUMN latitude double precision,
  ADD COLUMN longitude double precision,
  ADD COLUMN notes text NOT NULL DEFAULT '',
  ADD COLUMN firmware_channel text NOT NULL DEFAULT 'stable' CHECK (firmware_channel IN ('stable', 'beta')),
  ADD COLUMN device_token_rotated_at timestamptz;

-- Staged rollout: a release goes to "beta" rooms first, then is promoted to everyone, or halted.
ALTER TABLE firmware_releases
  ADD COLUMN channel text NOT NULL DEFAULT 'stable' CHECK (channel IN ('stable', 'beta')),
  ADD COLUMN halted_at timestamptz,
  ADD COLUMN created_by text;

-- ---------- Certificates ----------
ALTER TABLE certificates
  ADD COLUMN signature text,          -- Ed25519 over the canonical JSON of data
  ADD COLUMN key_id text,
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN revoked_reason text,
  ADD COLUMN revoked_by text REFERENCES admins(id);

-- ---------- Marketplace moderation ----------
ALTER TABLE listings
  ADD COLUMN moderation text NOT NULL DEFAULT 'visible' CHECK (moderation IN ('visible', 'hidden')),
  ADD COLUMN moderation_reason text;

-- ---------- Photos ----------
-- Stored processed (resized, re-encoded, all metadata such as GPS removed), with a thumbnail.
CREATE TABLE photos (
  id              text PRIMARY KEY,           -- random, unguessable: it is the URL
  owner_id        text NOT NULL REFERENCES users(id),
  kind            text NOT NULL CHECK (kind IN ('listing', 'checkin', 'profile')),
  entity_id       text,                       -- listing id, batch id or user id
  position        integer NOT NULL DEFAULT 0,
  width           integer NOT NULL,
  height          integer NOT NULL,
  bytes           integer NOT NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  removed_by      text,                       -- 'owner' or an admin id
  removed_reason  text,
  removed_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX photos_entity_idx ON photos (kind, entity_id, position) WHERE status = 'active';
CREATE INDEX photos_created_idx ON photos (created_at DESC);
