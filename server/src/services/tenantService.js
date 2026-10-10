import IssueType from '../models/IssueType.js';
import { DEFAULT_ISSUE_TYPES } from '../utils/constants.js';

/** A brand-new client starts with the standard issue types already in place. */
export async function seedTenantDefaults(tenantId) {
  await IssueType.insertMany(
    DEFAULT_ISSUE_TYPES.map((name, index) => ({
      tenant: tenantId,
      name,
      sortOrder: index * 10,
      defaultEttrMinutes: name === 'Fiber Cut' ? 60 : 120,
      isActive: true,
    })),
  );
}

export default seedTenantDefaults;
