import { once } from 'node:events';
import mongoose from 'mongoose';
import xlsx from 'xlsx';
import env from '../config/env.js';
import Customer from '../models/Customer.js';
import Ticket from '../models/Ticket.js';
import Invoice from '../models/Invoice.js';
import Quotation from '../models/Quotation.js';
import BillingRecord from '../models/BillingRecord.js';
import Subscriber from '../models/Subscriber.js';
import FieldTeam from '../models/FieldTeam.js';
import InventoryItem from '../models/InventoryItem.js';
import InventoryMovement from '../models/InventoryMovement.js';
import NetworkDevice from '../models/NetworkDevice.js';
import Pop from '../models/Pop.js';
import Vlan from '../models/Vlan.js';
import Connection from '../models/Connection.js';

/* ============================================================ Excel export */

/** Internal fields that mean nothing to a client reading their own data. */
const SKIP = new Set(['_id', '__v', 'tenant', 'passwordHash', 'history', 'ai', 'generatedText', 'logo', 'usernameKey']);
const MAX_CELL = 32000; // Excel's limit is 32,767 characters per cell

const stamp = (value) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: env.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(value).replace(',', '');

/** "customerReferenceNumber" → "Customer Reference Number". */
const heading = (key) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

/** One value as something readable in a spreadsheet cell. */
function cell(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return stamp(value);
  if (value?._bsontype === 'ObjectId' || value instanceof mongoose.Types.ObjectId) return String(value);
  if (Array.isArray(value)) {
    const text = value.map((v) => {
      if (v && typeof v === 'object' && 'description' in v) return `${v.description} × ${v.quantity ?? 1} @ ${v.rate ?? v.amount ?? ''}`;
      if (v && typeof v === 'object' && 'name' in v) return v.name;
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    }).join('; ');
    return text.slice(0, MAX_CELL);
  }
  if (typeof value === 'object') return JSON.stringify(value).slice(0, MAX_CELL);
  if (typeof value === 'string') return value.slice(0, MAX_CELL);
  return value;
}

/** Documents → sheet rows with readable column names (every field that appears in any row). */
function toSheet(docs) {
  const keys = [];
  for (const doc of docs) for (const key of Object.keys(doc)) if (!SKIP.has(key) && !keys.includes(key)) keys.push(key);
  const rows = docs.map((doc) => Object.fromEntries(keys.map((k) => [heading(k), cell(doc[k])])));
  return rows.length ? xlsx.utils.json_to_sheet(rows) : xlsx.utils.aoa_to_sheet([['No records']]);
}

/**
 * Everything one client has, as an Excel workbook — one sheet per area.
 * Must run inside the client's tenant scope (every request does), so the
 * tenant plugin confines each query to that client's own records.
 */
export async function buildClientWorkbook() {
  const sheets = [
    ['Customers', Customer], ['Tickets', Ticket], ['Invoices', Invoice], ['Quotations', Quotation],
    ['Monthly bills', BillingRecord], ['Billing users', Subscriber], ['Employees', FieldTeam],
    ['Inventory', InventoryItem], ['Stock movements', InventoryMovement], ['Network devices', NetworkDevice],
    ['POPs', Pop], ['VLANs', Vlan], ['Connections', Connection],
  ];
  const book = xlsx.utils.book_new();
  const counts = {};
  for (const [name, Model] of sheets) {
    const docs = await Model.find().sort({ createdAt: 1 }).lean();
    counts[name] = docs.length;
    xlsx.utils.book_append_sheet(book, toSheet(docs), name);
    // Payments live inside each bill; give them their own sheet so they can be totalled.
    if (Model === BillingRecord) {
      const payments = docs.flatMap((bill) => (bill.payments || []).map((p) => ({
        user: bill.username, billMonth: bill.period, amount: p.amount, receivedBy: p.receivedBy, receivedAt: p.receivedAt, note: p.note,
      })));
      counts.Payments = payments.length;
      xlsx.utils.book_append_sheet(book, toSheet(payments), 'Payments');
    }
  }
  return { buffer: xlsx.write(book, { type: 'buffer', bookType: 'xlsx' }), counts };
}

/* ================================================================= backup */

const { EJSON } = mongoose.mongo.BSON;

/** Which documents of a collection belong to one client (null = none of them). */
function clientFilter(collection, tenantId) {
  const id = new mongoose.Types.ObjectId(tenantId);
  if (collection === 'tenants') return { _id: id };
  if (collection === 'counters') return { _id: { $regex: `^${tenantId}:` } };
  return { tenant: id };
}

/**
 * Stream a complete, restorable copy of the database (or one client's part of
 * it) as JSON. Extended JSON keeps ids, dates and numbers exactly as stored.
 * Read-only: it never changes anything.
 *
 * Format: { format, version, createdAt, scope, collections: { name: [docs…] } }
 */
export async function streamBackup(res, { tenantId = null, filename }) {
  const db = mongoose.connection.db;
  const names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.'))
    .sort();

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');

  const write = async (chunk) => {
    if (!res.write(chunk)) await once(res, 'drain');
  };

  await write(`{"format":"noc-panel-backup","version":1,"createdAt":${JSON.stringify(new Date().toISOString())},`
    + `"scope":${JSON.stringify(tenantId ? { client: String(tenantId) } : 'all')},"collections":{`);
  for (const [i, name] of names.entries()) {
    await write(`${i ? ',' : ''}${JSON.stringify(name)}:[`);
    let first = true;
    for await (const doc of db.collection(name).find(tenantId ? clientFilter(name, tenantId) : {})) {
      await write((first ? '' : ',') + EJSON.stringify(doc, { relaxed: false }));
      first = false;
    }
    await write(']');
  }
  res.end('}}');
}
