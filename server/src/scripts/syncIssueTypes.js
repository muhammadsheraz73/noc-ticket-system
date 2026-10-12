/**
 * Bring every client's issue-type list in line with DEFAULT_ISSUE_TYPES.
 *
 * Types in the list are created if missing, re-activated and put in list
 * order; any other type is deactivated (never deleted — old tickets still
 * carry its name, and an admin can switch it back on).
 *
 *   npm --workspace server run sync:issue-types
 */
import { pathToFileURL } from 'node:url';
import IssueType from '../models/IssueType.js';
import Tenant from '../models/Tenant.js';
import logger from '../utils/logger.js';
import { DEFAULT_ISSUE_TYPES } from '../utils/constants.js';

export async function syncIssueTypes() {
  const tenants = await Tenant.find({}).select('_id name').lean();

  for (const tenant of tenants) {
    for (const [index, name] of DEFAULT_ISSUE_TYPES.entries()) {
      await IssueType.updateOne(
        { tenant: tenant._id, name },
        {
          $set: { isActive: true, sortOrder: index * 10 },
          $setOnInsert: { defaultEttrMinutes: name === 'Fiber Cut' ? 60 : 120 },
        },
        { upsert: true },
      );
    }
    const { modifiedCount } = await IssueType.updateMany(
      { tenant: tenant._id, name: { $nin: DEFAULT_ISSUE_TYPES }, isActive: true },
      { $set: { isActive: false } },
    );
    logger.info(`${tenant.name}: ${DEFAULT_ISSUE_TYPES.length} issue types active, ${modifiedCount} old type(s) deactivated`);
  }

  return tenants.length;
}

export default syncIssueTypes;

// Standalone run: `node src/scripts/syncIssueTypes.js`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
  await connectDatabase();
  const count = await syncIssueTypes();
  logger.info(`Synced issue types for ${count} client(s).`);
  await disconnectDatabase();
}
