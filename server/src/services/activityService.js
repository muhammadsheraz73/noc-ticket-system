import AuditLog from '../models/AuditLog.js';
import Ticket from '../models/Ticket.js';
import { ROLES } from '../utils/constants.js';
import { fieldEngineerScope, assigneeFilter } from './searchService.js';

/**
 * Entity types each role may see in the dashboard activity feed.
 *
 * The lists mirror what the role can actually open in the app, so the feed can
 * never advertise a record the user would be forbidden from reading. New entity
 * types are hidden until they are added here on purpose (fail closed).
 * `admin` is intentionally absent: it sees the whole trail.
 */
const VISIBLE_ENTITY_TYPES = {
  [ROLES.NOC_OPERATOR]: [
    'Ticket',
    'Customer',
    'FieldTeam',
    'IssueType',
    'Invoice',
    'Pop',
    'NetworkDevice',
    'Connection',
    'Vlan',
  ],
  [ROLES.ACCOUNTS]: ['Invoice', 'Customer'],
  [ROLES.FIELD_ENGINEER]: ['Ticket'],
};

/** Short description of the slice a role is shown, rendered under the card title. */
export const ACTIVITY_SCOPE_LABELS = {
  [ROLES.ADMIN]: 'Everything across the system',
  [ROLES.NOC_OPERATOR]: 'Tickets, customers, field teams, network and billing',
  [ROLES.ACCOUNTS]: 'Invoices and customers',
  [ROLES.FIELD_ENGINEER]: 'Tickets assigned to you',
};

/** Caps the ticket `$in` list a field engineer's feed is matched against. */
const FIELD_ENGINEER_TICKET_LIMIT = 200;

/**
 * Mongo filter restricting the audit trail to what `user` is allowed to see.
 * Admin gets `{}`; every other role gets an explicit allow-list.
 */
export async function activityFilter(user) {
  if (user.role === ROLES.ADMIN) return {};

  // A field engineer only ever sees their own tickets, so entity type alone is
  // not enough — the entry has to point at a ticket inside their scope.
  if (user.role === ROLES.FIELD_ENGINEER) {
    const assigned = await Ticket.find({
      isDeleted: false,
      ...assigneeFilter(await fieldEngineerScope(user)),
    })
      .sort({ updatedAt: -1 })
      .limit(FIELD_ENGINEER_TICKET_LIMIT)
      .select('_id')
      .lean();

    return {
      entityType: 'Ticket',
      entityId: { $in: assigned.map((ticket) => String(ticket._id)) },
    };
  }

  return { entityType: { $in: VISIBLE_ENTITY_TYPES[user.role] || [] } };
}

/** Latest audit entries `user` is allowed to see, newest first. */
export async function recentActivityFor(user, limit = 12) {
  const filter = await activityFilter(user);
  return AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
}

export default recentActivityFor;
