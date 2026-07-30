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

  async getChangedPagesForDocument(documentPath, startPage) {
    this.ensureCacheFileExists();
    const baseline = RemarkablePageCacheStore.getDocumentBaseline(documentPath);
    const requestedStart = Math.max(1, Number(startPage) || 1);
    const effectiveStart = Math.max(requestedStart, baseline + 1);
    console.log('remarkable sync baseline:', { documentPath, baseline, requestedStart, effectiveStart });
    if (effectiveStart <= baseline) {
      return { changedPages: [], skippedPages: 0, registeredPages: 0 };
    }
    return this.processPages(documentPath, effectiveStart);
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

  async processPages(documentPath, startPage) {
    const changedPages = [];
    let registeredPages = 0;
    let page = Math.max(1, Number(startPage) || 1);
    let lastPage = null;

    while (true) {
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
      const readErrorType = readResult && readResult._error && typeof readResult._error.type === 'string'
        ? readResult._error.type
        : null;
      const readErrorMessage = readResult && readResult._error && typeof readResult._error.message === 'string'
        ? readResult._error.message
        : null;
      const parsed = this.parseReadResult(readResult);
      const rawText = this.resolvePageText(readResult, parsed);
      const normalizedText = this.normalizeText(rawText);
      const content = normalizedText;
      const contentLength = content.length;
      const hasText = Boolean(rawText && rawText.trim().length > 0);
      const hasOcr = Boolean(parsed.text || parsed.content);
      const hasStrokes = (Array.isArray(readResult?.strokes) && readResult.strokes.length > 0)
        || (Array.isArray(readResult?.json?.strokes) && readResult.json.strokes.length > 0);

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
}

module.exports = new RemarkablePageSyncService();
