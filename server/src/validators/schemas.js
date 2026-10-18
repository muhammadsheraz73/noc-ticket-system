import { z } from 'zod';
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  INVOICE_STATUSES,
  QUOTATION_STATUSES,
  FIELD_TEAM_KINDS,
  DEVICE_TYPES,
  CONNECTION_TYPES,
  CUSTOMER_TYPES,
  normalizeCustomerType,
  CUSTOMER_STATUSES,
  INVENTORY_UNITS,
  STOCK_MOVEMENT_TYPES,
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_PATTERN,
} from '../utils/constants.js';

const trimmed = (max = 250) => z.string().trim().max(max);
const requiredText = (label, max = 250) =>
  z.string({ required_error: `${label} is required` }).trim().min(1, `${label} is required`).max(max);
const optionalText = (max = 250) => trimmed(max).optional().default('');

const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id')
  .optional()
  .or(z.literal(''))
  .transform((v) => (v ? v : undefined));

const username = z
  .string({ required_error: 'Username is required' })
  .trim()
  .toLowerCase()
  .min(USERNAME_MIN, `Username must be at least ${USERNAME_MIN} characters`)
  .max(USERNAME_MAX, `Username must be at most ${USERNAME_MAX} characters`)
  .regex(USERNAME_PATTERN, 'Use letters, digits, dot, underscore or hyphen only');

const password = z.string().min(8, 'Password must be at least 8 characters');

// ---------------------------------------------------------------- auth
/**
 * Sign in with either the username or the email. `email`/`username` are still
 * accepted as the field name so existing clients (the agent) keep working.
 */
export const loginSchema = z
  .object({
    identifier: z.string().trim().optional(),
    email: z.string().trim().optional(),
    username: z.string().trim().optional(),
    password: z.string().min(1, 'Password is required'),
  })
  .transform((body) => ({
    identifier: (body.identifier || body.email || body.username || '').toLowerCase(),
    password: body.password,
  }))
  .refine((body) => body.identifier.length > 0, {
    message: 'Username or email is required',
    path: ['identifier'],
  });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

/**
 * Every login belongs to one client and has full access to that client's data,
 * so there is no role to pick. Only the panel owner creates logins.
 */
export const createUserSchema = z.object({
  tenant: z
    .string({ required_error: 'Client is required' })
    .regex(/^[0-9a-fA-F]{24}$/, 'Select a client'),
  name: requiredText('Name'),
  username,
  email: z.string().trim().toLowerCase().email('A valid email address is required'),
  password,
  phone: optionalText(40),
  isActive: z.boolean().optional().default(true),
});

// A login never moves between clients, so `tenant` is not editable.
export const updateUserSchema = createUserSchema
  .partial()
  .omit({ password: true, tenant: true })
  .extend({ password: password.optional() });

const hexColor = z.string().refine((v) => v === '' || /^#[0-9a-fA-F]{6}$/.test(v), 'Colour must look like #1a56db');

/** A PNG/JPEG data URL of at most ~500 KB, or '' to remove the logo. */
const logoDataUrl = z
  .string()
  .max(700_000, 'Logo is too large — keep it under 500 KB')
  .refine((v) => v === '' || /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v), 'Logo must be a PNG or JPG image');

/** The letterhead a client prints on its quotations. */
const letterheadFields = {
  phone: optionalText(40),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid email address').max(160)]).optional().default(''),
  address: optionalText(300),
  website: optionalText(160),
  logo: logoDataUrl.optional(),
  quotationTerms: optionalText(3000),
};

export const tenantSchema = z.object({
  name: requiredText('Company name', 120),
  contactName: optionalText(120),
  notes: optionalText(1000),
  themeColor: hexColor.optional().default(''),
  isActive: z.boolean().optional().default(true),
  ...letterheadFields,
});

/** What a client's own admin may change about their company (not name, colour or status). */
export const companyProfileSchema = z.object({ contactName: optionalText(120), ...letterheadFields }).partial();

export const tenantUpdateSchema = tenantSchema.partial();

/** Admin-issued password reset — no current password, the admin is the authority. */
export const resetPasswordSchema = z.object({ password });

