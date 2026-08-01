const geminiVisionClient = require('./geminiVisionClient');
const logger = require('./logger');

/**
 * Gemini へ渡す指示プロンプト。
 *
 * 仕様（remarkable-review2.md）で依頼する内容:
 *   - 手書きノートを読み取る / OCR を実施する
 *   - 内容を要約する / 重要事項を抽出する / 覚えるべき内容を抽出する
 *   - 復習用 TODO を生成する / 分かりやすいタイトルを生成する
 *
 * @param {Object} params
 * @param {string} params.notebookName - ノート名
 * @param {number} params.page - ページ番号
 * @returns {string}
 */
function buildPrompt(params) {
  return [
    'あなたは手書きの勉強ノートを解析する学習アシスタントです。',
    `対象: ノート「${params.notebookName}」の ${params.page} ページ目の画像です。`,
    '',
    '次の作業を行ってください。',
    '1. 手書きノートを読み取る（OCR）',
    '2. 内容を要約する',
    '3. 重要事項を抽出する',
    '4. 覚えるべき内容を抽出する',
    '5. 復習用 TODO を生成する（例: 問題演習を解く / 公式を暗記する / 今日の授業内容を復習する）',
    '6. 分かりやすいタイトルを生成する',
    '',
    '出力は次のスキーマの JSON のみとし、説明文・Markdown・コードブロックは一切出力しないこと。',
    '{"title":"","summary":"","important_points":[],"memorize":[],"todo":[],"tags":[]}',
    '',
    '- important_points / memorize / todo / tags は文字列の配列にすること。',
    '- 読み取れる内容が無い場合は title と summary を空文字、配列を空配列にすること。',
  ].join('\n');
}

/**
 * Gemini の出力から JSON を取り出す。
 * コードフェンスや前後の余分な文字が混ざっても復旧できるようにする。
 *
 * @param {string} text
 * @returns {Record<string, any>}
 * @throws {Error} JSON として解釈できなかった場合
 */
function parseJson(text) {
  if (!text) {
    throw new Error('Gemini が空の応答を返しました');
  }

  let cleaned = text.trim();

  // ```json ... ``` を取り除く
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    // 最初の { から最後の } までを救出する
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('Gemini 出力に JSON が見つかりませんでした');
  }
}

/**
 * 文字列へ正規化する。
 * 要素がオブジェクトの場合は title / content / text を拾う。
 *
 * @param {unknown} item
 * @returns {string}
 */
function itemToString(item) {
  if (typeof item === 'string') return item.trim();
  if (item && typeof item === 'object') {
    const record = /** @type {Record<string, any>} */ (item);
    const candidate = record.title || record.content || record.text || record.name;
    return typeof candidate === 'string' ? candidate.trim() : '';
  }
  return '';
}

function toStringArray(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }

  if (Array.isArray(value)) {
    return value
      .map(itemToString)
      .filter((item) => item.length > 0);
  }

  if (value && typeof value === 'object') {
    const s = itemToString(value);
    return s.length > 0 ? [s] : [];
  }

  return [];
}

/**
 * 文字列へ正規化する。
 * @param {unknown} value
 * @returns {string}
 */
function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * `parsed` から最初に見つかったフィールド名を使って値を取得する。
 * @param {Record<string, any>} parsed
 * @param {string[]} names
 * @returns {unknown}
 */
function coalesceField(parsed, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(parsed, name)) {
      return parsed[name];
    }
  }
  return undefined;
}

/**
 * Gemini の出力を PageAnalysis へ正規化する。
 * @param {Record<string, any>} parsed
 * @returns {import('./types').PageAnalysis}
 */
function normalizeAnalysis(parsed) {
  return {
    title: toText(coalesceField(parsed, ['title', 'heading', 'name'])),
    summary: toText(coalesceField(parsed, ['summary', 'description'])),
    important_points: toStringArray(coalesceField(parsed, ['important_points', 'importantPoints', 'key_points', 'points'])),
    memorize: toStringArray(coalesceField(parsed, ['memorize', 'memorize_points', 'memorizePoints', 'memorize_items'])),
    todo: toStringArray(coalesceField(parsed, ['todo', 'todos', 'todo_items', 'tasks'])),
    tags: toStringArray(coalesceField(parsed, ['tags', 'label', 'labels'])),
  };
}

/**
 * Gemini Vision でページ画像を解析する。
 *
 * 仕様どおり、失敗（API エラー / JSON パース失敗の両方）した場合は 1 回だけ再試行する。
 *
 * @param {Object} params
 * @param {string} params.notebookName - ノート名
 * @param {number} params.page - ページ番号
 * @param {import('./types').PageImage} params.image - remarkable_page から取得した画像
 * @returns {Promise<{ analysis: import('./types').PageAnalysis, durationMs: number }>}
 * @throws {Error} 再試行しても解析できなかった場合
 */
async function analyzePage(params) {
  const prompt = buildPrompt({ notebookName: params.notebookName, page: params.page });
  const maxAttempts = 2; // 初回 + 1回の再試行
  const startedAt = Date.now();

  /** @type {Error|null} */
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const text = await geminiVisionClient.generate({
        prompt,
        imageData: params.image.data,
        mimeType: params.image.mimeType,
      });

      logger.info('Gemini から返ってきた生レスポンスを受け取りました', {
        notebook: params.notebookName,
        page: params.page,
        responsePreview: text.slice(0, 2000),
      });

      const parsed = parseJson(text);
      logger.info('Gemini JSON パース後', {
        notebook: params.notebookName,
        page: params.page,
        parsed,
      });

      const analysis = normalizeAnalysis(parsed);
      logger.info('Gemini 解析結果 (正規化後)', {
        notebook: params.notebookName,
        page: params.page,
        todoCount: analysis.todo.length,
        title: analysis.title,
        summary: analysis.summary,
        todos: analysis.todo,
      });

      if (analysis.todo.length === 0) {
        logger.warn('Gemini 解析結果で TODO が 0 件でした', {
          notebook: params.notebookName,
          page: params.page,
          reason: 'normalizeAnalysis 後の todo 配列が空でした',
          parsedTodoCount: Array.isArray(parsed.todo) ? parsed.todo.length : 'not-array',
          parsedTitle: parsed.title,
          parsedSummary: parsed.summary,
        });
      }

      return { analysis, durationMs: Date.now() - startedAt };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxAttempts) {
        logger.warn('Gemini 解析に失敗したため1回だけ再試行します', {
          notebook: params.notebookName,
          page: params.page,
          error: lastError.message,
        });
      }
    }
  }

  throw new Error(`Gemini 解析に失敗しました: ${lastError ? lastError.message : 'unknown error'}`);
}

module.exports = { analyzePage, buildPrompt, parseJson, normalizeAnalysis };
