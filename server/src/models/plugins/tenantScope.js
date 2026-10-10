import mongoose from 'mongoose';
import { getTenantId } from '../../utils/tenantContext.js';

const QUERY_OPS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'countDocuments',
  'distinct',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
];

/**
 * Makes a model belong to a client.
 *
 * Adds a `tenant` field and, whenever a tenant scope is active (see
 * utils/tenantContext.js), confines reads, updates and deletes to that tenant
 * and stamps new documents with it. A tenant user therefore cannot read or
 * change another client's data even if a route forgets to filter.
 *
 * Outside a scope (seed/migration scripts) nothing is filtered.
 */
export default function tenantScope(schema) {
  schema.add({
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
  });

  schema.pre(QUERY_OPS, function scopeQuery() {
    const tenantId = getTenantId();
    if (tenantId) this.where({ tenant: tenantId });
  });

  schema.pre('aggregate', function scopeAggregate() {
    const tenantId = getTenantId();
    if (tenantId) {
      this.pipeline().unshift({ $match: { tenant: new mongoose.Types.ObjectId(tenantId) } });
    }
  });

  schema.pre('validate', function stampTenant() {
    const tenantId = getTenantId();
    if (tenantId && this.isNew) this.tenant = tenantId;
  });

  schema.pre('insertMany', function stampMany(next, docs) {
    const tenantId = getTenantId();
    if (tenantId && Array.isArray(docs)) {
      for (const doc of docs) doc.tenant = tenantId;
    }
    next();
  });
}
