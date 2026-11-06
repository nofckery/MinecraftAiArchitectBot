import fs from 'node:fs';
import path from 'node:path';

/**
 * Safely renames oldPath to newPath with retry logic for Windows NTFS collisions (EPERM, EBUSY, EACCES, EMFILE, ENFILE).
 * Uses exponential backoff with randomized jitter.
 *
 * @param {string} oldPath - Source temporary file path
 * @param {string} newPath - Target destination file path
 * @param {Object} [options]
 * @param {number} [options.maxRetries=10]
 * @param {number} [options.baseDelayMs=10]
 * @param {number} [options.maxDelayMs=300]
 * @returns {Promise<void>}
 */
export async function atomicRenameWithRetry(oldPath, newPath, options = {}) {
  const maxRetries = options.maxRetries ?? 10;
  const baseDelayMs = options.baseDelayMs ?? 10;
  const maxDelayMs = options.maxDelayMs ?? 300;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await fs.promises.rename(oldPath, newPath);
      return;
    } catch (err) {
      const isTransientFsError =
        err.code === 'EPERM' ||
        err.code === 'EBUSY' ||
        err.code === 'EACCES' ||
        err.code === 'EMFILE' ||
        err.code === 'ENFILE';

      if (!isTransientFsError || attempt >= maxRetries) {
        try {
          if (fs.existsSync(oldPath)) {
            await fs.promises.unlink(oldPath);
          }
        } catch (_) {}
        throw err;
      }

      const backoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
      const jitter = 0.5 + Math.random();
      const delay = Math.round(backoff * jitter);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Atomically writes data to filePath by writing to a temporary file in the same directory,
 * then atomically renaming with retry logic.
 *
 * @param {string} filePath - Target file destination
 * @param {string|Buffer} data - Data to write
 * @param {Object|string} [options] - Options or encoding
 * @returns {Promise<void>}
 */
export async function atomicWriteFileWithRetry(filePath, data, options = {}) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });

  const tempPath = `${filePath}.tmp.${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const encoding = typeof options === 'string' ? options : (options?.encoding ?? 'utf8');

  try {
    await fs.promises.writeFile(tempPath, data, encoding);
    await atomicRenameWithRetry(tempPath, filePath, typeof options === 'object' ? options : {});
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) {
        await fs.promises.unlink(tempPath);
      }
    } catch (_) {}
    throw err;
  }
}

/**
 * Synchronously renames oldPath to newPath with retry loop for Windows file locking.
 *
 * @param {string} oldPath - Source temporary file path
 * @param {string} newPath - Target destination file path
 * @param {Object} [options]
 * @param {number} [options.maxRetries=10]
 * @param {number} [options.baseDelayMs=10]
 * @param {number} [options.maxDelayMs=300]
 */
export function atomicRenameWithRetrySync(oldPath, newPath, options = {}) {
  const maxRetries = options.maxRetries ?? 10;
  const baseDelayMs = options.baseDelayMs ?? 10;
  const maxDelayMs = options.maxDelayMs ?? 300;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      fs.renameSync(oldPath, newPath);
      return;
    } catch (err) {
      const isTransient =
        err.code === 'EPERM' ||
        err.code === 'EBUSY' ||
        err.code === 'EACCES' ||
        err.code === 'EMFILE' ||
        err.code === 'ENFILE';

      if (!isTransient || attempt >= maxRetries) {
        try {
          if (fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
          }
        } catch (_) {}
        throw err;
      }

      const backoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
      const jitter = 0.5 + Math.random();
      const delay = Math.round(backoff * jitter);
      const end = Date.now() + delay;
      while (Date.now() < end) {
        // busy wait
      }
    }
  }
}

/**
 * Synchronously writes data to filePath atomically using a temporary file in the same directory.
 *
 * @param {string} filePath - Target file destination
 * @param {string|Buffer} data - Data to write
 * @param {Object|string} [options] - Options or encoding
 */
export function atomicWriteFileSyncWithRetry(filePath, data, options = {}) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tempPath = `${filePath}.tmp.${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const encoding = typeof options === 'string' ? options : (options?.encoding ?? 'utf8');

  try {
    fs.writeFileSync(tempPath, data, encoding);
    atomicRenameWithRetrySync(tempPath, filePath, typeof options === 'object' ? options : {});
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (_) {}
    throw err;
  }
}
