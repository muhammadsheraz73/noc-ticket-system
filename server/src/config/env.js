import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

/** server/ root directory (…/server) */
export const SERVER_ROOT = path.resolve(here, '..', '..');

dotenv.config({ path: path.join(SERVER_ROOT, '.env') });

const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
};

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const list = (value, fallback) =>
  (value ? String(value) : fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: int(process.env.PORT, 5000),

  mongoUri: process.env.MONGODB_URI || '',
  useEmbeddedMongo: bool(process.env.USE_EMBEDDED_MONGO, true),
  embeddedMongoPort: int(process.env.EMBEDDED_MONGO_PORT, 27018),
  embeddedMongoPath: path.join(SERVER_ROOT, '.data', 'mongo'),

  jwtSecret: process.env.JWT_SECRET || 'noc-dev-only-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  bcryptRounds: int(process.env.BCRYPT_ROUNDS, 10),

  timezone: process.env.APP_TIMEZONE || 'Asia/Karachi',
  ticketNumberStart: int(process.env.TICKET_NUMBER_START, 4626),

  company: {
    name: process.env.COMPANY_NAME || 'NOC Network Services',
    address: process.env.COMPANY_ADDRESS || 'Gajjumata, Lahore, Pakistan',
    phone: process.env.COMPANY_PHONE || '0333-4458420',
    email: process.env.COMPANY_EMAIL || 'billing@noc-network.local',
  },
  invoice: {
    currency: process.env.INVOICE_CURRENCY || 'PKR',
    dueDays: int(process.env.INVOICE_DUE_DAYS, 15),
    taxPercent: Number(process.env.INVOICE_TAX_PERCENT || 0),
  },

  corsOrigins: list(process.env.CORS_ORIGINS, 'http://localhost:5173,http://127.0.0.1:5173'),

  ai: {
    enabled: bool(process.env.AI_ENABLED, true),
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.AI_MODEL || 'claude-opus-5',
    timeoutMs: int(process.env.AI_TIMEOUT_MS, 30000),
  },

  seed: {
    adminEmail: process.env.SEED_ADMIN_EMAIL || 'admin@noc.local',
    adminPassword: process.env.SEED_ADMIN_PASSWORD || 'Admin@123',
  },
};

if (env.isProduction && env.jwtSecret === 'noc-dev-only-secret-change-me') {
  throw new Error('JWT_SECRET must be set to a strong value when NODE_ENV=production');
}

export default env;
