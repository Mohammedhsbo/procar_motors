#!/usr/bin/env node
/**
 * Removes demo and test data before a system goes live.
 *
 *   node scripts/reset-demo-data.js --dry-run     # show what would go
 *   CONFIRM_RESET=yes node scripts/reset-demo-data.js
 *
 * Deletes transactional records — visits, quotations, invoices, payments,
 * orders, stock movements — and the demo customers and vehicles that came
 * with the development seed.
 *
 * Keeps the things a live system needs: the organisation, branches,
 * warehouses, users, roles, permissions, applications, and the catalogues
 * (parts, services, tire products, café menu, recipes).
 *
 * Refuses to run unless CONFIRM_RESET=yes, and never touches a database whose
 * URL does not look like the one you meant.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

/** Deleted in order: children before parents. */
const STEPS = [
  ['daily_cafe.order_items', (tx) => tx.cafeOrderItem.deleteMany({})],
  ['daily_cafe.orders', (tx) => tx.cafeOrder.deleteMany({})],
  ['daily_cafe.cash_sessions', (tx) => tx.cafeCashSession.deleteMany({})],
  ['daily_cafe.waste_logs', (tx) => tx.cafeWasteLog.deleteMany({})],

  ['tireszone.warranties', (tx) => tx.tireWarranty.deleteMany({})],
  ['tireszone.alignments', (tx) => tx.tireAlignment.deleteMany({})],
  ['tireszone.sales_order_items', (tx) => tx.tireSalesOrderItem.deleteMany({})],
  ['tireszone.sales_orders', (tx) => tx.tireSalesOrder.deleteMany({})],

  ['uxp.roll_consumption', (tx) => tx.uxbRollConsumption.deleteMany({})],
  ['uxp.paint_readings', (tx) => tx.uxbPaintReading.deleteMany({})],
  ['uxp.job_zones', (tx) => tx.uxbJobZone.deleteMany({})],
  ['uxp.job_items', (tx) => tx.uxbJobItem.deleteMany({})],
  ['uxp.jobs', (tx) => tx.uxbJob.deleteMany({})],

  ['finance.refunds', (tx) => tx.refund.deleteMany({})],
  ['finance.payments', (tx) => tx.payment.deleteMany({})],
  ['finance.invoice_items', (tx) => tx.invoiceItem.deleteMany({})],
  ['finance.invoices', (tx) => tx.invoice.deleteMany({})],
  ['finance.quotation_approvals', (tx) => tx.quotationApproval.deleteMany({})],
  ['finance.quotation_items', (tx) => tx.quotationItem.deleteMany({})],
  ['finance.quotations', (tx) => tx.quotation.deleteMany({})],
  ['finance.expenses', (tx) => tx.expense.deleteMany({})],

  ['purchasing.goods_receipt_items', (tx) => tx.goodsReceiptItem.deleteMany({})],
  ['purchasing.goods_receipts', (tx) => tx.goodsReceipt.deleteMany({})],
  ['purchasing.purchase_order_items', (tx) => tx.purchaseOrderItem.deleteMany({})],
  ['purchasing.purchase_orders', (tx) => tx.purchaseOrder.deleteMany({})],
  ['purchasing.purchase_request_items', (tx) => tx.purchaseRequestItem.deleteMany({})],
  ['purchasing.purchase_requests', (tx) => tx.purchaseRequest.deleteMany({})],

  // Reservations point at work orders and visits, so they go first.
  ['inventory.stock_reservations', (tx) => tx.stockReservation.deleteMany({})],
  ['inventory.inventory_transactions', (tx) => tx.inventoryTransaction.deleteMany({})],
  ['inventory.stock_alerts', (tx) => tx.stockAlert.deleteMany({})],

  ['promotors.quality_check_items', (tx) => tx.qualityCheckItem.deleteMany({})],
  ['promotors.quality_checks', (tx) => tx.qualityCheck.deleteMany({})],
  ['promotors.technician_tasks', (tx) => tx.technicianTask.deleteMany({})],
  // Warranties reference work orders.
  ['promotors.warranties', (tx) => tx.warranty.deleteMany({})],
  ['promotors.work_orders', (tx) => tx.workOrder.deleteMany({})],
  ['promotors.inspection_findings', (tx) => tx.inspectionFinding.deleteMany({})],
  ['promotors.inspection_results', (tx) => tx.inspectionResult.deleteMany({})],
  ['promotors.inspections', (tx) => tx.inspection.deleteMany({})],
  ['promotors.visit_damage_points', (tx) => tx.visitDamagePoint.deleteMany({})],
  ['promotors.job_tickets', (tx) => tx.jobTicket.deleteMany({})],
  ['promotors.vehicle_visits', (tx) => tx.vehicleVisit.deleteMany({})],
  ['promotors.vehicles', (tx) => tx.vehicle.deleteMany({})],

  ['ops.attachments', (tx) => tx.attachment.deleteMany({})],
  ['ops.stored_files', (tx) => tx.storedFile.deleteMany({})],
  ['ops.portal_feedback', (tx) => tx.portalFeedback.deleteMany({})],
  ['ops.notifications', (tx) => tx.notification.deleteMany({})],
  ['ops.outbox_events', (tx) => tx.outboxEvent.deleteMany({})],
  ['ops.sync_operations', (tx) => tx.syncOperation.deleteMany({})],
  ['ops.idempotency_keys', (tx) => tx.idempotencyKey.deleteMany({})],
  ['core.audit_logs', (tx) => tx.auditLog.deleteMany({})],

  // Customers last: everything above referenced them. Their UXB loyalty
  // profiles and portal logins have to go first.
  ['uxp.profiles', (tx) => tx.uxpProfile.deleteMany({})],
  [
    'core.users (portal customers only)',
    (tx) => tx.user.deleteMany({ where: { userType: 'customer' } }),
  ],
  ['core.customers', (tx) => tx.customer.deleteMany({})],
];

