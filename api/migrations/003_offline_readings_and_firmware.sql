-- Controllers keep readings while offline and send them later with their own timestamps.
-- A reading is identified by its room and time, so a batch that is sent twice is stored once.
DROP INDEX IF EXISTS readings_room_at_idx;
CREATE UNIQUE INDEX readings_room_at_key ON readings (room_id, at);

ALTER TABLE cold_rooms
  ADD COLUMN firmware_version integer,
  ADD COLUMN last_upload_at timestamptz;

-- Firmware for over-the-air updates. Files live in FIRMWARE_DIR; add one with `npm run firmware:release`.
CREATE TABLE firmware_releases (
  version     integer PRIMARY KEY,
  file_name   text NOT NULL,
  size        integer NOT NULL CHECK (size > 0),
  sha256      text NOT NULL CHECK (length(sha256) = 64),
  notes       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
