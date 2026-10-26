import { PassThrough } from 'node:stream';
import PDFDocument from 'pdfkit';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import { bankBlockHeight, drawBankBlock } from './pdfBank.js';
import { drawWordmark, measureWordmark } from './pdfBrand.js';
import { amountInWords, logoBuffer, tint } from './quotationPdf.js';

/**
 * Monthly bill slips on the client's own letterhead, one A5 landscape page per
 * bill, so a single slip can be shared on WhatsApp and a whole month printed
 * in one go. Renders to a Buffer (fixed Content-Length, like the other PDFs).
 */

const DEFAULT_BRAND = '#E35A00';
const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const STATUS = {
  Received: { label: 'PAID', color: '#15803d' },
  Partial: { label: 'PARTIAL', color: '#b45309' },
  Pending: { label: 'UNPAID', color: '#b91c1c' },
};
/** Bills are due this many days after they are issued. */
export const SLIP_DUE_DAYS = 10;

const money = (value) =>
  `PKR ${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function longDate(value) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: env.timezone, day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(value));
}

const monthName = (period) =>
  new Date(`${period}-15T00:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Stable, readable bill number derived from the month and the record id: `202610-3F9A2`. */
export const billNumber = (record) => `${record.period.replace('-', '')}-${String(record._id).slice(-5).toUpperCase()}`;

/**
 * @param slips    [{ record, previousDues, customer }] — customer: { name, customerReferenceNumber, contactNumber } or null
 * @param company  { name, address, phone, email, website, logo, color, bankAccounts }
 */
export function renderBillSlips(slips, company = {}) {
  return new Promise((resolve, reject) => {
    const brand = /^#[0-9a-fA-F]{6}$/.test(company.color || '') ? company.color : DEFAULT_BRAND;
    const companyName = company.name || env.company.name;
    const banks = (company.bankAccounts || []).slice(0, 2);

    const doc = new PDFDocument({
      size: 'A5',
      layout: 'landscape',
      margins: { top: 0, bottom: 0, left: 24, right: 24 },
      autoFirstPage: false,
      info: { Title: slips.length === 1 ? `Bill ${billNumber(slips[0].record)}` : 'Monthly bills', Author: companyName },
    });
    const out = new PassThrough();
    const chunks = [];
    out.on('data', (c) => chunks.push(c));
    out.on('end', () => resolve(Buffer.concat(chunks)));
    out.on('error', reject);
    doc.pipe(out);

    for (const slip of slips) {
      doc.addPage();
      drawSlip(doc, slip, { brand, companyName, company, banks });
    }
    if (!slips.length) {
      doc.addPage();
      doc.font('Helvetica').fontSize(12).fillColor(MUTED).text('No bills for this month.', 24, 200, { align: 'center' });
    }
    doc.end();
  });
}

