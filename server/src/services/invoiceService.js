import env from '../config/env.js';
import Invoice from '../models/Invoice.js';
import { nextSequence } from '../utils/sequence.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Compute every money field from the line items.
 * Totals are always recalculated server-side — the client's numbers are hints only.
 */
export function calculateTotals({ items = [], discountType = 'none', discountValue = 0, taxPercent = 0 }) {
  const normalizedItems = items.map((item) => {
    const quantity = Math.max(0, Number(item.quantity) || 0);
    const rate = Math.max(0, Number(item.rate) || 0);
    return {
      description: String(item.description || '').trim(),
      quantity,
      rate,
      amount: round2(quantity * rate),
    };
  });

  const subtotal = round2(normalizedItems.reduce((sum, item) => sum + item.amount, 0));

  let discountAmount = 0;
  if (discountType === 'percent') {
    discountAmount = round2((subtotal * Math.min(100, Math.max(0, Number(discountValue) || 0))) / 100);
  } else if (discountType === 'amount') {
    discountAmount = round2(Math.min(subtotal, Math.max(0, Number(discountValue) || 0)));
  }

  const taxable = round2(subtotal - discountAmount);
  const taxAmount = round2((taxable * Math.max(0, Number(taxPercent) || 0)) / 100);
  const total = round2(taxable + taxAmount);

  return { items: normalizedItems, subtotal, discountAmount, taxAmount, total };
}

/** `INV-2026-0001` — year-scoped, gap-free, generated server-side. */
export async function generateInvoiceNumber(date = new Date()) {
  const year = new Intl.DateTimeFormat('en-CA', {
    timeZone: env.timezone,
    year: 'numeric',
  }).format(date);

  const seq = await nextSequence(`invoiceNumber:${year}`, 1);
  return `INV-${year}-${String(seq).padStart(4, '0')}`;
}

/** Invoices linked to a customer, newest first. */
export function invoicesForCustomer(customerId) {
  return Invoice.find({ customer: customerId, isDeleted: false }).sort({ createdAt: -1 }).lean();
}
