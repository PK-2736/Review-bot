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
      this.cache = { documents: {} };
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
      this.cache = raw.trim() ? JSON.parse(raw) : { documents: {} };
    } catch (error) {
      console.warn('Remarkable page cache corrupted. Reinitializing cache.', error.message);
      this.cache = { documents: {} };
      this.save();
    }

    if (!this.cache.documents || typeof this.cache.documents !== 'object') {
      const legacyCache = { ...this.cache };
      this.cache = { documents: {} };
      for (const [key, value] of Object.entries(legacyCache)) {
        if (key === 'documents') continue;
        this.cache.documents[key] = value;
      }
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

  static getDocumentCache(documentPath, createIfMissing = false) {
    const cache = this.load();
    const key = this.normalizeDocumentPath(documentPath);
    if (!cache.documents[key]) {
      if (!createIfMissing) {
        return null;
      }
      cache.documents[key] = { baseline: 0, pages: {} };
    }
    if (!cache.documents[key].pages || typeof cache.documents[key].pages !== 'object') {
      cache.documents[key].pages = {};
    }
    return cache.documents[key];
  }

  static getPageEntry(documentPath, page) {
    const documentCache = this.getDocumentCache(documentPath, false);
    if (!documentCache) {
      return null;
    }
    const pageKey = String(page);
    return documentCache.pages[pageKey] || null;
  }

  static setPageEntry(documentPath, page, hash, normalizedHash, updatedAt) {
    const documentCache = this.getDocumentCache(documentPath, true);
    const pageKey = String(page);
    documentCache.pages[pageKey] = {
      hash,
      normalizedHash,
      updatedAt,
    };
  }

  static setDocumentBaseline(documentPath, page) {
    const documentCache = this.getDocumentCache(documentPath, true);
    documentCache.baseline = Number(page);
  }

  static getDocumentBaseline(documentPath) {
    const documentCache = this.getDocumentCache(documentPath, false);
    if (!documentCache) {
      return 0;
    }

    const explicitBaseline = documentCache.baseline;
    if (explicitBaseline != null && Number.isFinite(Number(explicitBaseline)) && Number(explicitBaseline) > 0) {
      return Number(explicitBaseline);
    }

    const pageNumbers = Object.keys(documentCache.pages || {})
      .map(page => Number(String(page).trim()))
      .filter(page => Number.isFinite(page));

    if (pageNumbers.length === 0) {
      return 0;
    }

    const maxPage = Math.max(...pageNumbers);
    if (process.env.DEBUG_REMARKABLE === 'true') {
      console.log('RemarkablePageCacheStore.getDocumentBaseline', { documentPath, explicitBaseline, pageNumbers, maxPage });
    }

    return maxPage;
  }

  static deletePageEntry(documentPath, page) {
    const documentCache = this.getDocumentCache(documentPath, false);
    if (!documentCache) return;
    delete documentCache.pages[String(page)];
    if (Object.keys(documentCache.pages).length === 0 && (!documentCache.baseline || documentCache.baseline === 0)) {
      delete this.load().documents[this.normalizeDocumentPath(documentPath)];
    }
  }

  static removeStalePages(documentPath, keepPages = []) {
    const documentCache = this.getDocumentCache(documentPath, false);
    if (!documentCache) return;
    const keepSet = new Set((keepPages || []).map(p => String(p)));
    for (const p of Object.keys(documentCache.pages)) {
      if (!keepSet.has(p)) {
        delete documentCache.pages[p];
      }
    }
    if (Object.keys(documentCache.pages).length === 0 && (!documentCache.baseline || documentCache.baseline === 0)) {
      delete this.load().documents[this.normalizeDocumentPath(documentPath)];
    }
  }

  static hasDocument(documentPath) {
    const documentCache = this.getDocumentCache(documentPath, false);
    if (!documentCache) return false;
    return Object.keys(documentCache.pages || {}).length > 0 || (documentCache.baseline != null && documentCache.baseline > 0);
  }

  static getCachedDocuments() {
    const cache = this.load();
    return Object.keys(cache.documents || {});
  }

  static getPageNumbers(documentPath) {
    const documentCache = this.getDocumentCache(documentPath, false);
    if (!documentCache) {
      return [];
    }
    return Object.keys(documentCache.pages || {})
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
