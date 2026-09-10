import AuditLog from '../models/AuditLog.js';
import logger from './logger.js';

/**
 * Record an important change. Audit writes must never break the request that
 * triggered them, so failures are logged and swallowed.
 */
export async function recordAudit({
  req,
  action,
  entityType,
  entityId,
  entityLabel,
  before,
  after,
  meta,
}) {
  try {
    await AuditLog.create({
      actor: req?.user?._id,
      actorName: req?.user?.name || 'system',
      actorRole: req?.user?.role || 'system',
      action,
      entityType,
      entityId: entityId ? String(entityId) : undefined,
      entityLabel,
      before: sanitize(before),
      after: sanitize(after),
      meta,
      ip: req?.ip,
    });
  } catch (error) {
    logger.error('Failed to write audit log:', error.message);
  }
}

function sanitize(value) {
  if (!value) return undefined;
  const plain = typeof value.toObject === 'function' ? value.toObject() : { ...value };
  delete plain.passwordHash;
  delete plain.__v;
  return plain;
}

export default recordAudit;
