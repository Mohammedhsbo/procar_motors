-- Phase 4: fuzzy search GIN indexes (pg_trgm already enabled in init)

CREATE INDEX IF NOT EXISTS customers_name_en_trgm_idx
  ON core.customers USING gin (name_en gin_trgm_ops);

CREATE INDEX IF NOT EXISTS customers_name_ar_trgm_idx
  ON core.customers USING gin (name_ar gin_trgm_ops);

CREATE INDEX IF NOT EXISTS customers_phone_trgm_idx
  ON core.customers USING gin (phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS vehicles_plate_normalized_trgm_idx
  ON promotors.vehicles USING gin (plate_normalized gin_trgm_ops);

CREATE INDEX IF NOT EXISTS vehicles_vin_trgm_idx
  ON promotors.vehicles USING gin (vin gin_trgm_ops)
  WHERE vin IS NOT NULL;
