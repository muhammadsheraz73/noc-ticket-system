import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import env from '../config/env.js';

/**
 * The complete inventory as a formatted Excel workbook or a printable PDF.
 * Both share one report model (`buildReport`) so the numbers always agree.
 */

const DEFAULT_BRAND = '#E35A00';
const MOVEMENT_LABEL = { in: 'Stock in', out: 'Stock out', adjust: 'Count adjusted' };

const brandHex = (color) => (/^#[0-9a-fA-F]{6}$/.test(color || '') ? color.toUpperCase() : DEFAULT_BRAND);

const money = (value) =>
  Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (value) => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });

function stamp(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: env.timezone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(date));
}

/** `2026-10-18` in the operational timezone, for file names. */
export function fileDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: env.timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date);
}

/** Excel wants a local wall-clock time; shift UTC into the operational timezone. */
function zonedDate(value) {
  const d = new Date(value);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: env.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
}

/**
 * @param items     every InventoryItem (lean)
 * @param branding  { company, color, generatedBy }
 */
export function buildReport(items, branding = {}) {
  const rows = items.map((item) => {
    const low = item.quantity <= item.minStock;
    return {
      ...item,
      status: item.quantity === 0 ? 'Out of stock' : low ? 'Low stock' : 'In stock',
      low,
      costValue: item.quantity * (item.costPrice || 0),
      saleValue: item.quantity * (item.salePrice || 0),
    };
  });

  const categories = new Map();
  for (const r of rows) {
    const key = r.category || 'Uncategorised';
    const c = categories.get(key) || { category: key, skus: 0, units: 0, costValue: 0, saleValue: 0, low: 0 };
    c.skus += 1;
    c.units += r.quantity;
    c.costValue += r.costValue;
    c.saleValue += r.saleValue;
    if (r.low) c.low += 1;
    categories.set(key, c);
  }

  return {
    company: branding.company || env.company.name,
    tagline: branding.tagline || '',
    brand: brandHex(branding.color),
    generatedBy: branding.generatedBy || '',
    generatedAt: new Date(),
    currency: env.invoice.currency,
    rows,
    categories: [...categories.values()].sort((a, b) => b.costValue - a.costValue),
    totals: {
      skus: rows.length,
      units: rows.reduce((s, r) => s + r.quantity, 0),
      lowStock: rows.filter((r) => r.low).length,
      outOfStock: rows.filter((r) => r.quantity === 0).length,
      costValue: rows.reduce((s, r) => s + r.costValue, 0),
      saleValue: rows.reduce((s, r) => s + r.saleValue, 0),
    },
  };
}

// ====================================================================== Excel

const argb = (hex) => `FF${hex.replace('#', '')}`;
const THIN = { style: 'thin', color: { argb: 'FFD9DEE5' } };
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const MONEY_FMT = '#,##0.00';
const QTY_FMT = '#,##0.###';

/** Title, subtitle and a brand rule across the top of a sheet. */
function sheetHeading(ws, report, title, lastCol) {
  ws.mergeCells(1, 1, 1, lastCol);
  const t = ws.getCell(1, 1);
  t.value = `${report.company} — ${title}`;
  t.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(report.brand) } };
  t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 30;

  ws.mergeCells(2, 1, 2, lastCol);
  const s = ws.getCell(2, 1);
  s.value = `Generated ${stamp(report.generatedAt)}${report.generatedBy ? ` by ${report.generatedBy}` : ''} · ${env.timezone}`;
  s.font = { italic: true, size: 9, color: { argb: 'FF64748B' } };
  s.alignment = { indent: 1 };
}

function styleHeaderRow(row, brand) {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(brand) } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = BOX;
  });
}

