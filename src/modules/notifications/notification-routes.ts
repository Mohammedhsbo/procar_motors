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

  // ── Cross-business events ────────────────────────────────────────────────
  {
    eventType: 'inspection.tires_required',
    category: 'workshop',
    roles: ['tires_manager', 'tires_sales', 'super_admin'],
    titleEn: () => 'Workshop needs tires',
    titleAr: () => 'الورشة تطلب إطارات',
    bodyEn: (p) =>
      `${asText(p.qty, '4')} tire(s) requested for a vehicle in the workshop`,
    bodyAr: (p) => `مطلوب ${asText(p.qty, '4')} إطار لمركبة في الورشة`,
    entityType: 'TireSalesOrder',
    entityId: (p) => asId(p.tireOrderId),
  },
  {
    eventType: 'cafe.waiting_area_order',
    category: 'workshop',
    roles: ['cafe_barista', 'cafe_cashier', 'cafe_manager', 'super_admin'],
    titleEn: () => 'Order from the waiting area',
    titleAr: () => 'طلب من منطقة الانتظار',
    bodyEn: () => 'A customer waiting for their vehicle placed an order',
    bodyAr: () => 'عميل ينتظر سيارته أرسل طلبًا',
    entityType: 'CafeOrder',
    entityId: (p) => asId(p.cafeOrderId),
  },

  // ── Reminders, raised nightly by the reminder engine ─────────────────────
  {
    eventType: 'reminder.oil_change_due',
    category: 'reminders',
    roles: ['advisor', 'reception', 'super_admin'],
    titleEn: () => 'Oil change due',
    titleAr: () => 'موعد تغيير الزيت',
    bodyEn: (p) =>
      `${asText(p.plate)} has run ${asText(p.kmSinceService)} km since its last service`,
    bodyAr: (p) =>
      `قطعت ${asText(p.plate)} مسافة ${asText(p.kmSinceService)} كم منذ آخر صيانة`,
    entityType: 'Vehicle',
    entityId: (p) => asId(p.vehicleId),
  },
  {
    eventType: 'reminder.warranty_expiring',
    category: 'reminders',
    roles: ['advisor', 'reception', 'super_admin'],
    titleEn: () => 'Warranty expiring soon',
    titleAr: () => 'ضمان على وشك الانتهاء',
    bodyEn: (p) => `Warranty on ${asText(p.plate)} expires shortly`,
    bodyAr: (p) => `ضمان ${asText(p.plate)} ينتهي قريبًا`,
    entityType: 'Warranty',
    entityId: (p) => asId(p.warrantyId),
  },
  {
    eventType: 'reminder.delivery_due',
    category: 'workshop',
    roles: ['advisor', 'workshop_manager', 'reception', 'super_admin'],
    titleEn: (p) =>
      p.overdue === true ? 'Delivery overdue' : 'Delivery due today',
    titleAr: (p) =>
      p.overdue === true ? 'تأخر موعد التسليم' : 'موعد التسليم اليوم',
    bodyEn: (p) => `${asText(p.plate)} — status ${asText(p.status)}`,
    bodyAr: (p) => `${asText(p.plate)} — الحالة ${asText(p.status)}`,
    entityType: 'VehicleVisit',
    entityId: (p) => asId(p.visitId),
  },
  {
    eventType: 'reminder.customer_lapsed',
    category: 'reminders',
    roles: ['advisor', 'reception', 'super_admin'],
    titleEn: (p) => `${asText(p.customerName, 'A customer')} has not visited`,
    titleAr: (p) => `${asText(p.customerName, 'عميل')} لم يزر المركز`,
    bodyEn: (p) => `No visit in the last ${asText(p.months, '6')} months`,
    bodyAr: (p) => `لا توجد زيارة خلال آخر ${asText(p.months, '6')} أشهر`,
    entityType: 'Customer',
    entityId: (p) => asId(p.customerId),
  },
];

export function routeForEvent(eventType: string) {
  return NOTIFICATION_ROUTES.find((r) => r.eventType === eventType);
}
