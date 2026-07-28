const crypto = require('crypto');
const remarkableMcp = require('./remarkableMcp');
const RemarkablePageCacheStore = require('./remarkablePageCacheStore');

const CACHE_MISSING_ERROR = 'ページキャッシュが存在しません。/cache コマンドで初期化してください。';
const DEBUG = process.env.DEBUG_REMARKABLE === 'true';

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
    const startFrom = Math.max(1, Number(startPage) || 1);
    const result = await this.processPages(documentPath, startFrom, { forceRegister: true });
    const baseline = result.lastPage || startFrom;
    RemarkablePageCacheStore.setDocumentBaseline(documentPath, baseline);
    RemarkablePageCacheStore.save();
    return result;
  }

  getChangedPagesForDocument(documentPath, startPage) {
    this.ensureCacheFileExists();
    const baseline = RemarkablePageCacheStore.getDocumentBaseline(documentPath);
    const requestedStart = Math.max(1, Number(startPage) || 1);
    const effectiveStart = Math.max(requestedStart, baseline + 1);
    console.log('remarkable sync baseline:', { documentPath, baseline, requestedStart, effectiveStart });
    if (effectiveStart <= baseline) {
      return Promise.resolve({ changedPages: [], skippedPages: 0, registeredPages: 0 });
    }
    return this.processPages(documentPath, effectiveStart, { forceRegister: false });
  }

  normalizeText(text) {
    if (typeof text !== 'string') {
      return '';
    }

    // Normalize line endings first.
    const normalizedEol = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalizedEol
      .split('\n')
      .map(line => line.replace(/[ \t]+$/u, '')) // remove trailing whitespace
      .map(line => line.replace(/[ \t]{2,}/gu, ' ')) // collapse repeated spaces/tabs
      .map(line => line.replace(/\u00A0/g, ' '));

    const filtered = lines.filter(line => line.trim() !== '');
    return filtered.join('\n').trim();
  }

  buildNormalizationDebug(rawText, normalizedText) {
    const rawPreview = JSON.stringify(rawText.slice(0, 200));
    const normalizedPreview = JSON.stringify(normalizedText.slice(0, 200));
    const diffSummary = rawText === normalizedText
      ? 'No normalization change'
      : 'Normalization changed whitespace or empty lines';

    return {
      rawPreview,
      normalizedPreview,
      diffSummary,
    };
  }

  async processPages(documentPath, startPage, options = {}) {
    const { forceRegister = false, endPage = null } = options;
    const changedPages = [];
    let skippedPages = 0;
    let registeredPages = 0;
    const pagesSeen = [];

    if (!forceRegister) {
      const requestedStart = Math.max(1, Number(startPage) || 1);
      const requestedEnd = endPage != null ? Number(endPage) : null;
      if (requestedEnd != null && requestedStart > requestedEnd) {
        return { changedPages, skippedPages, registeredPages, lastPage: requestedStart };
      }

      let page = requestedStart;
      while (true) {
        if (requestedEnd != null && page > requestedEnd) {
          break;
        }

        const readArgs = { document: documentPath, page, include_ocr: true };
        console.log('remarkable_read args:', JSON.stringify(readArgs));
        const readResult = await remarkableMcp.read(readArgs);
        const parsed = this.parseReadResult(readResult);
        const rawText = this.resolvePageText(readResult, parsed);
        const normalizedText = this.normalizeText(rawText);
        const rawHash = this.hashText(rawText);
        const normalizedHash = this.hashText(normalizedText);
        const content = normalizedText;
        const contentLength = content.length;

        if (normalizedText === '' || contentLength === 0) {
          console.log('Empty OCR page detected, ending scan:', { documentPath, page });
          break;
        }

        const existingEntry = RemarkablePageCacheStore.getPageEntry(documentPath, page);
        const previousHash = existingEntry ? (existingEntry.normalizedHash || existingEntry.hash) : null;
        const same = previousHash === normalizedHash || previousHash === rawHash;
        const changed = !existingEntry || !same;

        console.log({
          page,
          previousHash,
          previousHashSource: existingEntry ? 'cache' : 'none',
          rawHash,
          normalizedHash,
          same,
          contentLength,
          normalizedTextPreview: content.slice(0, 200),
        });

        if (DEBUG || rawText !== normalizedText) {
          const normalizationDebug = this.buildNormalizationDebug(rawText, normalizedText);
          console.log('Normalization debug:', normalizationDebug);
        }

        if (changed) {
          if (!existingEntry) {
            console.log('New page detected:', 'document=', documentPath, 'page=', page);
          } else {
            console.log('Page changed:', 'document=', documentPath, 'page=', page);
            if (DEBUG) {
              console.log('Changed page debug:', {
                page,
                documentPath,
                previousHash,
                rawHash,
                normalizedHash,
                rawTextPreview: JSON.stringify(rawText.slice(0, 200)),
                normalizedTextPreview: JSON.stringify(normalizedText.slice(0, 200)),
              });
            }
          }
          changedPages.push({ document: documentPath, page, content, hash: normalizedHash, rawHash, normalizedHash });
        } else {
          console.log('Page unchanged:', 'document=', documentPath, 'page=', page);
          skippedPages += 1;
        }

        RemarkablePageCacheStore.setPageEntry(documentPath, page, rawHash, normalizedHash, new Date().toISOString());
        pagesSeen.push(page);
        registeredPages += 1;

        if (!parsed.more) {
          break;
        }
        page += 1;
      }

      try {
        RemarkablePageCacheStore.removeStalePages(documentPath, pagesSeen);
      } catch (err) {
        console.warn('Failed to remove stale pages from cache:', err.message);
      }

      RemarkablePageCacheStore.save();
      return { changedPages, skippedPages, registeredPages, lastPage: page };
    }

    let page = startPage;
    let lastPage = startPage;
    while (true) {
      const readArgs = { document: documentPath, page, include_ocr: true };
      console.log('remarkable_read args:', JSON.stringify(readArgs));
      const readResult = await remarkableMcp.read(readArgs);
      const parsed = this.parseReadResult(readResult);
      const rawText = this.resolvePageText(readResult, parsed);
      const normalizedText = this.normalizeText(rawText);
      const rawHash = this.hashText(rawText);
      const normalizedHash = this.hashText(normalizedText);
      const content = normalizedText;
      const contentLength = content.length;

      if (normalizedText === '' || contentLength === 0) {
        console.log('Empty OCR page detected, ending scan:', { documentPath, page });
        break;
      }

      const existingEntry = RemarkablePageCacheStore.getPageEntry(documentPath, page);
      const previousHash = existingEntry ? (existingEntry.normalizedHash || existingEntry.hash) : null;
      const same = previousHash === normalizedHash || previousHash === rawHash;
      const changed = !existingEntry || !same;

      console.log({
        page,
        previousHash,
        previousHashSource: existingEntry ? 'cache' : 'none',
        rawHash,
        normalizedHash,
        same,
        contentLength,
        normalizedTextPreview: content.slice(0, 200),
      });

      if (DEBUG || rawText !== normalizedText) {
        const normalizationDebug = this.buildNormalizationDebug(rawText, normalizedText);
        console.log('Normalization debug:', normalizationDebug);
      }

      if (changed) {
        console.log('Page changed:', 'document=', documentPath, 'page=', page);
        if (content) {
          changedPages.push({ document: documentPath, page, content, hash: normalizedHash, rawHash, normalizedHash });
        }
        if (DEBUG) {
          console.log('Changed page debug:', {
            page,
            documentPath,
            previousHash,
            rawHash,
            normalizedHash,
            rawTextPreview: JSON.stringify(rawText.slice(0, 200)),
            normalizedTextPreview: JSON.stringify(normalizedText.slice(0, 200)),
          });
        }
      } else {
        console.log('Page unchanged:', 'document=', documentPath, 'page=', page);
        skippedPages += 1;
      }
      RemarkablePageCacheStore.setPageEntry(documentPath, page, rawHash, normalizedHash, new Date().toISOString());
      pagesSeen.push(page);
      registeredPages += 1;
      lastPage = page;

      if (!parsed.more) {
        break;
      }
      page += 1;
    }

    RemarkablePageCacheStore.save();
    return { changedPages, skippedPages, registeredPages, lastPage };
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
