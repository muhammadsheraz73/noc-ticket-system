import mongoose from 'mongoose';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import env from '../config/env.js';

export function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

/** Centralized error handler — every route funnels through here. */
export function errorHandler(err, _req, res, _next) {
  let status = err.status || 500;
  let message = err.message || 'Internal server error';
  let details = err.details;

  if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    message = 'Validation failed';
    details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    message = `Invalid value for "${err.path}"`;
  } else if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    message = `A record with this ${field} already exists`;
    details = [{ field, message: 'Must be unique' }];
  } else if (err.code === 'LIMIT_FILE_SIZE') {
    status = 400;
    message = 'Uploaded file is too large';
  }

  if (status >= 500) {
    logger.error(err.stack || err.message);
  }

  res.status(status).json({
    success: false,
    message,
    ...(details ? { details } : {}),
    ...(env.isProduction ? {} : { stack: status >= 500 ? err.stack : undefined }),
  });
}
