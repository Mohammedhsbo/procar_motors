-- Phase 18: shared FKs for TiresZone stub orders (architecture §20.3)
ALTER TABLE tireszone.orders
  ADD COLUMN IF NOT EXISTS customer_id UUID,
  ADD COLUMN IF NOT EXISTS work_order_id UUID;

CREATE INDEX IF NOT EXISTS orders_visit_id_idx
  ON tireszone.orders (visit_id);

CREATE INDEX IF NOT EXISTS orders_customer_id_idx
  ON tireszone.orders (customer_id);

CREATE INDEX IF NOT EXISTS orders_work_order_id_idx
  ON tireszone.orders (work_order_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_customer_id_fkey'
      AND conrelid = 'tireszone.orders'::regclass
  ) THEN
    ALTER TABLE tireszone.orders
      ADD CONSTRAINT orders_customer_id_fkey
      FOREIGN KEY (customer_id) REFERENCES core.customers(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_visit_id_fkey'
      AND conrelid = 'tireszone.orders'::regclass
  ) THEN
    ALTER TABLE tireszone.orders
      ADD CONSTRAINT orders_visit_id_fkey
      FOREIGN KEY (visit_id) REFERENCES promotors.vehicle_visits(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_work_order_id_fkey'
      AND conrelid = 'tireszone.orders'::regclass
  ) THEN
    ALTER TABLE tireszone.orders
      ADD CONSTRAINT orders_work_order_id_fkey
      FOREIGN KEY (work_order_id) REFERENCES promotors.work_orders(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
