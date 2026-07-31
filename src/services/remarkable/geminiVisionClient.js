const config = require('../../config');

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Gemini Vision API クライアント（低レベル）。
 *
 * 「画像 + プロンプト」を送って生成テキストを受け取るところまでを担当し、
 * プロンプトの組み立てや JSON の検証は pageAnalyzer が受け持つ。
 */
class GeminiVisionClient {
  constructor() {
    /** @type {string|undefined} */
    this.apiKey = config.remarkable.gemini.apiKey;
    /** @type {string} */
    this.model = this.normalizeModel(config.remarkable.gemini.model);
  }

  /**
   * `models/` 接頭辞を取り除いてモデル名を正規化する。
   * @param {string|undefined} model
   * @returns {string}
   */
  normalizeModel(model) {
    const normalized = String(model || '').trim();
    return normalized.toLowerCase().startsWith('models/')
      ? normalized.slice('models/'.length)
      : normalized;
  }

  /**
   * API キーが設定されているか。
   * @returns {boolean}
   */
  isConfigured() {
    return Boolean(this.apiKey);
  }

  /**
   * generateContent のエンドポイント URL を組み立てる。
   * @returns {string}
   */
  buildUrl() {
    return `${GEMINI_BASE}/${encodeURIComponent(this.model)}:generateContent`
      + `?key=${encodeURIComponent(String(this.apiKey))}`;
  }

  /**
   * 画像とプロンプトを送信し、生成されたテキストを取得する。
   *
   * @param {Object} params
   * @param {string} params.prompt - 指示プロンプト
   * @param {string} params.imageData - base64 エンコードされた画像
   * @param {string} params.mimeType - 画像の MIME タイプ
   * @returns {Promise<string>} 生成テキスト（JSON 文字列を期待する）
   * @throws {Error} API 呼び出しが失敗した場合
   */
  async generate(params) {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY が設定されていません');
    }

    const body = {
      contents: [{
        role: 'user',
        parts: [
          { text: params.prompt },
          { inline_data: { mime_type: params.mimeType, data: params.imageData } },
        ],
      }],
      generationConfig: {
        temperature: 0.2,
        // JSON のみを返させる（仕様: 返却形式は JSON のみ）
        responseMimeType: 'application/json',
      },
    };

    const response = await fetch(this.buildUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const message = data && data.error && data.error.message
        ? data.error.message
        : `HTTP ${response.status}`;
      throw new Error(`Gemini request failed: ${message}`);
    }

    return this.extractText(data);
  }

  /**
   * generateContent のレスポンスから生成テキストを取り出す。
   * @param {any} data
   * @returns {string}
   */
  extractText(data) {
    if (!data || !Array.isArray(data.candidates) || !data.candidates[0]) return '';

    const parts = data.candidates[0].content && data.candidates[0].content.parts;
    if (!Array.isArray(parts)) return '';

    return parts.map((/** @type {any} */ part) => part.text || '').join('').trim();
  }
}

module.exports = new GeminiVisionClient();
