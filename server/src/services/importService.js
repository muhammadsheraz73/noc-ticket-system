import xlsx from 'xlsx';
import Customer from '../models/Customer.js';
import ApiError from '../utils/ApiError.js';
import { CUSTOMER_TYPES } from '../utils/constants.js';

/** Customer fields an Excel column can be mapped onto. */
export const IMPORTABLE_FIELDS = [
  { field: 'customerReferenceNumber', label: 'Customer Reference Number', required: true },
  { field: 'name', label: 'Customer Name', required: true },
  { field: 'address', label: 'Address', required: true },
  { field: 'connectedFrom', label: 'Connected From', required: true },
  { field: 'type', label: 'Type (PUM/PMB/COR)', required: true },
  { field: 'contactNumber', label: 'Contact Number', required: true },
  { field: 'location', label: 'Location (Maps URL)', required: false },
  { field: 'destinationPort', label: 'Destination Port', required: false },
  { field: 'sourcePort', label: 'Source Port', required: false },
  { field: 'vlan', label: 'VLAN', required: false },
  { field: 'notes', label: 'Notes', required: false },
];

/** Header aliases used to guess a mapping automatically. */
const HEADER_HINTS = {
  customerReferenceNumber: ['customer reference number', 'customer ref', 'customer id', 'cust id', 'ref no', 'reference', 'id'],
  name: ['customer name', 'name', 'site name', 'site', 'customer'],
  address: ['address', 'site address', 'location address'],
  connectedFrom: ['connected from', 'pop', 'source pop', 'connected', 'from'],
  type: ['type', 'customer type', 'connection type', 'pum/pmb/cor'],
  contactNumber: ['contact number', 'contact', 'contact #', 'phone', 'mobile', 'cell'],
  location: ['location', 'maps', 'google maps', 'map link', 'coordinates', 'geo'],
  destinationPort: ['destination port', 'dest port', 'dst port', 'destination'],
  sourcePort: ['source port', 'src port', 'src', 'olt port'],
  vlan: ['vlan', 'vlan id', 'service vlan'],
  notes: ['notes', 'remarks', 'comment', 'description'],
};

const normalizeHeader = (value) => String(value ?? '').trim().toLowerCase().replace(/[\s_.#-]+/g, ' ');

/** Read a workbook buffer into `{ headers, rows }`. */
export function parseWorkbook(buffer) {
  let workbook;
  try {
    workbook = xlsx.read(buffer, { type: 'buffer', cellDates: true });
  } catch {
    throw ApiError.badRequest('The uploaded file could not be read as a spreadsheet');
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw ApiError.badRequest('The uploaded workbook has no sheets');

  const sheet = workbook.Sheets[sheetName];
  const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
  if (!matrix.length) throw ApiError.badRequest('The first sheet of the workbook is empty');

  const headers = matrix[0].map((h, index) => String(h ?? '').trim() || `Column ${index + 1}`);
  const rows = matrix.slice(1).map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = row[index] === undefined || row[index] === null ? '' : String(row[index]).trim();
    });
    return record;
  });

  return { sheetName, sheetNames: workbook.SheetNames, headers, rows };
}

/** Best-effort automatic column ➜ field mapping, shown to the user for confirmation. */
export function suggestMapping(headers) {
  const mapping = {};
  const used = new Set();

  for (const { field } of IMPORTABLE_FIELDS) {
    const hints = HEADER_HINTS[field] || [];
    const match = headers.find((header) => {
      if (used.has(header)) return false;
      const normalized = normalizeHeader(header);
      return hints.some((hint) => normalized === hint) || hints.some((hint) => normalized.includes(hint));
    });
    if (match) {
      mapping[field] = match;
      used.add(match);
    }
  }

  return mapping;
}

function applyMapping(row, mapping) {
  const record = {};
  for (const { field } of IMPORTABLE_FIELDS) {
    const column = mapping[field];
    record[field] = column ? String(row[column] ?? '').trim() : '';
  }
  if (record.type) record.type = record.type.toUpperCase();
  return record;
}

/**
 * Validate every mapped row and classify it.
 *
 * Nothing is written here — this powers both the preview step and the
 * dry-run half of the real import.
 */
