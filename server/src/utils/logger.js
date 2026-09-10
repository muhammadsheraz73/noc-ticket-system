const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const write = (stream, level, args) => {
  stream(`[${stamp()}] ${level}`, ...args);
};

const logger = {
  info: (...args) => write(console.log, 'INFO ', args),
  warn: (...args) => write(console.warn, 'WARN ', args),
  error: (...args) => write(console.error, 'ERROR', args),
  debug: (...args) => {
    if (process.env.NODE_ENV !== 'production') write(console.log, 'DEBUG', args);
  },
};

export default logger;
