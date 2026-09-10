import fs from 'node:fs';
import mongoose from 'mongoose';
import env from './env.js';
import logger from '../utils/logger.js';

let embedded = null;

/** True on Vercel, AWS Lambda and similar function runtimes. */
export const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

/**
 * Survives module re-evaluation inside a warm serverless container, so a
 * container never opens more than one connection.
 */
const cache = (globalThis.__nocMongoose ??= { promise: null });

/**
 * Resolve the MongoDB connection string.
 *
 * Priority:
 *  1. MONGODB_URI from the environment (local mongod, Atlas, docker, …)
 *  2. An embedded MongoDB started in-process, persisted to server/.data/mongo
 *     so the machine needs no MongoDB installation at all.
 */
async function resolveUri() {
  if (env.mongoUri) {
    logger.info(`MongoDB: using MONGODB_URI (${maskUri(env.mongoUri)})`);
    return env.mongoUri;
  }

  if (!env.useEmbeddedMongo) {
    throw new Error(
      'MONGODB_URI is not set and USE_EMBEDDED_MONGO=false. Set one of them in server/.env.',
    );
  }

  // An embedded instance may already be running (e.g. the API server is up and
  // the seeder is being run in another terminal). Only one process can own the
  // data directory, so reuse the live instance instead of failing on its port.
  const running = `mongodb://127.0.0.1:${env.embeddedMongoPort}/noc_system`;
  if (await isReachable(running)) {
    logger.info(`MongoDB: reusing the embedded instance already running on port ${env.embeddedMongoPort}`);
    return running;
  }

  logger.warn('MongoDB: MONGODB_URI not set - starting embedded MongoDB instance.');
  logger.warn('MongoDB: first start downloads a mongod binary (~100 MB, one time only).');

  fs.mkdirSync(env.embeddedMongoPath, { recursive: true });

  const { MongoMemoryServer } = await import('mongodb-memory-server');
  embedded = await MongoMemoryServer.create({
    instance: {
      port: env.embeddedMongoPort,
      dbName: 'noc_system',
      dbPath: env.embeddedMongoPath,
      storageEngine: 'wiredTiger',
    },
  });

  const uri = embedded.getUri('noc_system');
  logger.info(`MongoDB: embedded instance ready on port ${env.embeddedMongoPort}`);
  logger.info(`MongoDB: data directory ${env.embeddedMongoPath}`);
  return uri;
}

function maskUri(uri) {
  return uri.replace(/\/\/([^:@/]+):([^@]+)@/, '//$1:****@');
}

/** Quick probe for a MongoDB that is already listening, without holding a connection. */
async function isReachable(uri) {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 1000 });
  try {
    await client.connect();
    await client.db().admin().command({ ping: 1 });
    return true;
  } catch {
    return false;
  } finally {
    await client.close().catch(() => {});
  }
}

export async function connectDatabase() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;

  // On a serverless platform many invocations share one warm container, and
  // several can race to connect at once. Caching the in-flight promise on
  // globalThis means they all await a single connection instead of opening one
  // each and exhausting the cluster's connection limit.
  if (cache.promise) return cache.promise;

  cache.promise = (async () => {
    mongoose.set('strictQuery', true);

    const uri = await resolveUri();
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 15000,
      // A serverless container needs only a handful of sockets; the default of
      // 100 per instance would quickly exhaust an Atlas M0 (500 total).
      maxPoolSize: IS_SERVERLESS ? 5 : 20,
      // Index building belongs to deploys and the seeder, not to every cold start.
      autoIndex: !IS_SERVERLESS,
    });

    logger.info(`MongoDB: connected to database "${mongoose.connection.name}"`);
    return mongoose.connection;
  })();

  try {
    return await cache.promise;
  } catch (error) {
    // Let the next request retry instead of caching a failed connection.
    cache.promise = null;
    throw error;
  }
}

/**
 * Force the storage engine to flush to disk.
 *
 * The embedded instance is stopped as soon as a short-lived process (the
 * seeder, a one-off script) finishes, which can be well before WiredTiger's
 * next automatic checkpoint — without this, the last writes of the run are
 * lost. Managed clusters reject `fsync`, so a failure here is not an error.
 */
export async function flushDatabase() {
  if (mongoose.connection.readyState !== 1) return;
  try {
    await mongoose.connection.db.admin().command({ fsync: 1 });
  } catch (error) {
    logger.debug(`fsync not available: ${error.message}`);
  }
}

export async function disconnectDatabase() {
  await flushDatabase();
  cache.promise = null;

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (embedded) {
    // `doCleanup: false` keeps the persisted data directory on disk.
    await embedded.stop({ doCleanup: false, force: false });
    embedded = null;
  }
}

export default connectDatabase;
