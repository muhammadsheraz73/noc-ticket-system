import { PassThrough } from 'node:stream';
import PDFDocument from 'pdfkit';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import { cell, collectClientData, fieldsOf, heading } from './dataExport.js';
import { drawWordmark, measureWordmark } from './pdfBrand.js';
import { logoBuffer, tint } from './quotationPdf.js';

/**
 * A client's complete data as a PDF — the same records and the same fields as
 * the Excel download (both come from collectClientData), laid out for reading:
 * letterhead, a summary of how many records each area has, then every record
 * as a card listing all of its fields.
 *
 * Runs inside the client's tenant scope, so it only ever sees that client.
 */

const DEFAULT_BRAND = '#E35A00';
const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const MARGIN = 30;
const FOOTER_H = 20;
const COLS = 5;            // short fields per row
const CELL_H = 23;         // label + one line of value
const SHORT_MAX = 30;      // longer values get a full-width, wrapped row
const LONG_MAX = 1500;     // keep one record from running over a whole page

/** A database id (e.g. "6ae0a3a8…"): a link between records, meaningless on paper — the readable name is shown instead. */
const isId = (value) => value?._bsontype === 'ObjectId' || /^[0-9a-f]{24}$/i.test(String(value ?? ''));

const shortDate = (value) => new Intl.DateTimeFormat('en-GB', {
  timeZone: env.timezone, day: '2-digit', month: 'short', year: 'numeric',
}).format(value);

/** A readable heading for one record, per area. */
function titleOf(area, r) {
  switch (area) {
    case 'Customers': return `${r.customerReferenceNumber || ''} — ${r.name || ''}`;
    case 'Tickets': return `TID ${r.ticketNumber} — ${r.customerName || ''}`;
    case 'Invoices': return `${r.invoiceNumber} — ${r.customerName || ''}`;
    case 'Quotations': return `${r.quoteNumber} — ${r.clientName || ''}`;
    case 'Monthly bills': return `${r.username} — ${r.period}`;
    case 'Payments': return `${r.user} — PKR ${Number(r.amount || 0).toLocaleString('en-US')}`;
    case 'Billing users': return r.username;
    case 'Stock movements': return `${r.itemName || r.type || 'Movement'}${r.quantity !== undefined ? ` × ${r.quantity}` : ''}`;
    case 'VLANs': return `VLAN ${r.vlanId}${r.name ? ` — ${r.name}` : ''}`;
    case 'Connections': return r.label || r.customerReferenceNumber || 'Connection';
    default: return r.name || r.code || r.sku || 'Record';
  }
}

