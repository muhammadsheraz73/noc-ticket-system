import Customer from '../models/Customer.js';
import Ticket from '../models/Ticket.js';
import Invoice from '../models/Invoice.js';
import { startOfLocalDay } from '../utils/datetime.js';
import { CLOSED_STATUSES } from '../utils/constants.js';

/**
 * The numbers on the client dashboard's eight cards. One place for the maths,
 * so the dashboard (routes/dashboard.routes.js) and the "Your data" PDF
 * summary can never disagree. Runs inside the client's tenant scope.
 *
 * @param ticketScope   which tickets count (a field engineer sees only theirs)
 * @param canSeeInvoices whether the Pending Invoices card has a value
 */
export async function dashboardCardCounts({ ticketScope = { isDeleted: false }, canSeeInvoices = true, now = new Date() } = {}) {
  const todayStart = startOfLocalDay(now);
  const openFilter = { ...ticketScope, status: { $nin: CLOSED_STATUSES } };

  const [
    totalCustomers, totalTickets, resolvedTickets, urgentTickets, overdueTickets,
    inProgressTickets, resolvedToday, createdToday, pendingInvoices,
  ] = await Promise.all([
    Customer.countDocuments({ isDeleted: false }),
    Ticket.countDocuments(ticketScope),
    Ticket.countDocuments({ ...ticketScope, status: { $in: CLOSED_STATUSES } }),
    Ticket.countDocuments({ ...openFilter, priority: 'Urgent' }),
    Ticket.countDocuments({ ...openFilter, ettrAt: { $lt: now } }),
    Ticket.countDocuments({ ...ticketScope, status: 'In Progress' }),
    Ticket.countDocuments({ ...ticketScope, resolvedAt: { $gte: todayStart } }),
    Ticket.countDocuments({ ...ticketScope, createdAt: { $gte: todayStart } }),
    canSeeInvoices
      ? Invoice.countDocuments({ isDeleted: false, status: { $in: ['Draft', 'Unpaid'] } })
      : Promise.resolve(0),
  ]);

  return {
    totalCustomers, totalTickets, resolvedTickets, urgentTickets, overdueTickets,
    inProgressTickets, resolvedToday, createdToday, pendingInvoices,
  };
}

/**
 * The cards as the dashboard shows them, in the same order with the same
 * labels, hints and tones (see StatTile in client/src/pages/DashboardPage.jsx).
 */
export function dashboardCards(s) {
  return [
    { label: 'Total Customers', value: s.totalCustomers, hint: 'Active master records', tone: 'brand' },
    { label: 'Total Tickets', value: s.totalTickets, hint: 'All tickets, every status', tone: 'brand' },
    { label: 'Resolved Tickets', value: s.resolvedTickets, hint: 'Resolved · Closed, all time', tone: 'ok' },
    { label: 'Urgent Tickets', value: s.urgentTickets, hint: 'Priority: Urgent', tone: 'danger' },
    { label: 'Overdue (past ETTR)', value: s.overdueTickets, hint: 'Breached the committed ETTR', tone: 'danger' },
    { label: 'In Progress', value: s.inProgressTickets, hint: 'Field work underway', tone: 'warn' },
    { label: 'Resolved Today', value: s.resolvedToday, hint: `${s.createdToday} created today`, tone: 'ok' },
    { label: 'Pending Invoices', value: s.pendingInvoices, hint: 'Draft or Unpaid', tone: 'purple' },
  ];
}
