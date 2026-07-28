const fs = require('fs');
const path = require('path');
const os = require('os');

// Allow overriding cache location via environment variable for persistent storage
const CACHE_FILE = process.env.REMARKABLE_CACHE_FILE || path.join(os.homedir(), '.review-bot', 'remarkable-pages.json');
const CACHE_DIR = path.dirname(CACHE_FILE);

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

class RemarkablePageCacheStore {
  static cache = null;

  static load(options = {}) {
    const { createIfMissing = false } = options;

    if (this.cache) {
      return this.cache;
    }

    if (!fs.existsSync(CACHE_FILE)) {
      this.cache = {};
      if (createIfMissing) {
        this.save();
        console.log('Remarkable page cache created at', CACHE_FILE);
      } else {
        console.log('Remarkable page cache not found, expected at', CACHE_FILE);
      }
      return this.cache;
    }

    try {
      const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
      this.cache = raw.trim() ? JSON.parse(raw) : {};
    } catch (error) {
      console.warn('Remarkable page cache corrupted. Reinitializing cache.', error.message);
      this.cache = {};
      this.save();
    }

    return this.cache;
  }

  static save() {
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(this.cache || {}, null, 2), 'utf-8');
      console.log('Remarkable page cache saved to', CACHE_FILE);
    } catch (error) {
      console.error('Remarkable page cache save error:', error.message);
      throw error;
    }
  }

  static normalizeDocumentPath(documentPath) {
    if (documentPath == null) {
      return '';
    }
    return String(documentPath).trim().replace(/^\/+/, '').replace(/\/+$/, '');
  }

  static getPageEntry(documentPath, page) {
    const cache = this.load();
    const key = this.normalizeDocumentPath(documentPath);
    const pageKey = String(page);
    if (!cache[key] || cache[key][pageKey] == null) {
      return null;
    }
    return cache[key][pageKey];
  }

  static setPageEntry(documentPath, page, hash, updatedAt) {
    const cache = this.load();
    const key = this.normalizeDocumentPath(documentPath);
    if (!cache[key]) {
      cache[key] = {};
    }
    cache[key][String(page)] = { hash, updatedAt };
  }

  static deletePageEntry(documentPath, page) {
    const cache = this.load();
    const key = this.normalizeDocumentPath(documentPath);
    if (!cache[key]) return;
    delete cache[key][String(page)];
    if (Object.keys(cache[key]).length === 0) {
      delete cache[key];
    }
  }

  static removeStalePages(documentPath, keepPages = []) {
    const cache = this.load();
    const key = this.normalizeDocumentPath(documentPath);
    if (!cache[key]) return;
    const keepSet = new Set((keepPages || []).map(p => String(p)));
    for (const p of Object.keys(cache[key])) {
      if (!keepSet.has(p)) {
        delete cache[key][p];
      }
    }
    if (Object.keys(cache[key]).length === 0) {
      delete cache[key];
    }
  }

  static hasDocument(documentPath) {
    const cache = this.load();
    const key = this.normalizeDocumentPath(documentPath);
    return cache[key] != null && Object.keys(cache[key]).length > 0;
  }

  static getCachedDocuments() {
    const cache = this.load();
    return Object.keys(cache);
  }

  static getPageNumbers(documentPath) {
    const cache = this.load();
    const key = this.normalizeDocumentPath(documentPath);
    if (!cache[key]) {
      return [];
    }
    return Object.keys(cache[key])
      .map(page => Number(page))
      .filter(page => Number.isFinite(page))
      .sort((a, b) => a - b);
  }

  static hasCacheFile() {
    return fs.existsSync(CACHE_FILE);
  }

  static ensureCacheFile() {
    this.load({ createIfMissing: true });
  }
}

module.exports = RemarkablePageCacheStore;