/** @param company { name, logo, themeColor } — the client's letterhead */
export async function buildClientReportPdf(company) {
  const areas = await collectClientData();

  return new Promise((resolve, reject) => {
    const brand = /^#[0-9a-fA-F]{6}$/.test(company.themeColor || '') ? company.themeColor : DEFAULT_BRAND;
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: { Title: `${company.name} — complete data`, Author: company.name },
    });
    const out = new PassThrough();
    const chunks = [];
    out.on('data', (c) => chunks.push(c));
    out.on('end', () => resolve(Buffer.concat(chunks)));
    out.on('error', reject);
    doc.pipe(out);

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const left = MARGIN;
    const width = pageW - MARGIN * 2;
    const bottom = pageH - MARGIN - FOOTER_H;
    const today = shortDate(new Date());
    let y;

    const newPage = () => {
      doc.addPage();
      y = MARGIN;
    };

    // ======================================================= letterhead band
    const BAND = 78;
    doc.rect(0, 0, pageW, BAND).fill(brand);
    doc.polygon([pageW - 260, 0], [pageW, 0], [pageW, BAND], [pageW - 320, BAND]).fill(tint(brand, 0.12));
    let drewLogo = false;
    const logo = logoBuffer(company.logo);
    if (logo) {
      try {
        doc.roundedRect(left, 14, 160, 50, 6).fill('#ffffff');
        doc.image(logo, left + 6, 18, { fit: [148, 42], align: 'center', valign: 'center' });
        drewLogo = true;
      } catch (error) {
        logger.warn(`Data report: could not draw the logo (${error.message})`);
      }
    }
    if (!drewLogo) {
      const { width: markW } = measureWordmark(doc, company.name, { height: 32, maxWidth: width * 0.5 });
      doc.roundedRect(left, 14, Math.max(160, markW + 26), 50, 6).fill('#ffffff');
      drawWordmark(doc, company.name, { x: left + 13, y: 23, height: 32, maxWidth: width * 0.5, brand, ink: INK });
    }
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#ffffff').text('COMPLETE DATA', left, 20, { width, align: 'right', characterSpacing: 0.8 });
    doc.font('Helvetica').fontSize(9.5).fillColor('#ffffff').text(`${company.name} · ${today}`, left, 48, { width, align: 'right' });
    y = BAND + 18;

    // ============================================================= summary
    doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text('Summary', left, y);
    y += 20;
    const perRow = 7;
    const gap = 8;
    const tileW = (width - gap * (perRow - 1)) / perRow;
    areas.forEach(({ name, docs }, i) => {
      const x = left + (i % perRow) * (tileW + gap);
      const ty = y + Math.floor(i / perRow) * 48;
      doc.roundedRect(x, ty, tileW, 40, 4).lineWidth(0.8).fillAndStroke('#ffffff', LINE);
      doc.rect(x, ty, 3, 40).fill(brand);
      doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(String(docs.length), x + 11, ty + 6, { width: tileW - 16 });
      doc.font('Helvetica').fontSize(7.8).fillColor(MUTED).text(name, x + 11, ty + 25, { width: tileW - 16, lineBreak: false, ellipsis: true });
    });
    y += Math.ceil(areas.length / perRow) * 48 + 6;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
      'Every record this company has on the panel, with all of its fields — the same data as the Excel download. Empty fields and internal record ids are left out (the Excel file keeps the ids).',
      left, y, { width },
    );
    y += 24;

    // ====================================================== record cards
    const innerW = width - 20;
    const cellW = innerW / COLS;

    /** Lay one record out: short fields in a grid, long ones full width. Returns what to draw and its height. */
    const layout = (docItem, keys) => {
      const short = [];
      const long = [];
      for (const key of keys) {
        const raw = docItem[key];
        if (isId(raw) || (key === 'isDeleted' && !raw)) continue;
        let text = cell(raw);
        if (text === '' || text === null || text === undefined) continue;
        text = String(text);
        if (text.length > SHORT_MAX || text.includes('\n')) long.push([heading(key), text.slice(0, LONG_MAX)]);
        else short.push([heading(key), text]);
      }
      doc.font('Helvetica').fontSize(8.3);
      const longH = long.map(([, text]) => 11 + doc.heightOfString(text, { width: innerW }) + 5);
      const height = 22 + Math.ceil(short.length / COLS) * CELL_H + longH.reduce((s, h) => s + h, 0) + 6;
      return { short, long, longH, height };
    };

    for (const { name, docs } of areas) {
      if (y + 60 > bottom) newPage();
      doc.rect(left, y, width, 24).fill(tint(brand, 0.88));
      doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(name, left + 10, y + 6.5, { continued: true })
        .font('Helvetica').fontSize(9).fillColor(MUTED).text(`   ${docs.length} record${docs.length === 1 ? '' : 's'}`);
      y += 32;

      if (!docs.length) {
        doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED).text('No records.', left + 10, y);
        y += 24;
        continue;
      }

      const keys = fieldsOf(docs);
      docs.forEach((record, index) => {
        const card = layout(record, keys);
        if (y + card.height > bottom) {
          newPage();
          doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text(`${name} (continued)`, left, y);
          y += 16;
        }
        const top = y;
        doc.roundedRect(left, top, width, card.height, 4).lineWidth(0.7).stroke(LINE);
        doc.rect(left, top, 3, card.height).fill(brand);

        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK)
          .text(`${index + 1}. ${titleOf(name, record)}`, left + 10, top + 7, { width: innerW, lineBreak: false, ellipsis: true });
        let cy = top + 22;

        card.short.forEach(([label, text], i) => {
          const cx = left + 10 + (i % COLS) * cellW;
          const ry = cy + Math.floor(i / COLS) * CELL_H;
          doc.font('Helvetica-Bold').fontSize(6.4).fillColor(MUTED)
            .text(label.toUpperCase(), cx, ry, { width: cellW - 8, lineBreak: false, ellipsis: true, characterSpacing: 0.2 });
          doc.font('Helvetica').fontSize(8.3).fillColor(INK)
            .text(text, cx, ry + 9, { width: cellW - 8, lineBreak: false, ellipsis: true });
        });
        cy += Math.ceil(card.short.length / COLS) * CELL_H;

        card.long.forEach(([label, text], i) => {
          doc.font('Helvetica-Bold').fontSize(6.4).fillColor(MUTED).text(label.toUpperCase(), left + 10, cy, { width: innerW, characterSpacing: 0.2 });
          doc.font('Helvetica').fontSize(8.3).fillColor(INK).text(text, left + 10, cy + 9, { width: innerW });
          cy += card.longH[i];
        });

        y = top + card.height + 6;
      });
      y += 10;
    }

    // ============================================================ footers
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      // The footer sits in the bottom margin; without this pdfkit would start a blank page for it.
      doc.page.margins.bottom = 0;
      const fy = pageH - MARGIN - 8;
      doc.moveTo(left, fy - 6).lineTo(left + width, fy - 6).lineWidth(0.5).stroke(LINE);
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
        .text(`${company.name} — complete data · ${today}`, left, fy, { width: width / 2, lineBreak: false });
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, left, fy, { width, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}

export default buildClientReportPdf;
