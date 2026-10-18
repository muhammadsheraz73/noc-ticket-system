import { PassThrough } from 'node:stream';
import PDFDocument from 'pdfkit';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import { bankBlockHeight, drawBankBlock } from './pdfBank.js';

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
 * @param company    { name, address, phone, email, website, logo, color, bankAccounts }
 */
export function renderQuotationPdf(quotation, company = {}) {
  return new Promise((resolve, reject) => {
    const brand = /^#[0-9a-fA-F]{6}$/.test(company.color || '') ? company.color : DEFAULT_BRAND;
    const brandSoft = tint(brand, 0.9);
    const brandFaint = tint(brand, 0.95);
    const companyName = company.name || env.company.name;
    const currency = quotation.currency || env.invoice.currency;

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 36, bottom: 36, left: 36, right: 36 },
      bufferPages: true,
      info: { Title: `Quotation ${quotation.quoteNumber}`, Author: companyName, Subject: quotation.subject || '' },
    });
    const out = new PassThrough();
    const chunks = [];
    out.on('data', (c) => chunks.push(c));
    out.on('end', () => resolve(Buffer.concat(chunks)));
    out.on('error', reject);
    doc.pipe(out);

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const left = doc.page.margins.left;
    const right = pageW - doc.page.margins.right;
    const width = right - left;
    const FOOTER_H = 30;
    const bottomLimit = pageH - FOOTER_H - 14;

    /** Text height in a given font, for laying out before drawing. */
    const measure = (text, font, size, w) => doc.font(font).fontSize(size).heightOfString(text || ' ', { width: w });

    // ================================================================ header
    const HEADER_H = 96;
    doc.rect(0, 0, pageW, HEADER_H).fill(brand);
    // A lighter slanted panel on the right gives the band some depth.
    doc.polygon([pageW - 250, 0], [pageW, 0], [pageW, HEADER_H], [pageW - 320, HEADER_H]).fill(tint(brand, 0.12));
    doc.rect(0, HEADER_H, pageW, 3).fill(tint(brand, 0.55));

    const logo = logoBuffer(company.logo);
    let drewLogo = false;
    if (logo) {
      try {
        doc.roundedRect(left, 18, 176, 60, 6).fill('#ffffff');
        doc.image(logo, left + 8, 23, { fit: [160, 50], align: 'center', valign: 'center' });
        drewLogo = true;
      } catch (error) {
        logger.warn(`Quotation PDF: could not draw the logo (${error.message})`);
      }
    }
    if (!drewLogo) {
      doc.font('Helvetica-Bold').fontSize(20).fillColor('#ffffff').text(companyName, left, 30, { width: width * 0.55, lineBreak: false, ellipsis: true });
      if (company.website || company.email) {
        doc.font('Helvetica').fontSize(9).fillColor(tint(brand, 0.75)).text(company.website || company.email, left, 56, { width: width * 0.55 });
      }
    }

    doc.font('Helvetica-Bold').fontSize(28).fillColor('#ffffff').text('QUOTATION', left, 22, { width, align: 'right', characterSpacing: 1 });
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#ffffff').text(quotation.quoteNumber, left, 58, { width, align: 'right' });
    doc.font('Helvetica').fontSize(8.5).fillColor(tint(brand, 0.78)).text(`Issued ${longDate(quotation.issueDate)}`, left, 73, { width, align: 'right' });

    // ========================================================== info strip
    let y = HEADER_H + 18;
    const info = [
      ['QUOTATION NO.', quotation.quoteNumber],
      ['QUOTATION DATE', longDate(quotation.issueDate)],
      ['VALID UNTIL', longDate(quotation.validUntil)],
      ['PREPARED BY', quotation.createdByName || '—'],
    ];
    const gap = 8;
    const cellW = (width - gap * (info.length - 1)) / info.length;
    info.forEach(([label, value], i) => {
      const x = left + i * (cellW + gap);
      doc.roundedRect(x, y, cellW, 42, 4).lineWidth(0.8).fillAndStroke('#ffffff', LINE);
      doc.rect(x, y, cellW, 2.5).fill(brand);
      doc.font('Helvetica-Bold').fontSize(6.8).fillColor(MUTED).text(label, x + 10, y + 10, { width: cellW - 20, characterSpacing: 0.6 });
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(value, x + 10, y + 23, { width: cellW - 20, lineBreak: false, ellipsis: true });
    });
    y += 42 + 14;

    // ====================================================== from / for panels
    const panelW = (width - 12) / 2;
    const fromLines = [
      company.address,
      company.phone ? `Phone: ${company.phone}` : '',
      company.email ? `Email: ${company.email}` : '',
      company.website ? `Web: ${company.website}` : '',
    ].filter(Boolean);
    const forLines = [
      quotation.clientCompany,
      quotation.clientAddress,
      quotation.clientPhone ? `Phone: ${quotation.clientPhone}` : '',
      quotation.clientEmail ? `Email: ${quotation.clientEmail}` : '',
      quotation.customerReferenceNumber ? `Customer ID: ${quotation.customerReferenceNumber}` : '',
    ].filter(Boolean);

    const bodyHeight = (name, lines) => measure(name, 'Helvetica-Bold', 11, panelW - 24) + 4
      + lines.reduce((s, l) => s + measure(l, 'Helvetica', 8.8, panelW - 24) + 2.5, 0);
    const panelH = Math.max(86, 22 + 12 + Math.max(bodyHeight(companyName, fromLines), bodyHeight(quotation.clientName, forLines)) + 10);

    const panel = (x, title, name, lines) => {
      doc.roundedRect(x, y, panelW, panelH, 5).lineWidth(0.8).stroke(LINE);
      doc.save();
      doc.roundedRect(x, y, panelW, 22, 5).clip();
      doc.rect(x, y, panelW, 22).fill(brandSoft);
      doc.restore();
      doc.rect(x, y + 21, panelW, 1).fill(tint(brand, 0.75));
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(brand).text(title, x + 12, y + 7.5, { characterSpacing: 0.8 });
      let py = y + 32;
      doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(name, x + 12, py, { width: panelW - 24 });
      py = doc.y + 4;
      doc.font('Helvetica').fontSize(8.8).fillColor('#334155');
      for (const line of lines) {
        doc.text(line, x + 12, py, { width: panelW - 24 });
        py = doc.y + 2.5;
      }
    };
    panel(left, 'FROM', companyName, fromLines);
    panel(left + panelW + 12, 'QUOTATION FOR', quotation.clientName, forLines);
    y += panelH + 14;

    // ============================================================= subject
    if (quotation.subject) {
      const h = Math.max(26, measure(quotation.subject, 'Helvetica-Bold', 10, width - 90) + 14);
      doc.rect(left, y, width, h).fill(brandFaint);
      doc.rect(left, y, 3.5, h).fill(brand);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(brand).text('SUBJECT', left + 14, y + (h - 8) / 2 - 1, { characterSpacing: 0.8 });
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(quotation.subject, left + 76, y + 7, { width: width - 90 });
      y += h + 12;
    }

    // ===================================================== everything below the table
    const colGap = 18;
    const leftColW = width * 0.56 - colGap / 2;
    const rightColW = width - leftColW - colGap;
    const words = amountInWords(quotation.total, currency);
    const termLines = (quotation.terms || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      .map((line, i, all) => (all.length > 1 && !/^\d+[.)]/.test(line) ? `${i + 1}.  ${line}` : line));
    const noteText = (quotation.notes || '').trim();

    const totalRows = [['Subtotal', money(quotation.subtotal)]];
    if (quotation.discountAmount > 0) {
      totalRows.push([quotation.discountType === 'percent' ? `Discount (${quotation.discountValue}%)` : 'Discount', `- ${money(quotation.discountAmount)}`]);
    }
    if (quotation.taxAmount > 0) totalRows.push([`Sales Tax (${quotation.taxPercent}%)`, money(quotation.taxAmount)]);

    const wordsH = 22 + measure(words, 'Helvetica-Oblique', 9.5, leftColW - 20) + 10;
    const notesH = noteText ? 18 + measure(noteText, 'Helvetica', 8.8, leftColW) + 10 : 0;
    const termsH = termLines.length
      ? 18 + termLines.reduce((s, l) => s + measure(l, 'Helvetica', 8.8, leftColW) + 3, 0)
      : 0;
    const leftColH = wordsH + 12 + notesH + termsH;
    const rightColH = totalRows.length * 22 + 12 + 34 + 16;
    const summaryH = Math.max(leftColH, rightColH);
    const SIGN_H = 66;
    const accounts = company.bankAccounts || [];
    const bankH = bankBlockHeight(accounts);
    const tailH = 16 + summaryH + (bankH ? 16 + bankH : 0) + 22 + SIGN_H;

    // ============================================================== items
    const spec = [
      ['#', 0.06, 'center'],
      ['DESCRIPTION', 0.43, 'left'],
      ['QTY', 0.09, 'center'],
      ['UNIT', 0.09, 'center'],
      ['UNIT PRICE', 0.15, 'right'],
      [`AMOUNT (${currency})`, 0.18, 'right'],
    ];
    let cx = left;
    const cols = spec.map(([label, frac, align]) => {
      const c = { label, x: cx, w: width * frac, align };
      cx += c.w;
      return c;
    });
    const pad = 7;
    const ROW_H = 24;

    const drawHead = () => {
      doc.rect(left, y, width, 26).fill(brand);
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
      cols.forEach((c) => doc.text(c.label, c.x + pad, y + 9, { width: c.w - pad * 2, align: c.align, lineBreak: false, characterSpacing: 0.4 }));
      y += 26;
    };
    const rowFrame = (h, zebra) => {
      if (zebra) doc.rect(left, y, width, h).fill(brandFaint);
      doc.lineWidth(0.5).strokeColor(LINE);
      cols.slice(1).forEach((c) => doc.moveTo(c.x, y).lineTo(c.x, y + h).stroke());
      doc.moveTo(left, y).lineTo(left, y + h).stroke();
      doc.moveTo(right, y).lineTo(right, y + h).stroke();
      doc.moveTo(left, y + h).lineTo(right, y + h).stroke();
    };

    drawHead();
    let pageOfTable = 0;
    quotation.items.forEach((item, i) => {
      const h = Math.max(ROW_H, measure(item.description, 'Helvetica', 9, cols[1].w - pad * 2) + 13);
      if (y + h > bottomLimit) {
        doc.addPage();
        pageOfTable += 1;
        y = doc.page.margins.top;
        drawHead();
      }
      rowFrame(h, i % 2 === 1);
      const values = [String(i + 1), item.description, qty(item.quantity), item.unit || '—', money(item.rate), money(item.amount)];
      values.forEach((v, j) => {
        doc.font(j === 5 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(j === 0 || j === 3 ? MUTED : INK)
          .text(v, cols[j].x + pad, y + 7.5, { width: cols[j].w - pad * 2, align: cols[j].align });
      });
      y += h;
    });

    // Fill the rest of the table with ruled blank rows so the page reads as a
    // complete, printed form instead of a short table and an empty sheet.
    if (pageOfTable === 0) {
      let n = quotation.items.length;
      while (y + ROW_H + tailH <= bottomLimit) {
        rowFrame(ROW_H, n % 2 === 1);
        y += ROW_H;
        n += 1;
      }
    }

    // ======================================================= summary block
    if (y + tailH > bottomLimit) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    y += 16;
    const blockTop = y;

    // Totals (right)
    const tX = left + leftColW + colGap;
    const totalsBoxH = totalRows.length * 22 + 12;
    doc.roundedRect(tX, y, rightColW, totalsBoxH, 4).lineWidth(0.8).stroke(LINE);
    let ty = y + 8;
    totalRows.forEach(([label, value], i) => {
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(label, tX + 12, ty + 3, { width: rightColW * 0.55 });
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(value, tX, ty + 3, { width: rightColW - 12, align: 'right' });
      ty += 22;
      if (i < totalRows.length - 1) doc.moveTo(tX + 12, ty - 2).lineTo(tX + rightColW - 12, ty - 2).lineWidth(0.5).stroke(LINE);
    });
    ty = y + totalsBoxH + 6;
    doc.roundedRect(tX, ty, rightColW, 34, 4).fill(brand);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff').text('TOTAL', tX + 12, ty + 11.5, { width: rightColW * 0.4, characterSpacing: 1 });
    doc.font('Helvetica-Bold').fontSize(13).text(`${currency} ${money(quotation.total)}`, tX, ty + 10.5, { width: rightColW - 12, align: 'right' });
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(MUTED).text(`All amounts in ${currency === 'PKR' ? 'Pakistani Rupees (PKR)' : currency}`, tX, ty + 40, { width: rightColW, align: 'right' });

    // Amount in words, notes, terms (left)
    let ly = y;
    doc.roundedRect(left, ly, leftColW, wordsH, 4).fill(brandFaint);
    doc.rect(left, ly, 3, wordsH).fill(brand);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(brand).text('AMOUNT IN WORDS', left + 12, ly + 9, { characterSpacing: 0.8 });
    doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(INK).text(words, left + 12, ly + 22, { width: leftColW - 20 });
    ly += wordsH + 12;

    if (noteText) {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(brand).text('NOTES', left, ly, { characterSpacing: 0.8 });
      doc.font('Helvetica').fontSize(8.8).fillColor('#334155').text(noteText, left, ly + 13, { width: leftColW });
      ly = doc.y + 10;
    }
    if (termLines.length) {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(brand).text('TERMS & CONDITIONS', left, ly, { characterSpacing: 0.8 });
      ly += 14;
      doc.font('Helvetica').fontSize(8.8).fillColor('#334155');
      for (const line of termLines) {
        doc.text(line, left, ly, { width: leftColW });
        ly = doc.y + 3;
      }
    }

    // ======================================================== bank details
    let afterSummary = blockTop + summaryH;
    if (bankH) {
      if (afterSummary + 16 + bankH + 22 + SIGN_H > bottomLimit) {
        doc.addPage();
        afterSummary = doc.page.margins.top - 16;
      }
      afterSummary = drawBankBlock(doc, accounts, {
        x: left, y: afterSummary + 16, width, accent: brand, tintColor: brandFaint, ink: INK, muted: MUTED,
      });
    }

    // ========================================================== signatures
    if (afterSummary + 22 + SIGN_H > bottomLimit) {
      doc.addPage();
      afterSummary = doc.page.margins.top;
    }
    y = Math.max(afterSummary + 22, bottomLimit - SIGN_H);
    const sigGap = 16;
    const sigW = (width - sigGap * 2) / 3;
    const sigs = [
      ['Prepared By', quotation.createdByName || ''],
      [`For ${companyName}`, ''],
      ['Customer Acceptance', ''],
    ];
    const sigCaptions = ['Name & Signature', 'Authorised Signature & Stamp', 'Name, Signature & Date'];
    sigs.forEach(([title, preset], i) => {
      const x = left + i * (sigW + sigGap);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(title, x, y, { width: sigW, lineBreak: false, ellipsis: true });
      if (preset) doc.font('Helvetica').fontSize(9).fillColor('#334155').text(preset, x, y + 24, { width: sigW });
      doc.moveTo(x, y + 44).lineTo(x + sigW, y + 44).lineWidth(0.8).stroke('#94a3b8');
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(sigCaptions[i], x, y + 49, { width: sigW });
    });

    // ============================================================= footer
    const contact = [company.address, company.phone, company.email, company.website].filter(Boolean).join('   •   ')
      || `${companyName} — Thank you for your business`;
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      // Drawing in the bottom margin must not trigger an automatic page break.
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.rect(0, pageH - FOOTER_H, pageW, FOOTER_H).fill(brand);
      doc.font('Helvetica').fontSize(7.5).fillColor('#ffffff')
        .text(contact, left, pageH - FOOTER_H + 11, { width: width - 70, lineBreak: false, ellipsis: true });
      doc.font('Helvetica-Bold').fontSize(7.5)
        .text(`Page ${i + 1} of ${range.count}`, right - 70, pageH - FOOTER_H + 11, { width: 70, align: 'right', lineBreak: false });
      doc.page.margins.bottom = savedBottom;
    }

    doc.end();
  });
}

export default renderQuotationPdf;
