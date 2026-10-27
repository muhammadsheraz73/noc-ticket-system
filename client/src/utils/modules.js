import { ROLES } from '../context/AuthContext.jsx';

/**
 * Panel features the owner can lock (keys match MODULES on the server), in
 * menu order, with the page each one opens and who has it at all.
 */
export const MODULES = [
  { key: 'dashboard', label: 'Dashboard', path: '/', hint: 'Home screen', roles: [ROLES.ADMIN, ROLES.NOC_OPERATOR, ROLES.FIELD_ENGINEER, ROLES.ACCOUNTS] },
  { key: 'tickets', label: 'Tickets', path: '/tickets', hint: 'Complaints, ETTR, AI assistant', roles: [ROLES.ADMIN, ROLES.NOC_OPERATOR, ROLES.FIELD_ENGINEER] },
  { key: 'customers', label: 'Customers', path: '/customers', hint: 'Add and edit customers', roles: [ROLES.ADMIN, ROLES.NOC_OPERATOR] },
  { key: 'billing', label: 'Billing', path: '/billing', hint: 'Monthly bills and slips (billing team)', roles: [ROLES.ACCOUNTS] },
  { key: 'invoices', label: 'Invoices', path: '/invoices', hint: 'Invoices from tickets', roles: [ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NOC_OPERATOR, ROLES.FIELD_ENGINEER] },
  { key: 'quotations', label: 'Quotations', path: '/quotations', hint: 'Quotations and their PDFs', roles: [ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NOC_OPERATOR] },
  { key: 'employees', label: 'Employees', path: '/employees', hint: 'Field team members', roles: [ROLES.ADMIN, ROLES.NOC_OPERATOR] },
  { key: 'inventory', label: 'Inventory', path: '/inventory', hint: 'Stock and network devices', roles: [ROLES.ADMIN, ROLES.NOC_OPERATOR] },
  { key: 'import', label: 'Import Excel', path: '/customers/import', hint: 'Bulk customer import', roles: [ROLES.ADMIN, ROLES.NOC_OPERATOR] },
  { key: 'team', label: 'Billing Team', path: '/team', hint: 'Create billing logins', roles: [ROLES.ADMIN] },
];

export const MODULE_LABELS = Object.fromEntries(MODULES.map((m) => [m.key, m.label]));

/** First page this login can actually open — where to send them when the dashboard is locked. */
export function firstOpenPath(user) {
  const locked = user?.lockedModules || [];
  const open = MODULES.find((m) => m.key !== 'dashboard' && m.roles.includes(user?.role) && !locked.includes(m.key));
  return open ? open.path : '/settings';
}

/**
 * Ready-made packages (keys and locks match PLANS on the server). Picking one
 * sets its switches; changing a switch by hand makes the client "Custom".
 */
export const PLANS = [
  { key: 'basic', label: 'Basic', blurb: 'Tickets, customers and employees', locked: ['billing', 'invoices', 'quotations', 'inventory', 'team'] },
  { key: 'standard', label: 'Standard', blurb: 'Basic + billing, invoices and billing team', locked: ['quotations', 'inventory'] },
  { key: 'premium', label: 'Premium', blurb: 'Everything, including quotations and inventory', locked: [] },
];

export const PLAN_LABELS = { ...Object.fromEntries(PLANS.map((p) => [p.key, p.label])), custom: 'Custom' };

