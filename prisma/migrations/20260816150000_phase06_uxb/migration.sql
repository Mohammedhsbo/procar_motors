-- Phase 06 — UXB domain: car care, PPF, window film, polishing.
-- Lives in the existing `uxp` schema alongside uxp.profiles.

CREATE TABLE "uxp"."service_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uxb_service_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uxb_service_categories_organization_id_code_key"
    ON "uxp"."service_categories"("organization_id", "code");

CREATE TABLE "uxp"."vehicle_size_classes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "multiplier" DECIMAL(6,3) NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uxb_size_classes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uxb_size_classes_organization_id_code_key"
    ON "uxp"."vehicle_size_classes"("organization_id", "code");

CREATE TABLE "uxp"."services" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "description" TEXT,
    "base_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "duration_min" INTEGER NOT NULL DEFAULT 60,
    "warranty_months" INTEGER,
    "material_part_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "uxb_services_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uxb_services_organization_id_code_key"
    ON "uxp"."services"("organization_id", "code");
CREATE INDEX "uxb_services_category_id_idx" ON "uxp"."services"("category_id");

ALTER TABLE "uxp"."services"
    ADD CONSTRAINT "uxb_services_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "uxp"."service_categories"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "uxp"."service_prices" (
    "id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "size_class_id" UUID NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "uxb_service_prices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uxb_service_prices_service_id_size_class_id_key"
    ON "uxp"."service_prices"("service_id", "size_class_id");

ALTER TABLE "uxp"."service_prices"
    ADD CONSTRAINT "uxb_service_prices_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "uxp"."services"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "uxp"."service_prices"
    ADD CONSTRAINT "uxb_service_prices_size_class_id_fkey"
    FOREIGN KEY ("size_class_id") REFERENCES "uxp"."vehicle_size_classes"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "uxp"."jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "size_class_id" UUID,
    "stage" TEXT NOT NULL DEFAULT 'reception',
    "visit_id" UUID,
    "advisor_id" UUID,
    "odometer" INTEGER,
    "complaint" TEXT,
    "notes" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "invoice_id" UUID,
    "promised_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "uxb_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uxb_jobs_organization_id_number_key" ON "uxp"."jobs"("organization_id", "number");
CREATE INDEX "uxb_jobs_branch_id_stage_idx" ON "uxp"."jobs"("branch_id", "stage");
CREATE INDEX "uxb_jobs_customer_id_idx" ON "uxp"."jobs"("customer_id");
CREATE INDEX "uxb_jobs_vehicle_id_idx" ON "uxp"."jobs"("vehicle_id");
CREATE INDEX "uxb_jobs_visit_id_idx" ON "uxp"."jobs"("visit_id");

ALTER TABLE "uxp"."jobs"
    ADD CONSTRAINT "uxb_jobs_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "core"."customers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "uxp"."jobs"
    ADD CONSTRAINT "uxb_jobs_vehicle_id_fkey"
    FOREIGN KEY ("vehicle_id") REFERENCES "promotors"."vehicles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "uxp"."jobs"
    ADD CONSTRAINT "uxb_jobs_visit_id_fkey"
    FOREIGN KEY ("visit_id") REFERENCES "promotors"."vehicle_visits"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "uxp"."jobs"
    ADD CONSTRAINT "uxb_jobs_size_class_id_fkey"
    FOREIGN KEY ("size_class_id") REFERENCES "uxp"."vehicle_size_classes"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "uxp"."job_items" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "zone" TEXT,
    "area_sqm" DECIMAL(10,3),
    "qty" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(14,2) NOT NULL,
    "technician_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "uxb_job_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "uxb_job_items_job_id_idx" ON "uxp"."job_items"("job_id");

ALTER TABLE "uxp"."job_items"
    ADD CONSTRAINT "uxb_job_items_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "uxp"."jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "uxp"."job_items"
    ADD CONSTRAINT "uxb_job_items_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "uxp"."services"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "uxp"."job_zones" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "panel_code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "film_type" TEXT,
    "notes" TEXT,

    CONSTRAINT "uxb_job_zones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uxb_job_zones_job_id_panel_code_key" ON "uxp"."job_zones"("job_id", "panel_code");

ALTER TABLE "uxp"."job_zones"
    ADD CONSTRAINT "uxb_job_zones_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "uxp"."jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "uxp"."paint_readings" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "panel_code" TEXT NOT NULL,
    "thickness_um" DECIMAL(8,2) NOT NULL,
    "notes" TEXT,
    "recorded_by" UUID,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uxb_paint_readings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "uxb_paint_readings_job_id_idx" ON "uxp"."paint_readings"("job_id");

ALTER TABLE "uxp"."paint_readings"
    ADD CONSTRAINT "uxb_paint_readings_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "uxp"."jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "uxp"."material_rolls" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "roll_no" TEXT NOT NULL,
    "width_cm" DECIMAL(8,2) NOT NULL,
    "initial_m" DECIMAL(10,3) NOT NULL,
    "remaining_m" DECIMAL(10,3) NOT NULL,
    "supplier_id" UUID,
    "cost_per_m" DECIMAL(14,4),
    "status" TEXT NOT NULL DEFAULT 'open',
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uxb_material_rolls_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uxb_material_rolls_organization_id_roll_no_key"
    ON "uxp"."material_rolls"("organization_id", "roll_no");
CREATE INDEX "uxb_material_rolls_part_id_idx" ON "uxp"."material_rolls"("part_id");

ALTER TABLE "uxp"."material_rolls"
    ADD CONSTRAINT "uxb_material_rolls_part_id_fkey"
    FOREIGN KEY ("part_id") REFERENCES "inventory"."parts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- A roll can never be consumed past its length.
ALTER TABLE "uxp"."material_rolls"
    ADD CONSTRAINT "uxb_material_rolls_remaining_chk"
    CHECK ("remaining_m" >= 0 AND "remaining_m" <= "initial_m");

CREATE TABLE "uxp"."roll_consumption" (
    "id" UUID NOT NULL,
    "roll_id" UUID NOT NULL,
    "job_item_id" UUID NOT NULL,
    "meters_used" DECIMAL(10,3) NOT NULL,
    "waste_m" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "recorded_by" UUID,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uxb_roll_consumption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "uxb_roll_consumption_roll_id_idx" ON "uxp"."roll_consumption"("roll_id");
CREATE INDEX "uxb_roll_consumption_job_item_id_idx" ON "uxp"."roll_consumption"("job_item_id");

ALTER TABLE "uxp"."roll_consumption"
    ADD CONSTRAINT "uxb_roll_consumption_roll_id_fkey"
    FOREIGN KEY ("roll_id") REFERENCES "uxp"."material_rolls"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "uxp"."roll_consumption"
    ADD CONSTRAINT "uxb_roll_consumption_job_item_id_fkey"
    FOREIGN KEY ("job_item_id") REFERENCES "uxp"."job_items"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