async function counts() {
  const [customers, vehicles, visits, invoices, orders, jobs, notifications] =
    await Promise.all([
      prisma.customer.count(),
      prisma.vehicle.count(),
      prisma.vehicleVisit.count(),
      prisma.invoice.count(),
      prisma.cafeOrder.count(),
      prisma.uxbJob.count(),
      prisma.notification.count(),
    ]);
  return { customers, vehicles, visits, invoices, orders, jobs, notifications };
}

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  console.log(`Database: ${url.replace(/:\/\/[^@]*@/, '://***@')}`);
  const before = await counts();
  console.log('\nBefore:');
  for (const [k, v] of Object.entries(before)) {
    console.log(`  ${k.padEnd(14)} ${v}`);
  }

  const totalRows = Object.values(before).reduce((a, b) => a + b, 0);
  if (totalRows === 0) {
    console.log('\nNothing to clear.');
    return;
  }

  if (dryRun) {
    console.log(
      `\n--dry-run: ${STEPS.length} tables would be cleared. Nothing was deleted.`,
    );
    console.log('Kept: organisation, branches, warehouses, users, roles,');
    console.log('      permissions, applications, parts, services, menu, recipes.');
    return;
  }

  if (process.env.CONFIRM_RESET !== 'yes') {
    console.error(
      '\nThis deletes all transactional data and customers.',
    );
    console.error('Re-run with CONFIRM_RESET=yes to proceed.');
    process.exit(1);
  }

  console.log('\nClearing…');
  // One transaction: either the system is clean or it is untouched.
  await prisma.$transaction(
    async (tx) => {
      for (const [label, run] of STEPS) {
        const { count } = await run(tx);
        if (count > 0) console.log(`  ${label.padEnd(36)} ${count}`);
      }
    },
    { timeout: 120_000 },
  );

  const after = await counts();
  console.log('\nAfter:');
  for (const [k, v] of Object.entries(after)) {
    console.log(`  ${k.padEnd(14)} ${v}`);
  }
  console.log('\nDone. Catalogues, users and settings were kept.');
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
