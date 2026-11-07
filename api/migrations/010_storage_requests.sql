-- A farmer asks to store produce; the operator at the cold room weighs and inspects it, confirms
-- what was really received (e.g. asked 100 kg, confirmed 95 kg) and registers it as a batch.
CREATE TABLE storage_requests (
  id                  text PRIMARY KEY,
  farmer_id           text NOT NULL REFERENCES users(id),
  cold_room_id        text NOT NULL REFERENCES cold_rooms(id) ON UPDATE CASCADE,
  crop                text NOT NULL,
  unit                text NOT NULL CHECK (unit IN ('kg', 'crate')),
  estimated_quantity  integer NOT NULL CHECK (estimated_quantity > 0),
  note                text NOT NULL DEFAULT '',
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  batch_id            text REFERENCES batches(id),
  confirmed_quantity  integer,
  decline_reason      text,
  handled_by          text,
  handled_by_name     text,
  handled_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX storage_requests_room_idx ON storage_requests (cold_room_id, status, created_at);
CREATE INDEX storage_requests_farmer_idx ON storage_requests (farmer_id, created_at DESC);

-- What the farmer asked for and what the operator found, kept on the batch.
ALTER TABLE batches
  ADD COLUMN requested_quantity integer,
  ADD COLUMN inspection_note text NOT NULL DEFAULT '';
