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
      const hasCacheEntry = Boolean(existingEntry);
      const changed = forceRegister || (hasCacheEntry && existingEntry.hash !== contentHash);

      if (forceRegister) {
        registeredPages += 1;
      }

      if (!forceRegister && !hasCacheEntry) {
        console.log('Skip unmanaged page:', `document=${documentPath}`, `page=${page}`);
      } else if (changed) {
        if (!forceRegister) {
          console.log('Page changed:', 'document=', documentPath, 'page=', page);
        }

        if (text) {
          changedPages.push({ document: documentPath, page, content: text, hash: contentHash });
        }

        RemarkablePageCacheStore.setPageEntry(documentPath, page, contentHash, new Date().toISOString());
      } else {
        console.log('Page unchanged:', 'document=', documentPath, 'page=', page);
        skippedPages += 1;
      }

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