// ------------------------------------------------------------ customers
export const customerSchema = z.object({
  /** Blank on create = the server assigns the next Customer ID. */
  customerReferenceNumber: optionalText(60),
  name: requiredText('Customer Name', 160),
  address: requiredText('Address', 400),
  connectedFrom: requiredText('Connected From', 160),
  type: requiredText('Type', 20)
    .transform(normalizeCustomerType)
    .refine((v) => CUSTOMER_TYPES.includes(v), { message: `Type must be ${CUSTOMER_TYPES.join(' or ')}` }),
  status: z.enum(CUSTOMER_STATUSES).default('Active'),
  contactNumber: requiredText('Contact Number', 60),
  location: optionalText(500),
  bandwidth: optionalText(40),
  destinationPort: optionalText(120),
  sourcePort: optionalText(120),
  vlan: optionalText(60),
  notes: optionalText(1000),
});

export const customerUpdateSchema = customerSchema
  .extend({ customerReferenceNumber: requiredText('Customer Reference Number', 60) })
  .partial();

export const importCommitSchema = z.object({
  rows: z.array(z.record(z.any())).min(1, 'No rows to import').max(20000),
  mapping: z.record(z.string()),
  duplicateStrategy: z.enum(['skip', 'update']).default('skip'),
});

export const importPreviewSchema = z.object({
  rows: z.array(z.record(z.any())).min(1).max(20000),
  mapping: z.record(z.string()),
});

// -------------------------------------------------------------- tickets
export const createTicketSchema = z.object({
  customerId: requiredText('Customer', 60),
  issueType: requiredText('Issue Type', 80),
  remarks: optionalText(2000),
  priority: z.enum(TICKET_PRIORITIES).default('Medium'),
  status: z.enum(['In Progress']).default('In Progress'),
  ettrMinutes: z.coerce.number().int().min(5, 'ETTR must be at least 5 minutes').max(20160).default(60),
  assignedTo: objectId,
  assignedHelper: objectId,
  runAiAnalysis: z.boolean().optional().default(true),
});

export const updateTicketSchema = z.object({
  issueType: trimmed(80).optional(),
  remarks: trimmed(2000).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  status: z.enum(TICKET_STATUSES).optional(),
  ettrMinutes: z.coerce.number().int().min(5).max(20160).optional(),
  note: optionalText(500),
});

export const assignTicketSchema = z.object({
  assignedTo: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Select a valid field team or member'),
  assignedHelper: objectId,
  note: optionalText(500),
});

export const resolveTicketSchema = z.object({
  resolutionRemarks: requiredText('Resolution remarks', 2000),
  status: z.enum(['Resolved', 'Closed']).default('Resolved'),
});

// ------------------------------------------------------------- invoices
const invoiceItemSchema = z.object({
  description: requiredText('Item description', 300),
  quantity: z.coerce.number().min(0).max(1_000_000),
  rate: z.coerce.number().min(0).max(1_000_000_000),
});

export const createInvoiceSchema = z.object({
  ticketNumber: z.coerce.number({ required_error: 'Ticket ID is required' }).int().positive(),
  items: z.array(invoiceItemSchema).min(1, 'At least one line item is required').max(100),
  issueDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  discountType: z.enum(['none', 'percent', 'amount']).default('none'),
  discountValue: z.coerce.number().min(0).default(0),
  taxPercent: z.coerce.number().min(0).max(100).default(0),
  withholdingTaxPercent: z.coerce.number().min(0).max(100).default(0),
  status: z.enum(INVOICE_STATUSES).default('Draft'),
  notes: optionalText(1000),
});

export const updateInvoiceSchema = createInvoiceSchema.partial().omit({ ticketNumber: true });

// ----------------------------------------------------------- quotations
const quotationItemSchema = z.object({
  description: requiredText('Item description', 500),
  quantity: z.coerce.number().min(0).max(1_000_000),
  unit: optionalText(20),
  rate: z.coerce.number().min(0).max(1_000_000_000),
});

export const quotationSchema = z.object({
  /** Optional link to an existing customer; the "To" block is always stored as entered. */
  customer: objectId,
  clientName: requiredText('Client name', 160),
  clientCompany: optionalText(160),
  clientAddress: optionalText(400),
  clientPhone: optionalText(60),
  clientEmail: optionalText(160),
  subject: optionalText(200),
  issueDate: z.coerce.date().optional(),
  validUntil: z.coerce.date().optional(),
  items: z.array(quotationItemSchema).min(1, 'At least one line item is required').max(200),
  discountType: z.enum(['none', 'percent', 'amount']).default('none'),
  discountValue: z.coerce.number().min(0).default(0),
  taxPercent: z.coerce.number().min(0).max(100).default(0),
  status: z.enum(QUOTATION_STATUSES).default('Draft'),
  notes: optionalText(2000),
  terms: optionalText(3000),
});

