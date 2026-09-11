import Customer from '../models/Customer.js';
import Ticket from '../models/Ticket.js';
import Invoice from '../models/Invoice.js';
import Connection from '../models/Connection.js';
import NetworkDevice from '../models/NetworkDevice.js';
import Pop from '../models/Pop.js';
import Vlan from '../models/Vlan.js';
import { containsRegex } from '../utils/search.js';
import { ROLES } from '../utils/constants.js';

/**
 * One fast global search across every indexed business identifier.
 *
 * Handles the specification's example queries:
 *   10255 (customer ref) · Abdul Rouf (name) · 613 (VLAN)
 *   4626 (TID) · Gajjumata (POP) · GE0/0/1 (port)
 *
 * Results stay grouped by entity so the UI can separate Customers, Tickets,
 * Invoices and Network records.
 */
export async function globalSearch(rawQuery, { user, limit = 10 } = {}) {
  const q = String(rawQuery || '').trim();
  if (q.length < 1) {
    return emptyResult(q);
  }

  const rx = containsRegex(q);
  const asNumber = Number.parseInt(q, 10);
  const isNumeric = Number.isFinite(asNumber) && /^\d+$/.test(q);

  const canSeeInvoices = [ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NOC_OPERATOR].includes(user.role);
  const isFieldEngineer = user.role === ROLES.FIELD_ENGINEER;

  const ticketFilter = {
    isDeleted: false,
    $or: [
      ...(isNumeric ? [{ ticketNumber: asNumber }] : []),
      { customerReferenceNumber: rx },
      { customerName: rx },
      { issueType: rx },
      { remarks: rx },
      { assignedToName: rx },
      { assignedByName: rx },
      { status: rx },
      { priority: rx },
    ],
  };

  // Field engineers only ever see tickets they're assigned to (as the
  // primary handler or as the helper) — combined with the search text via
  // $and, since a Mongo filter object can only hold one top-level $or.
  if (isFieldEngineer) {
    const ids = await fieldEngineerScope(user);
    ticketFilter.$and = [{ $or: ticketFilter.$or }, assigneeFilter(ids)];
    delete ticketFilter.$or;
  }

  const [customers, tickets, invoices, connections, devices, pops, vlans] = await Promise.all([
    Customer.find({
      isDeleted: false,
      $or: [
        { customerReferenceNumber: rx },
        { name: rx },
        { address: rx },
        { contactNumber: rx },
        { connectedFrom: rx },
        { type: rx },
        { vlan: rx },
        { sourcePort: rx },
        { destinationPort: rx },
        { notes: rx },
      ],
    })
      .limit(limit)
      .lean(),

    Ticket.find(ticketFilter).sort({ createdAt: -1 }).limit(limit).lean(),

    canSeeInvoices
      ? Invoice.find({
          isDeleted: false,
          $or: [
            { invoiceNumber: rx },
            { customerReferenceNumber: rx },
            { customerName: rx },
            { notes: rx },
            ...(isNumeric ? [{ ticketNumber: asNumber }] : []),
          ],
        })
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean()
      : Promise.resolve([]),

    Connection.find({
      $or: [
        { label: rx },
        { sourceDeviceName: rx },
        { sourcePort: rx },
        { destinationDeviceName: rx },
        { destinationPort: rx },
        { vlan: rx },
        { customerReferenceNumber: rx },
        { ponPort: rx },
      ],
    })
      .limit(limit)
      .lean(),

    NetworkDevice.find({
      $or: [{ name: rx }, { model: rx }, { managementIp: rx }, { popName: rx }, { serialNumber: rx }],
    })
      .limit(limit)
      .lean(),

    Pop.find({ $or: [{ code: rx }, { name: rx }, { address: rx }] }).limit(limit).lean(),

    Vlan.find({
      $or: [{ name: rx }, { description: rx }, { subnet: rx }, ...(isNumeric ? [{ vlanId: asNumber }] : [])],
    })
      .limit(limit)
      .lean(),
  ]);

  const groups = {
    customers,
    tickets,
    invoices,
    network: {
      connections,
      devices,
      pops,
      vlans,
    },
  };

  const total =
    customers.length +
    tickets.length +
    invoices.length +
    connections.length +
    devices.length +
    pops.length +
    vlans.length;

  return { query: q, total, ...groups };
}

/**
 * Which FieldTeam record ids a field engineer is allowed to see tickets for.
 * Only their own linked record — not their whole team's tickets — so
 * "assigned to me" means tickets dispatched to them personally.
 */
export async function fieldEngineerScope(user) {
  const { default: FieldTeam } = await import('../models/FieldTeam.js');
  const records = await FieldTeam.find({ user: user._id }).select('_id').lean();
  return records.map((r) => r._id);
}

/**
 * A ticket is in scope if any of `ids` is either the primary handler or the
 * helper — a plain Mongo filter object can only carry one `$or`, so callers
 * that already build their own must merge this in via `$and` instead of
 * assigning it directly.
 */
export function assigneeFilter(ids) {
  return { $or: [{ assignedTo: { $in: ids } }, { assignedHelper: { $in: ids } }] };
}

function emptyResult(query) {
  return {
    query,
    total: 0,
    customers: [],
    tickets: [],
    invoices: [],
    network: { connections: [], devices: [], pops: [], vlans: [] },
  };
}
