-- Phase 16: customer portal feedback
CREATE TABLE IF NOT EXISTS ops.portal_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  visit_id UUID NULL,
  rating INT NULL,
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS portal_feedback_customer_id_created_at_idx
  ON ops.portal_feedback (customer_id, created_at);

CREATE INDEX IF NOT EXISTS portal_feedback_organization_id_created_at_idx
  ON ops.portal_feedback (organization_id, created_at);
