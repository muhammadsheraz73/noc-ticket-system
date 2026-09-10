/** Presentation helpers shared across pages. */

export const STATUS_TONE = {
  New: 'info',
  'In Progress': 'warn',
  'On Hold': 'purple',
  Resolved: 'ok',
  Closed: 'neutral',
};

export const PRIORITY_TONE = {
  Urgent: 'danger',
  High: 'warn',
  Medium: 'info',
  Low: 'neutral',
};

export const INVOICE_TONE = {
  Draft: 'neutral',
  Unpaid: 'warn',
  Paid: 'ok',
  Cancelled: 'danger',
};

export const ROLE_LABELS = {
  admin: 'Admin',
  noc_operator: 'NOC Operator',
  field_engineer: 'Field Engineer',
  accounts: 'Accounts',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `09-Sep 06:38 PM` — mirrors the server-side ticket format. */
export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const hours24 = d.getHours();
  const hour12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return (
    `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]} ` +
    `${String(hour12).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ` +
    `${hours24 < 12 ? 'AM' : 'PM'}`
  );
}

/** `09-Sep-2025` */
export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

/** `3 mins ago`, `in 2 hours` */
export function relativeTime(value, now = new Date()) {
  if (!value) return '';
  const diff = new Date(value).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const minute = 60000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < minute) return 'just now';

  let text;
  if (abs < hour) text = plural(Math.floor(abs / minute), 'min');
  else if (abs < day) text = plural(Math.floor(abs / hour), 'hour');
  else text = plural(Math.floor(abs / day), 'day');

  return diff < 0 ? `${text} ago` : `in ${text}`;
}

function plural(count, unit) {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

export function formatMoney(value, currency = 'PKR') {
  const n = Number(value || 0);
  return `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

/** `{0:Days 0:Hours 57:Mins }` from a millisecond span. */
export function countdownText(ms) {
  const overdue = ms < 0;
  const totalMinutes = Math.floor(Math.abs(ms) / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const body = `{${days}:Days ${hours}:Hours ${minutes}:Mins }`;
  return overdue ? `OVERDUE ${body}` : body;
}

/** Compact `2d 4h 15m` form for tables. */
export function countdownShort(ms) {
  const overdue = ms < 0;
  const totalMinutes = Math.floor(Math.abs(ms) / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (days || hours) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return `${overdue ? '-' : ''}${parts.join(' ')}`;
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function ettrLabel(minutes) {
  const m = Number(minutes) || 0;
  if (m < 60) return `${m} min`;
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${hours}h ${rest}m` : `${hours} hour${hours === 1 ? '' : 's'}`;
}
