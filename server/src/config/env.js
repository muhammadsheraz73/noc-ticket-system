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

const DEFAULT_MODELS = {
  openrouter: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  anthropic: 'claude-opus-5',
};

/**
 * OpenRouter keys are `sk-or-v1-` followed by 64 hex characters. Keys are often
 * copied without that prefix, which fails as an opaque 401, so add it back.
 */
const normalizeOpenRouterKey = (value) => {
  const key = String(value || '').trim();
  if (!key || key.startsWith('sk-or-')) return key;
  return `sk-or-v1-${key}`;
};

/**
 * The AI assistant can run against OpenRouter (default when an OpenRouter key
 * is present) or directly against the Anthropic API. AI_PROVIDER forces one.
 */
function aiConfig() {
  const openrouterApiKey = normalizeOpenRouterKey(process.env.OPENROUTER_API_KEY);
  const anthropicApiKey = (process.env.ANTHROPIC_API_KEY || '').trim();

  const provider = (
    process.env.AI_PROVIDER || (openrouterApiKey ? 'openrouter' : 'anthropic')
  ).toLowerCase();

  return {
    enabled: bool(process.env.AI_ENABLED, true),
    provider,
    apiKey: provider === 'openrouter' ? openrouterApiKey : anthropicApiKey,
    keyName: provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'ANTHROPIC_API_KEY',
    model: process.env.AI_MODEL || DEFAULT_MODELS[provider] || DEFAULT_MODELS.anthropic,
    timeoutMs: int(process.env.AI_TIMEOUT_MS, 60000),
    openrouterBaseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    // Optional attribution shown on openrouter.ai activity pages.
    appUrl: process.env.APP_PUBLIC_URL || '',
    appName: process.env.COMPANY_NAME || 'NOC Ticket Management System',
  };
}

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

  ai: aiConfig(),

  seed: {
    adminUsername: (process.env.SEED_ADMIN_USERNAME || 'admin').toLowerCase(),
    adminEmail: process.env.SEED_ADMIN_EMAIL || 'admin@noc.local',
    adminPassword: process.env.SEED_ADMIN_PASSWORD || 'Admin@123',
  },
};

if (env.isProduction && env.jwtSecret === 'noc-dev-only-secret-change-me') {
  throw new Error('JWT_SECRET must be set to a strong value when NODE_ENV=production');
}

export default env;
