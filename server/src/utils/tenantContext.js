import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The client (tenant) the current request belongs to.
 *
 * `requireAuth` opens this scope for every authenticated request, and the
 * tenant-scope plugin (models/plugins/tenantScope.js) reads it so that every
 * query, update, delete, aggregate and create is confined to that client —
 * individual routes never have to remember a tenant filter.
 */
const storage = new AsyncLocalStorage();

/** Run `fn` with `tenantId` as the active client. */
export function runWithTenant(tenantId, fn) {
  return storage.run({ tenantId: tenantId ? String(tenantId) : null }, fn);
}

/** The active client's id, or null outside a tenant scope (scripts, owner). */
export function getTenantId() {
  return storage.getStore()?.tenantId || null;
}

/**
 * Make `tenantId` the active client for the rest of the current async flow.
 * For one-off scripts (seed, migration) that are not behind a request.
 */
export function enterTenant(tenantId) {
  storage.enterWith({ tenantId: tenantId ? String(tenantId) : null });
}