export async function renderInventoryExcel(report, movements = []) {
  const wb = new ExcelJS.Workbook();
  wb.creator = report.generatedBy || report.company;
  wb.company = report.company;
  wb.created = report.generatedAt;
  wb.title = 'Inventory Report';

  // ------------------------------------------------------------ Inventory
  const ws = wb.addWorksheet('Inventory', {
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: `&L${report.company} — Inventory&RPage &P of &N` },
  });

  const columns = [
    { header: '#', key: 'n', width: 5 },
    { header: 'SKU', key: 'sku', width: 16 },
    { header: 'Item Name', key: 'name', width: 32 },
    { header: 'Category', key: 'category', width: 16 },
    { header: 'Unit', key: 'unit', width: 8 },
    { header: 'In Stock', key: 'quantity', width: 11, fmt: QTY_FMT },
    { header: 'Reorder Level', key: 'minStock', width: 11, fmt: QTY_FMT },
    { header: 'Status', key: 'status', width: 13 },
    { header: `Cost Price (${report.currency})`, key: 'costPrice', width: 14, fmt: MONEY_FMT },
    { header: `Sale Price (${report.currency})`, key: 'salePrice', width: 14, fmt: MONEY_FMT },
    { header: `Stock Value at Cost`, key: 'costValue', width: 17, fmt: MONEY_FMT },
    { header: `Stock Value at Sale`, key: 'saleValue', width: 17, fmt: MONEY_FMT },
    { header: 'Location', key: 'location', width: 18 },
    { header: 'Supplier', key: 'supplier', width: 18 },
    { header: 'Notes', key: 'notes', width: 28 },
  ];
  const last = columns.length;
  columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  sheetHeading(ws, report, 'Inventory Report', last);

  // Summary strip
  const t = report.totals;
  const summary = [
    ['Total SKUs', t.skus, QTY_FMT],
    ['Units in Stock', t.units, QTY_FMT],
    ['Low / Out of Stock', `${t.lowStock} / ${t.outOfStock}`, null],
    [`Stock Value at Cost (${report.currency})`, t.costValue, MONEY_FMT],
    [`Stock Value at Sale (${report.currency})`, t.saleValue, MONEY_FMT],
  ];
  const labelRow = ws.getRow(4);
  const valueRow = ws.getRow(5);
  summary.forEach(([label, value, fmt], i) => {
    const col = 1 + i * 3;
    ws.mergeCells(4, col, 4, col + 2);
    ws.mergeCells(5, col, 5, col + 2);
    const l = labelRow.getCell(col);
    l.value = label.toUpperCase();
    l.font = { bold: true, size: 8.5, color: { argb: 'FF64748B' } };
    l.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    l.alignment = { indent: 1 };
    const v = valueRow.getCell(col);
    v.value = value;
    v.font = { bold: true, size: 14, color: { argb: i === 2 && t.lowStock ? 'FFB91C1C' : 'FF0F172A' } };
    v.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    v.alignment = { indent: 1, horizontal: 'left' };
    if (fmt) v.numFmt = fmt;
  });
  valueRow.height = 24;

  const headerRowNo = 7;
  const header = ws.getRow(headerRowNo);
  columns.forEach((c, i) => { header.getCell(i + 1).value = c.header; });
  styleHeaderRow(header, report.brand);

  report.rows.forEach((r, index) => {
    const row = ws.getRow(headerRowNo + 1 + index);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = c.key === 'n' ? index + 1 : r[c.key] ?? '';
      if (c.fmt) cell.numFmt = c.fmt;
      cell.border = BOX;
      cell.alignment = { vertical: 'middle', wrapText: c.key === 'notes' || c.key === 'name' };
      if (index % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    });
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(2).font = { bold: true, name: 'Consolas' };
    row.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' };
    const status = row.getCell(8);
    status.alignment = { horizontal: 'center', vertical: 'middle' };
    if (r.low) {
      status.font = { bold: true, color: { argb: 'FFB91C1C' } };
      status.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
      row.getCell(6).font = { bold: true, color: { argb: 'FFB91C1C' } };
    } else {
      status.font = { color: { argb: 'FF15803D' } };
    }
  });

  // Totals row with live formulas, so edits in Excel keep adding up.
  const first = headerRowNo + 1;
  const lastData = headerRowNo + report.rows.length;
  const totalRow = ws.getRow(lastData + 1);
  totalRow.getCell(1).value = 'TOTAL';
  ws.mergeCells(lastData + 1, 1, lastData + 1, 5);
  const sumCell = (col, fmt, result) => {
    const letter = ws.getColumn(col).letter;
    const cell = totalRow.getCell(col);
    cell.value = report.rows.length ? { formula: `SUM(${letter}${first}:${letter}${lastData})`, result } : 0;
    cell.numFmt = fmt;
  };
  sumCell(6, QTY_FMT, t.units);
  sumCell(11, MONEY_FMT, t.costValue);
  sumCell(12, MONEY_FMT, t.saleValue);
  for (let c = 1; c <= last; c += 1) {
    const cell = totalRow.getCell(c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    cell.border = BOX;
  }
  totalRow.getCell(1).alignment = { horizontal: 'right', indent: 1 };
  totalRow.height = 20;

  ws.views = [{ state: 'frozen', ySplit: headerRowNo, xSplit: 3 }];
  if (report.rows.length) ws.autoFilter = { from: { row: headerRowNo, column: 1 }, to: { row: lastData, column: last } };
  ws.pageSetup.printTitlesRow = `${headerRowNo}:${headerRowNo}`;

  // ------------------------------------------------------------ By category
  const cs = wb.addWorksheet('By Category', { pageSetup: { orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const catCols = [
    ['Category', 26, null], ['SKUs', 9, QTY_FMT], ['Units in Stock', 14, QTY_FMT], ['Low Stock SKUs', 14, QTY_FMT],
    [`Value at Cost (${report.currency})`, 20, MONEY_FMT], [`Value at Sale (${report.currency})`, 20, MONEY_FMT], ['Share of Value', 13, '0.0%'],
  ];
  catCols.forEach(([, w], i) => { cs.getColumn(i + 1).width = w; });
  sheetHeading(cs, report, 'Stock by Category', catCols.length);
  const ch = cs.getRow(4);
  catCols.forEach(([h], i) => { ch.getCell(i + 1).value = h; });
  styleHeaderRow(ch, report.brand);
  report.categories.forEach((c, i) => {
    const row = cs.getRow(5 + i);
    const values = [c.category, c.skus, c.units, c.low, c.costValue, c.saleValue, t.costValue ? c.costValue / t.costValue : 0];
    values.forEach((v, j) => {
      const cell = row.getCell(j + 1);
      cell.value = v;
      if (catCols[j][2]) cell.numFmt = catCols[j][2];
      cell.border = BOX;
      if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    });
    row.getCell(1).font = { bold: true };
    if (c.low) row.getCell(4).font = { bold: true, color: { argb: 'FFB91C1C' } };
  });
  const catTotal = cs.getRow(5 + report.categories.length);
  [
    'TOTAL', t.skus, t.units, t.lowStock, t.costValue, t.saleValue, t.costValue ? 1 : 0,
  ].forEach((v, j) => {
    const cell = catTotal.getCell(j + 1);
    cell.value = v;
    if (catCols[j][2]) cell.numFmt = catCols[j][2];
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    cell.border = BOX;
  });
  cs.views = [{ state: 'frozen', ySplit: 4 }];

  // ------------------------------------------------------------ Movements
  const ms = wb.addWorksheet('Stock Movements', { pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const movCols = [
    ['Date & Time', 19], ['SKU', 16], ['Item Name', 30], ['Action', 15], ['Quantity', 11], ['Balance After', 13], ['Note', 36], ['By', 18],
  ];
  movCols.forEach(([, w], i) => { ms.getColumn(i + 1).width = w; });
  sheetHeading(ms, report, 'Stock Movement Ledger', movCols.length);
  const mh = ms.getRow(4);
  movCols.forEach(([h], i) => { mh.getCell(i + 1).value = h; });
  styleHeaderRow(mh, report.brand);
  movements.forEach((m, i) => {
    const row = ms.getRow(5 + i);
    const signed = m.type === 'out' ? -m.quantity : m.quantity;
    [zonedDate(m.createdAt), m.sku, m.itemName, MOVEMENT_LABEL[m.type] || m.type, m.type === 'adjust' ? m.quantity : signed, m.balanceAfter, m.note || '', m.byName || '']
      .forEach((v, j) => {
        const cell = row.getCell(j + 1);
        cell.value = v;
        cell.border = BOX;
        if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      });
    row.getCell(1).numFmt = 'dd-mmm-yyyy hh:mm AM/PM';
    row.getCell(2).font = { bold: true, name: 'Consolas' };
    row.getCell(5).numFmt = '+#,##0.###;-#,##0.###;0';
    row.getCell(5).font = { bold: true, color: { argb: m.type === 'in' ? 'FF15803D' : m.type === 'out' ? 'FFB91C1C' : 'FF1D4ED8' } };
    row.getCell(6).numFmt = QTY_FMT;
  });
  if (!movements.length) ms.getCell(5, 1).value = 'No stock movements recorded yet.';
  ms.views = [{ state: 'frozen', ySplit: 4 }];
  if (movements.length) ms.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + movements.length, column: movCols.length } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ======================================================================== PDF

export function renderInventoryPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32, bufferPages: true });
    const out = new PassThrough();
    const chunks = [];
    out.on('data', (c) => chunks.push(c));
    out.on('end', () => resolve(Buffer.concat(chunks)));
    out.on('error', reject);
    doc.pipe(out);

    const INK = '#0f172a';
    const MUTED = '#64748b';
    const LINE = '#e2e8f0';
    const DANGER = '#b91c1c';
    const OK = '#15803d';
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;
    const bottomLimit = doc.page.height - doc.page.margins.bottom - 26;

    // ---------- Header
    doc.rect(0, 0, doc.page.width, 6).fill(report.brand);
    doc.font('Helvetica-Bold').fontSize(17).fillColor(INK).text(report.company, left, 24, { width: width * 0.6 });
    if (report.tagline) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(report.tagline, left, 45, { width: width * 0.6 });
    doc.font('Helvetica-Bold').fontSize(20).fillColor(report.brand).text('INVENTORY REPORT', left, 22, { width, align: 'right' });
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
      .text(`Generated ${stamp(report.generatedAt)}${report.generatedBy ? ` · by ${report.generatedBy}` : ''}`, left, 47, { width, align: 'right' });

    // ---------- Summary cards
    const t = report.totals;
    const cards = [
      ['TOTAL SKUs', qty(t.skus), INK],
      ['UNITS IN STOCK', qty(t.units), INK],
      ['LOW / OUT OF STOCK', `${t.lowStock} / ${t.outOfStock}`, t.lowStock ? DANGER : OK],
      [`VALUE AT COST (${report.currency})`, money(t.costValue), INK],
      [`VALUE AT SALE (${report.currency})`, money(t.saleValue), INK],
    ];
    let y = 70;
    const gap = 8;
    const cardW = (width - gap * (cards.length - 1)) / cards.length;
    cards.forEach(([label, value, color], i) => {
      const x = left + i * (cardW + gap);
      doc.roundedRect(x, y, cardW, 44, 4).fill('#f1f5f9');
      doc.rect(x, y, 3, 44).fill(i === 2 ? color : report.brand);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(MUTED).text(label, x + 10, y + 8, { width: cardW - 14 });
      doc.font('Helvetica-Bold').fontSize(13).fillColor(color).text(value, x + 10, y + 21, { width: cardW - 14 });
    });
    y += 58;

    // ---------- Items table
    const spec = [
      ['#', 0.035, 'center'],
      ['SKU', 0.1, 'left'],
      ['ITEM', 0.2, 'left'],
      ['CATEGORY', 0.09, 'left'],
      ['UNIT', 0.045, 'center'],
      ['IN STOCK', 0.065, 'right'],
      ['REORDER', 0.06, 'right'],
      ['COST', 0.08, 'right'],
      ['SALE', 0.08, 'right'],
      ['STOCK VALUE', 0.095, 'right'],
      ['LOCATION', 0.1, 'left'],
      ['STATUS', 0.05, 'center'],
    ];
    let cx = left;
    const cols = spec.map(([label, frac, align]) => {
      const c = { label, x: cx, w: width * frac, align };
      cx += c.w;
      return c;
    });
    const pad = 4;

    const drawHeader = () => {
      doc.rect(left, y, width, 20).fill(report.brand);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff');
      cols.forEach((c) => doc.text(c.label, c.x + pad, y + 7, { width: c.w - pad * 2, align: c.align, lineBreak: false }));
      y += 20;
    };
    drawHeader();

    doc.font('Helvetica').fontSize(8);
    report.rows.forEach((r, i) => {
      const values = [
        String(i + 1), r.sku, r.name, r.category || '—', r.unit, qty(r.quantity), qty(r.minStock),
        money(r.costPrice), money(r.salePrice), money(r.costValue), r.location || '—',
        r.quantity === 0 ? 'OUT' : r.low ? 'LOW' : 'OK',
      ];
      doc.font('Helvetica').fontSize(8);
      const h = Math.max(18, ...[1, 2, 3, 10].map((j) => doc.heightOfString(values[j], { width: cols[j].w - pad * 2 }) + 9));
      if (y + h > bottomLimit) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader();
      }
      if (i % 2 === 1) doc.rect(left, y, width, h).fill('#f8fafc');
      if (r.low) doc.rect(left, y, 2.5, h).fill(DANGER);
      values.forEach((v, j) => {
        const c = cols[j];
        let font = 'Helvetica';
        let color = INK;
        if (j === 1 || j === 9) font = 'Helvetica-Bold';
        if (j === 0 || j === 3 || j === 10) color = MUTED;
        if (j === 5 && r.low) { font = 'Helvetica-Bold'; color = DANGER; }
        if (j === 11) { font = 'Helvetica-Bold'; color = r.low ? DANGER : OK; }
        doc.font(font).fontSize(8).fillColor(color).text(v, c.x + pad, y + 5, { width: c.w - pad * 2, align: c.align });
      });
      y += h;
      doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).lineWidth(0.5).stroke();
    });

    if (!report.rows.length) {
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('No inventory items yet.', left, y + 10, { width, align: 'center' });
      y += 30;
    }

    // Totals bar
    if (y + 22 > bottomLimit) { doc.addPage(); y = doc.page.margins.top; }
    doc.rect(left, y + 4, width, 20).fill(INK);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
    doc.text('TOTAL', cols[0].x + pad, y + 10, { width: cols[4].x + cols[4].w - cols[0].x - pad * 2, align: 'right' });
    doc.text(qty(t.units), cols[5].x + pad, y + 10, { width: cols[5].w - pad * 2, align: 'right' });
    doc.text(money(t.costValue), cols[9].x + pad, y + 10, { width: cols[9].w - pad * 2, align: 'right' });
    y += 36;

    // ---------- Category summary
    if (report.categories.length) {
      const blockH = 34 + report.categories.length * 16;
      if (y + Math.min(blockH, 120) > bottomLimit) { doc.addPage(); y = doc.page.margins.top; }
      doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Stock by category', left, y);
      y += 18;
      const catCols = [
        ['CATEGORY', 0.3, 'left'], ['SKUs', 0.1, 'right'], ['UNITS', 0.14, 'right'],
        ['LOW', 0.12, 'right'], [`VALUE AT COST (${report.currency})`, 0.34, 'right'],
      ].map(([label, frac, align], i, all) => ({
        label, align, w: width * 0.55 * frac,
        x: left + width * 0.55 * all.slice(0, i).reduce((s, a) => s + a[1], 0),
      }));
      const catW = width * 0.55;
      doc.rect(left, y, catW, 18).fill('#f1f5f9');
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED);
      catCols.forEach((c) => doc.text(c.label, c.x + pad, y + 6, { width: c.w - pad * 2, align: c.align, lineBreak: false }));
      y += 18;
      for (const c of report.categories) {
        if (y + 16 > bottomLimit) { doc.addPage(); y = doc.page.margins.top; }
        const vals = [c.category, qty(c.skus), qty(c.units), qty(c.low), money(c.costValue)];
        vals.forEach((v, j) => {
          doc.font(j === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8)
            .fillColor(j === 3 && c.low ? DANGER : INK)
            .text(v, catCols[j].x + pad, y + 4, { width: catCols[j].w - pad * 2, align: catCols[j].align, lineBreak: false });
        });
        y += 16;
        doc.moveTo(left, y).lineTo(left + catW, y).strokeColor(LINE).lineWidth(0.5).stroke();
      }
    }

    // ---------- Footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      const fy = doc.page.height - doc.page.margins.bottom - 14;
      doc.moveTo(left, fy - 6).lineTo(right, fy - 6).strokeColor(LINE).lineWidth(0.5).stroke();
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
      doc.text(`${report.company} · Inventory report · ${stamp(report.generatedAt)}`, left, fy, { width: width / 2, lineBreak: false });
      doc.text(`Page ${i + 1} of ${range.count}`, left + width / 2, fy, { width: width / 2, align: 'right', lineBreak: false });
    }

    doc.end();
  });
}
