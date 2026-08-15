import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_REPORT_EXPORT } from './jobs.processors';
import { RedisCacheService } from '../cache/redis-cache.service';
import {
  ReportsService,
  type ReportFormat,
  type ReportKind,
} from '../../modules/reports/reports.service';

type ExportJobData = {
  organizationId: string;
  branchId: string;
  scope: { mode: 'one'; branchId: string } | { mode: 'all' };
  kind: ReportKind;
  format: ReportFormat;
  requestedBy: string;
  from?: string | null;
  to?: string | null;
};

type CsvScalar = string | number | boolean | null;

@Processor(QUEUE_REPORT_EXPORT)
export class ReportExportProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportExportProcessor.name);

  constructor(
    private readonly reports: ReportsService,
    private readonly cache: RedisCacheService,
  ) {
    super();
  }

  async process(job: Job<ExportJobData>) {
    const jobId = String(job.id);
    await this.cache.setJson(
      this.cache.reportKey(jobId),
      {
        jobId,
        status: 'processing',
        kind: job.data.kind,
        format: job.data.format,
      },
      3600,
    );

    try {
      const payload = await this.reports.buildExportPayload({
        organizationId: job.data.organizationId,
        scope: job.data.scope,
        kind: job.data.kind,
        from: job.data.from,
        to: job.data.to,
      });

      const filename = `${job.data.kind}-${Date.now()}.${job.data.format}`;
      let content: string;
      let mime: string;

      if (job.data.format === 'csv') {
        content = toCsv(payload);
        mime = 'text/csv; charset=utf-8';
      } else {
        content = toSimplePdf(payload, job.data.kind);
        mime = 'application/pdf';
      }

      const result = {
        jobId,
        status: 'completed',
        kind: job.data.kind,
        format: job.data.format,
        filename,
        mime,
        contentBase64: Buffer.from(content, 'utf8').toString('base64'),
      };
      await this.cache.setJson(this.cache.reportKey(jobId), result, 3600);
      return { jobId, status: 'completed', filename };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.cache.setJson(
        this.cache.reportKey(jobId),
        {
          jobId,
          status: 'failed',
          kind: job.data.kind,
          format: job.data.format,
          error: message,
        },
        3600,
      );
      throw err;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Report export ${job.id} failed: ${err.message}`);
  }
}

function csvScalar(value: unknown): CsvScalar {
  if (value == null) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return JSON.stringify(value);
}

function toCsv(payload: unknown): string {
  const rows = flattenForCsv(payload);
  if (!rows.length) return 'key,value\n';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = csvScalar(v) == null ? '' : String(csvScalar(v));
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(',')),
  ].join('\n');
}

function flattenForCsv(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    const list: unknown[] = payload;
    return list.map((item, i) => {
      if (typeof item === 'object' && item !== null) {
        return {
          index: i,
          ...flattenObject(item as Record<string, unknown>),
        };
      }
      return { index: i, value: csvScalar(item) };
    });
  }
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['items', 'technicians', 'series', 'columns']) {
      const nested = obj[key];
      if (Array.isArray(nested)) {
        return flattenForCsv(nested);
      }
    }
    if (obj.kpis && typeof obj.kpis === 'object') {
      return Object.entries(obj.kpis as Record<string, unknown>).map(
        ([k, v]) => ({
          metric: k,
          value: csvScalar(v),
        }),
      );
    }
    return [flattenObject(obj)];
  }
  return [{ value: csvScalar(payload) }];
}

function flattenObject(
  obj: Record<string, unknown>,
  prefix = '',
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      !(v instanceof Date)
    ) {
      Object.assign(out, flattenObject(v as Record<string, unknown>, key));
    } else if (Array.isArray(v)) {
      out[key] = JSON.stringify(v);
    } else if (v instanceof Date) {
      out[key] = v.toISOString();
    } else {
      out[key] = csvScalar(v);
    }
  }
  return out;
}

/** Minimal single-page PDF for MVP without external deps. */
function toSimplePdf(payload: unknown, kind: string): string {
  const text =
    `Pro Motors Report: ${kind}\n\n${JSON.stringify(payload, null, 2)}`
      .slice(0, 3500)
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/\r/g, '');
  const lines = text.split('\n');
  const contentLines = [
    'BT',
    '/F1 10 Tf',
    '50 750 Td',
    '14 TL',
    ...lines.flatMap((line, idx) =>
      idx === 0 ? [`(${line}) Tj`] : ['T*', `(${line}) Tj`],
    ),
    'ET',
  ];
  const stream = contentLines.join('\n');
  const objs = [
    '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj',
    '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj',
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj',
    `4 0 obj<< /Length ${Buffer.byteLength(stream, 'utf8')} >>stream\n${stream}\nendstream endobj`,
    '5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const o of objs) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${o}\n`;
  }
  const xref = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objs.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}
