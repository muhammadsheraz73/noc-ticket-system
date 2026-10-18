import { PassThrough } from 'node:stream';
import PDFDocument from 'pdfkit';
import env from '../config/env.js';
import logger from '../utils/logger.js';

/**
 * A quotation on the client's own letterhead: their logo, colour, address
 * and default terms. Renders to a Buffer so the route can send a fixed
 * Content-Length (see pdfService.js for why).
 */

const DEFAULT_BRAND = '#E35A00';
const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';

const money = (value) =>
  Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (value) => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });

function longDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: env.timezone, day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(value));
}

/** Mix a hex colour with white — `amount` 0 = colour, 1 = white. */
function tint(hex, amount) {
  const n = Number.parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0');
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
}

// ------------------------------------------------------------ amount in words
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowThousand(n) {
  const parts = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ''));
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(' ');
}

function integerWords(n) {
  if (n === 0) return 'Zero';
  const scales = [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']];
  const parts = [];
  for (const [size, name] of scales) {
    if (n >= size) {
      parts.push(`${belowThousand(Math.floor(n / size))} ${name}`);
      n %= size;
    }
  }
  if (n) parts.push(belowThousand(n));
  return parts.join(' ');
}

/** `Rupees One Hundred Twenty-Five Thousand and Fifty Paisa Only` */
export function amountInWords(value, currency = 'PKR') {
  const total = Math.round(Math.max(0, Number(value) || 0) * 100);
  const whole = Math.floor(total / 100);
  const cents = total % 100;
  const [major, minor] = currency === 'PKR' ? ['Rupees', 'Paisa'] : [currency, 'Cents'];
  return `${major} ${integerWords(whole)}${cents ? ` and ${integerWords(cents)} ${minor}` : ''} Only`;
}

function logoBuffer(dataUrl) {
  const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl || '');
  return match ? Buffer.from(match[2], 'base64') : null;
}

/**
 * @param quotation  Quotation (lean or document)
 * @param company    { name, address, phone, email, website, logo, color }
 */
