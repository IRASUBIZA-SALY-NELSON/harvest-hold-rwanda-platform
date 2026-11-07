-- The prototype cools with Peltier modules; the full-size design will use the ice bank.
-- Each room says which it has, so the app shows the right equipment and readings.
ALTER TABLE cold_rooms
  ADD COLUMN cooling_type text NOT NULL DEFAULT 'peltier' CHECK (cooling_type IN ('peltier', 'ice_bank'));

-- Peltier readings. (ice_bank, pump and compressor stay for ice-bank rooms.)
ALTER TABLE readings
  ADD COLUMN hot_side real,          -- hot-side heatsink, °C
  ADD COLUMN cooler_duty real,       -- % power to the Peltier module(s)
  ADD COLUMN cooler_current real,    -- A
  ADD COLUMN cooler_voltage real,    -- V
  ADD COLUMN hot_fan boolean;
