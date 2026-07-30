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
    const baseline = Math.max(1, Number(startPage) || 1);
    RemarkablePageCacheStore.setDocumentBaseline(documentPath, baseline);
    RemarkablePageCacheStore.save();
    return { baseline };
  }

  async getChangedPagesForDocument(documentPath, startPage, pageCount = null) {
    this.ensureCacheFileExists();
    const baseline = RemarkablePageCacheStore.getDocumentBaseline(documentPath);
    const requestedStart = Math.max(1, Number(startPage) || 1);
    const effectiveStart = Math.max(requestedStart, baseline + 1);
    console.log('remarkable sync baseline:', { documentPath, baseline, requestedStart, effectiveStart, pageCount });

    if (pageCount != null && effectiveStart > pageCount) {
      return { changedPages: [], skippedPages: 0, registeredPages: 0 };
    }

    if (effectiveStart <= baseline) {
      return { changedPages: [], skippedPages: 0, registeredPages: 0 };
    }
    return this.processPages(documentPath, effectiveStart, pageCount);
  }

  normalizeText(text) {
    if (typeof text !== 'string') {
      return '';
    }

    const normalizedEol = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalizedEol
      .split('\n')
      .map(line => line.replace(/[ \t]+$/u, ''))
      .map(line => line.replace(/[ \t]{2,}/gu, ' '))
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

  async processPages(documentPath, startPage, endPage = null) {
    const changedPages = [];
    let registeredPages = 0;
    let page = Math.max(1, Number(startPage) || 1);
    let lastPage = null;

    while (true) {
      if (endPage != null && page > endPage) {
        console.log('remarkable sync: reached metadata pageCount limit, ending scan', { documentPath, page, endPage });
        break;
      }

      const readArgs = { document: documentPath, page, include_ocr: true };
      console.log('remarkable_read args:', JSON.stringify(readArgs));
      const readResult = await remarkableMcp.read(readArgs);

      let readResultJson;
      try {
        readResultJson = JSON.stringify(readResult, null, 2);
      } catch (error) {
        readResultJson = `Unable to stringify readResult: ${error.message}`;
      }

      const readResultKeys = readResult && typeof readResult === 'object' ? Object.keys(readResult) : [];
      const parsed = this.parseReadResult(readResult);
      const rawText = this.resolvePageText(readResult, parsed);
      const normalizedText = this.normalizeText(rawText);
      const content = normalizedText;
      const contentLength = content.length;
      const hasText = Boolean(rawText && rawText.trim().length > 0);
      const hasOcr = Boolean(parsed.text || parsed.content);
      const hasStrokes = (Array.isArray(readResult?.strokes) && readResult.strokes.length > 0)
        || (Array.isArray(readResult?.json?.strokes) && readResult.json.strokes.length > 0);
      const readErrorType = parsed.errorType || (readResult && readResult._error && typeof readResult._error.type === 'string' ? readResult._error.type : null);
      const readErrorMessage = parsed.errorMessage || (readResult && readResult._error && typeof readResult._error.message === 'string' ? readResult._error.message : null);

      console.log('remarkable_read result:', readResultJson);
      console.log('remarkable_read OCR info:', {
        page,
        ocrLength: rawText.length,
        ocrPreview: rawText.slice(0, 100),
        keys: readResultKeys,
        hasText,
        hasOcr,
        hasStrokes,
        errorType: readErrorType,
        errorMessage: readErrorMessage,
      });

      if (readErrorType) {
        const message = readErrorType === 'page_out_of_range'
          ? 'Reached end of document'
          : `remarkable_read error: ${readErrorType}${readErrorMessage ? ` - ${readErrorMessage}` : ''}`;
        console.log(message, {
          page,
          errorType: readErrorType,
          errorMessage: readErrorMessage,
          hasOcr,
          ocrLength: rawText.length,
          hasText,
          hasStrokes,
          keys: readResultKeys,
        });
        break;
      }

      if (normalizedText === '' || contentLength === 0) {
        console.log('Empty OCR page detected, ending scan:', {
          page,
          hasOcr,
          ocrLength: rawText.length,
          hasText,
          hasStrokes,
          keys: readResultKeys,
        });
        break;
      }

      if (DEBUG || rawText !== normalizedText) {
        const normalizationDebug = this.buildNormalizationDebug(rawText, normalizedText);
        console.log('Normalization debug:', normalizationDebug);
      }

      changedPages.push({ document: documentPath, page, content });
      registeredPages += 1;
      lastPage = page;

      if (endPage != null) {
        if (page >= endPage) {
          break;
        }
        page += 1;
        continue;
      }

      if (!parsed.more) {
        break;
      }
      page += 1;
    }

    return { changedPages, skippedPages: 0, registeredPages, lastPage };
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
    const result = { text: '', content: '', more: false, errorType: null, errorMessage: null };

    if (!readResult) return result;

    if (typeof readResult.text === 'string' && readResult.text.trim() !== '') {
      result.text = readResult.text.trim();
    }

    if (readResult.json && typeof readResult.json.text === 'string' && readResult.json.text.trim() !== '') {
      result.text = result.text || readResult.json.text.trim();
    }

    let parsedResult = null;
    if (readResult.json && typeof readResult.json.result === 'string') {
      try {
        parsedResult = JSON.parse(readResult.json.result);
      } catch (error) {
        console.warn('RemarkablePageSyncService: parse readResult.json.result failed', error.message);
      }
    }

    if (parsedResult && typeof parsedResult === 'object') {
      if (typeof parsedResult.content === 'string' && parsedResult.content.trim() !== '') {
        result.content = parsedResult.content.trim();
      }
      if (typeof parsedResult.text === 'string' && parsedResult.text.trim() !== '') {
        result.text = result.text || parsedResult.text.trim();
      }
      if (parsedResult.more === true) {
        result.more = true;
      }
      if (parsedResult._error && typeof parsedResult._error === 'object') {
        if (typeof parsedResult._error.type === 'string') {
          result.errorType = parsedResult._error.type;
        }
        if (typeof parsedResult._error.message === 'string') {
          result.errorMessage = parsedResult._error.message;
        }
      }
    }

    if (readResult._error && typeof readResult._error === 'object') {
      if (typeof readResult._error.type === 'string') {
        result.errorType = result.errorType || readResult._error.type;
      }
      if (typeof readResult._error.message === 'string') {
        result.errorMessage = result.errorMessage || readResult._error.message;
      }
    }

    return result;
  }
}

module.exports = new RemarkablePageSyncService();
