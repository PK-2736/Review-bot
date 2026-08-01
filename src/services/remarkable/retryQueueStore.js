const fs = require('fs');
const path = require('path');

const config = require('../../config');
const logger = require('./logger');

const DEFAULT_RETRY_DELAY_MS = 5 * 60 * 1000; // 5分
const MAX_RETRY_ATTEMPTS = 3;

class RetryQueueStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.queue = null;
  }

  load() {
    if (this.queue) return this.queue;

    try {
      if (!fs.existsSync(this.filePath)) {
        this.queue = [];
        return this.queue;
      }

      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = raw && raw.trim() ? JSON.parse(raw) : [];
      this.queue = Array.isArray(parsed) ? this.normalizeEntries(parsed) : [];
      logger.info('retry queue loaded', { file: this.filePath, length: this.queue.length });
    } catch (error) {
      logger.error('retry queue load failed, using empty queue', {
        file: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      this.queue = [];
    }

    return this.queue;
  }

  save() {
    const queue = this.load();
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, `${JSON.stringify(queue, null, 2)}\n`, 'utf-8');
      logger.info('retry queue saved', { file: this.filePath, length: queue.length });
      return true;
    } catch (error) {
      logger.error('retry queue save failed', {
        file: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  normalizeEntries(entries) {
    if (!Array.isArray(entries)) return [];
    return entries.map((entry) => this.normalizeEntry(entry)).filter(Boolean);
  }

  normalizeEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const notebookPath = typeof entry.notebookPath === 'string' ? entry.notebookPath : '';
    const notebookName = typeof entry.notebookName === 'string' ? entry.notebookName : notebookPath;
    const page = Number.isFinite(Number(entry.page)) ? Number(entry.page) : null;
    if (!notebookPath || page === null) return null;

    return {
      notebookPath,
      notebookName,
      page,
      attempt: Number.isFinite(Number(entry.attempt)) ? Math.max(1, Number(entry.attempt)) : 1,
      firstAttemptAt: typeof entry.firstAttemptAt === 'number' ? entry.firstAttemptAt : Date.now(),
      lastAttemptAt: typeof entry.lastAttemptAt === 'number' ? entry.lastAttemptAt : Date.now(),
      nextAttemptAt: typeof entry.nextAttemptAt === 'number' ? entry.nextAttemptAt : Date.now(),
      lastErrorMessage: typeof entry.lastErrorMessage === 'string' ? entry.lastErrorMessage : '',
      lastErrorType: typeof entry.lastErrorType === 'string' ? entry.lastErrorType : '',
      lastErrorSource: typeof entry.lastErrorSource === 'string' ? entry.lastErrorSource : '',
      notebookModified: typeof entry.notebookModified === 'string' ? entry.notebookModified : null,
      totalPages: Number.isFinite(Number(entry.totalPages)) ? Number(entry.totalPages) : null,
    };
  }

  getAllEntries() {
    return this.load();
  }

  findEntry(notebookPath, page) {
    const entryKey = this.createKey(notebookPath, page);
    return this.load().find((entry) => this.createKey(entry.notebookPath, entry.page) === entryKey) || null;
  }

  getDueEntries() {
    const now = Date.now();
    return this.load().filter((entry) => entry.nextAttemptAt <= now && entry.attempt <= MAX_RETRY_ATTEMPTS);
  }

  createKey(notebookPath, page) {
    return `${String(notebookPath)}#${page}`;
  }

  addOrUpdate(entry) {
    const normalized = this.normalizeEntry(entry);
    if (!normalized) return null;
    const queue = this.load();
    const existingIndex = queue.findIndex((item) => this.createKey(item.notebookPath, item.page) === this.createKey(normalized.notebookPath, normalized.page));
    if (existingIndex >= 0) {
      queue[existingIndex] = normalized;
    } else {
      queue.push(normalized);
    }
    return normalized;
  }

  remove(notebookPath, page) {
    const queue = this.load();
    const key = this.createKey(notebookPath, page);
    const filtered = queue.filter((entry) => this.createKey(entry.notebookPath, entry.page) !== key);
    if (filtered.length !== queue.length) {
      this.queue = filtered;
      return true;
    }
    return false;
  }

  scheduleRetry(notebookPath, notebookName, page, error, attempt) {
    const now = Date.now();
    const existing = this.findEntry(notebookPath, page);
    const nextAttempt = existing ? existing.attempt + 1 : attempt;
    const firstAttemptAt = existing ? existing.firstAttemptAt : now;
    const nextAttemptAt = now + DEFAULT_RETRY_DELAY_MS;
    const entry = {
      notebookPath,
      notebookName,
      page,
      attempt: nextAttempt,
      firstAttemptAt,
      lastAttemptAt: now,
      nextAttemptAt,
      lastErrorMessage: error instanceof Error ? error.message : String(error),
      lastErrorType: error && error.name ? error.name : '',
      lastErrorSource: error && error.source ? error.source : '',
      notebookModified: existing ? existing.notebookModified : null,
      totalPages: existing ? existing.totalPages : null,
    };
    this.addOrUpdate(entry);
    this.save();
    logger.warn('retry queue entry scheduled', {
      notebookPath,
      notebookName,
      page,
      attempt: nextAttempt,
      nextAttemptAt: new Date(nextAttemptAt).toISOString(),
      error: entry.lastErrorMessage,
    });
    return entry;
  }
}

module.exports = new RetryQueueStore(config.remarkable.retryQueueFile);
