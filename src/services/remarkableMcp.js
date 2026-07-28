const config = require('../config');

const DEBUG = process.env.DEBUG_REMARKABLE === 'true';
const PROTOCOL_VERSION = '2024-11-05';

/**
 * remarkable-mcp クライアント（MCP Streamable HTTP / JSON-RPC 2.0）
 *
 * 提供ツール:
 *   - remarkable_recent : 直近で更新されたノート・ページを取得
 *   - remarkable_read   : ノート/ページのテキストを取得
 *   - remarkable_image  : ページ画像（base64）を取得
 *
 * サーバー実装の差異に耐えられるよう、レスポンスは防御的に正規化する。
 */
class RemarkableMcpClient {
  constructor() {
    this.url = config.remarkable.mcp.url;
    this.token = config.remarkable.mcp.token;
    this.sessionId = null;
    this.initialized = false;
    this.nextId = 1;
  }

  isConfigured() {
    return Boolean(this.url);
  }

  buildHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }
    return headers;
  }

  /**
   * JSON-RPC リクエストを送信し、結果を返す
   * @param {string} method
   * @param {Object} [params]
   * @param {boolean} [isNotification] - id を持たない通知
   */
  async send(method, params, isNotification = false) {
    if (!this.url) {
      throw new Error('REMARKABLE_MCP_URL が設定されていません');
    }

    const body = { jsonrpc: '2.0', method };
    if (params !== undefined) body.params = params;
    if (!isNotification) body.id = this.nextId++;

    const response = await fetch(this.url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    // 新しいセッションIDが払い出されたら保持
    const sessionHeader = response.headers.get('mcp-session-id');
    if (sessionHeader) {
      this.sessionId = sessionHeader;
    }

    if (isNotification) {
      // 通知はレスポンス本文を持たない（202など）
      return null;
    }

    const message = await this.parseResponse(response);

    if (!response.ok) {
      if (DEBUG) console.log(`MCP debug: ${method} failed`, {
        status: response.status,
        message,
      });
      const error = new Error(`MCP request failed (${method})`);
      error.httpStatusCode = response.status;
      error.responseData = message;
      throw error;
    }

    if (message && message.error) {
      if (DEBUG) console.log(`MCP debug: ${method} tool error`, message.error);
      const error = new Error(`MCP error (${method}): ${message.error.message || 'unknown'}`);
      error.responseData = message.error;
      throw error;
    }

    return message ? message.result : null;
  }

  /**
   * application/json と text/event-stream の両方に対応してレスポンスを解析
   */
  async parseResponse(response) {
    const text = await response.text();
    if (!text) return null;

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream')) {
      // SSE: `data:` 行に載る JSON を抽出（最後の JSON メッセージを採用）
      const dataLines = text
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .filter(Boolean);

      for (let i = dataLines.length - 1; i >= 0; i--) {
        try {
          return JSON.parse(dataLines[i]);
        } catch (_) {
          // 次の候補へ
        }
      }
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (_) {
      if (DEBUG) console.log('MCP debug: non-JSON response', text.slice(0, 300));
      return null;
    }
  }

  /**
   * 初期化ハンドシェイク（初回のみ）
   */
  async ensureInitialized() {
    if (this.initialized) return;

    try {
      await this.send('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'review-bot', version: '1.0.0' },
      });
      // initialized 通知
      await this.send('notifications/initialized', undefined, true);
    } catch (error) {
      // initialize 不要なサーバーもあるため、致命的にはしない
      if (DEBUG) console.log('MCP debug: initialize skipped/failed:', error.message);
    }

    this.initialized = true;
  }

  /**
   * ツール呼び出し
   * @param {string} name
   * @param {Object} [args]
   * @returns {Promise<any>} 正規化前の tools/call 結果
   */
  async callTool(name, args = {}) {
    await this.ensureInitialized();
    return this.send('tools/call', { name, arguments: args });
  }

  /**
   * tools/call の結果からテキスト/JSON/画像を取り出す
   * MCP標準: result.content = [{ type: 'text', text }, { type: 'image', data, mimeType }, ...]
   * structuredContent を持つ実装にも対応する。
   */
  extractContent(result) {
    if (result == null) {
      return { text: '', json: null, images: [] };
    }

    // 構造化出力を優先
    if (result.structuredContent !== undefined) {
      return { text: '', json: result.structuredContent, images: [] };
    }

    const content = Array.isArray(result.content) ? result.content : [];
    const texts = [];
    const images = [];

    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      if (item.type === 'text' && typeof item.text === 'string') {
        texts.push(item.text);
      } else if (item.type === 'image' && item.data) {
        images.push({ data: item.data, mimeType: item.mimeType || 'image/png' });
      } else if (item.type === 'resource' && item.resource) {
        if (typeof item.resource.text === 'string') texts.push(item.resource.text);
        if (item.resource.blob) {
          images.push({ data: item.resource.blob, mimeType: item.resource.mimeType || 'image/png' });
        }
      }
    }

    const joinedText = texts.join('\n').trim();
    let json = null;
    if (joinedText) {
      try {
        json = JSON.parse(joinedText);
      } catch (_) {
        json = null;
      }
    }

    // content が空で result 自体がデータを持つ実装への保険
    if (!content.length && !result.content) {
      return { text: '', json: result, images };
    }

    return { text: joinedText, json, images };
  }

  // ---- 高レベルAPI --------------------------------------------------------

  /**
   * 直近で更新されたノートを取得
   * @param {Object} [args] - サーバー実装に渡す引数（例: { since }）
   */
  async recent(args = {}) {
    const result = await this.callTool('remarkable_recent', args);
    return this.extractContent(result);
  }

  /**
   * ノート/ページのテキストを取得
   * @param {Object} args - 例: { id, page }
   */
  async read(args) {
    const result = await this.callTool('remarkable_read', args);
    return this.extractContent(result);
  }

  /**
   * ページ画像（base64）を取得
   * @param {Object} args - 例: { id, page }
   */
  async image(args) {
    const result = await this.callTool('remarkable_image', args);
    return this.extractContent(result);
  }
}

module.exports = new RemarkableMcpClient();
