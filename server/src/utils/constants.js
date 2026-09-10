export const ROLES = {
  ADMIN: 'admin',
  NOC_OPERATOR: 'noc_operator',
  FIELD_ENGINEER: 'field_engineer',
  ACCOUNTS: 'accounts',
};

export const ROLE_VALUES = Object.values(ROLES);

export const ROLE_LABELS = {
  [ROLES.ADMIN]: 'Admin',
  [ROLES.NOC_OPERATOR]: 'NOC Operator',
  [ROLES.FIELD_ENGINEER]: 'Field Engineer',
  [ROLES.ACCOUNTS]: 'Accounts',
};

/** PUM / PMB / COR — extendable by an Admin through the customer-types endpoint. */
export const CUSTOMER_TYPES = ['PUM', 'PMB', 'COR'];

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
  'Fiber Cut',
  'LOS',
  'Internet Connectivity',
  'Power',
  'Configuration',
  'Other',
];

export const INVOICE_STATUSES = ['Draft', 'Unpaid', 'Paid', 'Cancelled'];

export const FIELD_TEAM_KINDS = ['team', 'member'];

export const DEVICE_TYPES = ['OLT', 'Switch', 'Router', 'ONU', 'Splitter', 'Media Converter', 'Other'];

export const CONNECTION_TYPES = ['Fiber', 'Copper', 'PON', 'Wireless', 'Uplink', 'Other'];

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
