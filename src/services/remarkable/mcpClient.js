const config = require('../../config');
const logger = require('./logger');

const PROTOCOL_VERSION = '2024-11-05';
const DEBUG = process.env.DEBUG_REMARKABLE === 'true';

/**
 * @typedef {Object} McpContent
 * @property {string} text - content 内のテキストを連結したもの
 * @property {any} json - structuredContent もしくはテキストを JSON として解釈したもの
 * @property {Array<{ data: string, mimeType: string }>} images - 画像コンテンツ
 */

/**
 * remarkable-mcp クライアント（MCP Streamable HTTP / JSON-RPC 2.0）。
 *
 * 仕様（remarkable-review2.md）で使用するツールは次の2つだけ。
 *   - remarkable_browse : ノート一覧 / パス / modified / 総ページ数
 *   - remarkable_page   : 指定ページの画像
 */
class RemarkableMcpClient {
  constructor() {
    /** @type {string|undefined} */
    this.url = config.remarkable.mcp.url;
    /** @type {string|undefined} */
    this.token = config.remarkable.mcp.token;
    /** @type {string|null} MCP サーバーが払い出すセッションID */
    this.sessionId = null;
    /** @type {boolean} initialize 済みか */
    this.initialized = false;
    /** @type {number} JSON-RPC のリクエストID */
    this.nextId = 1;
  }

  /**
   * 接続先が設定されているか。
   * @returns {boolean}
   */
  isConfigured() {
    return Boolean(this.url);
  }

  /**
   * リクエストヘッダーを組み立てる。
   * @returns {Record<string, string>}
   */
  buildHeaders() {
    /** @type {Record<string, string>} */
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    return headers;
  }

  /**
   * JSON-RPC リクエストを送信して result を返す。
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   * @param {boolean} [isNotification] - id を持たない通知として送るか
   * @returns {Promise<any>}
   */
  async send(method, params, isNotification = false) {
    if (!this.url) {
      throw new Error('REMARKABLE_MCP_URL が設定されていません');
    }

    /** @type {Record<string, unknown>} */
    const body = { jsonrpc: '2.0', method };
    if (params !== undefined) body.params = params;
    if (!isNotification) body.id = this.nextId++;

    const response = await fetch(this.url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    // セッションIDが払い出されたら以降のリクエストで再利用する
    const sessionHeader = response.headers.get('mcp-session-id');
    if (sessionHeader) this.sessionId = sessionHeader;

    // 通知はレスポンス本文を持たない（202 など）
    if (isNotification) return null;

    const message = await this.parseResponse(response);

    if (!response.ok) {
      const error = new Error(`MCP request failed (${method}): HTTP ${response.status}`);
      throw error;
    }

    if (message && message.error) {
      throw new Error(`MCP error (${method}): ${message.error.message || 'unknown error'}`);
    }

    return message ? message.result : null;
  }

  /**
   * application/json と text/event-stream の両方に対応してレスポンスを解析する。
   * @param {Response} response
   * @returns {Promise<any>}
   */
  async parseResponse(response) {
    const text = await response.text();
    if (!text) return null;

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream')) {
      // SSE: `data:` 行に載る JSON のうち、最後にパースできたものを採用する
      const dataLines = text
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .filter(Boolean);

      for (let i = dataLines.length - 1; i >= 0; i -= 1) {
        try {
          return JSON.parse(dataLines[i]);
        } catch (error) {
          // 次の候補を試す
        }
      }
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      if (DEBUG) logger.warn('MCP から JSON 以外の応答を受信しました', { body: text.slice(0, 300) });
      return null;
    }
  }