export const quotationUpdateSchema = quotationSchema.partial();

export const quotationStatusSchema = z.object({ status: z.enum(QUOTATION_STATUSES) });

export const updateInvoiceStatusSchema = z.object({
  status: z.enum(INVOICE_STATUSES),
});

// ----------------------------------------------------------- field team
export const fieldTeamSchema = z.object({
  name: requiredText('Name', 120),
  kind: z.enum(FIELD_TEAM_KINDS).default('member'),
  team: objectId,
  phone: optionalText(40),
  email: trimmed(160).optional().default(''),
  area: optionalText(120),
  user: objectId,
  isActive: z.boolean().optional().default(true),
  notes: optionalText(500),
});

export const fieldTeamUpdateSchema = fieldTeamSchema.partial();

// ------------------------------------------------------ network inventory
export const popSchema = z.object({
  code: requiredText('POP code', 40).transform((v) => v.toUpperCase()),
  name: requiredText('POP name', 160),
  address: optionalText(300),
  location: optionalText(400),
  notes: optionalText(500),
  isActive: z.boolean().optional().default(true),
});

export const deviceSchema = z.object({
  name: requiredText('Device name', 160),
  deviceType: z.enum(DEVICE_TYPES).default('Switch'),
  pop: objectId,
  vendor: optionalText(80),
  model: optionalText(120),
  managementIp: optionalText(60),
  serialNumber: optionalText(120),
  ports: z
    .array(
      z.object({
        name: requiredText('Port name', 80),
        portType: optionalText(60),
        speed: optionalText(40),
        sfpType: optionalText(60),
        status: z.enum(['Free', 'In Use', 'Faulty', 'Reserved']).default('Free'),
        notes: optionalText(200),
      }),
    )
    .optional()
    .default([]),
  notes: optionalText(500),
  isActive: z.boolean().optional().default(true),
});

export const connectionSchema = z.object({
  label: optionalText(160),
  sourceDevice: objectId,
  sourcePort: optionalText(120),
  destinationDevice: objectId,
  destinationPort: optionalText(120),
  vlan: optionalText(60),
  connectionType: z.enum(CONNECTION_TYPES).default('Fiber'),
  sfpSpeed: optionalText(40),
  sfpType: optionalText(60),
  ponPort: optionalText(80),
  customer: objectId,
  status: z.enum(['Active', 'Down', 'Planned', 'Decommissioned']).default('Active'),
  notes: optionalText(500),
});

export const vlanSchema = z.object({
  vlanId: z.coerce.number().int().min(1).max(4094),
  name: requiredText('VLAN name', 120),
  description: optionalText(400),
  pop: objectId,
  subnet: optionalText(60),
  isActive: z.boolean().optional().default(true),
});

// ------------------------------------------------------------ inventory
const amount = z.coerce.number().min(0, 'Cannot be negative').max(1e9);

export const inventoryItemSchema = z.object({
  sku: requiredText('SKU', 60).transform((v) => v.toUpperCase()),
  name: requiredText('Item name', 160),
  category: optionalText(80),
  unit: z.enum(INVENTORY_UNITS).default('pcs'),
  /** Opening stock on create only — later changes go through stock movements. */
  quantity: amount.default(0),
  minStock: amount.default(0),
  costPrice: amount.default(0),
  salePrice: amount.default(0),
  location: optionalText(120),
  supplier: optionalText(120),
  notes: optionalText(500),
  isActive: z.boolean().optional().default(true),
});

export const inventoryItemUpdateSchema = inventoryItemSchema.omit({ quantity: true }).partial();

export const stockMovementSchema = z
  .object({
    type: z.enum(STOCK_MOVEMENT_TYPES),
    quantity: amount,
    note: optionalText(300),
  })
  .refine((body) => body.type === 'adjust' || body.quantity > 0, {
    message: 'Quantity must be more than 0',
    path: ['quantity'],
  });

export const issueTypeSchema = z.object({
  name: requiredText('Issue type name', 80),
  description: optionalText(300),
  defaultEttrMinutes: z.coerce.number().int().min(5).max(20160).default(60),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().default(100),
});
