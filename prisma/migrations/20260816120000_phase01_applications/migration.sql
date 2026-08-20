-- Phase 01 — multi-application identity
-- Adds the application registry, per-user application access, per-branch
-- application enablement, and an application dimension on roles/permissions.

CREATE TABLE "core"."applications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "description" TEXT,
    "base_url" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "applications_organization_id_code_key"
    ON "core"."applications"("organization_id", "code");

ALTER TABLE "core"."applications"
    ADD CONSTRAINT "applications_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "core"."organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "core"."user_app_access" (
    "user_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "granted_by" UUID,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_app_access_pkey" PRIMARY KEY ("user_id", "application_id")
);

CREATE INDEX "user_app_access_application_id_idx"
    ON "core"."user_app_access"("application_id");

ALTER TABLE "core"."user_app_access"
    ADD CONSTRAINT "user_app_access_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "core"."users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "core"."user_app_access"
    ADD CONSTRAINT "user_app_access_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "core"."applications"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "core"."branch_applications" (
    "branch_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "branch_applications_pkey" PRIMARY KEY ("branch_id", "application_id")
);

CREATE INDEX "branch_applications_application_id_idx"
    ON "core"."branch_applications"("application_id");

ALTER TABLE "core"."branch_applications"
    ADD CONSTRAINT "branch_applications_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "core"."branches"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "core"."branch_applications"
    ADD CONSTRAINT "branch_applications_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "core"."applications"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Application scope on roles and permissions. NULL = spans every application,
-- which keeps every existing row valid.
ALTER TABLE "core"."roles" ADD COLUMN "application_code" TEXT;
ALTER TABLE "core"."permissions" ADD COLUMN "application_code" TEXT;

CREATE INDEX "roles_application_code_idx" ON "core"."roles"("application_code");
CREATE INDEX "permissions_application_code_idx" ON "core"."permissions"("application_code");
