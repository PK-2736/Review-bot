const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '../cache/remarkable-pages.json');
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
    } catch (error) {
      console.error('Remarkable page cache save error:', error.message);
      throw error;
    }
  }

  static getPageEntry(documentPath, page) {
    const cache = this.load();
    const pageKey = String(page);
    if (!cache[documentPath] || cache[documentPath][pageKey] == null) {
      return null;
    }
    return cache[documentPath][pageKey];
  }

  static setPageEntry(documentPath, page, hash, updatedAt) {
    const cache = this.load();
    if (!cache[documentPath]) {
      cache[documentPath] = {};
    }
    cache[documentPath][String(page)] = { hash, updatedAt };
  }

  static hasDocument(documentPath) {
    const cache = this.load();
    return cache[documentPath] != null && Object.keys(cache[documentPath]).length > 0;
  }

  static getCachedDocuments() {
    const cache = this.load();
    return Object.keys(cache);
  }

  static hasCacheFile() {
    return fs.existsSync(CACHE_FILE);
  }

  static ensureCacheFile() {
    this.load({ createIfMissing: true });
  }
}

module.exports = RemarkablePageCacheStore;
