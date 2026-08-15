/**
 * Architecture §18.2 — in-app notification routing.
 */
export type NotificationRoute = {
  eventType: string;
  category: string;
  roles: string[];
  titleEn: (p: Record<string, unknown>) => string;
  titleAr: (p: Record<string, unknown>) => string;
  bodyEn?: (p: Record<string, unknown>) => string;
  bodyAr?: (p: Record<string, unknown>) => string;
  entityType?: string;
  entityId?: (p: Record<string, unknown>) => string | null;
};

function asText(value: unknown, fallback = ''): string {
  if (value == null) return fallback;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  return fallback;
}

function asId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export const NOTIFICATION_ROUTES: NotificationRoute[] = [
  {
    eventType: 'vehicle.visit.created',
    category: 'workshop',
    roles: ['advisor', 'reception', 'super_admin'],
    titleEn: () => 'New vehicle check-in',
    titleAr: () => 'تسجيل مركبة جديدة',
    bodyEn: (p) => `Visit ${asText(p.visitId)} checked in`,
    bodyAr: (p) => `تم تسجيل الزيارة ${asText(p.visitId)}`,
    entityType: 'VehicleVisit',
    entityId: (p) => asId(p.visitId),
  },
  {
    eventType: 'inspection.completed',
    category: 'workshop',
    roles: ['advisor', 'super_admin'],
    titleEn: () => 'Inspection completed',
    titleAr: () => 'اكتمل الفحص',
    entityType: 'Inspection',
    entityId: (p) => asId(p.inspectionId),
  },
  {
    eventType: 'quotation.sent',
    category: 'approvals',
    roles: ['advisor', 'super_admin'],
    titleEn: (p) => `Quotation sent ${asText(p.number)}`,
    titleAr: (p) => `تم إرسال عرض السعر ${asText(p.number)}`,
    entityType: 'Quotation',
    entityId: (p) => asId(p.quotationId),
  },
  {
    eventType: 'quotation.approved',
    category: 'approvals',
    roles: ['advisor', 'workshop_manager', 'technician', 'super_admin'],
    titleEn: (p) => `Quotation approved ${asText(p.number)}`,
    titleAr: (p) => `تمت الموافقة على عرض السعر ${asText(p.number)}`,
    entityType: 'Quotation',
    entityId: (p) => asId(p.quotationId),
  },
  {
    eventType: 'quotation.rejected',
    category: 'approvals',
    roles: ['advisor', 'super_admin'],
    titleEn: (p) => `Quotation rejected ${asText(p.number)}`,
    titleAr: (p) => `تم رفض عرض السعر ${asText(p.number)}`,
    entityType: 'Quotation',
    entityId: (p) => asId(p.quotationId),
  },
  {
    eventType: 'inventory.parts_unavailable',
    category: 'inventory',
    roles: [
      'store_keeper',
      'warehouse_manager',
      'purchasing_officer',
      'purchasing_manager',
      'super_admin',
    ],
    titleEn: () => 'Parts unavailable',
    titleAr: () => 'قطع غير متوفرة',
    entityType: 'WorkOrder',
    entityId: (p) => asId(p.workOrderId),
  },
  {
    eventType: 'inventory.low_stock',
    category: 'inventory',
    roles: ['store_keeper', 'warehouse_manager', 'super_admin'],
    titleEn: () => 'Low stock alert',
    titleAr: () => 'تنبيه نقص مخزون',
    entityType: 'Part',
    entityId: (p) => asId(p.partId),
  },
  {
    eventType: 'purchase.order.approved',
    category: 'purchasing',
    roles: [
      'store_keeper',
      'purchasing_officer',
      'purchasing_manager',
      'super_admin',
    ],
    titleEn: (p) => `PO approved ${asText(p.number)}`,
    titleAr: (p) => `تمت الموافقة على أمر الشراء ${asText(p.number)}`,
    entityType: 'PurchaseOrder',
    entityId: (p) => asId(p.purchaseOrderId),
  },
  {
    eventType: 'vehicle.ready',
    category: 'delivery',
    roles: ['reception', 'advisor', 'super_admin'],
    titleEn: () => 'Vehicle ready for delivery',
    titleAr: () => 'المركبة جاهزة للتسليم',
    entityType: 'VehicleVisit',
    entityId: (p) => asId(p.visitId),
  },
  {
    eventType: 'vehicle.delivered',
    category: 'delivery',
    roles: ['reception', 'advisor', 'accountant', 'super_admin'],
    titleEn: () => 'Vehicle delivered',
    titleAr: () => 'تم تسليم المركبة',
    entityType: 'VehicleVisit',
    entityId: (p) => asId(p.visitId),
  },
  {
    eventType: 'payment.received',
    category: 'finance',
    roles: ['accountant', 'reception', 'super_admin'],
    titleEn: (p) => `Payment received ${asText(p.amount)}`,
    titleAr: (p) => `تم استلام دفعة ${asText(p.amount)}`,
    entityType: 'Invoice',
    entityId: (p) => asId(p.invoiceId),
  },
  {
    eventType: 'qc.failed',
    category: 'workshop',
    roles: ['technician', 'workshop_manager', 'super_admin'],
    titleEn: () => 'QC failed — rework required',
    titleAr: () => 'فشل فحص الجودة — مطلوب إعادة عمل',
    entityType: 'QualityCheck',
    entityId: (p) => asId(p.qualityCheckId),
  },
  {
    eventType: 'quotation.expired',
    category: 'approvals',
    roles: ['advisor', 'super_admin'],
    titleEn: () => 'Quotations expired',
    titleAr: () => 'انتهت صلاحية عروض أسعار',
    bodyEn: (p) => `${asText(p.expired, '0')} quotation(s) expired`,
    bodyAr: (p) => `انتهت صلاحية ${asText(p.expired, '0')} عرض/عروض`,
  },
];

export function routeForEvent(eventType: string) {
  return NOTIFICATION_ROUTES.find((r) => r.eventType === eventType);
}
