import xlsx from 'xlsx';
import ApiError from '../utils/ApiError.js';

const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function parseMoney(value) {
  const n = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Accepts Excel dates, `24-12-22`, `15-8-2026`, `1/10/2026` (day first) and ISO dates. */
export function parseDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  const m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1]), 7));
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Read the first sheet and map the columns of the old Excel billing sheet. */
export function parseBillingWorkbook(buffer) {
  let wb;
  try {
    wb = xlsx.read(buffer, { type: 'buffer', cellDates: true });
  } catch {
    throw ApiError.badRequest('The uploaded file could not be read as a spreadsheet');
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw ApiError.badRequest('The workbook has no sheets');
  const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '', raw: true });
  const headerIndex = matrix.findIndex((row) => row.some((c) => norm(c) === 'user'));
  if (headerIndex < 0) throw ApiError.badRequest('Could not find a "USER" column in the first sheet');

  const headers = matrix[headerIndex].map(norm);
  const first = (...names) => headers.findIndex((h) => names.includes(h));
  const last = (...names) => headers.map((h, i) => (names.includes(h) ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
  const col = {
    user: first('user', 'username'),
    activation: first('dated', 'date', 'activation date'),
    payDate: last('dated', 'date'),
    pkg: first('unit', 'package', 'bandwidth'),
    status: first('status'),
    address: first('adress', 'address'),
    fee: first('fee', 'amount', 'monthly fee'),
    received: first('received', 'recived'),
    receivedBy: first('rec by', 'received by', 'recived by'),
  };

  const rows = [];
  for (const row of matrix.slice(headerIndex + 1)) {
    const username = String(row[col.user] ?? '').trim();
    if (!username) continue;
    const get = (i) => (i >= 0 ? row[i] : '');
    rows.push({
      username,
      activationDate: parseDate(get(col.activation)),
      paymentDate: col.payDate !== col.activation ? parseDate(get(col.payDate)) : undefined,
      package: String(get(col.pkg) ?? '').trim(),
      status: /inactive|disable|left/i.test(String(get(col.status))) ? 'Inactive' : 'Active',
      address: String(get(col.address) ?? '').replace(/\s+/g, ' ').trim(),
      fee: parseMoney(get(col.fee)),
      received: parseMoney(get(col.received)),
      receivedBy: String(get(col.receivedBy) ?? '').trim(),
    });
  }
  return rows;
}
