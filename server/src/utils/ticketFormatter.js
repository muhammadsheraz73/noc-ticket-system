import {
  PRIORITY_LABELS,
  PRIORITY_MESSAGES,
  CLOSED_STATUSES,
  TICKET_FORBIDDEN_CUSTOMER_FIELDS,
} from './constants.js';
import { formatTicketDateTime, formatEttrDuration, computeTimeLeft } from './datetime.js';

/** The horizontal rule used by the standardized ticket layout. */
export const SEPARATOR = '-'.repeat(30);

/**
 * The ONLY customer fields the generated ticket is ever allowed to see.
 *
 * The formatter accepts this narrow projection instead of the full customer
 * document, so internal network data (address, PUM/PMB/COR type, source port,
 * destination port, VLAN) cannot leak into a ticket even by accident.
 */
export const TICKET_VISIBLE_CUSTOMER_FIELDS = [
  'customerReferenceNumber',
  'name',
  'location',
  'contactNumber',
  'connectedFrom',
];

/** Narrow a customer document down to the ticket-visible projection. */
export function toTicketCustomer(customer) {
  const source = typeof customer?.toObject === 'function' ? customer.toObject() : customer || {};
  const projection = {};
  for (const field of TICKET_VISIBLE_CUSTOMER_FIELDS) {
    projection[field] = source[field] ?? '';
  }
  return projection;
}

/**
 * Build the exact standardized NOC ticket text.
 *
 * ```
 * *TID: 4626* | 09-Sep 06:38 PM
 * ETTR: 09-Sep 07:38 PM {1H 0M}
 * Time Left: *{0:Days 0:Hours 57:Mins }*
 * ------------------------------
 * Site | Customer ID: 10255
 * Name: Abdul Rouf
 * Location: https://maps.app.goo.gl/EXwFUHbbik4spH5s8
 * Contact #: 0333-4458420
 * Connected From: Gajjumata Pop
 * ------------------------------
 * Type: *Fiber Cut*
 * Remarks: shahid town fiber down
 * ------------------------------
 * Assigned By: Mirza Arslan Shabbir
 * Required: Urgent (Do First)
 * Status: In Progress
 * *Sharafat Ali:* Resolve this ticket as soon as possible, it's Urgent
 * ```
 *
 * @param {object} ticket   ticket-shaped object (ticketNumber, createdAt, ettrAt, …)
 * @param {object} customer full customer document — narrowed internally
 * @param {{now?: Date}} [options]
 */
export function buildTicketText(ticket, customer, options = {}) {
  const now = options.now || new Date();
  const view = toTicketCustomer(customer);

  const createdAt = ticket.createdAt || now;
  const ettrAt = ticket.ettrAt;
  const stoppedAt = CLOSED_STATUSES.includes(ticket.status) ? ticket.resolvedAt || null : null;
  const timeLeft = computeTimeLeft(ettrAt, { now, stoppedAt });

  const lines = [];

  lines.push(`*TID: ${ticket.ticketNumber}* | ${formatTicketDateTime(createdAt)}`);
  lines.push(`ETTR: ${formatTicketDateTime(ettrAt)} ${formatEttrDuration(ticket.ettrMinutes)}`);
  lines.push(`Time Left: *${timeLeft.text}*`);
  lines.push(SEPARATOR);

  lines.push(`Site | Customer ID: ${view.customerReferenceNumber}`);
  lines.push(`Name: ${view.name}`);
  if (view.location) lines.push(`Location: ${view.location}`);
  lines.push(`Contact #: ${view.contactNumber}`);
  lines.push(`Connected From: ${view.connectedFrom}`);
  lines.push(SEPARATOR);

  lines.push(`Type: *${ticket.issueType}*`);
  lines.push(`Remarks: ${ticket.remarks || '-'}`);
  lines.push(SEPARATOR);

  lines.push(`Assigned By: ${ticket.assignedByName || '-'}`);
  lines.push(`Required: ${PRIORITY_LABELS[ticket.priority] || ticket.priority}`);
  lines.push(`Status: ${ticket.status}`);

  if (ticket.assignedToName) {
    const message = PRIORITY_MESSAGES[ticket.priority] || PRIORITY_MESSAGES.Medium;
    lines.push(`*${ticket.assignedToName}:* ${message}`);
  }

  return lines.join('\n');
}

/**
 * Verification helper used by the test-suite and by
 * `GET /api/tickets/:id/verify-visibility`.
 *
 * Returns the list of internal customer fields whose value shows up in the
 * generated ticket text. A compliant ticket always returns `[]`.
 */
export function findInternalLeaks(text, customer) {
  const source = typeof customer?.toObject === 'function' ? customer.toObject() : customer || {};
  const leaks = [];

  for (const field of TICKET_FORBIDDEN_CUSTOMER_FIELDS) {
    const value = source[field];
    if (value === undefined || value === null) continue;
    const needle = String(value).trim();
    if (needle.length < 2) continue;
    if (text.includes(needle)) leaks.push({ field, value: needle });
  }

  return leaks;
}

export default buildTicketText;
