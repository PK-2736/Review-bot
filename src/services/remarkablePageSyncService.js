const crypto = require('crypto');
const remarkableMcp = require('./remarkableMcp');
const RemarkablePageCacheStore = require('./remarkablePageCacheStore');

const CACHE_MISSING_ERROR = 'ページキャッシュが存在しません。/cache コマンドで初期化してください。';

class RemarkablePageSyncService {
  hasCacheFile() {
    return RemarkablePageCacheStore.hasCacheFile();
  }

  ensureCacheFileExists() {
    if (!this.hasCacheFile()) {
      throw new Error(CACHE_MISSING_ERROR);
    }
  }

  async initializeCacheForDocument(documentPath, startPage) {
    RemarkablePageCacheStore.ensureCacheFile();
    const result = await this.processPages(documentPath, startPage, { forceRegister: true });
    RemarkablePageCacheStore.save();
    return result;
  }

  getChangedPagesForDocument(documentPath, startPage) {
    this.ensureCacheFileExists();
    return this.processPages(documentPath, startPage, { forceRegister: false });
  }

  async processPages(documentPath, startPage, options = {}) {
    const { forceRegister = false } = options;
    const changedPages = [];
    let skippedPages = 0;
    let registeredPages = 0;

    if (!forceRegister) {
      // Read all pages sequentially starting from startPage.
      // Treat pages not present in cache as new pages (will be returned in changedPages),
      // but do NOT update the cache here — cache is updated only after successful Todoist registration.
      const cachedPages = RemarkablePageCacheStore.getPageNumbers(documentPath).filter(page => page >= startPage);
      const cachedSet = new Set(cachedPages.map(p => Number(p)));

      const pagesSeen = [];
      let page = startPage;
      while (true) {
        const readArgs = { document: documentPath, page, include_ocr: true };
        console.log('remarkable_read args:', JSON.stringify(readArgs));
        const readResult = await remarkableMcp.read(readArgs);
        const parsed = this.parseReadResult(readResult);
        const text = this.resolvePageText(readResult, parsed);
        const hashSource = parsed.content !== '' ? parsed.content : parsed.text;
        const contentHash = this.hashText(hashSource);
        const existingEntry = RemarkablePageCacheStore.getPageEntry(documentPath, page);
        const previousHash = existingEntry ? existingEntry.hash : null;
        const same = previousHash === contentHash;
        const content = text || '';
        console.log({
          page,
          previousHash,
          previousHashSource: existingEntry ? 'cache' : 'none',
          currentHash: contentHash,
          same,
          contentLength: content.length,
          preview: content.slice(0, 200),
        });

        pagesSeen.push(page);

        if (!existingEntry) {
          // New page
          console.log('New page detected:', 'document=', documentPath, 'page=', page);
          if (text) {
            changedPages.push({ document: documentPath, page, content: text, hash: contentHash });
          }
        } else if (!same) {
          console.log('Page changed:', 'document=', documentPath, 'page=', page);
          if (text) {
            changedPages.push({ document: documentPath, page, content: text, hash: contentHash });
          }
        } else {
          console.log('Page unchanged:', 'document=', documentPath, 'page=', page);
          skippedPages += 1;
        }

        if (!parsed.more) {
          break;
        }
        page += 1;
      }

      // Remove stale cached pages that no longer exist in the document
      try {
        RemarkablePageCacheStore.removeStalePages(documentPath, pagesSeen);
      } catch (err) {
        console.warn('Failed to remove stale pages from cache:', err.message);
      }

      return { changedPages, skippedPages, registeredPages };
    }

    let page = startPage;
    while (true) {
      const readArgs = { document: documentPath, page, include_ocr: true };
      console.log('remarkable_read args:', JSON.stringify(readArgs));
      const readResult = await remarkableMcp.read(readArgs);
      const parsed = this.parseReadResult(readResult);
      const text = this.resolvePageText(readResult, parsed);
      const hashSource = parsed.content !== '' ? parsed.content : parsed.text;
      const contentHash = this.hashText(hashSource);
      const existingEntry = RemarkablePageCacheStore.getPageEntry(documentPath, page);
      const previousHash = existingEntry ? existingEntry.hash : null;
      const same = previousHash === contentHash;
      const content = text || '';
      console.log({
        page,
        previousHash,
        previousHashSource: existingEntry ? 'cache' : 'none',
        currentHash: contentHash,
        same,
        contentLength: content.length,
        preview: content.slice(0, 200),
      });
      const changed = !existingEntry || !same;

      registeredPages += 1;
      if (changed) {
        console.log('Page changed:', 'document=', documentPath, 'page=', page);
        if (text) {
          changedPages.push({ document: documentPath, page, content: text, hash: contentHash });
        }
      } else {
        console.log('Page unchanged:', 'document=', documentPath, 'page=', page);
        skippedPages += 1;
      }
      RemarkablePageCacheStore.setPageEntry(documentPath, page, contentHash, new Date().toISOString());

      if (!parsed.more) {
        break;
      }
      page += 1;
    }

    return { changedPages, skippedPages, registeredPages };
  }

  resolvePageText(readResult, parsed) {
    if (typeof readResult.text === 'string' && readResult.text.trim() !== '') {
      return readResult.text.trim();
    }
    if (readResult.json && typeof readResult.json.text === 'string' && readResult.json.text.trim() !== '') {
      return readResult.json.text.trim();
    }
    if (parsed.content) {
      return parsed.content;
    }
    if (parsed.text) {
      return parsed.text;
    }
    return '';
  }

  parseReadResult(readResult) {
    const result = { text: '', content: '', more: false };

    if (!readResult) return result;

    if (typeof readResult.text === 'string' && readResult.text.trim() !== '') {
      result.text = readResult.text.trim();
    }

    if (readResult.json && typeof readResult.json.text === 'string' && readResult.json.text.trim() !== '') {
      result.text = result.text || readResult.json.text.trim();
    }

    if (readResult.json && typeof readResult.json.result === 'string') {
      try {
        const parsed = JSON.parse(readResult.json.result);
        if (parsed && typeof parsed === 'object') {
          if (typeof parsed.content === 'string' && parsed.content.trim() !== '') {
            result.content = parsed.content.trim();
          }
          if (typeof parsed.text === 'string' && parsed.text.trim() !== '') {
            result.text = result.text || parsed.text.trim();
          }
          if (parsed.more === true) {
            result.more = true;
          }
        }
      } catch (error) {
        console.warn('RemarkablePageSyncService: parse readResult.json.result failed', error.message);
      }
    }

    return result;
  }

  hashText(text) {
    return crypto.createHash('sha256').update(text || '', 'utf8').digest('hex');
  }
}

module.exports = new RemarkablePageSyncService();
