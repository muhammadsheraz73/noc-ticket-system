import env from '../config/env.js';

const MINUTE = 60 * 1000;

/**
 * Fixed three-letter month abbreviations.
 *
 * ICU's `month: 'short'` is locale- and version-dependent (`en-GB` renders
 * September as "Sept"), and the ticket format is a fixed contract, so the
 * abbreviation is looked up here instead of being formatted.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Break a date into calendar/clock fields **in the operational timezone**. */
function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(new Date(date));

  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: get('year'),
    monthIndex: Number.parseInt(get('month'), 10) - 1,
    day: get('day'),
    hour: get('hour').padStart(2, '0'),
    minute: get('minute'),
    dayPeriod: get('dayPeriod').toUpperCase(),
  };
}

/**
 * Format a date exactly the way the standardized NOC ticket expects it:
 *   `09-Sep 06:38 PM`
 * Always rendered in the configured operational timezone (APP_TIMEZONE),
 * never in the browser's timezone.
 */
export function formatTicketDateTime(date, timeZone = env.timezone) {
  const p = zonedParts(date, timeZone);
  return `${p.day}-${MONTHS[p.monthIndex]} ${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/** `09-Sep-2025` — used on invoices. */
export function formatDate(date, timeZone = env.timezone) {
  const p = zonedParts(date, timeZone);
  return `${p.day}-${MONTHS[p.monthIndex]}-${p.year}`;
}

/** `{1H 0M}` — the ETTR duration suffix. */
export function formatEttrDuration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  return `{${Math.floor(total / 60)}H ${total % 60}M}`;
}

/**
 * Break a millisecond span into the ticket's day/hour/minute buckets.
 * Minutes are rounded *down* so a countdown never displays a value that has
 * not actually elapsed yet.
 */
export function breakdown(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / MINUTE));
  return {
    days: Math.floor(totalMinutes / (24 * 60)),
    hours: Math.floor((totalMinutes % (24 * 60)) / 60),
    minutes: totalMinutes % 60,
    totalMinutes,
  };
}

/**
 * Authoritative time-left calculation. Always derived from the stored
 * server-side timestamps — the browser's clock is never an input.
 *
 * @returns {{overdue: boolean, frozen: boolean, ms: number, text: string, ...}}
 */
export function computeTimeLeft(ettrAt, { now = new Date(), stoppedAt = null } = {}) {
  const reference = stoppedAt ? new Date(stoppedAt) : new Date(now);
  const target = new Date(ettrAt);
  const ms = target.getTime() - reference.getTime();
  const overdue = ms < 0;
  const parts = breakdown(Math.abs(ms));

  return {
    overdue,
    frozen: Boolean(stoppedAt),
    ms,
    ...parts,
    text: formatTimeLeftText(ms),
  };
}

/**
 * `{0:Days 0:Hours 57:Mins }` for remaining time, and an explicit overdue
 * marker once the ETTR has passed.
 */
export function formatTimeLeftText(ms) {
  const { days, hours, minutes } = breakdown(Math.abs(ms));
  const body = `{${days}:Days ${hours}:Hours ${minutes}:Mins }`;
  return ms < 0 ? `OVERDUE ${body}` : body;
}

/** Add minutes to a date and return a new Date. */
export function addMinutes(date, minutes) {
  return new Date(new Date(date).getTime() + Number(minutes) * MINUTE);
}

/** Add whole days to a date and return a new Date. */
export function addDays(date, days) {
  return new Date(new Date(date).getTime() + Number(days) * 24 * 60 * MINUTE);
}

/** Start of the current day in the operational timezone, as a UTC Date. */
export function startOfLocalDay(now = new Date(), timeZone = env.timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  const localMidnight = new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00Z`);
  // Offset between the timezone and UTC at this instant.
  const offsetMs = now.getTime() - new Date(localIsoString(now, timeZone)).getTime();
  return new Date(localMidnight.getTime() + offsetMs);
}

function localIsoString(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}Z`;
}
