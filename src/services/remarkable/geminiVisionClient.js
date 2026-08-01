const config = require('../../config');
const logger = require('./logger');
const { RetryableError } = require('./retryError');

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const fs = require('fs');
const path = require('path');

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

    const promptPreview = String(params.prompt || '').slice(0, 400);
    const imageDataLength = typeof params.imageData === 'string' ? params.imageData.length : 0;

    logger.info('Gemini API へ送信します', {
      promptPreview,
      mimeType: params.mimeType,
      imageDataLength,
    });

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

    // ログ: request body のプレビュー（画像部分は先頭100文字と長さのみ）
    try {
      const partPreview = (parts => {
        try {
          return parts.map(p => {
            if (p.text) return { type: 'text', textPreview: String(p.text).slice(0, 200) };
            if (p.inline_data) {
              const dataStr = typeof p.inline_data.data === 'string' ? p.inline_data.data : '';
              return {
                type: 'inline_data',
                mime_type: p.inline_data.mime_type,
                dataPreview: dataStr.slice(0, 100),
                dataLength: dataStr.length,
              };
            }
            return { type: 'unknown' };
          });
        } catch (e) {
          return [{ type: 'preview_error', error: String(e) }];
        }
      })(body.contents[0].parts);

      logger.info('Gemini request body preview', {
        model: this.model,
        url: this.buildUrl(),
        contentsStructure: body.contents.map(c => ({ role: c.role, partsCount: Array.isArray(c.parts) ? c.parts.length : 0 })),
        parts: partPreview,
      });
    } catch (err) {
      logger.warn('Gemini request preview の生成に失敗しました', { error: String(err) });
    }

    const response = await fetch(this.buildUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    // 実際に送信している request body をログに出力（画像データは先頭100文字に切り詰める）
    try {
      const preview = JSON.parse(JSON.stringify(body));
      if (Array.isArray(preview.contents)) {
        for (const c of preview.contents) {
          if (!Array.isArray(c.parts)) continue;
          for (const p of c.parts) {
            if (p && p.inline_data && typeof p.inline_data.data === 'string') {
              const dataStr = p.inline_data.data;
              p.inline_data.data = `${dataStr.slice(0, 100)}${dataStr.length > 100 ? `... (length=${dataStr.length})` : ''}`;
            }
          }
        }
      }

      logger.info('Gemini に送信した request body (truncated)', {
        requestBody: JSON.stringify(preview, null, 2).slice(0, 20000),
      });
    } catch (err) {
      logger.warn('request body のプレビュー生成に失敗しました', { error: String(err) });
    }

    const data = await response.json().catch(() => null);

    // Save and log the entire Gemini response for debugging (user requested full response)
    try {
      const dumpDir = path.resolve(process.cwd(), 'tmp', 'remarkable-debug');
      fs.mkdirSync(dumpDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `gemini-response-${ts}.json`;
      const outPath = path.join(dumpDir, filename);
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2));

      // Log important fields as requested
      const candidates = data && data.candidates ? data.candidates : null;
      const finishReason = data && (data.finishReason || data.finish_reason || (Array.isArray(data.candidates) && data.candidates[0] && data.candidates[0].finish_reason)) ? (data.finishReason || data.finish_reason || (data.candidates[0] && data.candidates[0].finish_reason)) : null;
      const promptFeedback = data && data.promptFeedback ? data.promptFeedback : (data && data.prompt_feedback ? data.prompt_feedback : null);
      const usageMetadata = data && data.usageMetadata ? data.usageMetadata : (data && data.usage_metadata ? data.usage_metadata : null);

      logger.info('Gemini API からの全文レスポンスを保存しました', { outPath });
      logger.info('Gemini 応答の詳細', {
        candidates: Array.isArray(candidates) ? candidates.length : candidates,
        finishReason,
        promptFeedback,
        usageMetadata,
      });
    } catch (err) {
      logger.warn('Gemini レスポンスの保存/ログに失敗しました', { error: String(err) });
    }

    if (!response.ok) {
      const message = data && data.error && data.error.message
        ? data.error.message
        : `HTTP ${response.status}`;
      throw new Error(`Gemini request failed: ${message}`);
    }

    const text = this.extractText(data);
    logger.info('Gemini API から生レスポンスを受信しました', {
      responsePreview: text.slice(0, 2000),
      responseLength: text.length,
    });

    return text;
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
