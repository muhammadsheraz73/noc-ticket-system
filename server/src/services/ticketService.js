import Customer from '../models/Customer.js';
import Ticket from '../models/Ticket.js';
import FieldTeam from '../models/FieldTeam.js';
import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import { nextSequence } from '../utils/sequence.js';
import { addMinutes, computeTimeLeft, formatTicketDateTime } from '../utils/datetime.js';
import { buildTicketText } from '../utils/ticketFormatter.js';
import { CLOSED_STATUSES } from '../utils/constants.js';

export const TICKET_SEQUENCE_KEY = 'ticketNumber';

/** Reserve the next unique, server-side TID. */
export function reserveTicketNumber() {
  return nextSequence(TICKET_SEQUENCE_KEY, env.ticketNumberStart);
}

/** Load a customer that is valid to raise a ticket against. */
export async function requireActiveCustomer(customerIdOrRef) {
  const query = { isDeleted: false };
  const asString = String(customerIdOrRef || '').trim();
  if (!asString) throw ApiError.badRequest('A customer must be selected');

  const customer = /^[0-9a-fA-F]{24}$/.test(asString)
    ? await Customer.findOne({ _id: asString, ...query })
    : await Customer.findOne({ customerReferenceNumber: asString, ...query });

  if (!customer) throw ApiError.badRequest(`No active customer found for "${asString}"`);
  return customer;
}

/** Resolve an assignee (primary or helper), requiring an active linked login. */
async function resolveAssignee(id) {
  const assignee = await FieldTeam.findOne({ _id: id, isActive: true }).populate('user', 'isActive');
  if (!assignee) throw ApiError.badRequest('The selected field team/member is not available');
  // A stale `user` reference (account since deleted) must not count as a login.
  if (!assignee.user || assignee.user.isActive === false) {
    throw ApiError.badRequest(
      `${assignee.name} has no active login account linked — link one from Field Teams before assigning tickets to them`,
    );
  }
  return assignee;
}

/**
 * Create a ticket.
 *
 * TID, created time and ETTR are all produced from server state — nothing
 * about the schedule is taken from the browser.
 */
export async function createTicket({ payload, user }) {
  const customer = await requireActiveCustomer(payload.customerId);

  if (payload.assignedHelper && payload.assignedHelper === payload.assignedTo) {
    throw ApiError.badRequest('The helper must be a different person from the primary assignee');
  }

  const assignee = payload.assignedTo ? await resolveAssignee(payload.assignedTo) : null;
  const helper = payload.assignedHelper ? await resolveAssignee(payload.assignedHelper) : null;

  const now = new Date();
  const ettrMinutes = Number(payload.ettrMinutes) || 60;
  const ticketNumber = await reserveTicketNumber();

  const ticket = new Ticket({
    ticketNumber,
    customer: customer._id,
    customerReferenceNumber: customer.customerReferenceNumber,
    customerName: customer.name,
    issueType: payload.issueType,
    remarks: payload.remarks || '',
    priority: payload.priority || 'Medium',
    status: payload.status || 'New',
    ettrMinutes,
    ettrAt: addMinutes(now, ettrMinutes),
    assignedBy: user._id,
    assignedByName: user.name,
    assignedTo: assignee?._id,
    assignedToName: assignee?.name || '',
    assignedAt: assignee ? now : undefined,
    assignedHelper: helper?._id,
    assignedHelperName: helper?.name || '',
    createdAt: now,
    history: [
      {
        at: now,
        by: user._id,
        byName: user.name,
        action: 'created',
        to: payload.status || 'New',
        note: `Ticket raised for customer ${customer.customerReferenceNumber}`,
      },
      ...(assignee
        ? [
            {
              at: now,
              by: user._id,
              byName: user.name,
              action: 'assigned',
              to: assignee.name,
              note: helper ? `Helper: ${helper.name}` : undefined,
            },
          ]
        : []),
    ],
  });

  ticket.generatedText = buildTicketText(ticket, customer, { now });
  await ticket.save();

  return { ticket, customer };
}

/**
 * Re-render the stored ticket snapshot after any change.
 * Call this whenever a field that appears in the ticket text is modified.
 */
export async function refreshGeneratedText(ticket, customer) {
  const linked = customer || (await Customer.findById(ticket.customer));
  ticket.generatedText = buildTicketText(ticket, linked, { now: new Date() });
  return ticket;
}

/**
 * Attach the authoritative, live view of a ticket for API responses:
 * a freshly-rendered ticket text and a server-computed countdown.
 *
 * `Time Left` is always derived here from stored timestamps, so a browser with
 * a wrong clock can never change what the system considers overdue.
 */
export function decorateTicket(ticket, customer, now = new Date()) {
  const plain = typeof ticket.toJSON === 'function' ? ticket.toJSON() : { ...ticket };
  const stoppedAt = CLOSED_STATUSES.includes(plain.status) ? plain.resolvedAt || null : null;
  const timeLeft = computeTimeLeft(plain.ettrAt, { now, stoppedAt });

  const linkedCustomer = customer || (plain.customer && plain.customer.name ? plain.customer : null);

  return {
    ...plain,
    serverTime: now,
    timeLeft: {
      overdue: timeLeft.overdue,
      frozen: timeLeft.frozen,
      milliseconds: timeLeft.ms,
      days: timeLeft.days,
      hours: timeLeft.hours,
      minutes: timeLeft.minutes,
      totalMinutes: timeLeft.totalMinutes,
      text: timeLeft.text,
    },
    createdAtText: formatTicketDateTime(plain.createdAt),
    ettrAtText: formatTicketDateTime(plain.ettrAt),
    isOverdue: timeLeft.overdue && !timeLeft.frozen,
    generatedText: linkedCustomer
      ? buildTicketText(plain, linkedCustomer, { now })
      : plain.generatedText,
  };
}

/** Append an entry to a ticket's audit trail. */
export function pushHistory(ticket, { user, action, from = '', to = '', note = '' }) {
  ticket.history.push({
    at: new Date(),
    by: user?._id,
    byName: user?.name || 'system',
    action,
    from: String(from ?? ''),
    to: String(to ?? ''),
    note,
  });
}
