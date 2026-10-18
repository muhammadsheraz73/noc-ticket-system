export const ROLES = {
  /** The panel owner: manages clients and their logins, never sees client data. */
  SUPERADMIN: 'superadmin',
  /** What every client login is: full access to that client's own data. */
  ADMIN: 'admin',
  NOC_OPERATOR: 'noc_operator',
  FIELD_ENGINEER: 'field_engineer',
  ACCOUNTS: 'accounts',
};

export const ROLE_VALUES = Object.values(ROLES);

/**
 * Login usernames: lowercase letters, digits, dot, underscore and hyphen, and
 * they must start and end with a letter or a digit. Deliberately narrow so a
 * username can never be confused with an email address at the login prompt.
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

export const ROLE_LABELS = {
  [ROLES.SUPERADMIN]: 'Owner',
  [ROLES.ADMIN]: 'Admin',
  [ROLES.NOC_OPERATOR]: 'NOC Operator',
  [ROLES.FIELD_ENGINEER]: 'Field Engineer',
  [ROLES.ACCOUNTS]: 'Accounts',
};

/** The customer types a new or edited customer can have. */
export const CUSTOMER_TYPES = ['COR', 'Area Corporate', 'Home User'];

/** Service status of a customer; records saved before this field existed count as Active. */
export const CUSTOMER_STATUSES = ['Active', 'Non Active', 'Free'];

/** Match a typed/imported value to its canonical spelling ("home user" / "HOME-USER" → "Home User"). */
function matchOption(options, value) {
  const text = String(value ?? '').trim();
  const key = (v) => v.toLowerCase().replace(/[\s_-]+/g, '');
  return options.find((o) => key(o) === key(text)) || text;
}

export function normalizeCustomerType(value) {
  return matchOption(CUSTOMER_TYPES, value);
}

export function normalizeCustomerStatus(value) {
  const text = String(value ?? '').trim();
  return /^in-?active$/i.test(text) ? 'Non Active' : matchOption(CUSTOMER_STATUSES, text);
}

export const TICKET_STATUSES = ['New', 'In Progress', 'On Hold', 'Resolved', 'Closed'];

/** Statuses that stop the ETTR countdown. */
export const CLOSED_STATUSES = ['Resolved', 'Closed'];

export const OPEN_STATUSES = ['New', 'In Progress', 'On Hold'];

export const TICKET_PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'];

/** The `Required:` line of the generated ticket. */
export const PRIORITY_LABELS = {
  Urgent: 'Urgent (Do First)',
  High: 'High (Do Next)',
  Medium: 'Medium (Normal)',
  Low: 'Low (When Free)',
};

/** Closing instruction addressed to the assigned field member. */
export const PRIORITY_MESSAGES = {
  Urgent: "Resolve this ticket as soon as possible, it's Urgent",
  High: 'Please prioritize this ticket and share an update shortly',
  Medium: 'Please resolve this ticket within the given ETTR',
  Low: 'Please handle this ticket as per your availability',
};

export const DEFAULT_ISSUE_TYPES = [
  'Configurations',
  'Electrical Failures & Planning',
  'Equipment Collection',
  'Equipment Replacement',
  'Fiber Cut',
  'Internal Area Issues (ISP)',
  'New Deployments & Planning',
  'Optical Power Value (+/-)',
  'P-Services (Fiber Routing)',
  'P-Services (General Support)',
  'P-Services (Technical)',
  'P-Services (Wireless)',
  'Slow Browsing & Ping Timeout',
  'Static IP’s Issue',
  'Wireless Connectivity Issue',
  'Maintenance',
  'Internet service Down',
  'Cat 6 Wire',
  'Administrative Task',
  'Re-activation',
];

export const INVOICE_STATUSES = ['Draft', 'Unpaid', 'Paid', 'Cancelled'];

/** Expired is not stored — a Draft/Sent quotation past its valid-until date reads as expired. */
export const QUOTATION_STATUSES = ['Draft', 'Sent', 'Accepted', 'Rejected'];

export const FIELD_TEAM_KINDS = ['team', 'member'];

export const DEVICE_TYPES = ['OLT', 'Switch', 'Router', 'ONU', 'Splitter', 'Media Converter', 'Other'];

export const CONNECTION_TYPES = ['Fiber', 'Copper', 'PON', 'Wireless', 'Uplink', 'Other'];

/** Units a stock item (SKU) can be counted in. */
export const INVENTORY_UNITS = ['pcs', 'meter', 'roll', 'box', 'set', 'kg'];

/** in = received, out = issued/used, adjust = physical count sets the balance. */
export const STOCK_MOVEMENT_TYPES = ['in', 'out', 'adjust'];

export const AI_STATUSES = ['pending', 'completed', 'failed', 'unavailable', 'disabled'];

/**
 * Customer fields that must NEVER appear in the generated ticket text.
 * Enforced by `assertNoInternalLeak()` and covered by the test-suite.
 */
export const TICKET_FORBIDDEN_CUSTOMER_FIELDS = [
  'address',
  'type',
  'sourcePort',
  'destinationPort',
  'vlan',
];

export const ETTR_PRESETS = [
  { label: '30 Minutes', minutes: 30 },
  { label: '1 Hour', minutes: 60 },
  { label: '2 Hours', minutes: 120 },
  { label: '4 Hours', minutes: 240 },
  { label: '8 Hours', minutes: 480 },
  { label: '12 Hours', minutes: 720 },
  { label: '24 Hours', minutes: 1440 },
  { label: '48 Hours', minutes: 2880 },
];
