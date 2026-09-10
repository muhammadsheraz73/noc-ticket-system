import env from '../config/env.js';
import logger from '../utils/logger.js';
import { connectDatabase, disconnectDatabase } from '../config/db.js';

import User from '../models/User.js';
import Customer from '../models/Customer.js';
import Ticket from '../models/Ticket.js';
import FieldTeam from '../models/FieldTeam.js';
import Invoice from '../models/Invoice.js';
import IssueType from '../models/IssueType.js';
import Pop from '../models/Pop.js';
import NetworkDevice from '../models/NetworkDevice.js';
import Connection from '../models/Connection.js';
import Vlan from '../models/Vlan.js';
import Counter from '../models/Counter.js';
import AuditLog from '../models/AuditLog.js';

import { ROLES, DEFAULT_ISSUE_TYPES } from '../utils/constants.js';
import { addMinutes, addDays } from '../utils/datetime.js';
import { buildTicketText } from '../utils/ticketFormatter.js';
import { calculateTotals, generateInvoiceNumber } from '../services/invoiceService.js';
import { reserveTicketNumber, TICKET_SEQUENCE_KEY } from '../services/ticketService.js';

const RESET = process.argv.includes('--reset');

const USERS = [
  {
    name: 'Mirza Arslan Shabbir',
    email: env.seed.adminEmail,
    password: env.seed.adminPassword,
    role: ROLES.ADMIN,
    phone: '0300-1112233',
  },
  {
    name: 'Usman Tariq',
    email: 'noc@noc.local',
    password: 'Noc@12345',
    role: ROLES.NOC_OPERATOR,
    phone: '0300-2223344',
  },
  {
    name: 'Sharafat Ali',
    email: 'field@noc.local',
    password: 'Field@12345',
    role: ROLES.FIELD_ENGINEER,
    phone: '0301-3334455',
  },
  {
    name: 'Hina Batool',
    email: 'accounts@noc.local',
    password: 'Accounts@123',
    role: ROLES.ACCOUNTS,
    phone: '0302-4445566',
  },
];

const POPS = [
  { code: 'GJM', name: 'Gajjumata Pop', address: 'Gajjumata, Ferozepur Road, Lahore' },
  { code: 'KHY', name: 'Kahna Pop', address: 'Kahna Nau, Lahore' },
  { code: 'TWN', name: 'Township Pop', address: 'Township, Lahore' },
];

const CUSTOMERS = [
  {
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
    notes: 'Primary residential fibre link. Shared splitter with 10256.',
  },
  {
    customerReferenceNumber: '10256',
    name: 'Al-Madina Traders',
    address: 'Shop 14, Main Bazaar, Gajjumata, Lahore',
    connectedFrom: 'Gajjumata Pop',
    type: 'COR',
    contactNumber: '0321-7788990',
    location: 'https://maps.app.goo.gl/EXwFUHbbik4spH5s8',
    sourcePort: 'GPON0/1/4',
    destinationPort: 'GE0/0/2',
    vlan: '614',
    notes: 'Corporate 20 Mbps dedicated link.',
  },
  {
    customerReferenceNumber: '10257',
    name: 'Kahna Public School',
    address: 'Kahna Nau Main Road, Lahore',
    connectedFrom: 'Kahna Pop',
    type: 'PMB',
    contactNumber: '0300-5566778',
    location: 'https://maps.app.goo.gl/kahnaPublicSchool',
    sourcePort: 'GPON1/2/7',
    destinationPort: 'GE0/0/5',
    vlan: '702',
    notes: 'Bandwidth peaks during school hours.',
  },
  {
    customerReferenceNumber: '10258',
    name: 'Hafiz Medical Store',
    address: 'Township C Block, Lahore',
    connectedFrom: 'Township Pop',
    type: 'PUM',
    contactNumber: '0345-1122334',
    location: '',
    sourcePort: 'GPON2/1/1',
    destinationPort: 'GE0/0/9',
    vlan: '811',
    notes: '',
  },
];

