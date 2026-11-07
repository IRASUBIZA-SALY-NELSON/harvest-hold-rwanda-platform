-- Harvest Hold: initial schema.

CREATE TABLE crop_profiles (
  crop        text PRIMARY KEY,
  version     integer NOT NULL,
  data        jsonb NOT NULL,           -- the whole crop-profiles/<crop>.json file
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cold_rooms (
  id                 text PRIMARY KEY,
  name               text NOT NULL,
  district           text NOT NULL,
  sector             text NOT NULL,
  crop               text NOT NULL REFERENCES crop_profiles(crop),  -- main crop: sets the room's conditions
  capacity_crates    integer NOT NULL CHECK (capacity_crates > 0),
  device_token_hash  text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                   text PRIMARY KEY,
  role                 text NOT NULL CHECK (role IN ('farmer', 'buyer')),
  name                 text NOT NULL,
  phone                text NOT NULL UNIQUE,
  pin_hash             text NOT NULL,
  district             text NOT NULL,
  cold_room_id         text REFERENCES cold_rooms(id),
  business_name        text,
  business_type        text,
  lang                 text NOT NULL DEFAULT 'rw' CHECK (lang IN ('rw', 'en', 'fr')),
  failed_pin_attempts  integer NOT NULL DEFAULT 0,
  locked_until         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (role <> 'farmer' OR cold_room_id IS NOT NULL)
);

CREATE TABLE otp_codes (
  id          bigserial PRIMARY KEY,
  phone       text NOT NULL,
  purpose     text NOT NULL CHECK (purpose IN ('register', 'resetPin')),
  code_hash   text NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_phone_idx ON otp_codes (phone, created_at DESC);

CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE push_tokens (
  token       text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per controller upload (about every minute). "at" is set by the server.
CREATE TABLE readings (
  id               bigserial PRIMARY KEY,
  room_id          text NOT NULL REFERENCES cold_rooms(id),
  at               timestamptz NOT NULL DEFAULT now(),
  chamber          real,
  coil_outlet      real,
  product          real,
  humidity         real,
  ice_bank         real,
  outside          real,
  battery          integer,
  battery_v        real,
  solar_v          real,
  solar_charging   boolean,
  pump             boolean,
  fan              boolean,
  compressor       boolean,
  humidifier       boolean,
  door_open        boolean,
  device_alerts    text[] NOT NULL DEFAULT '{}',
  profile_version  integer
);
CREATE INDEX readings_room_at_idx ON readings (room_id, at DESC);

-- stored_at is always set by the server at check-in: farmers cannot back-date stock.
CREATE TABLE batches (
  id            text PRIMARY KEY,
  farmer_id     text NOT NULL REFERENCES users(id),
  cold_room_id  text NOT NULL REFERENCES cold_rooms(id),
  crop          text NOT NULL,
  quantity      integer NOT NULL CHECK (quantity >= 0),
  unit          text NOT NULL CHECK (unit IN ('kg', 'crate')),
  stored_at     timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'stored' CHECK (status IN ('stored', 'removed')),
  removed_at    timestamptz
);
CREATE INDEX batches_room_idx ON batches (cold_room_id, status);
CREATE INDEX batches_farmer_idx ON batches (farmer_id);

-- A certificate is a frozen record: "data" never changes after it is issued.
CREATE TABLE certificates (
  id         text PRIMARY KEY,
  batch_id   text NOT NULL REFERENCES batches(id),
  issued_at  timestamptz NOT NULL DEFAULT now(),
  data       jsonb NOT NULL
);
CREATE INDEX certificates_batch_idx ON certificates (batch_id, issued_at DESC);

CREATE TABLE listings (
  id              text PRIMARY KEY,
  batch_id        text NOT NULL REFERENCES batches(id),
  farmer_id       text NOT NULL REFERENCES users(id),
  cold_room_id    text NOT NULL REFERENCES cold_rooms(id),
  crop            text NOT NULL,
  quantity        integer NOT NULL CHECK (quantity >= 0),
  unit            text NOT NULL CHECK (unit IN ('kg', 'crate')),
  price_per_unit  integer NOT NULL CHECK (price_per_unit > 0),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'soldOut')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX listings_status_idx ON listings (status);

CREATE TABLE orders (
  id              text PRIMARY KEY,
  listing_id      text NOT NULL REFERENCES listings(id),
  buyer_id        text NOT NULL REFERENCES users(id),
  farmer_id       text NOT NULL REFERENCES users(id),
  crop            text NOT NULL,
  quantity        integer NOT NULL CHECK (quantity > 0),
  unit            text NOT NULL,
  price_per_unit  integer NOT NULL,
  note            text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_buyer_idx ON orders (buyer_id);
CREATE INDEX orders_farmer_idx ON orders (farmer_id);

CREATE TABLE alerts (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL,
  params      jsonb NOT NULL DEFAULT '{}',
  link        text,
  read        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alerts_user_idx ON alerts (user_id, created_at DESC);

-- Tracks ongoing room problems so each one is announced once, plus "back to normal".
CREATE TABLE room_alert_state (
  room_id   text NOT NULL REFERENCES cold_rooms(id),
  type      text NOT NULL,
  since     timestamptz NOT NULL,
  notified  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (room_id, type)
);