export function renderQuotationPdf(quotation, company = {}) {
  return new Promise((resolve, reject) => {
    const brand = /^#[0-9a-fA-F]{6}$/.test(company.color || '') ? company.color : DEFAULT_BRAND;
    const soft = tint(brand, 0.9);
    const companyName = company.name || env.company.name;
    const currency = quotation.currency || env.invoice.currency;

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 40, bottom: 40, left: 42, right: 42 },
      bufferPages: true,
      info: { Title: `Quotation ${quotation.quoteNumber}`, Author: companyName },
    });
    const out = new PassThrough();
    const chunks = [];
    out.on('data', (c) => chunks.push(c));
    out.on('end', () => resolve(Buffer.concat(chunks)));
    out.on('error', reject);
    doc.pipe(out);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;
    const bottomLimit = doc.page.height - doc.page.margins.bottom - 30;

    // ================================================================ header
    doc.rect(0, 0, doc.page.width, 8).fill(brand);

    let y = 30;
    let headerBottom = y;
    const logo = logoBuffer(company.logo);
    let drewLogo = false;
    if (logo) {
      try {
        doc.image(logo, left, y, { fit: [170, 62], align: 'left', valign: 'top' });
        drewLogo = true;
        headerBottom = y + 66;
      } catch (error) {
        logger.warn(`Quotation PDF: could not draw the logo (${error.message})`);
      }
    }
    if (!drewLogo) {
      doc.font('Helvetica-Bold').fontSize(19).fillColor(INK).text(companyName, left, y + 4, { width: width * 0.55 });
      headerBottom = doc.y + 4;
    }

    doc.font('Helvetica-Bold').fontSize(26).fillColor(brand).text('QUOTATION', left, y, { width, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(`# ${quotation.quoteNumber}`, left, y + 32, { width, align: 'right' });

    // Company letterhead lines under the logo / name
    y = Math.max(headerBottom, y + 50);
    if (drewLogo) {
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(companyName, left, y, { width: width * 0.6 });
      y = doc.y + 1;
    }
    const contactLine = [company.phone, company.email].filter(Boolean).join('   ·   ');
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
    for (const line of [company.address, contactLine, company.website].filter(Boolean)) {
      doc.text(line, left, y, { width: width * 0.6 });
      y = doc.y + 1;
    }
    y += 12;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).lineWidth(1).stroke();
    y += 14;

    // ===================================================== to / reference
    const colW = (width - 20) / 2;
    const blockTop = y;

    doc.font('Helvetica-Bold').fontSize(8).fillColor(brand).text('QUOTATION FOR', left, y, { characterSpacing: 0.6 });
    y = doc.y + 4;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(quotation.clientName, left, y, { width: colW });
    y = doc.y + 2;
    doc.font('Helvetica').fontSize(9).fillColor('#334155');
    for (const line of [
      quotation.clientCompany,
      quotation.clientAddress,
      quotation.clientPhone ? `Phone: ${quotation.clientPhone}` : '',
      quotation.clientEmail ? `Email: ${quotation.clientEmail}` : '',
      quotation.customerReferenceNumber ? `Customer ID: ${quotation.customerReferenceNumber}` : '',
    ].filter(Boolean)) {
      doc.text(line, left, y, { width: colW });
      y = doc.y + 1;
    }
    const leftBottom = y;

    // Reference box
    const refX = left + colW + 20;
    const refRows = [
      ['Quotation No.', quotation.quoteNumber],
      ['Date', longDate(quotation.issueDate)],
      ['Valid Until', longDate(quotation.validUntil)],
      ['Prepared By', quotation.createdByName || '—'],
    ];
    const refH = 16 + refRows.length * 17;
    doc.roundedRect(refX, blockTop, colW, refH, 5).fill(soft);
    let ry = blockTop + 10;
    for (const [label, value] of refRows) {
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(label, refX + 12, ry, { width: colW * 0.45 });
      doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(value, refX + colW * 0.45, ry, { width: colW * 0.55 - 12, align: 'right' });
      ry += 17;
    }

    y = Math.max(leftBottom, blockTop + refH) + 16;

    // ============================================================= subject
    if (quotation.subject) {
      doc.rect(left, y, 3, 18).fill(brand);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(`Subject: ${quotation.subject}`, left + 10, y + 4, { width: width - 10 });
      y = Math.max(y + 18, doc.y) + 12;
    }

    // ============================================================== items
    const spec = [
      ['#', 0.06, 'center'],
      ['DESCRIPTION', 0.46, 'left'],
      ['QTY', 0.09, 'right'],
      ['UNIT', 0.09, 'center'],
      ['UNIT PRICE', 0.15, 'right'],
      [`AMOUNT (${currency})`, 0.15, 'right'],
    ];
    let cx = left;
    const cols = spec.map(([label, frac, align]) => {
      const c = { label, x: cx, w: width * frac, align };
      cx += c.w;
      return c;
    });
    const pad = 6;

    const drawHead = () => {
      doc.rect(left, y, width, 22).fill(brand);
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
      cols.forEach((c) => doc.text(c.label, c.x + pad, y + 7.5, { width: c.w - pad * 2, align: c.align, lineBreak: false }));
      y += 22;
    };
    drawHead();

    quotation.items.forEach((item, i) => {
      doc.font('Helvetica').fontSize(9);
      const h = Math.max(22, doc.heightOfString(item.description, { width: cols[1].w - pad * 2 }) + 12);
      if (y + h > bottomLimit) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHead();
      }
      if (i % 2 === 1) doc.rect(left, y, width, h).fill('#f8fafc');
      const values = [String(i + 1), item.description, qty(item.quantity), item.unit || '—', money(item.rate), money(item.amount)];
      values.forEach((v, j) => {
        doc.font(j === 5 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(j === 0 || j === 3 ? MUTED : INK)
          .text(v, cols[j].x + pad, y + 6, { width: cols[j].w - pad * 2, align: cols[j].align });
      });
      y += h;
      doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).lineWidth(0.6).stroke();
    });

    // ============================================================= totals
    const rows = [['Subtotal', money(quotation.subtotal)]];
    if (quotation.discountAmount > 0) {
      rows.push([quotation.discountType === 'percent' ? `Discount (${quotation.discountValue}%)` : 'Discount', `- ${money(quotation.discountAmount)}`]);
    }
    if (quotation.taxAmount > 0) rows.push([`Sales Tax (${quotation.taxPercent}%)`, money(quotation.taxAmount)]);
    const totalsH = rows.length * 18 + 34;
    if (y + 14 + totalsH > bottomLimit) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    y += 14;
    const tX = left + width * 0.55;
    const tW = right - tX;
    const totalsTop = y;
    for (const [label, value] of rows) {
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(label, tX, y, { width: tW * 0.5 });
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(value, tX, y, { width: tW, align: 'right' });
      y += 18;
    }
    doc.roundedRect(tX, y, tW, 28, 4).fill(brand);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff').text('TOTAL', tX + 10, y + 9, { width: tW * 0.4 });
    doc.text(`${currency} ${money(quotation.total)}`, tX, y + 9, { width: tW - 10, align: 'right' });
    y += 28;

    // Amount in words, beside the totals
    const wW = width * 0.55 - 20;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(brand).text('AMOUNT IN WORDS', left, totalsTop, { characterSpacing: 0.6 });
    doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(INK).text(amountInWords(quotation.total, currency), left, totalsTop + 13, { width: wW });
    y = Math.max(y, doc.y) + 22;

    // ===================================================== notes & terms
    const section = (title, body, numbered) => {
      if (!body) return;
      const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return;
      if (y + 40 > bottomLimit) { doc.addPage(); y = doc.page.margins.top; }
      doc.font('Helvetica-Bold').fontSize(8).fillColor(brand).text(title, left, y, { characterSpacing: 0.6 });
      y = doc.y + 4;
      lines.forEach((line, i) => {
        const text = numbered && lines.length > 1 && !/^\d+[.)]/.test(line) ? `${i + 1}.  ${line}` : line;
        doc.font('Helvetica').fontSize(9).fillColor('#334155');
        const h = doc.heightOfString(text, { width });
        if (y + h > bottomLimit) { doc.addPage(); y = doc.page.margins.top; }
        doc.text(text, left, y, { width });
        y = doc.y + 2;
      });
      y += 12;
    };
    section('NOTES', quotation.notes, false);
    section('TERMS & CONDITIONS', quotation.terms, true);

    // ========================================================= signatures
    if (y + 70 > bottomLimit) { doc.addPage(); y = doc.page.margins.top; }
    y = Math.max(y + 18, bottomLimit - 60);
    const sigW = 190;
    doc.moveTo(left, y + 30).lineTo(left + sigW, y + 30).strokeColor('#94a3b8').lineWidth(0.8).stroke();
    doc.moveTo(right - sigW, y + 30).lineTo(right, y + 30).stroke();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(`For ${companyName}`, left, y + 36, { width: sigW });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Authorised Signature', left, y + 48, { width: sigW });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text('Customer Acceptance', right - sigW, y + 36, { width: sigW, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Signature & Date', right - sigW, y + 48, { width: sigW, align: 'right' });

    // ============================================================= footer
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      const fy = doc.page.height - doc.page.margins.bottom - 14;
      doc.rect(left, fy - 8, width, 1.2).fill(brand);
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
      doc.text(`Thank you for your business  ·  ${companyName}  ·  ${quotation.quoteNumber}`, left, fy, { width: width * 0.75, lineBreak: false });
      doc.text(`Page ${i + 1} of ${range.count}`, left + width * 0.75, fy, { width: width * 0.25, align: 'right', lineBreak: false });
    }

    doc.end();
  });
}

export default renderQuotationPdf;
