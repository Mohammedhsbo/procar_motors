-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "core";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "daily_cafe";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "finance";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "inventory";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ops";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "promotors";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "purchasing";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "tireszone";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "uxp";

-- CreateEnum
CREATE TYPE "core"."UserType" AS ENUM ('staff', 'customer');

-- CreateEnum
CREATE TYPE "core"."UserStatus" AS ENUM ('active', 'suspended', 'invited');

-- CreateEnum
CREATE TYPE "core"."CustomerStatus" AS ENUM ('vip', 'active', 'inactive');

-- CreateEnum
CREATE TYPE "promotors"."VisitStatus" AS ENUM ('waiting', 'inspection', 'waitingApproval', 'readyForRepair', 'inProgress', 'waitingParts', 'qualityCheck', 'readyForDelivery', 'completed');

-- CreateEnum
CREATE TYPE "promotors"."Priority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "promotors"."FuelType" AS ENUM ('petrol', 'diesel', 'hybrid', 'electric');

-- CreateEnum
CREATE TYPE "promotors"."TransmissionType" AS ENUM ('auto', 'manual');

-- CreateEnum
CREATE TYPE "promotors"."InspectionResultState" AS ENUM ('ok', 'warning', 'failed');

-- CreateEnum
CREATE TYPE "promotors"."InspectionStatus" AS ENUM ('draft', 'in_progress', 'completed');