export async function validateRows(rows, mapping) {
  const mapped = rows.map((row, index) => ({ rowNumber: index + 2, data: applyMapping(row, mapping) }));

  const refs = mapped.map((r) => r.data.customerReferenceNumber).filter(Boolean);
  const existing = await Customer.find({ customerReferenceNumber: { $in: refs } })
    .select('customerReferenceNumber name isDeleted')
    .lean();
  const existingByRef = new Map(existing.map((c) => [c.customerReferenceNumber, c]));

  const seenInFile = new Map();
  const results = [];

  for (const entry of mapped) {
    const { data, rowNumber } = entry;
    const errors = [];

    for (const { field, label, required } of IMPORTABLE_FIELDS) {
      if (required && !data[field]) errors.push(`${label} is required`);
    }

    if (data.type && !CUSTOMER_TYPES.includes(data.type)) {
      errors.push(`Type must be one of ${CUSTOMER_TYPES.join(', ')} (found "${data.type}")`);
    }

    let status = 'new';
    if (errors.length) {
      status = 'invalid';
    } else if (seenInFile.has(data.customerReferenceNumber)) {
      status = 'duplicate_in_file';
      errors.push(`Duplicate of row ${seenInFile.get(data.customerReferenceNumber)} in this file`);
    } else if (existingByRef.has(data.customerReferenceNumber)) {
      status = 'existing';
    }

    if (data.customerReferenceNumber && !seenInFile.has(data.customerReferenceNumber)) {
      seenInFile.set(data.customerReferenceNumber, rowNumber);
    }

    results.push({
      rowNumber,
      status,
      errors,
      data,
      existing: existingByRef.get(data.customerReferenceNumber) || null,
    });
  }

  return {
    rows: results,
    summary: {
      total: results.length,
      new: results.filter((r) => r.status === 'new').length,
      existing: results.filter((r) => r.status === 'existing').length,
      duplicateInFile: results.filter((r) => r.status === 'duplicate_in_file').length,
      invalid: results.filter((r) => r.status === 'invalid').length,
    },
  };
}

/**
 * Perform the import.
 *
 * Existing customers are NEVER overwritten silently: they are skipped unless
 * the operator explicitly chooses `duplicateStrategy: 'update'`.
 *
 * @param {'skip'|'update'} duplicateStrategy
 */
export async function importRows({ rows, mapping, duplicateStrategy = 'skip', user }) {
  const validation = await validateRows(rows, mapping);

  const report = {
    imported: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  for (const row of validation.rows) {
    if (row.status === 'invalid') {
      report.failed += 1;
      report.details.push({
        rowNumber: row.rowNumber,
        reference: row.data.customerReferenceNumber || '(missing)',
        outcome: 'failed',
        message: row.errors.join('; '),
      });
      continue;
    }

    if (row.status === 'duplicate_in_file') {
      report.skipped += 1;
      report.details.push({
        rowNumber: row.rowNumber,
        reference: row.data.customerReferenceNumber,
        outcome: 'skipped',
        message: row.errors.join('; '),
      });
      continue;
    }

    if (row.status === 'existing' && duplicateStrategy !== 'update') {
      report.skipped += 1;
      report.details.push({
        rowNumber: row.rowNumber,
        reference: row.data.customerReferenceNumber,
        outcome: 'skipped',
        message: 'Customer already exists — kept the existing record',
      });
      continue;
    }

    try {
      if (row.status === 'existing') {
        await Customer.updateOne(
          { customerReferenceNumber: row.data.customerReferenceNumber },
          { $set: { ...row.data, updatedBy: user?._id } },
        );
        report.updated += 1;
        report.details.push({
          rowNumber: row.rowNumber,
          reference: row.data.customerReferenceNumber,
          outcome: 'updated',
          message: 'Existing customer updated from file',
        });
      } else {
        await Customer.create({ ...row.data, createdBy: user?._id });
        report.imported += 1;
        report.details.push({
          rowNumber: row.rowNumber,
          reference: row.data.customerReferenceNumber,
          outcome: 'imported',
          message: 'New customer created',
        });
      }
    } catch (error) {
      report.failed += 1;
      report.details.push({
        rowNumber: row.rowNumber,
        reference: row.data.customerReferenceNumber,
        outcome: 'failed',
        message: error.code === 11000 ? 'Customer Reference Number already exists' : error.message,
      });
    }
  }

  return { report, summary: validation.summary };
}

/** A ready-to-fill import template. */
export function buildTemplateWorkbook() {
  const headers = IMPORTABLE_FIELDS.map((f) => f.label);
  const example = [
    '10255',
    'Abdul Rouf',
    'Shahid Town, Gajjumata, Lahore',
    'Gajjumata Pop',
    'PUM',
    '0333-4458420',
    'https://maps.app.goo.gl/EXwFUHbbik4spH5s8',
    'GE0/0/1',
    'GPON0/1/3',
    '613',
    'Primary residential link',
  ];

  const sheet = xlsx.utils.aoa_to_sheet([headers, example]);
  sheet['!cols'] = headers.map(() => ({ wch: 26 }));

  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, sheet, 'Customers');
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
