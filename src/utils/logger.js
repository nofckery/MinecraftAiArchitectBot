import fs from 'node:fs';
import path from 'node:path';

const LOG_DIR = path.resolve('data');
const LOG_FILE = path.join(LOG_DIR, 'bot.log');

try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch {
  // Ignore startup directory creation error if handled elsewhere
}

function timestamp() {
  return new Date().toISOString();
}

let diskWriteWarningShown = false;

function writeToFile(level, message, ...args) {
  try {
    const formattedArgs = args.length > 0 ? ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') : '';
    const line = `[${timestamp()}] [${level}] ${message}${formattedArgs}\n`;
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch (err) {
    if (!diskWriteWarningShown) {
      diskWriteWarningShown = true;
      console.warn(`\x1b[33m[WARN] Dateisystem-Schreibfehler bei '${LOG_FILE}': ${err.message}\x1b[0m`);
    }
  }
}

export const logger = {
  info(message, ...args) {
    console.log(`\x1b[36m[${timestamp()}] [INFO]\x1b[0m ${message}`, ...args);
    writeToFile('INFO', message, ...args);
  },
  warn(message, ...args) {
    console.warn(`\x1b[33m[${timestamp()}] [WARN]\x1b[0m ${message}`, ...args);
    writeToFile('WARN', message, ...args);
  },
  error(message, ...args) {
    console.error(`\x1b[31m[${timestamp()}] [ERROR]\x1b[0m ${message}`, ...args);
    writeToFile('ERROR', message, ...args);
  },
  debug(message, ...args) {
    if (process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development') {
      console.log(`\x1b[90m[${timestamp()}] [DEBUG]\x1b[0m ${message}`, ...args);
    }
    writeToFile('DEBUG', message, ...args);
  },
  build(message, ...args) {
    console.log(`\x1b[32m[${timestamp()}] [BUILD]\x1b[0m ${message}`, ...args);
    writeToFile('BUILD', message, ...args);
  }
};