-- CreateEnum
CREATE TYPE "promotors"."WorkOrderStatus" AS ENUM ('draft', 'assigned', 'in_progress', 'paused', 'waiting_parts', 'qc', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "promotors"."TechnicianTaskStatus" AS ENUM ('pending', 'assigned', 'in_progress', 'paused', 'completed', 'blocked');

-- CreateEnum
CREATE TYPE "promotors"."QualityCheckStatus" AS ENUM ('pending', 'passed', 'failed');

-- CreateEnum
CREATE TYPE "inventory"."InventoryTxnType" AS ENUM ('purchase_in', 'issue', 'return', 'adjustment', 'transfer_out', 'transfer_in', 'consume');

-- CreateEnum
CREATE TYPE "inventory"."ReservationStatus" AS ENUM ('active', 'released', 'consumed', 'cancelled');

-- CreateEnum
CREATE TYPE "inventory"."StockAlertLevel" AS ENUM ('low', 'out');

-- CreateEnum
CREATE TYPE "inventory"."StockAlertStatus" AS ENUM ('open', 'acknowledged', 'closed');

-- CreateEnum
CREATE TYPE "purchasing"."SupplierStatus" AS ENUM ('active', 'hold', 'inactive');

-- CreateEnum
CREATE TYPE "purchasing"."PurchaseRequestStatus" AS ENUM ('draft', 'pending_approval', 'approved', 'ordered', 'received', 'cancelled');

-- CreateEnum
CREATE TYPE "purchasing"."PurchaseOrderStatus" AS ENUM ('new', 'pending_approval', 'approved', 'partially_received', 'received', 'cancelled');

-- CreateEnum
CREATE TYPE "finance"."QuotationStatus" AS ENUM ('draft', 'sent', 'pending', 'approved', 'rejected', 'expired', 'superseded');

-- CreateEnum
CREATE TYPE "finance"."QuotationItemKind" AS ENUM ('labor', 'service', 'part', 'diagnostics', 'other');

-- CreateEnum
CREATE TYPE "finance"."ApprovalActorType" AS ENUM ('customer', 'staff');

-- CreateEnum
CREATE TYPE "finance"."ApprovalDecision" AS ENUM ('approve', 'reject', 'request_changes');

-- CreateEnum
CREATE TYPE "finance"."InvoiceStatus" AS ENUM ('draft', 'issued', 'partial', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "finance"."PaymentMethod" AS ENUM ('cash', 'card', 'visa', 'bank_transfer', 'wallet', 'other');

-- CreateEnum
CREATE TYPE "finance"."PaymentStatus" AS ENUM ('pending', 'confirmed', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "ops"."AttachmentKind" AS ENUM ('photo', 'video', 'document', 'pdf');

-- CreateEnum
CREATE TYPE "ops"."AttachmentPhase" AS ENUM ('before', 'during', 'after', 'other');

-- CreateEnum
CREATE TYPE "ops"."OutboxStatus" AS ENUM ('pending', 'published', 'failed');

-- CreateEnum
CREATE TYPE "ops"."SyncOpStatus" AS ENUM ('pending', 'applied', 'conflict', 'failed');

-- CreateTable
CREATE TABLE "core"."organizations" (
    "id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "tax_id" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "logo_file_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."branches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Cairo',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."departments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."employees" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "department_id" UUID,
    "code" TEXT,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "phone" TEXT,
    "job_title" TEXT,
    "hire_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."users" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID,
    "customer_id" UUID,
    "email" TEXT,
    "username" TEXT,
    "password_hash" TEXT NOT NULL,
    "user_type" "core"."UserType" NOT NULL,
    "status" "core"."UserStatus" NOT NULL DEFAULT 'active',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "core"."user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "branch_id" UUID,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "core"."user_branch_access" (
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,

    CONSTRAINT "user_branch_access_pkey" PRIMARY KEY ("user_id","branch_id")
);

-- CreateTable
CREATE TABLE "core"."customers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsapp" TEXT,
    "email" TEXT,
    "status" "core"."CustomerStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "preferred_branch_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."system_settings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "request_id" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "device_info" TEXT,
    "ip" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "rotated_from" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotors"."vehicles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "plate" TEXT NOT NULL,
    "plate_normalized" TEXT NOT NULL,
    "vin" TEXT,
    "engine_number" TEXT,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "color" TEXT,
    "fuel_type" "promotors"."FuelType",
    "transmission" "promotors"."TransmissionType",
    "mileage_current" INTEGER,
    "photo_file_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotors"."vehicle_visits" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "status" "promotors"."VisitStatus" NOT NULL DEFAULT 'waiting',
    "priority" "promotors"."Priority" NOT NULL DEFAULT 'normal',
    "advisor_id" UUID,
    "mileage_in" INTEGER,
    "fuel_level_pct" INTEGER,
    "exterior_condition" TEXT,
    "complaint" TEXT,
    "expected_delivery_at" TIMESTAMPTZ(6),
    "progress_pct" INTEGER NOT NULL DEFAULT 0,
    "checked_in_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "vehicle_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotors"."visit_damage_points" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "x_pct" DECIMAL(5,2) NOT NULL,
    "y_pct" DECIMAL(5,2) NOT NULL,
    "label_en" TEXT NOT NULL,
    "label_ar" TEXT NOT NULL,
    "severity" TEXT,

    CONSTRAINT "visit_damage_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotors"."job_tickets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "advisor_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "job_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotors"."inspection_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inspection_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotors"."inspection_template_items" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "category" TEXT,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "requires_measurement" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "inspection_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotors"."inspections" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "template_version" INTEGER NOT NULL,
    "inspector_id" UUID,
    "status" "promotors"."InspectionStatus" NOT NULL DEFAULT 'draft',
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "estimated_total" DECIMAL(14,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotors"."inspection_results" (
    "id" UUID NOT NULL,
    "inspection_id" UUID NOT NULL,
    "template_item_id" UUID NOT NULL,
    "state" "promotors"."InspectionResultState" NOT NULL,
    "note" TEXT,
    "measurement" TEXT,
    "photo_file_ids" UUID[] DEFAULT ARRAY[]::UUID[],

    CONSTRAINT "inspection_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotors"."inspection_findings" (
    "id" UUID NOT NULL,
    "inspection_id" UUID NOT NULL,
    "title_en" TEXT NOT NULL,
    "title_ar" TEXT NOT NULL,
    "cause_en" TEXT,
    "cause_ar" TEXT,
    "severity" TEXT,
    "recommended_action_en" TEXT,
    "recommended_action_ar" TEXT,
    "estimated_minutes" INTEGER,

    CONSTRAINT "inspection_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotors"."workshop_bays" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "workshop_bays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotors"."work_orders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "job_ticket_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "promotors"."WorkOrderStatus" NOT NULL DEFAULT 'draft',
    "priority" "promotors"."Priority" NOT NULL DEFAULT 'normal',
    "technician_id" UUID,
    "bay_id" UUID,
    "estimated_minutes" INTEGER,
    "actual_minutes" INTEGER,
    "progress_pct" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "parent_work_order_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotors"."technician_tasks" (
    "id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "assignee_id" UUID,
    "title" TEXT NOT NULL,
    "status" "promotors"."TechnicianTaskStatus" NOT NULL DEFAULT 'pending',
    "priority" "promotors"."Priority" NOT NULL DEFAULT 'normal',
    "estimated_minutes" INTEGER,
    "elapsed_seconds" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6),
    "paused_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "blocked_reason" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "technician_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotors"."quality_checks" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "inspector_id" UUID,
    "status" "promotors"."QualityCheckStatus" NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quality_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotors"."quality_check_items" (
    "id" UUID NOT NULL,
    "quality_check_id" UUID NOT NULL,
    "label_en" TEXT NOT NULL,
    "label_ar" TEXT NOT NULL,
    "passed" BOOLEAN,

    CONSTRAINT "quality_check_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotors"."services" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "labor_price" DECIMAL(14,2) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotors"."warranties" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "work_order_id" UUID,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "valid_until" DATE,
    "valid_until_mileage" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warranties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."warehouses" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."part_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "parent_id" UUID,

    CONSTRAINT "part_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."parts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "oem_number" TEXT,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "category_id" UUID,
    "brand" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "cost_price" DECIMAL(14,2) NOT NULL,
    "sell_price" DECIMAL(14,2) NOT NULL,
    "min_stock" INTEGER NOT NULL DEFAULT 0,
    "max_stock" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."stock_balances" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "on_hand" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "bin_location" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."inventory_transactions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "type" "inventory"."InventoryTxnType" NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unit_cost" DECIMAL(14,2),
    "reference_type" TEXT,
    "reference_id" UUID,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."stock_reservations" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "qty_consumed" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "status" "inventory"."ReservationStatus" NOT NULL DEFAULT 'active',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."stock_alerts" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "level" "inventory"."StockAlertLevel" NOT NULL,
    "status" "inventory"."StockAlertStatus" NOT NULL DEFAULT 'open',
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(6),

    CONSTRAINT "stock_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchasing"."suppliers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "tax_id" TEXT,
    "rating" DECIMAL(3,2),
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "purchasing"."SupplierStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchasing"."purchase_requests" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "requested_by" UUID,
    "status" "purchasing"."PurchaseRequestStatus" NOT NULL DEFAULT 'draft',
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchasing"."purchase_request_items" (
    "id" UUID NOT NULL,
    "pr_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "purchase_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchasing"."purchase_orders" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "purchasing"."PurchaseOrderStatus" NOT NULL DEFAULT 'new',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchasing"."purchase_order_items" (
    "id" UUID NOT NULL,
    "po_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "qty_ordered" DECIMAL(14,3) NOT NULL,
    "qty_received" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchasing"."goods_receipts" (
    "id" UUID NOT NULL,
    "po_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "received_by" UUID,
    "received_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchasing"."goods_receipt_items" (
    "id" UUID NOT NULL,
    "grn_id" UUID NOT NULL,
    "po_item_id" UUID NOT NULL,
    "qty_received" DECIMAL(14,3) NOT NULL,
    "qty_rejected" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "unit_cost_actual" DECIMAL(14,2),

    CONSTRAINT "goods_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."tax_rates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."quotations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "job_ticket_id" UUID,
    "customer_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "number" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "parent_quotation_id" UUID,
    "status" "finance"."QuotationStatus" NOT NULL DEFAULT 'draft',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "estimated_minutes" INTEGER,
    "valid_until" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."quotation_items" (
    "id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "kind" "finance"."QuotationItemKind" NOT NULL,
    "part_id" UUID,
    "service_id" UUID,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."quotation_approvals" (
    "id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "actor_type" "finance"."ApprovalActorType" NOT NULL,
    "actor_id" UUID,
    "decision" "finance"."ApprovalDecision" NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."invoices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "visit_id" UUID,
    "job_ticket_id" UUID,
    "work_order_id" UUID,
    "quotation_id" UUID,
    "customer_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "finance"."InvoiceStatus" NOT NULL DEFAULT 'draft',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount_paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "issued_at" TIMESTAMPTZ(6),
    "due_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."invoice_items" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."payments" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "finance"."PaymentMethod" NOT NULL,
    "status" "finance"."PaymentStatus" NOT NULL DEFAULT 'pending',
    "received_by" UUID,
    "paid_at" TIMESTAMPTZ(6),
    "reference" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT,
    "approved_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."expenses" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "expense_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops"."attachments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "file_key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "kind" "ops"."AttachmentKind" NOT NULL,
    "phase" "ops"."AttachmentPhase" NOT NULL DEFAULT 'other',
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops"."notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "title_ar" TEXT NOT NULL,
    "body_en" TEXT,
    "body_ar" TEXT,
    "entity_type" TEXT,
    "entity_id" UUID,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops"."notification_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops"."tasks" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "assignee_id" UUID,
    "type" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "title" TEXT NOT NULL,
    "priority" "promotors"."Priority" NOT NULL DEFAULT 'normal',
    "due_at" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops"."idempotency_keys" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "user_id" UUID,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops"."sync_operations" (
    "id" UUID NOT NULL,
    "client_id" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ops"."SyncOpStatus" NOT NULL DEFAULT 'pending',
    "conflict_info" JSONB,
    "server_entity_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "sync_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops"."outbox_events" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ops"."OutboxStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "retry_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uxp"."profiles" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "loyalty_pts" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tireszone"."products" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "size" TEXT,
    "brand" TEXT,
    "part_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tireszone"."orders" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "visit_id" UUID,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_cafe"."orders" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_id" UUID,
    "visit_id" UUID,
    "employee_id" UUID,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branches_organization_id_code_key" ON "core"."branches"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_id_key" ON "core"."users"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_customer_id_key" ON "core"."users"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_organization_id_email_key" ON "core"."users"("organization_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_key_key" ON "core"."roles"("organization_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "core"."permissions"("key");

-- CreateIndex
CREATE INDEX "customers_name_en_idx" ON "core"."customers"("name_en");

-- CreateIndex
CREATE INDEX "customers_name_ar_idx" ON "core"."customers"("name_ar");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_phone_key" ON "core"."customers"("organization_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_organization_id_key_key" ON "core"."system_settings"("organization_id", "key");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "core"."audit_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_branch_id_created_at_idx" ON "core"."audit_logs"("branch_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "core"."audit_logs"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "core"."refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_token_hash_idx" ON "core"."refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "vehicles_plate_normalized_idx" ON "promotors"."vehicles"("plate_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_organization_id_plate_normalized_key" ON "promotors"."vehicles"("organization_id", "plate_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_organization_id_vin_key" ON "promotors"."vehicles"("organization_id", "vin");

-- CreateIndex
CREATE INDEX "vehicle_visits_branch_id_status_idx" ON "promotors"."vehicle_visits"("branch_id", "status");

-- CreateIndex
CREATE INDEX "vehicle_visits_branch_id_checked_in_at_idx" ON "promotors"."vehicle_visits"("branch_id", "checked_in_at");

-- CreateIndex
CREATE INDEX "vehicle_visits_vehicle_id_idx" ON "promotors"."vehicle_visits"("vehicle_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_tickets_visit_id_key" ON "promotors"."job_tickets"("visit_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_tickets_organization_id_number_key" ON "promotors"."job_tickets"("organization_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_templates_organization_id_code_version_key" ON "promotors"."inspection_templates"("organization_id", "code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_bays_branch_id_code_key" ON "promotors"."workshop_bays"("branch_id", "code");

-- CreateIndex
CREATE INDEX "work_orders_branch_id_status_idx" ON "promotors"."work_orders"("branch_id", "status");

-- CreateIndex
CREATE INDEX "work_orders_technician_id_idx" ON "promotors"."work_orders"("technician_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_organization_id_number_key" ON "promotors"."work_orders"("organization_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "services_organization_id_code_key" ON "promotors"."services"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_branch_id_code_key" ON "inventory"."warehouses"("branch_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "parts_organization_id_sku_key" ON "inventory"."parts"("organization_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "parts_organization_id_barcode_key" ON "inventory"."parts"("organization_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_warehouse_id_part_id_key" ON "inventory"."stock_balances"("warehouse_id", "part_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_part_id_created_at_idx" ON "inventory"."inventory_transactions"("part_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_transactions_branch_id_created_at_idx" ON "inventory"."inventory_transactions"("branch_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_branch_id_number_key" ON "purchasing"."purchase_requests"("branch_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_branch_id_number_key" ON "purchasing"."purchase_orders"("branch_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_organization_id_number_version_key" ON "finance"."quotations"("organization_id", "number", "version");

-- CreateIndex
CREATE INDEX "invoices_branch_id_status_idx" ON "finance"."invoices"("branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organization_id_number_key" ON "finance"."invoices"("organization_id", "number");

-- CreateIndex
CREATE INDEX "payments_paid_at_idx" ON "finance"."payments"("paid_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_branch_id_number_key" ON "finance"."payments"("branch_id", "number");

-- CreateIndex
CREATE INDEX "attachments_entity_type_entity_id_idx" ON "ops"."attachments"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "ops"."notifications"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_channel_event_key_key" ON "ops"."notification_preferences"("user_id", "channel", "event_key");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_key_key" ON "ops"."idempotency_keys"("key");

-- CreateIndex
CREATE UNIQUE INDEX "sync_operations_client_id_operation_id_key" ON "ops"."sync_operations"("client_id", "operation_id");

-- CreateIndex
CREATE INDEX "outbox_events_status_created_at_idx" ON "ops"."outbox_events"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_customer_id_key" ON "uxp"."profiles"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "tireszone"."products"("sku");

-- AddForeignKey
ALTER TABLE "core"."branches" ADD CONSTRAINT "branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "core"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."departments" ADD CONSTRAINT "departments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "core"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."departments" ADD CONSTRAINT "departments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "core"."branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."employees" ADD CONSTRAINT "employees_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "core"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."employees" ADD CONSTRAINT "employees_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "core"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."employees" ADD CONSTRAINT "employees_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "core"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."users" ADD CONSTRAINT "users_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."users" ADD CONSTRAINT "users_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "core"."customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "core"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "core"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "core"."permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "core"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."user_roles" ADD CONSTRAINT "user_roles_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "core"."branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."user_branch_access" ADD CONSTRAINT "user_branch_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."user_branch_access" ADD CONSTRAINT "user_branch_access_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "core"."branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."customers" ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "core"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."customers" ADD CONSTRAINT "customers_preferred_branch_id_fkey" FOREIGN KEY ("preferred_branch_id") REFERENCES "core"."branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."system_settings" ADD CONSTRAINT "system_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "core"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "core"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."vehicles" ADD CONSTRAINT "vehicles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "core"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."vehicles" ADD CONSTRAINT "vehicles_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "core"."customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."vehicle_visits" ADD CONSTRAINT "vehicle_visits_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "core"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."vehicle_visits" ADD CONSTRAINT "vehicle_visits_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "core"."customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."vehicle_visits" ADD CONSTRAINT "vehicle_visits_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "promotors"."vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."visit_damage_points" ADD CONSTRAINT "visit_damage_points_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "promotors"."vehicle_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."job_tickets" ADD CONSTRAINT "job_tickets_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "promotors"."vehicle_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."inspection_template_items" ADD CONSTRAINT "inspection_template_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "promotors"."inspection_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."inspections" ADD CONSTRAINT "inspections_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "promotors"."vehicle_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."inspections" ADD CONSTRAINT "inspections_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "promotors"."inspection_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."inspection_results" ADD CONSTRAINT "inspection_results_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "promotors"."inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."inspection_results" ADD CONSTRAINT "inspection_results_template_item_id_fkey" FOREIGN KEY ("template_item_id") REFERENCES "promotors"."inspection_template_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."inspection_findings" ADD CONSTRAINT "inspection_findings_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "promotors"."inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."work_orders" ADD CONSTRAINT "work_orders_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "promotors"."vehicle_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."work_orders" ADD CONSTRAINT "work_orders_job_ticket_id_fkey" FOREIGN KEY ("job_ticket_id") REFERENCES "promotors"."job_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."work_orders" ADD CONSTRAINT "work_orders_bay_id_fkey" FOREIGN KEY ("bay_id") REFERENCES "promotors"."workshop_bays"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."work_orders" ADD CONSTRAINT "work_orders_parent_work_order_id_fkey" FOREIGN KEY ("parent_work_order_id") REFERENCES "promotors"."work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."technician_tasks" ADD CONSTRAINT "technician_tasks_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "promotors"."work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."quality_checks" ADD CONSTRAINT "quality_checks_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "promotors"."vehicle_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."quality_checks" ADD CONSTRAINT "quality_checks_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "promotors"."work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."quality_check_items" ADD CONSTRAINT "quality_check_items_quality_check_id_fkey" FOREIGN KEY ("quality_check_id") REFERENCES "promotors"."quality_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."services" ADD CONSTRAINT "services_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "core"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."warranties" ADD CONSTRAINT "warranties_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "promotors"."vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotors"."warranties" ADD CONSTRAINT "warranties_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "promotors"."work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."warehouses" ADD CONSTRAINT "warehouses_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "core"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."part_categories" ADD CONSTRAINT "part_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "core"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."part_categories" ADD CONSTRAINT "part_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "inventory"."part_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."parts" ADD CONSTRAINT "parts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "core"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."parts" ADD CONSTRAINT "parts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "inventory"."part_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."stock_balances" ADD CONSTRAINT "stock_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "inventory"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."stock_balances" ADD CONSTRAINT "stock_balances_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "inventory"."parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."inventory_transactions" ADD CONSTRAINT "inventory_transactions_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "inventory"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."inventory_transactions" ADD CONSTRAINT "inventory_transactions_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "inventory"."parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."stock_reservations" ADD CONSTRAINT "stock_reservations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "inventory"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."stock_reservations" ADD CONSTRAINT "stock_reservations_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "inventory"."parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."stock_reservations" ADD CONSTRAINT "stock_reservations_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "promotors"."work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."stock_reservations" ADD CONSTRAINT "stock_reservations_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "promotors"."vehicle_visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."stock_alerts" ADD CONSTRAINT "stock_alerts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "inventory"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."stock_alerts" ADD CONSTRAINT "stock_alerts_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "inventory"."parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchasing"."suppliers" ADD CONSTRAINT "suppliers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "core"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchasing"."purchase_request_items" ADD CONSTRAINT "purchase_request_items_pr_id_fkey" FOREIGN KEY ("pr_id") REFERENCES "purchasing"."purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchasing"."purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "purchasing"."suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchasing"."purchase_order_items" ADD CONSTRAINT "purchase_order_items_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchasing"."purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchasing"."goods_receipts" ADD CONSTRAINT "goods_receipts_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchasing"."purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchasing"."goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_grn_id_fkey" FOREIGN KEY ("grn_id") REFERENCES "purchasing"."goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchasing"."goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_po_item_id_fkey" FOREIGN KEY ("po_item_id") REFERENCES "purchasing"."purchase_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."tax_rates" ADD CONSTRAINT "tax_rates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "core"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."quotations" ADD CONSTRAINT "quotations_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "promotors"."vehicle_visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."quotations" ADD CONSTRAINT "quotations_job_ticket_id_fkey" FOREIGN KEY ("job_ticket_id") REFERENCES "promotors"."job_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."quotations" ADD CONSTRAINT "quotations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "core"."customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."quotations" ADD CONSTRAINT "quotations_parent_quotation_id_fkey" FOREIGN KEY ("parent_quotation_id") REFERENCES "finance"."quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."quotation_items" ADD CONSTRAINT "quotation_items_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "finance"."quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."quotation_approvals" ADD CONSTRAINT "quotation_approvals_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "finance"."quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."invoices" ADD CONSTRAINT "invoices_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "promotors"."vehicle_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."invoices" ADD CONSTRAINT "invoices_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "promotors"."work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."invoices" ADD CONSTRAINT "invoices_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "finance"."quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "core"."customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "finance"."invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "finance"."invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "finance"."payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."refunds" ADD CONSTRAINT "refunds_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "finance"."invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uxp"."profiles" ADD CONSTRAINT "profiles_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "core"."customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tireszone"."orders" ADD CONSTRAINT "orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "tireszone"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tireszone"."orders" ADD CONSTRAINT "orders_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "promotors"."vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_cafe"."orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "core"."customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_cafe"."orders" ADD CONSTRAINT "orders_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "promotors"."vehicle_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Stock balance integrity checks
ALTER TABLE "inventory"."stock_balances"
  ADD CONSTRAINT "stock_balances_on_hand_nonneg" CHECK ("on_hand" >= 0),
  ADD CONSTRAINT "stock_balances_reserved_nonneg" CHECK ("reserved" >= 0),
  ADD CONSTRAINT "stock_balances_reserved_lte_on_hand" CHECK ("reserved" <= "on_hand");

-- Enable trigram search (Phase 4 will use it; safe to create early)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
