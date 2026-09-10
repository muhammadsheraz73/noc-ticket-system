import PDFDocument from 'pdfkit';
import env from '../config/env.js';
import { formatDate } from '../utils/datetime.js';

const COLORS = {
  ink: '#0f172a',
  muted: '#64748b',
  line: '#e2e8f0',
  brand: '#0e4f8f',
  brandSoft: '#eaf2fb',
};

const money = (value) =>
  Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Stream a professional invoice PDF into `res` (or any writable stream).
 * Uses PDFKit so there is no headless-browser dependency.
 */
export function streamInvoicePdf(invoice, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: 45 });
  doc.pipe(stream);

  const { width } = doc.page;
  const left = doc.page.margins.left;
  const right = width - doc.page.margins.right;
  const contentWidth = right - left;

  // ---------- Header ----------
  doc.rect(0, 0, width, 108).fill(COLORS.brand);

  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(19).text(env.company.name, left, 30);
  doc.font('Helvetica').fontSize(9).fillColor('#d6e6f7');
  doc.text(env.company.address, left, 55, { width: contentWidth * 0.55 });
  doc.text(`${env.company.phone}  |  ${env.company.email}`, left, 68);

  doc.font('Helvetica-Bold').fontSize(24).fillColor('#ffffff').text('INVOICE', left, 30, {
    width: contentWidth,
    align: 'right',
  });
  doc.font('Helvetica').fontSize(10).fillColor('#d6e6f7').text(invoice.invoiceNumber, left, 60, {
    width: contentWidth,
    align: 'right',
  });
  doc.fontSize(9).text(`Status: ${invoice.status}`, left, 76, {
    width: contentWidth,
    align: 'right',
  });

  // ---------- Bill to / meta ----------
  let y = 132;
  doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(8).text('BILL TO', left, y);
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(12).text(invoice.customerName, left, y + 13);
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted);
  doc.text(`Customer ID: ${invoice.customerReferenceNumber}`, left, y + 30);
  if (invoice.customerAddress) doc.text(invoice.customerAddress, left, y + 43, { width: contentWidth * 0.5 });
  if (invoice.customerContact) doc.text(`Contact: ${invoice.customerContact}`, left, y + 56);

  const metaX = left + contentWidth * 0.58;
  const metaRows = [
    ['Invoice No.', invoice.invoiceNumber],
    ['Ticket ID (TID)', String(invoice.ticketNumber)],
    ['Issue Date', formatDate(invoice.issueDate)],
    ['Due Date', formatDate(invoice.dueDate)],
  ];
  metaRows.forEach(([label, value], index) => {
    const rowY = y + index * 15;
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text(label, metaX, rowY, { width: 90 });
    doc
      .fillColor(COLORS.ink)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(value, metaX + 92, rowY, { width: right - (metaX + 92), align: 'right' });
  });

  // ---------- Items table ----------
  y = 232;
  const cols = {
    description: { x: left + 8, width: contentWidth * 0.5 },
    qty: { x: left + contentWidth * 0.56, width: contentWidth * 0.1 },
    rate: { x: left + contentWidth * 0.66, width: contentWidth * 0.15 },
    amount: { x: left + contentWidth * 0.81, width: contentWidth * 0.17 - 8 },
  };

  doc.rect(left, y, contentWidth, 24).fill(COLORS.brandSoft);
  doc.fillColor(COLORS.brand).font('Helvetica-Bold').fontSize(9);
  doc.text('DESCRIPTION', cols.description.x, y + 8, { width: cols.description.width });
  doc.text('QTY', cols.qty.x, y + 8, { width: cols.qty.width, align: 'right' });
  doc.text('RATE', cols.rate.x, y + 8, { width: cols.rate.width, align: 'right' });
  doc.text('AMOUNT', cols.amount.x, y + 8, { width: cols.amount.width, align: 'right' });

  y += 24;
  doc.font('Helvetica').fontSize(9);

  for (const item of invoice.items) {
    const textHeight = doc.heightOfString(item.description || '-', { width: cols.description.width });
    const rowHeight = Math.max(24, textHeight + 12);

    if (y + rowHeight > doc.page.height - 170) {
      doc.addPage();
      y = doc.page.margins.top;
    }

    doc.fillColor(COLORS.ink);
    doc.text(item.description || '-', cols.description.x, y + 7, { width: cols.description.width });
    doc.text(String(item.quantity), cols.qty.x, y + 7, { width: cols.qty.width, align: 'right' });
    doc.text(money(item.rate), cols.rate.x, y + 7, { width: cols.rate.width, align: 'right' });
    doc.font('Helvetica-Bold').text(money(item.amount), cols.amount.x, y + 7, {
      width: cols.amount.width,
      align: 'right',
    });
    doc.font('Helvetica');

    y += rowHeight;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(COLORS.line).lineWidth(0.7).stroke();
  }

  if (!invoice.items.length) {
    doc.fillColor(COLORS.muted).text('No line items', cols.description.x, y + 8);
    y += 30;
  }

  // ---------- Totals ----------
  y += 14;
  const totalsX = left + contentWidth * 0.56;
  const totalsWidth = right - totalsX;

  const totalRow = (label, value, { bold = false, color = COLORS.ink } = {}) => {
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(bold ? 11 : 9)
      .fillColor(bold ? color : COLORS.muted)
      .text(label, totalsX, y, { width: totalsWidth * 0.55 });
    doc
      .font('Helvetica-Bold')
      .fontSize(bold ? 11 : 9)
      .fillColor(color)
      .text(value, totalsX + totalsWidth * 0.55, y, {
        width: totalsWidth * 0.45,
        align: 'right',
      });
    y += bold ? 20 : 16;
  };

  totalRow('Subtotal', `${invoice.currency} ${money(invoice.subtotal)}`);
  if (invoice.discountAmount > 0) {
    const label =
      invoice.discountType === 'percent' ? `Discount (${invoice.discountValue}%)` : 'Discount';
    totalRow(label, `- ${invoice.currency} ${money(invoice.discountAmount)}`);
  }
  if (invoice.taxAmount > 0) {
    totalRow(`Tax (${invoice.taxPercent}%)`, `${invoice.currency} ${money(invoice.taxAmount)}`);
  }

  doc.moveTo(totalsX, y).lineTo(right, y).strokeColor(COLORS.line).lineWidth(1).stroke();
  y += 10;
  totalRow('TOTAL', `${invoice.currency} ${money(invoice.total)}`, { bold: true, color: COLORS.brand });

  // ---------- Notes / footer ----------
  if (invoice.notes) {
    y += 12;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.muted).text('NOTES', left, y);
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink).text(invoice.notes, left, y + 12, {
      width: contentWidth * 0.55,
    });
  }

  const footerY = doc.page.height - 62;
  doc.moveTo(left, footerY).lineTo(right, footerY).strokeColor(COLORS.line).lineWidth(1).stroke();
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(
      `This invoice relates to NOC ticket TID ${invoice.ticketNumber} for customer ${invoice.customerReferenceNumber}.`,
      left,
      footerY + 10,
      { width: contentWidth, align: 'center' },
    )
    .text('Generated by the NOC Ticket Management System', left, footerY + 24, {
      width: contentWidth,
      align: 'center',
    });

  doc.end();
  return doc;
}

export default streamInvoicePdf;
