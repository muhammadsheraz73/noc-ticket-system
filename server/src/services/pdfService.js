import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import PDFDocument from 'pdfkit';
import env from '../config/env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Decode an uploaded `data:image/...;base64,` logo, or null when there is none. */
export function dataUrlToBuffer(dataUrl) {
  const match = /^data:image\/(?:png|jpeg|webp);base64,(.+)$/.exec(dataUrl || '');
  return match ? Buffer.from(match[1], 'base64') : null;
}

const COLORS = {
  ink: '#111111',
  muted: '#5b5b5b',
  line: '#d4d4d4',
  link: '#1a56db',
};

const money = (value) =>
  Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const shortDate = (value) => {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: env.timezone,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('day')}-${get('month')}-${get('year')}`;
};

/**
 * Stream the invoice PDF into `res` (or any writable stream), styled after
 * the company's standard invoice template (logo header, black tagline band,
 * "Invoice From / Invoice To" blocks, itemised table, tax breakdown).
 *
 * `extra` carries fields the Invoice document does not itself store — they
 * live on the linked Ticket/Customer instead and are looked up by the caller.
 */
export function streamInvoicePdf(invoice, stream, extra = {}) {
  const { ticketCategory = '', supervisorName = '', connectedFrom = '', branding = {} } = extra;
  const companyName = branding.name || env.company.name;
  const bandColor = /^#[0-9a-fA-F]{6}$/.test(branding.color || '') ? branding.color : COLORS.ink;

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(stream);

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentWidth = right - left;

  /** Label/value pair on one line, label bold+caps, value regular. */
  const fieldRow = (label, value, x, y, labelWidth, valueWidth) => {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLORS.ink).text(label, x, y, { width: labelWidth });
    doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.ink).text(value || '—', x + labelWidth, y, { width: valueWidth });
  };

  /** Right-aligned label/value pair, used in the "Invoice To" meta column. */
  const metaRow = (label, value, x, width, y) => {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLORS.ink).text(label, x, y, { width: width * 0.45, align: 'right' });
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(COLORS.ink)
      .text(value, x + width * 0.45 + 8, y, { width: width * 0.55 - 8, align: 'right' });
  };

  // ---------- Header: logo + INVOICE ----------
  try {
    if (!branding.logo) throw new Error('no logo');
    doc.image(branding.logo, left, 38, { fit: [150, 48] });
  } catch {
    doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.ink).text(companyName, left, 42, { width: 300 });
  }
  doc.font('Helvetica-Bold').fontSize(30).fillColor(COLORS.ink).text('INVOICE', left, 44, {
    width: contentWidth,
    align: 'right',
  });

  // ---------- Tagline band ----------
  let y = 96;
  doc.rect(left, y, contentWidth, 20).fill(bandColor);
  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor('#ffffff')
    .text(`------:-${env.company.tagline}-:------`, left, y + 6, { width: contentWidth, align: 'center' });

  // ---------- Invoice From ----------
  y += 36;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.ink).text('Invoice From:', left, y);
  y += 18;
  doc.moveTo(left, y).lineTo(right, y).strokeColor(COLORS.line).lineWidth(1).stroke();
  y += 10;

  const fromLabelWidth = 96;
  const fromValueWidth = contentWidth - fromLabelWidth;
  const fromRows = [
    ['NAME:', companyName],
    ['ADDRESS:', env.company.address],
    ['CONTACT INFO:', `${env.company.phone} | ${env.company.email.toUpperCase()}`],
    ['SUPERVISION BY:', supervisorName],
    ['TICKET CAT:', ticketCategory],
  ];
  doc.font('Helvetica').fontSize(8.5);
  for (const [label, value] of fromRows) {
    fieldRow(label, value, left, y, fromLabelWidth, fromValueWidth);
    y += Math.max(14, doc.heightOfString(value || '—', { width: fromValueWidth }) + 4);
  }
  y += 8;

  // ---------- Invoice To ----------
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.ink).text('Invoice To:', left, y);
  y += 18;
  doc.moveTo(left, y).lineTo(right, y).strokeColor(COLORS.line).lineWidth(1).stroke();
  y += 10;

  const toLabelWidth = 68;
  const colLeftWidth = contentWidth * 0.55;
  const colLeftValueWidth = colLeftWidth - toLabelWidth;
  const colRightX = left + colLeftWidth + 12;
  const colRightWidth = right - colRightX;

  const leftRows = [
    ['CLIENT #:', invoice.customerReferenceNumber],
    ['NAME:', invoice.customerName],
    ['ADDRESS:', invoice.customerAddress],
    ['PHONE:', invoice.customerContact],
    ['CONNECTED:', connectedFrom],
  ];
  const rightRows = [
    ['TASK #:', String(invoice.ticketNumber)],
    ['INVOICE #:', invoice.invoiceNumber],
    ['DATED:', shortDate(invoice.issueDate)],
    ['EXPIRATION DATE:', shortDate(invoice.dueDate)],
    ['INVOICE TOTAL:', money(invoice.total)],
  ];

  doc.font('Helvetica').fontSize(8.5);
  for (let i = 0; i < leftRows.length; i += 1) {
    const [label, value] = leftRows[i];
    fieldRow(label, value, left, y, toLabelWidth, colLeftValueWidth);
    metaRow(rightRows[i][0], rightRows[i][1], colRightX, colRightWidth, y);
    y += Math.max(14, doc.heightOfString(value || '—', { width: colLeftValueWidth }) + 4);
  }
  y += 12;

  // ---------- Items table ----------
  const cols = {
    description: { x: left, width: contentWidth * 0.46 },
    qty: { x: left + contentWidth * 0.46, width: contentWidth * 0.1 },
    rate: { x: left + contentWidth * 0.56, width: contentWidth * 0.16 },
    taxable: { x: left + contentWidth * 0.72, width: contentWidth * 0.12 },
    amount: { x: left + contentWidth * 0.84, width: contentWidth * 0.16 },
  };

  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.ink);
  doc.text('PRODUCT / SERVICE DESCRIPTION', cols.description.x, y, { width: cols.description.width });
  doc.text('QTY', cols.qty.x, y, { width: cols.qty.width, align: 'center' });
  doc.text('UNIT PRICE', cols.rate.x, y, { width: cols.rate.width, align: 'right' });
  doc.text('TAXABLE', cols.taxable.x, y, { width: cols.taxable.width, align: 'center' });
  doc.text('AMOUNT', cols.amount.x, y, { width: cols.amount.width, align: 'right' });
  y += 14;
  doc.moveTo(left, y).lineTo(right, y).strokeColor(COLORS.ink).lineWidth(1).stroke();
  y += 8;

  const isTaxable = invoice.taxAmount > 0 || invoice.withholdingTaxAmount > 0;

  for (const item of invoice.items) {
    const textHeight = doc.heightOfString(item.description || '-', { width: cols.description.width });
    const rowHeight = Math.max(18, textHeight + 6);

    if (y + rowHeight > doc.page.height - 190) {
      doc.addPage();
      y = doc.page.margins.top;
    }

    doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink);
    doc.text(item.description || '-', cols.description.x, y, { width: cols.description.width });
    doc.text(String(item.quantity), cols.qty.x, y, { width: cols.qty.width, align: 'center' });
    doc.text(money(item.rate), cols.rate.x, y, { width: cols.rate.width, align: 'right' });
    doc.text(isTaxable ? 'Yes' : 'No', cols.taxable.x, y, { width: cols.taxable.width, align: 'center' });
    doc.font('Helvetica-Bold').text(money(item.amount), cols.amount.x, y, { width: cols.amount.width, align: 'right' });

    y += rowHeight;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(COLORS.line).lineWidth(0.6).stroke();
    y += 4;
  }

  if (!invoice.items.length) {
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text('No line items', cols.description.x, y);
    y += 20;
  }

  // ---------- Totals ----------
  y += 14;
  const totalsX = left + contentWidth * 0.5;
  const totalsWidth = right - totalsX;

  const totalRow = (label, amount, { showDash = false } = {}) => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.ink).text(label, totalsX, y, { width: totalsWidth * 0.42, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink).text(invoice.currency, totalsX + totalsWidth * 0.42 + 6, y, {
      width: totalsWidth * 0.18,
      align: 'left',
    });
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(COLORS.ink)
      .text(showDash ? '-' : money(amount), totalsX, y, { width: totalsWidth, align: 'right' });
    y += 16;
  };

  totalRow('Subtotal:', invoice.subtotal, { showDash: invoice.subtotal <= 0 });
  if (invoice.discountAmount > 0) {
    const label = invoice.discountType === 'percent' ? `Discount (${invoice.discountValue}%):` : 'Discount:';
    totalRow(label, invoice.discountAmount);
  }
  totalRow(`Sales Tax (${invoice.taxPercent}%):`, invoice.taxAmount, { showDash: invoice.taxAmount <= 0 });
  totalRow(`Withholding Tax (${invoice.withholdingTaxPercent}%):`, invoice.withholdingTaxAmount, {
    showDash: invoice.withholdingTaxAmount <= 0,
  });

  y += 3;
  doc.rect(totalsX, y, totalsWidth, 20).fill(COLORS.ink);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff').text('TOTAL:', totalsX + 8, y + 6, { width: totalsWidth * 0.42 });
  doc.text(invoice.currency, totalsX + totalsWidth * 0.42 + 6, y + 6, { width: totalsWidth * 0.18 });
  doc.text(money(invoice.total), totalsX, y + 6, { width: totalsWidth - 8, align: 'right' });
  y += 34;

  // ---------- Notes ----------
  if (invoice.notes) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.muted).text('NOTES', left, y);
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink).text(invoice.notes, left, y + 12, {
      width: contentWidth * 0.6,
    });
  }

  // ---------- Footer ----------
  const footerY = doc.page.height - doc.page.margins.bottom - 34;
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(COLORS.link)
    .text('If you have any questions concerning this quotation, please contact:', left, footerY, {
      width: contentWidth,
      underline: true,
    });
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(COLORS.muted)
    .text('Thank you for your business!', left, footerY + 14, { width: contentWidth });

  doc.end();
  return doc;
}

/**
 * Render to an in-memory Buffer instead of a stream, so the route can send a
 * fixed Content-Length response. A few HTTP clients (some embedded webviews
 * in particular) mishandle a chunked `application/pdf` body and end up with
 * a zero-byte blob — sending a known length up front sidesteps that.
 */
export function renderInvoicePdfBuffer(invoice, extra = {}) {
  return new Promise((resolve, reject) => {
    const stream = new PassThrough();
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    streamInvoicePdf(invoice, stream, extra);
  });
}

export default streamInvoicePdf;
