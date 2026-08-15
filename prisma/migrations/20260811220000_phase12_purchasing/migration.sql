-- Phase 12: purchasing org scoping, PR source refs, PO↔PR link, GRN uniqueness

-- Purchase requests
ALTER TABLE purchasing.purchase_requests
  ADD COLUMN IF NOT EXISTS organization_id UUID,
  ADD COLUMN IF NOT EXISTS quotation_id UUID,
  ADD COLUMN IF NOT EXISTS visit_id UUID,
  ADD COLUMN IF NOT EXISTS work_order_id UUID;

UPDATE purchasing.purchase_requests pr
SET organization_id = b.organization_id
FROM core.branches b
WHERE pr.branch_id = b.id
  AND pr.organization_id IS NULL;

ALTER TABLE purchasing.purchase_requests
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE purchasing.purchase_requests
  DROP CONSTRAINT IF EXISTS purchase_requests_branch_id_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS purchase_requests_organization_id_number_key
  ON purchasing.purchase_requests (organization_id, number);

CREATE INDEX IF NOT EXISTS purchase_requests_branch_id_status_idx
  ON purchasing.purchase_requests (branch_id, status);

CREATE INDEX IF NOT EXISTS purchase_requests_quotation_id_idx
  ON purchasing.purchase_requests (quotation_id);

-- Purchase orders
ALTER TABLE purchasing.purchase_orders
  ADD COLUMN IF NOT EXISTS organization_id UUID,
  ADD COLUMN IF NOT EXISTS purchase_request_id UUID,
  ADD COLUMN IF NOT EXISTS notes TEXT;

UPDATE purchasing.purchase_orders po
SET organization_id = b.organization_id
FROM core.branches b
WHERE po.branch_id = b.id
  AND po.organization_id IS NULL;

ALTER TABLE purchasing.purchase_orders
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE purchasing.purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_branch_id_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_organization_id_number_key
  ON purchasing.purchase_orders (organization_id, number);

CREATE INDEX IF NOT EXISTS purchase_orders_branch_id_status_idx
  ON purchasing.purchase_orders (branch_id, status);

CREATE INDEX IF NOT EXISTS purchase_orders_purchase_request_id_idx
  ON purchasing.purchase_orders (purchase_request_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_purchase_request_id_fkey'
  ) THEN
    ALTER TABLE purchasing.purchase_orders
      ADD CONSTRAINT purchase_orders_purchase_request_id_fkey
      FOREIGN KEY (purchase_request_id)
      REFERENCES purchasing.purchase_requests(id)
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

-- Goods receipts
ALTER TABLE purchasing.goods_receipts
  ADD COLUMN IF NOT EXISTS organization_id UUID,
  ADD COLUMN IF NOT EXISTS supplier_invoice_ref TEXT;

UPDATE purchasing.goods_receipts gr
SET organization_id = b.organization_id
FROM core.branches b
WHERE gr.branch_id = b.id
  AND gr.organization_id IS NULL;

ALTER TABLE purchasing.goods_receipts
  ALTER COLUMN organization_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS goods_receipts_organization_id_number_key
  ON purchasing.goods_receipts (organization_id, number);

CREATE INDEX IF NOT EXISTS goods_receipts_branch_id_status_idx
  ON purchasing.goods_receipts (branch_id, status);
