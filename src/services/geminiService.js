const config = require('../config');

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Gemini API クライアント
 *
 * 役割:
 *   - OCR結果を理解する
 *   - 今日学習した内容を要約する
 *   - 復習内容・優先順位を考える
 *   - Todoist登録用JSONを生成する（JSONのみ、説明文・Markdown禁止）
 *
 * ノートは1リクエストで送るが、教科同士を混ぜずノートごとに独立して解析させる。
 */
class GeminiService {
  constructor() {
    this.apiKey = config.remarkable.gemini.apiKey;
    this.defaultModel = 'gemini-3.6-flash';
    this.model = this.normalizeModel(config.remarkable.gemini.model || this.defaultModel);
  }

  normalizeModel(model) {
    if (!model) return this.defaultModel;
    let normalized = String(model).trim();
    if (normalized.toLowerCase().startsWith('models/')) {
      normalized = normalized.slice('models/'.length);
    }
    return normalized || this.defaultModel;
  }

  getGeminiUrl(model) {
    return `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  isModelUnavailableError(error) {
    if (!error || typeof error !== 'object') return false;
    const message = String(error.message || '').toLowerCase();
    const status = String(error.status || '').toUpperCase();
    return status === 'NOT_FOUND' && message.includes('no longer available');
  }

  async requestReviewPlan(model, prompt) {
    const url = this.getGeminiUrl(model);
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: 'application/json',
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = data && data.error ? data.error.message : `HTTP ${response.status}`;
      const error = new Error(`Gemini request failed: ${message}`);
      error.responseData = data;
      error.status = data && data.error ? data.error.status : response.status;
      throw error;
    }

    return data;
  }

  /**
   * OCRをまとめたテキストから復習JSONを生成
   * @param {string} groupedOcrText - ノートごとにまとめたOCR結果
   * @returns {Promise<{notebooks: Array}>}
   */
  async generateReviewPlan(groupedOcrText) {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY が設定されていません');
    }

    const prompt = this.buildPrompt(groupedOcrText);

    try {
      const data = await this.requestReviewPlan(this.model, prompt);
      const text = this.extractText(data);
      const parsed = this.parseJson(text);
      return this.validate(parsed);
    } catch (error) {
      if (this.isModelUnavailableError(error) && this.model !== this.defaultModel) {
        console.warn(`Gemini model '${this.model}' is unavailable; retrying with fallback model '${this.defaultModel}'`);
        const data = await this.requestReviewPlan(this.defaultModel, prompt);
        const text = this.extractText(data);
        const parsed = this.parseJson(text);
        return this.validate(parsed);
      }
      throw error;
    }
  }

  buildPrompt(groupedOcrText) {
    return [
      'あなたは学習内容を解析し、最適な復習計画を作成するアシスタントです。',
      '以下は、reMarkableで今日書かれた勉強ノートをOCRしたテキストです。',
      'ノートごと（教科ごと）に独立して解析してください。教科同士を混ぜないこと。',
      '',
      '各ノートについて次を判断してください:',
      '- 今日学習した内容',
      '- 理解した内容',
      '- 理解が浅そうな内容',
      '- 復習するべき内容',
      '- 優先順位',
      '',
      '復習日の目安（理解度に応じて柔軟に判断してよい）:',
      '- 理解度が低い: 翌日 (due_days=1)',
      '- 普通: 7日後 (due_days=7)',
      '- 十分理解: 30日後 (due_days=30)',
      '',
      'priority は 4=最優先, 3=高, 2=中, 1=低 とする。',
      '',
      '出力はJSONのみ。説明文・Markdown・コードブロックは一切禁止。',
      '出力スキーマ:',
      '{"notebooks":[{"name":"教科名","summary":"要約","tasks":[{"title":"復習タスク","due_days":1,"priority":4}]}]}',
      '',
      '--- OCR結果 ---',
      groupedOcrText,
    ].join('\n');
  }

  extractText(data) {
    if (!data || !Array.isArray(data.candidates) || !data.candidates[0]) {
      return '';
    }
    const parts = data.candidates[0].content && data.candidates[0].content.parts;
    if (!Array.isArray(parts)) return '';
    return parts.map(p => p.text || '').join('').trim();
  }

  /**
   * Markdownコードフェンス等が混ざっても復旧できるようにJSONを抽出
   */
  parseJson(text) {
    if (!text) {
      throw new Error('Gemini が空の応答を返しました');
    }

    let cleaned = text.trim();
    // ```json ... ``` を除去
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim();
    }

    try {
      return JSON.parse(cleaned);
    } catch (_) {
      // 最初の { から最後の } までを救出
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(cleaned.slice(start, end + 1));
        } catch (error) {
          throw new Error(`Gemini出力のJSON解析に失敗しました: ${error.message}`);
        }
      }
      throw new Error('Gemini出力にJSONが見つかりませんでした');
    }
  }

  /**
   * スキーマ検証と値の正規化
   */
  validate(parsed) {
    if (!parsed || !Array.isArray(parsed.notebooks)) {
      throw new Error('Gemini出力に notebooks 配列がありません');
    }

    const notebooks = parsed.notebooks
      .filter(nb => nb && typeof nb.name === 'string' && nb.name.trim())
      .map(nb => ({
        name: nb.name.trim(),
        summary: typeof nb.summary === 'string' ? nb.summary.trim() : '',
        tasks: Array.isArray(nb.tasks)
          ? nb.tasks
              .filter(task => task && typeof task.title === 'string' && task.title.trim())
              .map(task => ({
                title: task.title.trim(),
                due_days: this.clampDueDays(task.due_days),
                priority: this.clampPriority(task.priority),
              }))
          : [],
      }))
      .filter(nb => nb.tasks.length > 0);

    return { notebooks };
  }

  clampDueDays(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 1;
    return Math.min(Math.round(n), 365);
  }

  clampPriority(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 1;
    return Math.min(Math.max(Math.round(n), 1), 4);
  }
}

module.exports = new GeminiService();
