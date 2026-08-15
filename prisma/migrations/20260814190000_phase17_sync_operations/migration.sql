-- Phase 17: scope sync operations for status lookup and audit
ALTER TABLE ops.sync_operations
  ADD COLUMN IF NOT EXISTS organization_id UUID,
  ADD COLUMN IF NOT EXISTS actor_id UUID,
  ADD COLUMN IF NOT EXISTS branch_id UUID,
  ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'create',
  ADD COLUMN IF NOT EXISTS result JSONB;

CREATE INDEX IF NOT EXISTS sync_operations_organization_id_operation_id_idx
  ON ops.sync_operations (organization_id, operation_id);

CREATE INDEX IF NOT EXISTS sync_operations_actor_id_created_at_idx
  ON ops.sync_operations (actor_id, created_at);
