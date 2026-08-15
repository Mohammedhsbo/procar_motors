import { SyncOpStatus } from '@prisma/client';

export const SYNC_ALLOWED = new Set([
  'customer:create',
  'vehicle:create',
  'vehicle_visit:create',
  'vehicle_visit:update',
  'attachment:create',
]);

export const SYNC_FORBIDDEN_ENTITIES = new Set([
  'payment',
  'payments',
  'invoice',
  'invoices',
  'stock',
  'inventory',
  'reservation',
  'quotation',
  'quotations',
  'purchase_order',
  'purchase_request',
  'goods_receipt',
  'expense',
  'expenses',
  'po',
  'grn',
]);

export type SyncOpInput = {
  operationId: string;
  idempotencyKey?: string;
  entityType: string;
  action: string;
  clientTimestamp: string;
  payload: Record<string, unknown>;
};

export type SyncOpResult = {
  operationId: string;
  status: SyncOpStatus;
  serverEntityId?: string | null;
  merged?: boolean;
  conflict?: {
    code: string;
    message: string;
    server?: unknown;
    client?: unknown;
  };
  error?: {
    code: string;
    message: string;
  };
};

export function syncKey(entityType: string, action: string) {
  return `${entityType}:${action}`.toLowerCase();
}
