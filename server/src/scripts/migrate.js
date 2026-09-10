/**
 * Copy every collection from one MongoDB to another.
 *
 * Typical use: move the local/embedded database to MongoDB Atlas.
 *
 *   node src/scripts/migrate.js --to "mongodb+srv://user:pass@cluster0.xxx.mongodb.net/noc_system"
 *
 * Options:
 *   --from <uri>   Source database. Defaults to the embedded instance
 *                  (mongodb://127.0.0.1:<EMBEDDED_MONGO_PORT>/noc_system).
 *   --to <uri>     Target database. Required.
 *   --drop         Drop each target collection before copying (clean migration).
 *   --dry-run      Report what would be copied without writing anything.
 */
import { MongoClient } from 'mongodb';
import env from '../config/env.js';
import logger from '../utils/logger.js';

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : true;
}

const DROP = Boolean(arg('drop', false));
const DRY_RUN = Boolean(arg('dry-run', false));
const FROM = arg('from', env.mongoUri || `mongodb://127.0.0.1:${env.embeddedMongoPort}/noc_system`);
const TO = arg('to');

const mask = (uri) => String(uri).replace(/\/\/([^:@/]+):([^@]+)@/, '//$1:****@');

async function run() {
  if (!TO || TO === true) {
    throw new Error('Target database is required:  node src/scripts/migrate.js --to "<uri>"');
  }
  if (FROM === TO) {
    throw new Error('Source and target are the same database.');
  }

  logger.info(`Source : ${mask(FROM)}`);
  logger.info(`Target : ${mask(TO)}`);
  if (DRY_RUN) logger.warn('Dry run — nothing will be written.');

  const source = new MongoClient(FROM, { serverSelectionTimeoutMS: 15000 });
  const target = new MongoClient(TO, { serverSelectionTimeoutMS: 20000 });

  await source.connect();
  await target.connect();

  const sourceDb = source.db();
  const targetDb = target.db();

  const collections = (await sourceDb.listCollections().toArray())
    .map((c) => c.name)
    .filter((name) => !name.startsWith('system.'))
    .sort();

  if (!collections.length) {
    logger.warn('Source database has no collections — nothing to migrate.');
  }

  let totalCopied = 0;

  for (const name of collections) {
    const documents = await sourceDb.collection(name).find({}).toArray();

    if (!documents.length) {
      logger.info(`  ${name.padEnd(18)} empty, skipped`);
      continue;
    }

    if (DRY_RUN) {
      logger.info(`  ${name.padEnd(18)} would copy ${documents.length} document(s)`);
      totalCopied += documents.length;
      continue;
    }

    if (DROP) {
      await targetDb.collection(name).drop().catch(() => {});
    }

    // `_id` is preserved, so every ObjectId reference between collections stays valid.
    const result = await targetDb.collection(name).bulkWrite(
      documents.map((doc) => ({
        replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
      })),
      { ordered: false },
    );

    const written = result.upsertedCount + result.modifiedCount + result.matchedCount;
    logger.info(`  ${name.padEnd(18)} ${written}/${documents.length} document(s)`);
    totalCopied += written;

    // Recreate the source indexes (skip _id_, which always exists).
    const indexes = await sourceDb.collection(name).indexes();
    for (const index of indexes) {
      if (index.name === '_id_') continue;
      const { key, name: indexName, v, ns, ...options } = index;
      await targetDb
        .collection(name)
        .createIndex(key, { name: indexName, ...options })
        .catch((error) => logger.warn(`    index ${indexName}: ${error.message}`));
    }
  }

  await source.close();
  await target.close();

  logger.info('-'.repeat(58));
  logger.info(
    DRY_RUN
      ? `Dry run complete — ${totalCopied} document(s) across ${collections.length} collection(s).`
      : `Migration complete — ${totalCopied} document(s) across ${collections.length} collection(s).`,
  );
  if (!DRY_RUN) {
    logger.info('Now set MONGODB_URI in server/.env to the target and restart the API.');
  }
}

run().catch((error) => {
  logger.error(`Migration failed: ${error.message}`);
  process.exit(1);
});
