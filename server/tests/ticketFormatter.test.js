import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTicketText, findInternalLeaks, SEPARATOR } from '../src/utils/ticketFormatter.js';
import {
  formatTicketDateTime,
  formatEttrDuration,
  formatTimeLeftText,
  computeTimeLeft,
  addMinutes,
} from '../src/utils/datetime.js';
import { calculateTotals } from '../src/services/invoiceService.js';

/** The exact customer from the specification, including internal network data. */
const CUSTOMER = {
  customerReferenceNumber: '10255',
  name: 'Abdul Rouf',
  address: 'House 22, Shahid Town, Gajjumata, Lahore',
  connectedFrom: 'Gajjumata Pop',
  type: 'PUM',
  contactNumber: '0333-4458420',
  location: 'https://maps.app.goo.gl/EXwFUHbbik4spH5s8',
  sourcePort: 'GPON0/1/3',
  destinationPort: 'GE0/0/1',
  vlan: '613',
};

/** 09-Sep 06:38 PM in Asia/Karachi === 13:38 UTC. */
const CREATED_AT = new Date('2025-09-09T13:38:00.000Z');

const TICKET = {
  ticketNumber: 4626,
  createdAt: CREATED_AT,
  ettrMinutes: 60,
  ettrAt: addMinutes(CREATED_AT, 60),
  issueType: 'Fiber Cut',
  remarks: 'shahid town fiber down',
  priority: 'Urgent',
  status: 'In Progress',
  assignedByName: 'Mirza Arslan Shabbir',
  assignedToName: 'Sharafat Ali',
};

// 3 minutes after creation → 57 minutes left, matching the specification sample.
const NOW = addMinutes(CREATED_AT, 3);

test('generated ticket matches the specification format exactly', () => {
  const expected = [
    '*TID: 4626* | 09-Sep 06:38 PM',
    'ETTR: 09-Sep 07:38 PM {1H 0M}',
    'Time Left: *{0:Days 0:Hours 57:Mins }*',
    SEPARATOR,
    'Site | Customer ID: 10255',
    'Name: Abdul Rouf',
    'Location: https://maps.app.goo.gl/EXwFUHbbik4spH5s8',
    'Contact #: 0333-4458420',
    'Connected From: Gajjumata Pop',
    SEPARATOR,
    'Type: *Fiber Cut*',
    'Remarks: shahid town fiber down',
    SEPARATOR,
    'Assigned By: Mirza Arslan Shabbir',
    'Required: Urgent (Do First)',
    'Status: In Progress',
    "*Sharafat Ali:* Resolve this ticket as soon as possible, it's Urgent",
  ].join('\n');

  assert.equal(buildTicketText(TICKET, CUSTOMER, { now: NOW }), expected);
});

test('generated ticket never exposes internal network data', () => {
  const text = buildTicketText(TICKET, CUSTOMER, { now: NOW });

  assert.deepEqual(findInternalLeaks(text, CUSTOMER), []);

  // Explicit checks for each forbidden field from section 4 of the spec.
  assert.ok(!text.includes(CUSTOMER.address), 'address must not appear');
  assert.ok(!text.includes('PUM'), 'PUM/PMB/COR type must not appear');
  assert.ok(!text.includes(CUSTOMER.sourcePort), 'source port must not appear');
  assert.ok(!text.includes(CUSTOMER.destinationPort), 'destination port must not appear');
  assert.ok(!/\b613\b/.test(text), 'VLAN must not appear');
});

test('separator is a 30-character rule', () => {
  assert.equal(SEPARATOR, '------------------------------');
  assert.equal(SEPARATOR.length, 30);
});

test('a ticket with no assignee omits the closing instruction line', () => {
  const text = buildTicketText({ ...TICKET, assignedToName: '' }, CUSTOMER, { now: NOW });
  assert.ok(!text.includes('Sharafat Ali'));
  assert.ok(text.trimEnd().endsWith('Status: In Progress'));
});

test('a customer without a Maps URL omits the Location line', () => {
  const text = buildTicketText(TICKET, { ...CUSTOMER, location: '' }, { now: NOW });
  assert.ok(!text.includes('Location:'));
  assert.ok(text.includes('Contact #: 0333-4458420'));
});

test('time left goes overdue once the ETTR has passed', () => {
  const later = addMinutes(TICKET.ettrAt, 65);
  const result = computeTimeLeft(TICKET.ettrAt, { now: later });

  assert.equal(result.overdue, true);
  assert.equal(result.hours, 1);
  assert.equal(result.minutes, 5);
  assert.equal(result.text, 'OVERDUE {0:Days 1:Hours 5:Mins }');
  assert.ok(buildTicketText(TICKET, CUSTOMER, { now: later }).includes('Time Left: *OVERDUE'));
});

test('a resolved ticket freezes its countdown at the resolution time', () => {
  const resolvedTicket = {
    ...TICKET,
    status: 'Resolved',
    resolvedAt: addMinutes(CREATED_AT, 20),
  };
  const muchLater = addMinutes(CREATED_AT, 5000);
  const text = buildTicketText(resolvedTicket, CUSTOMER, { now: muchLater });

  assert.ok(text.includes('Time Left: *{0:Days 0:Hours 40:Mins }*'));
  assert.ok(text.includes('Status: Resolved'));
});

test('ETTR duration formats hours and minutes', () => {
  assert.equal(formatEttrDuration(60), '{1H 0M}');
  assert.equal(formatEttrDuration(30), '{0H 30M}');
  assert.equal(formatEttrDuration(1440), '{24H 0M}');
  assert.equal(formatEttrDuration(150), '{2H 30M}');
});

test('time-left text uses the day/hour/minute buckets', () => {
  assert.equal(formatTimeLeftText(0), '{0:Days 0:Hours 0:Mins }');
  assert.equal(formatTimeLeftText(90 * 60 * 1000), '{0:Days 1:Hours 30:Mins }');
  assert.equal(formatTimeLeftText(50 * 60 * 60 * 1000), '{2:Days 2:Hours 0:Mins }');
});

test('dates render in the operational timezone, not the machine timezone', () => {
  assert.equal(formatTicketDateTime(CREATED_AT), '09-Sep 06:38 PM');
  assert.equal(formatTicketDateTime(new Date('2025-01-05T19:05:00.000Z')), '06-Jan 12:05 AM');
});

test('invoice totals apply discount before tax', () => {
  const totals = calculateTotals({
    items: [
      { description: 'Splicing', quantity: 1, rate: 3500 },
      { description: 'Drop cable', quantity: 40, rate: 45 },
    ],
    discountType: 'percent',
    discountValue: 10,
    taxPercent: 17,
  });

  assert.equal(totals.subtotal, 5300);
  assert.equal(totals.discountAmount, 530);
  assert.equal(totals.taxAmount, 810.9);
  assert.equal(totals.total, 5580.9);
  assert.equal(totals.items[1].amount, 1800);
});

test('invoice discount can never exceed the subtotal', () => {
  const totals = calculateTotals({
    items: [{ description: 'Callout', quantity: 1, rate: 1000 }],
    discountType: 'amount',
    discountValue: 5000,
  });

  assert.equal(totals.discountAmount, 1000);
  assert.equal(totals.total, 0);
});
