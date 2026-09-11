import { z } from 'zod';
import {
  ROLE_VALUES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  INVOICE_STATUSES,
  FIELD_TEAM_KINDS,
  DEVICE_TYPES,
  CONNECTION_TYPES,
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

export const createUserSchema = z.object({
  name: requiredText('Name'),
  username,
  email: z.string().trim().toLowerCase().email('A valid email address is required'),
  password,
  role: z.enum(ROLE_VALUES, { errorMap: () => ({ message: 'Invalid role' }) }),
  phone: optionalText(40),
  isActive: z.boolean().optional().default(true),
});

export const updateUserSchema = createUserSchema
  .partial()
  .omit({ password: true })
  .extend({ password: password.optional() });

/** Admin-issued password reset — no current password, the admin is the authority. */
export const resetPasswordSchema = z.object({ password });

// ------------------------------------------------------------ customers
export const customerSchema = z.object({
  customerReferenceNumber: requiredText('Customer Reference Number', 60),
  name: requiredText('Customer Name', 160),
  address: requiredText('Address', 400),
  connectedFrom: requiredText('Connected From', 160),
  type: requiredText('Type', 20).transform((v) => v.toUpperCase()),
  contactNumber: requiredText('Contact Number', 60),
  location: optionalText(500),
  destinationPort: optionalText(120),
  sourcePort: optionalText(120),
  vlan: optionalText(60),
  notes: optionalText(1000),
});

export const customerUpdateSchema = customerSchema.partial();

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
  status: z.enum(TICKET_STATUSES).default('New'),
  ettrMinutes: z.coerce.number().int().min(5, 'ETTR must be at least 5 minutes').max(20160).default(60),
  assignedTo: objectId,
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
  status: z.enum(INVOICE_STATUSES).default('Draft'),
  notes: optionalText(1000),
});

export const updateInvoiceSchema = createInvoiceSchema.partial().omit({ ticketNumber: true });

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

export const issueTypeSchema = z.object({
  name: requiredText('Issue type name', 80),
  description: optionalText(300),
  defaultEttrMinutes: z.coerce.number().int().min(5).max(20160).default(60),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().default(100),
});
