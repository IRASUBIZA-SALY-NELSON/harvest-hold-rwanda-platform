-- A batch always has a code and a starting quantity, even when a script inserts it directly.
-- The API makes the code itself (HHB-XXXX-XXXX from a readable alphabet); this is the safety net.
ALTER TABLE batches ALTER COLUMN code SET DEFAULT 'HHB-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4)) || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));

CREATE FUNCTION batches_initial_quantity() RETURNS trigger AS $$
BEGIN
  IF NEW.initial_quantity IS NULL THEN NEW.initial_quantity := NEW.quantity; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER batches_initial_quantity BEFORE INSERT ON batches FOR EACH ROW EXECUTE FUNCTION batches_initial_quantity();
