-- Phase 05 — Tire Zone domain.
-- Stock, cost and movement stay in the shared `inventory` schema (decision D5);
-- these tables hold only what is specific to selling and fitting tires.

DROP TABLE IF EXISTS "tireszone"."orders";
DROP TABLE IF EXISTS "tireszone"."products";

CREATE TABLE "tireszone"."products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "pattern" TEXT,
    "width" INTEGER NOT NULL,
    "aspect_ratio" INTEGER NOT NULL,
    "rim_diameter" INTEGER NOT NULL,
    "season" TEXT NOT NULL DEFAULT 'all_season',
    "speed_rating" TEXT,
    "load_index" TEXT,
    "run_flat" BOOLEAN NOT NULL DEFAULT false,
    "dot_week" TEXT,
    "warranty_months" INTEGER,
    "warranty_km" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tire_products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tire_products_part_id_key" ON "tireszone"."products"("part_id");
CREATE UNIQUE INDEX "tire_products_sku_key" ON "tireszone"."products"("sku");
CREATE INDEX "tire_products_size_idx" ON "tireszone"."products"("width", "aspect_ratio", "rim_diameter");
CREATE INDEX "tire_products_brand_idx" ON "tireszone"."products"("brand");

ALTER TABLE "tireszone"."products"
    ADD CONSTRAINT "tire_products_part_id_fkey"
    FOREIGN KEY ("part_id") REFERENCES "inventory"."parts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "tireszone"."fitments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year_from" INTEGER NOT NULL,
    "year_to" INTEGER,
    "width" INTEGER NOT NULL,
    "aspect_ratio" INTEGER NOT NULL,
    "rim_diameter" INTEGER NOT NULL,
    "position" TEXT NOT NULL DEFAULT 'all',
    "is_oem" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tire_fitments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tire_fitments_make_model_idx" ON "tireszone"."fitments"("make", "model");
CREATE INDEX "tire_fitments_size_idx" ON "tireszone"."fitments"("width", "aspect_ratio", "rim_diameter");

CREATE TABLE "tireszone"."services" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "duration_min" INTEGER NOT NULL DEFAULT 30,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tire_services_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tire_services_organization_id_code_key"
    ON "tireszone"."services"("organization_id", "code");

CREATE TABLE "tireszone"."sales_orders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'pos',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "customer_id" UUID,
    "vehicle_id" UUID,
    "visit_id" UUID,
    "work_order_id" UUID,
    "odometer" INTEGER,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "invoice_id" UUID,
    "notes" TEXT,
    "completed_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tire_sales_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tire_sales_orders_organization_id_number_key"
    ON "tireszone"."sales_orders"("organization_id", "number");
CREATE INDEX "tire_sales_orders_branch_id_status_idx" ON "tireszone"."sales_orders"("branch_id", "status");
CREATE INDEX "tire_sales_orders_visit_id_idx" ON "tireszone"."sales_orders"("visit_id");
CREATE INDEX "tire_sales_orders_customer_id_idx" ON "tireszone"."sales_orders"("customer_id");

ALTER TABLE "tireszone"."sales_orders"
    ADD CONSTRAINT "tire_sales_orders_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "core"."customers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tireszone"."sales_orders"
    ADD CONSTRAINT "tire_sales_orders_vehicle_id_fkey"
    FOREIGN KEY ("vehicle_id") REFERENCES "promotors"."vehicles"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tireszone"."sales_orders"
    ADD CONSTRAINT "tire_sales_orders_visit_id_fkey"
    FOREIGN KEY ("visit_id") REFERENCES "promotors"."vehicle_visits"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tireszone"."sales_orders"
    ADD CONSTRAINT "tire_sales_orders_work_order_id_fkey"
    FOREIGN KEY ("work_order_id") REFERENCES "promotors"."work_orders"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "tireszone"."sales_order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID,
    "service_id" UUID,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(14,2) NOT NULL,
    "tax_rate_id" UUID,
    "reservation_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tire_sales_order_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tire_sales_order_items_order_id_idx" ON "tireszone"."sales_order_items"("order_id");

ALTER TABLE "tireszone"."sales_order_items"
    ADD CONSTRAINT "tire_sales_order_items_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "tireszone"."sales_orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tireszone"."sales_order_items"
    ADD CONSTRAINT "tire_sales_order_items_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "tireszone"."products"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tireszone"."sales_order_items"
    ADD CONSTRAINT "tire_sales_order_items_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "tireszone"."services"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- A line is either a product or a service, never both and never neither.
ALTER TABLE "tireszone"."sales_order_items"
    ADD CONSTRAINT "tire_sales_order_items_one_kind_chk"
    CHECK (("product_id" IS NOT NULL) <> ("service_id" IS NOT NULL));

CREATE TABLE "tireszone"."warranties" (
    "id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "months" INTEGER,
    "km_limit" INTEGER,
    "start_odometer" INTEGER,
    "starts_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "terms" TEXT,

    CONSTRAINT "tire_warranties_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tire_warranties_order_item_id_key" ON "tireszone"."warranties"("order_item_id");

ALTER TABLE "tireszone"."warranties"
    ADD CONSTRAINT "tire_warranties_order_item_id_fkey"
    FOREIGN KEY ("order_item_id") REFERENCES "tireszone"."sales_order_items"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "tireszone"."alignments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "technician_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "notes" TEXT,
    "performed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tire_alignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tire_alignments_order_id_key" ON "tireszone"."alignments"("order_id");

ALTER TABLE "tireszone"."alignments"
    ADD CONSTRAINT "tire_alignments_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "tireszone"."sales_orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
