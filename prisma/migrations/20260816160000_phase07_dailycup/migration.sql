-- Phase 07 — Daily Cup domain: cafe operations and recipe costing.
-- Replaces the placeholder daily_cafe.orders table. Ingredients are
-- inventory.parts rows in a per-branch cafe warehouse (decision D5).

DROP TABLE IF EXISTS "daily_cafe"."orders";

CREATE TABLE "daily_cafe"."categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cafe_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cafe_categories_organization_id_code_key"
    ON "daily_cafe"."categories"("organization_id", "code");

CREATE TABLE "daily_cafe"."recipes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "yield_qty" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "yield_unit" TEXT NOT NULL DEFAULT 'unit',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cafe_recipes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cafe_recipes_organization_id_code_key"
    ON "daily_cafe"."recipes"("organization_id", "code");

CREATE TABLE "daily_cafe"."recipe_items" (
    "id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "qty" DECIMAL(14,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "waste_pct" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cafe_recipe_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cafe_recipe_items_recipe_id_part_id_key"
    ON "daily_cafe"."recipe_items"("recipe_id", "part_id");

ALTER TABLE "daily_cafe"."recipe_items"
    ADD CONSTRAINT "cafe_recipe_items_recipe_id_fkey"
    FOREIGN KEY ("recipe_id") REFERENCES "daily_cafe"."recipes"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "daily_cafe"."recipe_items"
    ADD CONSTRAINT "cafe_recipe_items_part_id_fkey"
    FOREIGN KEY ("part_id") REFERENCES "inventory"."parts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "daily_cafe"."products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "description" TEXT,
    "image_file_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cafe_products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cafe_products_organization_id_code_key"
    ON "daily_cafe"."products"("organization_id", "code");
CREATE INDEX "cafe_products_category_id_idx" ON "daily_cafe"."products"("category_id");

ALTER TABLE "daily_cafe"."products"
    ADD CONSTRAINT "cafe_products_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "daily_cafe"."categories"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "daily_cafe"."product_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "size" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "recipe_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cafe_product_variants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cafe_product_variants_product_id_size_key"
    ON "daily_cafe"."product_variants"("product_id", "size");

ALTER TABLE "daily_cafe"."product_variants"
    ADD CONSTRAINT "cafe_product_variants_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "daily_cafe"."products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "daily_cafe"."product_variants"
    ADD CONSTRAINT "cafe_product_variants_recipe_id_fkey"
    FOREIGN KEY ("recipe_id") REFERENCES "daily_cafe"."recipes"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "daily_cafe"."modifiers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "price_delta" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ingredient_part_id" UUID,
    "qty" DECIMAL(14,4),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cafe_modifiers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cafe_modifiers_organization_id_code_key"
    ON "daily_cafe"."modifiers"("organization_id", "code");

ALTER TABLE "daily_cafe"."modifiers"
    ADD CONSTRAINT "cafe_modifiers_ingredient_part_id_fkey"
    FOREIGN KEY ("ingredient_part_id") REFERENCES "inventory"."parts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "daily_cafe"."cash_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "opened_by" UUID NOT NULL,
    "closed_by" UUID,
    "opening_float" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expected_cash" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "closing_count" DECIMAL(14,2),
    "variance" DECIMAL(14,2),
    "status" TEXT NOT NULL DEFAULT 'open',
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(6),
    "notes" TEXT,

    CONSTRAINT "cafe_cash_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cafe_cash_sessions_branch_id_status_idx"
    ON "daily_cafe"."cash_sessions"("branch_id", "status");

CREATE TABLE "daily_cafe"."orders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'takeaway',
    "status" TEXT NOT NULL DEFAULT 'open',
    "customer_id" UUID,
    "visit_id" UUID,
    "session_id" UUID,
    "table_ref" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cost_total" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "invoice_id" UUID,
    "employee_id" UUID,
    "ready_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cafe_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cafe_orders_organization_id_number_key"
    ON "daily_cafe"."orders"("organization_id", "number");
CREATE INDEX "cafe_orders_branch_id_status_idx" ON "daily_cafe"."orders"("branch_id", "status");
CREATE INDEX "cafe_orders_visit_id_idx" ON "daily_cafe"."orders"("visit_id");

ALTER TABLE "daily_cafe"."orders"
    ADD CONSTRAINT "cafe_orders_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "core"."customers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "daily_cafe"."orders"
    ADD CONSTRAINT "cafe_orders_visit_id_fkey"
    FOREIGN KEY ("visit_id") REFERENCES "promotors"."vehicle_visits"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "daily_cafe"."orders"
    ADD CONSTRAINT "cafe_orders_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "daily_cafe"."cash_sessions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "daily_cafe"."order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(14,2) NOT NULL,
    "modifiers" JSONB,
    "cost_snapshot" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cafe_order_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cafe_order_items_order_id_idx" ON "daily_cafe"."order_items"("order_id");

ALTER TABLE "daily_cafe"."order_items"
    ADD CONSTRAINT "cafe_order_items_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "daily_cafe"."orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "daily_cafe"."order_items"
    ADD CONSTRAINT "cafe_order_items_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "daily_cafe"."product_variants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "daily_cafe"."waste_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "qty" DECIMAL(14,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "cost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "recorded_by" UUID,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "cafe_waste_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cafe_waste_logs_branch_id_recorded_at_idx"
    ON "daily_cafe"."waste_logs"("branch_id", "recorded_at");

ALTER TABLE "daily_cafe"."waste_logs"
    ADD CONSTRAINT "cafe_waste_logs_part_id_fkey"
    FOREIGN KEY ("part_id") REFERENCES "inventory"."parts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
