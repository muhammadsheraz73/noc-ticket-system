/**
 * Give a username to every account created before usernames existed.
 *
 * `username` is required by the schema, so without this an old account would
 * fail validation the moment anything saved it — including the `lastLoginAt`
 * write on a successful sign-in. The API runs it once at start-up; it can also
 * be run on its own:
 *
 *   npm --workspace server run backfill:usernames
 */
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import User from '../models/User.js';
import logger from '../utils/logger.js';

/** Matches an account that has not been given a username yet. */
const MISSING = { $or: [{ username: { $exists: false } }, { username: null }, { username: '' }] };

/**
 * Idempotent, and safe to run twice at once — a `node --watch` restart or a
 * second instance can easily boot while the first is still working.
 *
 * @returns {Promise<number>} how many accounts this run gave a username
 */
export async function backfillUsernames() {
  const users = mongoose.connection.collection('users');

  // The raw collection is used deliberately: these documents cannot be
  // hydrated into a model that now requires the very field they are missing.
  let filled = 0;

  // One account per pass, re-reading each time, so a concurrent run's writes
  // are seen instead of being raced. Bounded by the work that existed at the
  // start, which no single pass can increase.
  for (let guard = await users.countDocuments(MISSING); guard > 0; guard -= 1) {
    const account = await users.findOne(MISSING, { projection: { _id: 1, name: 1, email: 1 } });
    if (!account) break;

    const username = await User.deriveUsername(account.email || account.name);
    try {
      // `MISSING` stays in the filter: whoever writes first wins, and the loser
      // moves on rather than overwriting a username that is already assigned.
      const result = await users.updateOne({ _id: account._id, ...MISSING }, { $set: { username } });
      if (result.modifiedCount) {
        filled += 1;
        logger.info(`Backfilled username "${username}" for ${account.email || account.name}`);
      }
    } catch (error) {
      // 11000 — another process claimed this username first; the next pass
      // re-derives and picks the following free one.
      if (error.code !== 11000) throw error;
    }
  }

  return filled;
}

export default backfillUsernames;

// Standalone run: `node src/scripts/backfillUsernames.js`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
  await connectDatabase();
  const count = await backfillUsernames();
  logger.info(count ? `Backfilled ${count} username(s).` : 'Every account already has a username.');
  await disconnectDatabase();
}
