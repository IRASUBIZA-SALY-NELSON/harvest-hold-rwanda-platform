-- Storage prices (RWF per day) per crop and per cold room. The most specific price wins:
--   this crop in this room, then this crop everywhere, then the room's own price (cold_rooms.storage_rate_*),
--   then the system price (settings.storage_rates). No price at all = "no rate set", never 0.
CREATE TABLE storage_prices (
  id              bigserial PRIMARY KEY,
  crop            text NOT NULL REFERENCES crop_profiles(crop),
  room_id         text REFERENCES cold_rooms(id) ON UPDATE CASCADE,   -- null = this crop in every room
  kg_per_day      integer CHECK (kg_per_day >= 0),
  crate_per_day   integer CHECK (crate_per_day >= 0),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text,
  CHECK (kg_per_day IS NOT NULL OR crate_per_day IS NOT NULL)
);
CREATE UNIQUE INDEX storage_prices_key ON storage_prices (crop, coalesce(room_id, ''));
