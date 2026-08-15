/**
 * Verify BullMQ job schedulers are unique (no duplicate schedules after upsert).
 */
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

(async () => {
  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const outbox = new Queue('outbox-dispatch', { connection });
  const scheduled = new Queue('scheduled-jobs', { connection });

  const outboxSchedulers = await outbox.getJobSchedulers();
  const scheduledSchedulers = await scheduled.getJobSchedulers();

  const ids = [
    ...outboxSchedulers.map((s) => s.id || s.key),
    ...scheduledSchedulers.map((s) => s.id || s.key),
  ];
  const expected = [
    'outbox-drain-repeat',
    'quotation-expiry-repeat',
    'low-stock-scan-repeat',
  ];

  console.log('Outbox schedulers:', outboxSchedulers.map((s) => s.id || s.key));
  console.log(
    'Scheduled schedulers:',
    scheduledSchedulers.map((s) => s.id || s.key),
  );

  for (const id of expected) {
    const matches = ids.filter((x) => x === id);
    if (matches.length !== 1) {
      console.error(`FAIL duplicate/missing scheduler ${id}: count=${matches.length}`);
      process.exit(1);
    }
  }

  // Simulate second upsert (same as app restart) — must stay unique
  await outbox.upsertJobScheduler(
    'outbox-drain-repeat',
    { every: 3_000 },
    { name: 'drain', data: {} },
  );
  await scheduled.upsertJobScheduler(
    'quotation-expiry-repeat',
    { pattern: '5 * * * *' },
    { name: 'quotation-expiry', data: { kind: 'quotation-expiry' } },
  );
  await scheduled.upsertJobScheduler(
    'low-stock-scan-repeat',
    { pattern: '15 2 * * *' },
    { name: 'low-stock-scan', data: { kind: 'low-stock-scan' } },
  );

  const after = [
    ...(await outbox.getJobSchedulers()).map((s) => s.id || s.key),
    ...(await scheduled.getJobSchedulers()).map((s) => s.id || s.key),
  ];
  for (const id of expected) {
    const matches = after.filter((x) => x === id);
    if (matches.length !== 1) {
      console.error(`FAIL after re-upsert ${id}: count=${matches.length}`);
      process.exit(1);
    }
  }

  // Lock contention: only one holder
  const lockKey = 'lock:verify-p14';
  const a = await connection.set(lockKey, 'a', 'PX', 5000, 'NX');
  const b = await connection.set(lockKey, 'b', 'PX', 5000, 'NX');
  if (a !== 'OK' || b === 'OK') {
    console.error('FAIL lock NX behavior', { a, b });
    process.exit(1);
  }
  await connection.del(lockKey);

  console.log('SCHEDULER_DEDUP_OK');
  await outbox.close();
  await scheduled.close();
  await connection.quit();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
