import { Injectable } from '@nestjs/common';

export type QuoteLineInput = {
  qty: number;
  unitPrice: number;
};

export type QuoteTotals = {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  lines: Array<{ qty: number; unitPrice: number; lineTotal: number }>;
};

@Injectable()
export class QuotationCalculatorService {
  calculate(
    items: QuoteLineInput[],
    options?: { discount?: number; taxRatePct?: number },
  ): QuoteTotals {
    const discount = this.round2(Math.max(0, options?.discount ?? 0));
    const taxRatePct = options?.taxRatePct ?? 14;

    const lines = items.map((item) => {
      const qty = Number(item.qty);
      const unitPrice = Number(item.unitPrice);
      const lineTotal = this.round2(qty * unitPrice);
      return { qty, unitPrice, lineTotal };
    });

    const subtotal = this.round2(lines.reduce((s, l) => s + l.lineTotal, 0));
    const taxable = Math.max(0, subtotal - discount);
    const tax = this.round2(taxable * (taxRatePct / 100));
    const total = this.round2(taxable + tax);

    return { subtotal, discount, tax, total, lines };
  }

  round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }
}
