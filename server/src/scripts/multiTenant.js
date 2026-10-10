/**
 * One-time upgrade of an existing single-company database to multi-client.
 *
 * Everything that exists today is handed to ONE client (the company the panel
 * was built for), the global unique indexes are replaced with per-client ones,
 * and — optionally — a separate owner login is created for you.
 *
 *   npm --workspace server run migrate:tenants -- --tenant "Wellnet" \
 *       --owner-username owner --owner-email you@example.com --owner-password "S0me-Strong-Pass"
 *
 * Safe to run twice: documents that already have a client are left alone.
 */
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import logger from '../utils/logger.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Counter from '../models/Counter.js';
import AuditLog from '../models/AuditLog.js';
import BillingRecord from '../models/BillingRecord.js';
import Connection from '../models/Connection.js';
import Customer from '../models/Customer.js';
import FieldTeam from '../models/FieldTeam.js';
import Invoice from '../models/Invoice.js';
import IssueType from '../models/IssueType.js';
import NetworkDevice from '../models/NetworkDevice.js';
import Pop from '../models/Pop.js';
import Subscriber from '../models/Subscriber.js';
import Ticket from '../models/Ticket.js';
import Vlan from '../models/Vlan.js';
import { ROLES } from '../utils/constants.js';

const SCOPED_MODELS = [
  AuditLog, BillingRecord, Connection, Customer, FieldTeam, Invoice,
  IssueType, NetworkDevice, Pop, Subscriber, Ticket, Vlan,
];

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

export async function migrateToTenants({ tenantName, owner }) {
  let tenant = await Tenant.findOne({ name: tenantName });
  if (!tenant) tenant = await Tenant.create({ name: tenantName });
  logger.info(`Client: ${tenant.name} (${tenant._id})`);

  const missing = { tenant: { $exists: false } };

  for (const Model of SCOPED_MODELS) {
    // The raw collection is used on purpose: the tenant plugin would otherwise
    // narrow the update to a scope that is not active here.
    const result = await Model.collection.updateMany(missing, { $set: { tenant: tenant._id } });
    logger.info(`  ${Model.modelName}: ${result.modifiedCount} document(s) assigned`);
  }

  const users = await User.collection.updateMany(
    { ...missing, role: { $ne: ROLES.SUPERADMIN } },
    { $set: { tenant: tenant._id } },
  );
  logger.info(`  User: ${users.modifiedCount} login(s) assigned`);

  // Ticket / invoice counters become per-client so numbering continues.
  const counters = await Counter.collection.find({ _id: { $not: /:/ } }).toArray();
  for (const counter of counters) {
    const key = `${tenant._id}:${counter._id}`;
    await Counter.collection.updateOne({ _id: key }, { $max: { seq: counter.seq } }, { upsert: true });
    await Counter.collection.deleteOne({ _id: counter._id });
  }
  logger.info(`  Counter: ${counters.length} sequence(s) moved under the client`);

  for (const Model of [...SCOPED_MODELS, User, Tenant]) {
    await Model.syncIndexes();
  }
  logger.info('Indexes rebuilt (per-client uniqueness).');

  if (owner?.username && owner?.email && owner?.password) {
    const exists = await User.exists({ $or: [{ username: owner.username }, { email: owner.email }] });
    if (exists) {
      logger.warn(`Owner login "${owner.username}" already exists — left unchanged.`);
    } else {
      await User.create({
        name: 'Panel Owner',
        username: owner.username,
        email: owner.email,
        role: ROLES.SUPERADMIN,
        passwordHash: await User.hashPassword(owner.password),
      });
      logger.info(`Owner login created: ${owner.username}`);
    }
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const tenantName = arg('tenant');
  if (!tenantName) {
    logger.error('Usage: migrate:tenants -- --tenant "Company name" [--owner-username u --owner-email e --owner-password p]');
    process.exit(1);
  }

  try {
    await connectDatabase();
    await migrateToTenants({
      tenantName,
      owner: {
        username: arg('owner-username')?.toLowerCase(),
        email: arg('owner-email')?.toLowerCase(),
        password: arg('owner-password'),
      },
    });
  } catch (error) {
    logger.error('Migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
    await mongoose.disconnect().catch(() => {});
  }
}