  /**
   * 初期化ハンドシェイク（初回のみ）。
   * initialize が不要なサーバーもあるため、失敗しても致命的にはしない。
   * @returns {Promise<void>}
   */
  async ensureInitialized() {
    if (this.initialized) return;

    try {
      await this.send('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'review-bot', version: '1.0.0' },
      });
      await this.send('notifications/initialized', undefined, true);
    } catch (error) {
      logger.warn('MCP の initialize をスキップしました', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    this.initialized = true;
  }

  /**
   * ツールを呼び出す。
   * @param {string} name - ツール名
   * @param {Record<string, unknown>} [args]
   * @returns {Promise<any>} tools/call の result（正規化前）
   */
  async callTool(name, args = {}) {
    await this.ensureInitialized();
    return this.send('tools/call', { name, arguments: args });
  }

  /**
   * tools/call の result からテキスト / JSON / 画像を取り出す。
   *
   * MCP 標準: result.content = [{ type: 'text', text }, { type: 'image', data, mimeType }, ...]
   * structuredContent を返す実装にも対応する。
   *
   * @param {any} result
   * @returns {McpContent}
   */
  extractContent(result) {
    if (result == null) {
      return { text: '', json: null, images: [] };
    }

    const collectContentItems = (source) => {
      if (!source || typeof source !== 'object') return [];
      if (Array.isArray(source)) return source;
      if (Array.isArray(source.content)) return source.content;
      if (Array.isArray(source.contents)) return source.contents;
      if (Array.isArray(source.items)) return source.items;
      if (Array.isArray(source.resources)) return source.resources;
      if (source.content && typeof source.content === 'object') return [source.content];
      if (source.result && typeof source.result === 'object') {
        const nested = collectContentItems(source.result);
        if (nested.length > 0) return nested;
      }
      return [];
    };

    const content = collectContentItems(result);
    /** @type {string[]} */
    const texts = [];
    /** @type {Array<{ data: string, mimeType: string }>} */
    const images = [];

    const collectResourceImage = (item) => {
      if (!item || typeof item !== 'object') return;

      const resource = item.resource && typeof item.resource === 'object' ? item.resource : null;
      const blob = typeof item.blob === 'string' && item.blob.length > 0
        ? item.blob
        : resource && typeof resource.blob === 'string' && resource.blob.length > 0
          ? resource.blob
          : null;
      const mimeType = typeof item.mimeType === 'string' && item.mimeType.length > 0
        ? item.mimeType
        : resource && typeof resource.mimeType === 'string' && resource.mimeType.length > 0
          ? resource.mimeType
          : 'image/png';

      if (blob) {
        images.push({ data: String(blob), mimeType });
      }
    };

    for (const item of content) {
      if (!item || typeof item !== 'object') continue;

      if (item.type === 'text' && typeof item.text === 'string') {
        texts.push(item.text);
      } else if (item.type === 'image' && item.data) {
        images.push({ data: String(item.data), mimeType: item.mimeType || 'image/png' });
      } else if (item.type === 'resource') {
        const resource = item.resource && typeof item.resource === 'object' ? item.resource : null;
        if (resource && typeof resource.text === 'string') texts.push(resource.text);
        collectResourceImage(item);
      }
    }

    if (images.length === 0) {
      collectResourceImage(result);
    }

    logger.info('remarkable_mcp extractContent', {
      resultType: Array.isArray(result) ? 'array' : typeof result,
      contentCount: content.length,
      imageCount: images.length,
      hasStructuredContent: result && typeof result === 'object' && result.structuredContent !== undefined,
      resultPreview: typeof result === 'string'
        ? result.slice(0, 400)
        : JSON.stringify(result).slice(0, 1200),
      imagesPreview: images.slice(0, 3).map((image) => ({ mimeType: image.mimeType, dataLength: image.data.length })),
    });

    // structuredContent があればそれを JSON として優先採用する（画像は content 側から取る）
    if (result.structuredContent !== undefined) {
      return { text: texts.join('\n').trim(), json: result.structuredContent, images };
    }

    const joinedText = texts.join('\n').trim();
    let json = null;
    if (joinedText) {
      try {
        json = JSON.parse(joinedText);
      } catch (error) {
        json = null;
      }
    }

    // content が空で result 自体がデータを持つ実装への保険
    if (content.length === 0 && !result.content) {
      return { text: '', json: result, images };
    }

    return { text: joinedText, json, images };
  }

  // ---- 高レベル API ------------------------------------------------------

  /**
   * ノート一覧を取得する（remarkable_browse）。
   * @param {string} [browsePath] - 走査するパス（既定は "/"）
   * @returns {Promise<McpContent>}
   */
  async browse(browsePath = '/') {
    const result = await this.callTool('remarkable_browse', { path: browsePath });
    return this.extractContent(result);
  }

  /**
   * 指定ページの画像を取得する（remarkable_page）。
   *
   * OCR は Gemini Vision が担当するため、必ず include_ocr=false で呼び出し、
   * OCR の二重実行を防ぐ。compatibility モードは使用しない。
   *
   * @param {{ document: string, page: number, include_ocr?: boolean }} args
   * @returns {Promise<McpContent>}
   */
  async page(args) {
    const result = await this.callTool('remarkable_page', {
      document: args.document,
      page: args.page,
      include_ocr: args.include_ocr === false ? false : false,
    });
    return this.extractContent(result);
  }
}

module.exports = new RemarkableMcpClient();