const VLANS = [
  { vlanId: 613, name: 'RESI-GJM-613', description: 'Residential pool, Gajjumata', subnet: '10.61.3.0/24' },
  { vlanId: 614, name: 'CORP-GJM-614', description: 'Corporate pool, Gajjumata', subnet: '10.61.4.0/24' },
  { vlanId: 702, name: 'EDU-KHY-702', description: 'Education sector, Kahna', subnet: '10.70.2.0/24' },
  { vlanId: 811, name: 'RESI-TWN-811', description: 'Residential pool, Township', subnet: '10.81.1.0/24' },
];

async function run() {
  await connectDatabase();

  if (RESET) {
    logger.warn('--reset supplied: clearing all collections.');
    await Promise.all([
      User.deleteMany({}),
      Customer.deleteMany({}),
      Ticket.deleteMany({}),
      FieldTeam.deleteMany({}),
      Invoice.deleteMany({}),
      IssueType.deleteMany({}),
      Pop.deleteMany({}),
      NetworkDevice.deleteMany({}),
      Connection.deleteMany({}),
      Vlan.deleteMany({}),
      Counter.deleteMany({}),
      AuditLog.deleteMany({}),
    ]);
  }

  // ---------------------------------------------------------------- users
  const users = {};
  for (const spec of USERS) {
    let user = await User.findOne({ email: spec.email });
    if (!user) {
      user = await User.create({
        name: spec.name,
        email: spec.email,
        role: spec.role,
        phone: spec.phone,
        passwordHash: await User.hashPassword(spec.password),
      });
      logger.info(`Created user ${spec.email} (${spec.role})`);
    }
    users[spec.role] = user;
  }

  // ---------------------------------------------------------- issue types
  for (const [index, name] of DEFAULT_ISSUE_TYPES.entries()) {
    await IssueType.updateOne(
      { name },
      {
        $setOnInsert: {
          name,
          sortOrder: index * 10,
          defaultEttrMinutes: name === 'Fiber Cut' ? 60 : 120,
          isActive: true,
        },
      },
      { upsert: true },
    );
  }

  // ----------------------------------------------------------------- POPs
  const popsByName = {};
  for (const spec of POPS) {
    const pop = await Pop.findOneAndUpdate(
      { code: spec.code },
      { $setOnInsert: spec },
      { upsert: true, new: true },
    );
    popsByName[pop.name] = pop;
  }

  // ---------------------------------------------------------------- VLANs
  for (const spec of VLANS) {
    await Vlan.updateOne({ vlanId: spec.vlanId }, { $setOnInsert: spec }, { upsert: true });
  }

  // -------------------------------------------------------------- devices
  const olt = await NetworkDevice.findOneAndUpdate(
    { name: 'OLT-GJM-01' },
    {
      $setOnInsert: {
        name: 'OLT-GJM-01',
        deviceType: 'OLT',
        pop: popsByName['Gajjumata Pop']?._id,
        popName: 'Gajjumata Pop',
        vendor: 'Huawei',
        model: 'MA5608T',
        managementIp: '10.10.10.5',
        serialNumber: 'HW-MA5608T-0091',
        ports: [
          { name: 'GPON0/1/3', portType: 'PON', speed: '2.5G', sfpType: 'C+', status: 'In Use' },
          { name: 'GPON0/1/4', portType: 'PON', speed: '2.5G', sfpType: 'C+', status: 'In Use' },
          { name: 'GPON0/1/5', portType: 'PON', speed: '2.5G', sfpType: 'C+', status: 'Free' },
        ],
      },
    },
    { upsert: true, new: true },
  );

  const aggSwitch = await NetworkDevice.findOneAndUpdate(
    { name: 'SW-GJM-CORE' },
    {
      $setOnInsert: {
        name: 'SW-GJM-CORE',
        deviceType: 'Switch',
        pop: popsByName['Gajjumata Pop']?._id,
        popName: 'Gajjumata Pop',
        vendor: 'Cisco',
        model: 'C9200-24T',
        managementIp: '10.10.10.2',
        ports: [
          { name: 'GE0/0/1', portType: 'Ethernet', speed: '1G', sfpType: 'SM LC 20km', status: 'In Use' },
          { name: 'GE0/0/2', portType: 'Ethernet', speed: '1G', sfpType: 'SM LC 20km', status: 'In Use' },
        ],
      },
    },
    { upsert: true, new: true },
  );

  // ------------------------------------------------------------ customers
  const customers = {};
  for (const spec of CUSTOMERS) {
    let customer = await Customer.findOne({ customerReferenceNumber: spec.customerReferenceNumber });
    if (!customer) {
      customer = await Customer.create({ ...spec, createdBy: users[ROLES.ADMIN]._id });
      logger.info(`Created customer ${spec.customerReferenceNumber} — ${spec.name}`);
    }
    customers[spec.customerReferenceNumber] = customer;
  }

  // ----------------------------------------------------------- connection
  await Connection.updateOne(
    { customerReferenceNumber: '10255' },
    {
      $setOnInsert: {
        label: 'Abdul Rouf — residential drop',
        sourceDevice: olt._id,
        sourceDeviceName: olt.name,
        sourcePort: 'GPON0/1/3',
        destinationDevice: aggSwitch._id,
        destinationDeviceName: aggSwitch.name,
        destinationPort: 'GE0/0/1',
        vlan: '613',
        connectionType: 'PON',
        sfpSpeed: '2.5G',
        sfpType: 'C+',
        ponPort: 'PON3/ONU12',
        customer: customers['10255']._id,
        customerReferenceNumber: '10255',
        status: 'Active',
      },
    },
    { upsert: true },
  );

  // ----------------------------------------------------------- field team
  const team = await FieldTeam.findOneAndUpdate(
    { name: 'Gajjumata Field Team' },
    { $setOnInsert: { name: 'Gajjumata Field Team', kind: 'team', area: 'Gajjumata / Kahna' } },
    { upsert: true, new: true },
  );

  const members = [
    { name: 'Sharafat Ali', phone: '0301-3334455', area: 'Gajjumata', user: users[ROLES.FIELD_ENGINEER]._id },
    { name: 'Bilal Ahmed', phone: '0307-6667788', area: 'Kahna' },
    { name: 'Nadeem Akhtar', phone: '0308-9990011', area: 'Township' },
  ];

  const membersByName = {};
  for (const spec of members) {
    const member = await FieldTeam.findOneAndUpdate(
      { name: spec.name },
      { $setOnInsert: { ...spec, kind: 'member', team: team._id } },
      { upsert: true, new: true },
    );
    membersByName[spec.name] = member;
  }

  // -------------------------------------------------------------- tickets
  // Start the TID sequence at the value from the specification example.
  await Counter.updateOne(
    { _id: TICKET_SEQUENCE_KEY },
    { $setOnInsert: { seq: env.ticketNumberStart - 1 } },
    { upsert: true },
  );

  const existingTickets = await Ticket.countDocuments();
  if (existingTickets === 0) {
    const now = new Date();

    const specs = [
      {
        customer: customers['10255'],
        issueType: 'Fiber Cut',
        remarks: 'shahid town fiber down',
        priority: 'Urgent',
        status: 'In Progress',
        ettrMinutes: 60,
        createdAt: addMinutes(now, -3),
        assignee: membersByName['Sharafat Ali'],
      },
      {
        customer: customers['10256'],
        issueType: 'Internet Connectivity',
        remarks: 'Customer reports slow speed during evening hours',
        priority: 'High',
        status: 'New',
        ettrMinutes: 240,
        createdAt: addMinutes(now, -95),
        assignee: null,
      },
      {
        customer: customers['10257'],
        issueType: 'LOS',
        remarks: 'ONU showing red LOS light since morning',
        priority: 'Urgent',
        status: 'On Hold',
        ettrMinutes: 120,
        createdAt: addMinutes(now, -400),
        assignee: membersByName['Bilal Ahmed'],
      },
      {
        customer: customers['10258'],
        issueType: 'Power',
        remarks: 'Area load-shedding, UPS backup exhausted',
        priority: 'Medium',
        status: 'Resolved',
        ettrMinutes: 480,
        createdAt: addMinutes(now, -1500),
        resolvedAfter: 300,
        assignee: membersByName['Nadeem Akhtar'],
      },
    ];

    for (const spec of specs) {
      const ticketNumber = await reserveTicketNumber();
      const ticket = new Ticket({
        ticketNumber,
        customer: spec.customer._id,
        customerReferenceNumber: spec.customer.customerReferenceNumber,
        customerName: spec.customer.name,
        issueType: spec.issueType,
        remarks: spec.remarks,
        priority: spec.priority,
        status: spec.status,
        ettrMinutes: spec.ettrMinutes,
        ettrAt: addMinutes(spec.createdAt, spec.ettrMinutes),
        assignedBy: users[ROLES.ADMIN]._id,
        assignedByName: users[ROLES.ADMIN].name,
        assignedTo: spec.assignee?._id,
        assignedToName: spec.assignee?.name || '',
        assignedAt: spec.assignee ? spec.createdAt : undefined,
        createdAt: spec.createdAt,
        resolvedAt: spec.resolvedAfter ? addMinutes(spec.createdAt, spec.resolvedAfter) : undefined,
        resolutionRemarks: spec.resolvedAfter ? 'Mains power restored, link is stable.' : '',
        ai: { status: 'pending', troubleshootingSteps: [] },
        history: [
          {
            at: spec.createdAt,
            by: users[ROLES.ADMIN]._id,
            byName: users[ROLES.ADMIN].name,
            action: 'created',
            to: 'New',
            note: `Ticket raised for customer ${spec.customer.customerReferenceNumber}`,
          },
          ...(spec.assignee
            ? [
                {
                  at: spec.createdAt,
                  by: users[ROLES.ADMIN]._id,
                  byName: users[ROLES.ADMIN].name,
                  action: 'assigned',
                  to: spec.assignee.name,
                },
              ]
            : []),
        ],
      });

      ticket.generatedText = buildTicketText(ticket, spec.customer, { now });
      await ticket.save();
      logger.info(`Created ticket TID ${ticketNumber} — ${spec.issueType} for ${spec.customer.name}`);
    }
  }

  // ------------------------------------------------------------- invoices
  if ((await Invoice.countDocuments()) === 0) {
    const ticket = await Ticket.findOne({ ticketNumber: env.ticketNumberStart });
    if (ticket) {
      const customer = customers['10255'];
      const items = [
        { description: 'Fiber splicing — emergency call out', quantity: 1, rate: 3500 },
        { description: 'Drop cable replacement (per metre)', quantity: 40, rate: 45 },
        { description: 'SC/APC connector', quantity: 2, rate: 250 },
      ];
      const totals = calculateTotals({ items, discountType: 'none', discountValue: 0, taxPercent: 0 });
      const issueDate = new Date();

      await Invoice.create({
        invoiceNumber: await generateInvoiceNumber(issueDate),
        ticket: ticket._id,
        ticketNumber: ticket.ticketNumber,
        customer: customer._id,
        customerReferenceNumber: customer.customerReferenceNumber,
        customerName: customer.name,
        customerAddress: customer.address,
        customerContact: customer.contactNumber,
        issueDate,
        dueDate: addDays(issueDate, env.invoice.dueDays),
        items: totals.items,
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        taxAmount: totals.taxAmount,
        total: totals.total,
        currency: env.invoice.currency,
        status: 'Unpaid',
        notes: 'Emergency restoration charges for fibre cut in Shahid Town.',
        createdBy: users[ROLES.ACCOUNTS]._id,
        createdByName: users[ROLES.ACCOUNTS].name,
      });
      logger.info(`Created invoice for TID ${ticket.ticketNumber}`);
    }
  }

  printSummary();
  // Flushes to disk and stops the embedded instance (if one was started).
  await disconnectDatabase();
}

function printSummary() {
  const line = '='.repeat(66);
  console.log(`\n${line}`);
  console.log('  SEED COMPLETE — demo accounts');
  console.log(line);
  for (const user of USERS) {
    console.log(`  ${user.role.padEnd(15)} ${user.email.padEnd(22)} ${user.password}`);
  }
  console.log(line);
  console.log('  Demo customer : 10255 (Abdul Rouf)');
  console.log(`  Demo ticket   : TID ${env.ticketNumberStart} (Fiber Cut)`);
  console.log(`${line}\n`);
}

run().catch(async (error) => {
  logger.error('Seed failed:', error.message);
  logger.error(error.stack);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
