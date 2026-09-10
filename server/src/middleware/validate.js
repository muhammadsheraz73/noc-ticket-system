import ApiError from '../utils/ApiError.js';

/**
 * Validate and *replace* a request segment with the parsed Zod output, so
 * handlers only ever see sanitized, correctly typed data.
 *
 * @param {import('zod').ZodTypeAny} schema
 * @param {'body'|'query'|'params'} source
 */
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || source,
        message: issue.message,
      }));
      return next(ApiError.badRequest('Validation failed', details));
    }

    if (source === 'query') {
      // Express 4 exposes req.query as a getter-only object on some versions.
      Object.defineProperty(req, 'validatedQuery', { value: result.data, writable: true });
    } else {
      req[source] = result.data;
    }
    return next();
  };
}

export default validate;
