import { useState } from 'react';
import { Badge } from './ui.jsx';
import { ettrLabel, formatDateTime, formatNumber, initials, relativeTime } from '../utils/format.js';
import '../styles/owner.css';

/** Shared pieces for the owner's monitoring pages. */

export const RANGE_OPTIONS = [7, 30, 90];

const HEALTH_TONE = { healthy: 'ok', attention: 'warn', critical: 'danger', suspended: 'neutral' };
const HEALTH_ICON = { healthy: '✓', attention: '!', critical: '✕', suspended: '⏸' };

/** Health verdict — always icon + words, never colour alone. */
export function HealthBadge({ health }) {
  if (!health) return null;
  return (
    <span title={health.reasons?.join('\n') || 'All good'}>
      <Badge tone={HEALTH_TONE[health.level]}>
        <span aria-hidden="true">{HEALTH_ICON[health.level]}</span> {health.label}
      </Badge>
    </span>
  );
}

/** 7 / 30 / 90 day switch. */
export function RangeSwitch({ value, onChange }) {
  return (
    <div className="seg" role="group" aria-label="Time range">
      {RANGE_OPTIONS.map((days) => (
        <button
          key={days}
          type="button"
          className={`seg__btn${value === days ? ' is-active' : ''}`}
          aria-pressed={value === days}
          onClick={() => onChange(days)}
        >
          {days}d
        </button>
      ))}
    </div>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-10-13` → `13 Oct` (the key is already in the operational timezone). */
export function dayLabel(key) {
  const [, month, day] = String(key).split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1] || ''}`;
}

/**
 * Tickets per day as thin, baseline-anchored bars with a hover tooltip.
 * One series, so the title names it and no legend is needed.
 */
export function TrendBars({ series, unit = 'tickets', height = 170 }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...series.map((d) => d.count));
  const total = series.reduce((acc, d) => acc + d.count, 0);
  const ticks = [0, Math.floor((series.length - 1) / 2), series.length - 1];

  return (
    <div className="trend">
      <div className="trend__plot" style={{ height }} onMouseLeave={() => setHover(null)}>
        <div className="trend__grid" style={{ bottom: '100%' }}>
          <span>{formatNumber(max)}</span>
        </div>
        <div className="trend__grid" style={{ bottom: '50%' }}>
          <span>{max >= 2 ? formatNumber(Math.round(max / 2)) : ''}</span>
        </div>
        <div className="trend__bars">
          {series.map((d, i) => (
            <div
              key={d.day}
              className={`trend__slot${hover === i ? ' is-hover' : ''}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              tabIndex={0}
              aria-label={`${dayLabel(d.day)}: ${d.count} ${unit}`}
            >
              {d.count ? <div className="trend__bar" style={{ height: `${(d.count / max) * 100}%` }} /> : null}
            </div>
          ))}
        </div>
        {hover !== null ? (
          <div
            className="trend__tip"
            style={{ left: `${((hover + 0.5) / series.length) * 100}%` }}
          >
            <div className="trend__tip-label">{dayLabel(series[hover].day)}</div>
            <div className="trend__tip-value">{formatNumber(series[hover].count)} {unit}</div>
          </div>
        ) : null}
      </div>
      <div className="trend__axis">
        {ticks.map((i, n) => (
          <span key={n} style={{ left: `${((i + 0.5) / series.length) * 100}%` }}>{dayLabel(series[i].day)}</span>
        ))}
      </div>
      {total === 0 ? <div className="trend__empty">No tickets in this period</div> : null}
    </div>
  );
}

/** A row-sized trend for tables. */
export function Sparkline({ series }) {
  const max = Math.max(1, ...series.map((d) => d.count));
  const total = series.reduce((acc, d) => acc + d.count, 0);
  return (
    <div className="spark" title={`${total} tickets in ${series.length} days`} aria-label={`${total} tickets in ${series.length} days`}>
      {series.map((d) => (
        <span
          key={d.day}
          className="spark__bar"
          style={{ height: d.count ? `${Math.max(12, (d.count / max) * 100)}%` : 0 }}
          title={`${dayLabel(d.day)}: ${d.count}`}
        />
      ))}
    </div>
  );
}

/** Ranked horizontal bars with the label and value as text. */
export function RankBars({ rows, empty = 'Nothing yet.', valueSuffix = '' }) {
  if (!rows.length || rows.every((r) => !r.count)) return <div className="muted small">{empty}</div>;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="rank">
      {rows.map((row) => (
        <div className="rank__row" key={row.label} title={`${row.label}: ${row.count}${valueSuffix}`}>
          <span className="rank__label">{row.label}</span>
          <span className="rank__track">
            {row.count ? <span className="rank__fill" style={{ width: `${(row.count / max) * 100}%` }} /> : null}
          </span>
          <span className="rank__value">{formatNumber(row.count)}{valueSuffix}</span>
        </div>
      ))}
    </div>
  );
}

/** A labelled 0–100 meter, coloured by how good the number is. */
export function Meter({ value, label }) {
  if (value === null || value === undefined) return <span className="muted small">—</span>;
  const tone = value >= 80 ? 'ok' : value >= 60 ? 'warn' : 'danger';
  return (
    <div className="meter" title={label}>
      <span className="meter__track"><span className={`meter__fill meter__fill--${tone}`} style={{ width: `${value}%` }} /></span>
      <span className="meter__value">{value}%</span>
    </div>
  );
}

export function durationLabel(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes >= 1440) {
    const days = Math.floor(minutes / 1440);
    const hours = Math.round((minutes % 1440) / 60);
    return `${days}d ${hours}h`;
  }
  return ettrLabel(minutes);
}

const ACTIONS = {
  create: 'created',
  update: 'updated',
  assign: 'assigned',
  resolve: 'resolved',
  soft_delete: 'archived',
  status_change: 'changed the status of',
  import_customers: 'imported',
  import: 'imported',
  deactivate: 'deactivated',
  restore: 'restored',
  change_password: 'reset the password of',
  delete: 'deleted',
  export: 'exported',
  payment: 'recorded a payment on',
};

/** What each audited thing is called in plain words. */
const ENTITY_LABELS = {
  Ticket: 'ticket',
  Customer: 'customer',
  Invoice: 'invoice',
  Quotation: 'quotation',
  Billing: 'bill',
  BillingRecord: 'bill',
  Subscriber: 'billing user',
  User: 'login',
  FieldTeam: 'employee',
  IssueType: 'issue type',
  InventoryItem: 'stock item',
  NetworkDevice: 'network device',
  Connection: 'connection',
  Pop: 'POP',
  Vlan: 'VLAN',
  Tenant: 'client',
  Company: 'company profile',
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Abdul Rouf 2026-10" → "Abdul Rouf (Oct 2026)". */
const prettyLabel = (label = '') =>
  label.replace(/\s*\b(\d{4})-(0[1-9]|1[0-2])\b/, (_m, y, mo) => ` (${MONTH_NAMES[Number(mo) - 1]} ${y})`).trim();

/** One audit entry as a plain sentence: "Hina Batool recorded a payment for Kahna School (Oct 2026)". */
export function activitySentence(entry) {
  const who = entry.actorName || 'Someone';
  if (entry.action === 'login') return `${who} signed in`;
  if (entry.action === 'logout') return `${who} signed out`;
  const label = entry.entityLabel || '';
  if (label.endsWith('(feature access)')) return `${who} changed feature access for ${label.replace(' (feature access)', '')}`;
  if (entry.entityType === 'Billing' && /\bbills$/.test(label)) return `${who} generated bills for ${prettyLabel(label.replace(/ bills$/, ''))}`;
  if (entry.entityType === 'Billing' && entry.action === 'create') return `${who} created a bill for ${prettyLabel(label)}`;
  if (entry.entityType === 'Billing' && entry.action === 'delete') return `${who} deleted the bill for ${prettyLabel(label)}`;
  const verb = ACTIONS[entry.action] || entry.action.replace(/_/g, ' ');
  const entity = ENTITY_LABELS[entry.entityType] || String(entry.entityType || '').toLowerCase();
  return `${who} ${verb} ${entity}${label ? ` ${prettyLabel(label)}` : ''}`;
}

/** Icon per area of the panel, shown beside the sentence (never colour alone). */
export function activityIcon(entry) {
  if (entry.action === 'login' || entry.action === 'logout') return '🔑';
  return {
    Ticket: '🎫', Customer: '👥', Invoice: '🧾', Quotation: '📄', Billing: '💰', BillingRecord: '💰', Subscriber: '💰',
    User: '👤', FieldTeam: '🧑‍🔧', InventoryItem: '📦', NetworkDevice: '🖧', Connection: '🖧', Pop: '🖧', Vlan: '🖧',
    Tenant: '🏢', Company: '🏢', IssueType: '🏷',
  }[entry.entityType] || '•';
}

/** Activity areas the owner can filter by (values are the server's entity types). */
export const ACTIVITY_TYPES = [
  { value: '', label: 'Everything' },
  { value: 'User', label: 'Logins' },
  { value: 'Ticket', label: 'Tickets' },
  { value: 'Customer', label: 'Customers' },
  { value: 'Billing', label: 'Bills' },
  { value: 'Invoice', label: 'Invoices' },
  { value: 'Quotation', label: 'Quotations' },
  { value: 'Tenant', label: 'Client settings' },
];

export function ClientAvatar({ client, large = false }) {
  return (
    <span
      className={`client-avatar${large ? ' client-avatar--lg' : ''}`}
      style={client.themeColor ? { background: client.themeColor } : undefined}
      aria-hidden="true"
    >
      {initials(client.name) || '?'}
    </span>
  );
}

/** "Today" / "Yesterday" / "Mon, 26 Oct" for the day an entry happened. */
function dayHeading(value, now) {
  const d = new Date(value);
  const key = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (key(d) === key(now)) return 'Today';
  if (key(d) === key(yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

const timeOfDay = (value) => new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/**
 * The activity trail, grouped under day headings. Each line: an icon for the
 * area, a plain sentence, the client (when several are mixed) and the time.
 */
export function ActivityFeed({ items, now, showClient = false, grouped = true, empty = 'Nothing recorded yet.' }) {
  if (!items.length) return <div className="card__body muted small">{empty}</div>;
  const groups = [];
  for (const entry of items) {
    const heading = grouped ? dayHeading(entry.createdAt, now) : '';
    if (!groups.length || groups[groups.length - 1].heading !== heading) groups.push({ heading, entries: [] });
    groups[groups.length - 1].entries.push(entry);
  }
  return (
    <div className="afeed">
      {groups.map((group, gi) => (
        <section key={`${group.heading}-${gi}`}>
          {group.heading ? <h4 className="afeed__day">{group.heading}</h4> : null}
          {group.entries.map((entry) => (
            <div className={`afeed__item afeed__item--${activityTone(entry.action)}`} key={entry._id}>
              <span className="afeed__icon" aria-hidden="true">{activityIcon(entry)}</span>
              <div className="afeed__body">
                <div className="afeed__text">{activitySentence(entry)}</div>
                {showClient && entry.tenantName ? <span className="afeed__client">{entry.tenantName}</span> : null}
              </div>
              <span className="afeed__time" title={formatDateTime(entry.createdAt)}>
                {grouped ? timeOfDay(entry.createdAt) : relativeTime(entry.createdAt, now)}
              </span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/** Tone per kind of action — drives the icon ring colour, paired with the sentence. */
export function activityTone(action) {
  if (action === 'login' || action === 'logout') return 'neutral';
  if (['delete', 'soft_delete', 'deactivate'].includes(action)) return 'danger';
  if (action === 'resolve' || action === 'payment') return 'ok';
  if (action === 'create' || action === 'import_customers' || action === 'import') return 'info';
  return 'warn';
}
