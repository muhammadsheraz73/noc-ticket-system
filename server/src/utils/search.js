/** Escape a user-supplied string so it is safe inside a RegExp. */
export function escapeRegex(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive "contains" matcher built from untrusted input. */
export function containsRegex(input) {
  return new RegExp(escapeRegex(String(input).trim()), 'i');
}

/** Parse `page`/`limit` query params into safe skip/limit values. */
export function parsePagination(query = {}, { defaultLimit = 25, maxLimit = 200 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

/** Turn a `sort` query param such as `-createdAt` into a Mongoose sort object. */
export function parseSort(sort, fallback = { createdAt: -1 }, allowed = null) {
  if (!sort) return fallback;
  const result = {};
  for (const token of String(sort).split(',')) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const direction = trimmed.startsWith('-') ? -1 : 1;
    const field = trimmed.replace(/^[-+]/, '');
    if (allowed && !allowed.includes(field)) continue;
    result[field] = direction;
  }
  return Object.keys(result).length ? result : fallback;
}
