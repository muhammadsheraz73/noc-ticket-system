import multer from 'multer';
import ApiError from '../utils/ApiError.js';

const ALLOWED_EXTENSIONS = /\.(xlsx|xls|csv)$/i;

/** In-memory upload of a single spreadsheet, capped at 10 MB. */
export const uploadSpreadsheet = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    if (!ALLOWED_EXTENSIONS.test(file.originalname)) {
      return cb(ApiError.badRequest('Only .xlsx, .xls or .csv files can be imported'));
    }
    return cb(null, true);
  },
}).single('file');

export default uploadSpreadsheet;