function drawSlip(doc, { record, previousDues = 0, customer }, { brand, companyName, company, banks }) {
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const left = 24;
  const right = pageW - 24;
  const width = right - left;
  const brandSoft = tint(brand, 0.9);

  // ============================================================== header band
  const HEADER_H = 66;
  doc.rect(0, 0, pageW, HEADER_H).fill(brand);
  doc.polygon([pageW - 190, 0], [pageW, 0], [pageW, HEADER_H], [pageW - 240, HEADER_H]).fill(tint(brand, 0.12));
  doc.rect(0, HEADER_H, pageW, 2.5).fill(tint(brand, 0.55));

  let drewLogo = false;
  const logo = logoBuffer(company.logo);
  if (logo) {
    try {
      doc.roundedRect(left, 11, 150, 44, 5).fill('#ffffff');
      doc.image(logo, left + 6, 14, { fit: [138, 38], align: 'center', valign: 'center' });
      drewLogo = true;
    } catch (error) {
      logger.warn(`Bill slip: could not draw the logo (${error.message})`);
    }
  }
  if (!drewLogo) {
    const maxCard = width * 0.55;
    const { width: markW } = measureWordmark(doc, companyName, { height: 30, maxWidth: maxCard - 24 });
    doc.roundedRect(left, 11, Math.max(150, markW + 24), 44, 5).fill('#ffffff');
    drawWordmark(doc, companyName, { x: left + 12, y: 18, height: 30, maxWidth: maxCard - 24, brand, ink: INK });
  }

  doc.font('Helvetica-Bold').fontSize(19).fillColor('#ffffff')
    .text('MONTHLY BILL', left, 15, { width, align: 'right', characterSpacing: 1 });
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#ffffff')
    .text(monthName(record.period), left, 39, { width, align: 'right' });

  // ============================================================== info strip
  const issued = record.createdAt || new Date();
  const payBy = new Date(new Date(issued).getTime() + SLIP_DUE_DAYS * 86400000);
  let y = HEADER_H + 12;
  const info = [
    ['BILL NO.', billNumber(record)],
    ['BILLING MONTH', monthName(record.period)],
    ['BILL DATE', longDate(issued)],
    ['PAY BY', longDate(payBy)],
  ];
  const gap = 7;
  const cellW = (width - gap * (info.length - 1)) / info.length;
  info.forEach(([label, value], i) => {
    const x = left + i * (cellW + gap);
    doc.roundedRect(x, y, cellW, 36, 4).lineWidth(0.8).fillAndStroke('#ffffff', LINE);
    doc.rect(x, y, cellW, 2.2).fill(brand);
    doc.font('Helvetica-Bold').fontSize(6.3).fillColor(MUTED).text(label, x + 9, y + 8, { width: cellW - 18, characterSpacing: 0.6 });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(value, x + 9, y + 19, { width: cellW - 18, lineBreak: false, ellipsis: true });
  });
  y += 36 + 11;

  // ========================================================= billed-to panel
  const PANEL_H = 124;
  const leftW = width * 0.46;
  const rightX = left + leftW + 10;
  const rightW = width - leftW - 10;

  const panelHead = (x, w, title) => {
    doc.roundedRect(x, y, w, PANEL_H, 5).lineWidth(0.8).stroke(LINE);
    doc.save();
    doc.roundedRect(x, y, w, 20, 5).clip();
    doc.rect(x, y, w, 20).fill(brandSoft);
    doc.restore();
    doc.rect(x, y + 19.5, w, 0.8).fill(tint(brand, 0.75));
    doc.font('Helvetica-Bold').fontSize(7).fillColor(brand).text(title, x + 10, y + 7, { characterSpacing: 0.8 });
  };

  panelHead(left, leftW, 'BILLED TO');
  const status = STATUS[record.paymentStatus] || STATUS.Pending;
  // Payment status stamp in the panel's corner.
  doc.font('Helvetica-Bold').fontSize(8);
  const stampW = doc.widthOfString(status.label, { characterSpacing: 1 }) + 16;
  doc.roundedRect(left + leftW - stampW - 8, y + 4, stampW, 13, 3).lineWidth(1).stroke(status.color);
  doc.fillColor(status.color).text(status.label, left + leftW - stampW - 8, y + 7.3, { width: stampW, align: 'center', characterSpacing: 1 });

  const name = customer?.name || record.username;
  let py = y + 28;
  doc.font('Helvetica-Bold').fontSize(11.5).fillColor(INK).text(name, left + 10, py, { width: leftW - 20, lineBreak: false, ellipsis: true });
  py += 18;
  const details = [
    ['Customer ID', customer?.customerReferenceNumber || '—'],
    ['Package', record.package || '—'],
    ['Contact', customer?.contactNumber || '—'],
    ['Address', record.address || '—'],
  ];
  for (const [label, value] of details) {
    doc.font('Helvetica').fontSize(7.8).fillColor(MUTED).text(label, left + 10, py, { width: 62 });
    const isAddress = label === 'Address';
    doc.font('Helvetica-Bold').fontSize(8.4).fillColor(INK).text(value, left + 74, py - 0.5, {
      width: leftW - 84,
      height: isAddress ? 22 : undefined,
      lineBreak: isAddress,
      ellipsis: true,
    });
    py += isAddress ? 0 : 14;
  }

  // ============================================================ amount panel
  panelHead(rightX, rightW, 'AMOUNT');
  const totalPayable = record.fee + previousDues;
  const balance = Math.max(0, totalPayable - record.received);
  const rows = [
    [`Monthly fee · ${monthName(record.period)}`, money(record.fee)],
    ...(previousDues > 0 ? [['Previous dues', money(previousDues)]] : []),
    ['Total payable', money(totalPayable), 'total'],
    ['Received', record.received ? `− ${money(record.received)}` : money(0)],
    ['Balance due', money(balance), 'balance'],
  ];
  let ry = y + 26;
  const ROW_H = previousDues > 0 ? 17 : 19;
  for (const [label, value, kind] of rows) {
    if (kind === 'total') {
      doc.rect(rightX + 1, ry - 4, rightW - 2, ROW_H).fill(tint(brand, 0.95));
    }
    if (kind === 'balance') {
      doc.rect(rightX + 10, ry - 5, rightW - 20, 0.8).fill(LINE);
      ry += 2;
    }
    const strong = kind === 'total' || kind === 'balance';
    const color = kind === 'balance' ? (balance > 0 ? STATUS.Pending.color : STATUS.Received.color) : INK;
    doc.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 9.6 : 8.6).fillColor(strong ? INK : MUTED)
      .text(label, rightX + 10, ry, { width: rightW * 0.55, lineBreak: false, ellipsis: true });
    doc.font('Helvetica-Bold').fontSize(strong ? 10.5 : 9).fillColor(color)
      .text(value, rightX + 10, ry - (strong ? 0.8 : 0), { width: rightW - 20, align: 'right', lineBreak: false });
    ry += ROW_H;
  }
  doc.font('Helvetica-Oblique').fontSize(7).fillColor(MUTED)
    .text(amountInWords(balance), rightX + 10, y + PANEL_H - 14, { width: rightW - 20, lineBreak: false, ellipsis: true });

  y += PANEL_H + 11;

  // ============================================================ bank details
  if (banks.length && y + bankBlockHeight(banks) < pageH - 26) {
    y = drawBankBlock(doc, banks, { x: left, y, width, accent: brand, tintColor: tint(brand, 0.95), ink: INK, muted: MUTED }) + 8;
  }

  // ================================================================== footer
  const contact = [company.phone, company.email, company.website].filter(Boolean).join('  ·  ');
  doc.rect(0, pageH - 22, pageW, 22).fill(brandSoft);
  doc.font('Helvetica').fontSize(7.2).fillColor(MUTED)
    .text(contact || companyName, left, pageH - 14.5, { width: width * 0.62, lineBreak: false, ellipsis: true });
  doc.font('Helvetica-Oblique').fontSize(7).fillColor(MUTED)
    .text('Computer-generated bill — no signature required.', left, pageH - 14.5, { width, align: 'right', lineBreak: false });
}

export default renderBillSlips;
