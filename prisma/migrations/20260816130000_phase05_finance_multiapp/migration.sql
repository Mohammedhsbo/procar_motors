-- Phase 05 — one financial ledger for four applications (decision D6).
-- Every sale, in any app, issues a finance.invoice tagged with its source.

ALTER TABLE "finance"."invoices"
    ADD COLUMN "source_app" TEXT NOT NULL DEFAULT 'promotors',
    ADD COLUMN "source_ref_type" TEXT,
    ADD COLUMN "source_ref" UUID;

CREATE INDEX "invoices_source_app_source_ref_idx"
    ON "finance"."invoices"("source_app", "source_ref");

-- Egyptian payment rails used across the group.
ALTER TYPE "finance"."PaymentMethod" ADD VALUE IF NOT EXISTS 'instapay';
ALTER TYPE "finance"."PaymentMethod" ADD VALUE IF NOT EXISTS 'vodafone_cash';
