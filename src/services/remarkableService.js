const config = require('../config');
const remarkableMcp = require('./remarkableMcp');
const geminiService = require('./geminiService');
const RemarkableCacheStore = require('./remarkableCacheStore');
const todoistService = require('./todoist');

const DEBUG = process.env.DEBUG_REMARKABLE === 'true';

/**
 * reMarkable 復習同期の中核サービス
 *
 * 役割分担:
 *   - MCP側(mcp.recrubo.net): reMarkable認証・データ取得・Google Vision OCR まで実施し、
 *     OCR済みテキストを返す。
 *   - bot側(このサービス): MCPからOCR済みテキストを取得 → Gemini で復習内容生成 → Todoist登録。
 *
 * フロー:
 *   recent → 更新ページのOCR済みテキスト取得 → キャッシュ除外 → ノート別集約
 *          → Gemini(1回) → JSON検証 → Todoist登録 → キャッシュ記録
 */
class RemarkableService {
  /**
   * 必要な認証情報がそろっているか
   */
  isConfigured() {
    return (
      remarkableMcp.isConfigured() &&
      Boolean(config.remarkable.mcp.token) &&
      geminiService.isConfigured()
    );
  }

  /**
   * 設定不足の項目を返す（エラーメッセージ用）
   */
  missingConfig() {
    const missing = [];
    if (!remarkableMcp.isConfigured()) missing.push('REMARKABLE_MCP_URL');
    if (!config.remarkable.mcp.token) missing.push('REMARKABLE_MCP_TOKEN');
    if (!geminiService.isConfigured()) missing.push('GEMINI_API_KEY');
    return missing;
  }

  /**
   * 今日更新されたノートを解析し、復習タスクをTodoistへ登録
   * @returns {Promise<{created:number, skipped:number, notebooks:number, notebookNames:string[], errors:string[]}>}
   */
  async syncTodayReviews() {
    const summary = { created: 0, skipped: 0, notebooks: 0, notebookNames: [], errors: [] };

    if (!this.isConfigured()) {
      throw new Error(`必要な設定が不足しています: ${this.missingConfig().join(', ')}`);
    }

    // ① 今日更新されたノート取得
    const recentRaw = await remarkableMcp.recent({});
    const notebooks = this.normalizeRecent(recentRaw);

    if (DEBUG) console.log('reMarkable debug: notebooks', JSON.stringify(notebooks).slice(0, 500));

    if (notebooks.length === 0) {
      return summary;
    }

    // ②〜④ ページ取得 → キャッシュ除外 → OCR → ノート別集約
    const groups = []; // { name, pages: [{ key, text }] }
    const processedKeys = []; // 成功後にキャッシュへ記録するキー

    for (const notebook of notebooks) {
      const pageTexts = [];

      for (const page of notebook.pages) {
        const key = `${notebook.id}:${page.id}`;

        // ③ 解析済みページを除外
        if (RemarkableCacheStore.has(key)) {
          summary.skipped += 1;
          continue;
        }

        try {
          const text = await this.getPageText(notebook, page);
          if (text) {
            pageTexts.push({ key, label: page.label, text });
            processedKeys.push({ key, notebook: notebook.name, page: page.id });
          } else {
            // テキストが空でも再解析を避けるため記録対象にする
            processedKeys.push({ key, notebook: notebook.name, page: page.id, empty: true });
          }
        } catch (error) {
          console.error(`ページ取得失敗 (${key}):`, error.message);
          summary.errors.push(`取得: ${notebook.name} p.${page.label} - ${error.message}`);
        }
      }

      if (pageTexts.length > 0) {
        groups.push({ name: notebook.name, pages: pageTexts });
      }
    }

    if (groups.length === 0) {
      // 新規に解析するページがなかった場合でも、キャッシュだけは更新
      this.commitCache(processedKeys);
      return summary;
    }

    // ⑤ Gemini へ 1 回だけ送信
    const groupedText = this.buildGroupedText(groups);
    if (DEBUG) console.log('reMarkable debug: groupedText\n', groupedText.slice(0, 1000));

    const plan = await geminiService.generateReviewPlan(groupedText);

    // ⑥〜⑧ 検証済みJSONを Todoist へ登録
    const today = new Date();

    for (const notebook of plan.notebooks) {
      const projectName = `${config.remarkable.projectPrefix || ''}${notebook.name}`;
      summary.notebookNames.push(notebook.name);

      for (const task of notebook.tasks) {
        const dueDate = new Date(today);
        dueDate.setDate(today.getDate() + task.due_days);

        try {
          await todoistService.createRemarkableTask({
            projectName,
            content: task.title,
            dueDate,
            priority: task.priority,
          });
          summary.created += 1;
        } catch (error) {
          console.error(`Todoist登録失敗 (${notebook.name} / ${task.title}):`, error.message);
          summary.errors.push(`Todoist: ${notebook.name} - ${error.message}`);
        }
      }
    }

    summary.notebooks = plan.notebooks.length;

    // ⑨ 解析済みページを記録
    this.commitCache(processedKeys);

    return summary;
  }

  /**
   * 1ページのOCR済みテキストを取得する。
   * OCR は MCP 側（Google Vision）で完了しているため、bot側はテキストを受け取るだけ。
   *   1. recent の応答にページ本文が含まれていればそれを使う
   *   2. なければ remarkable_read で取得する
   */
  async getPageText(notebook, page) {
    // ① recent にテキストが含まれるケース
    if (page.text) {
      return page.text;
    }

    // ② remarkable_read でOCR済みテキストを取得
    const args = this.buildPageArgs(notebook, page);
    const readResult = await remarkableMcp.read(args);

    if (readResult.text) {
      return readResult.text;
    }
    // JSON形式で { text } を返す実装への保険
    if (readResult.json && typeof readResult.json.text === 'string') {
      return readResult.json.text;
    }

    return '';
  }

  /**
   * MCP ツールへ渡すページ引数を組み立てる。
   * サーバー実装差に備え、代表的なキーをまとめて渡す。
   */
  buildPageArgs(notebook, page) {
    return {
      id: notebook.id,
      documentId: notebook.id,
      page: page.id,
      pageId: page.id,
      pageIndex: page.index,
    };
  }

  /**
   * ④ OCR結果をノートごとにまとめる（仕様書の集約フォーマット）
   */
  buildGroupedText(groups) {
    return groups
      .map(group => {
        const body = group.pages
          .map(p => `Page ${p.label}\n${p.text}`)
          .join('\n\n');
        return `${group.name}\n\n${body}`;
      })
      .join('\n\n----------------------\n\n');
  }

  /**
   * 処理済みページをキャッシュへ記録
   */
  commitCache(processedKeys) {
    for (const entry of processedKeys) {
      try {
        RemarkableCacheStore.upsert({
          key: entry.key,
          notebook: entry.notebook,
          page: entry.page,
          processedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error('キャッシュ記録失敗:', error.message);
      }
    }
  }

  // ---- 正規化 ------------------------------------------------------------

  /**
   * remarkable_recent の応答を正規化
   * @returns {Array<{id:string, name:string, pages:Array<{id:string, index:number, label:string}>}>}
   */
  normalizeRecent(recentResult) {
    // extractContent の戻り値 { text, json, images } を許容
    let data = recentResult;
    if (recentResult && typeof recentResult === 'object' && 'json' in recentResult) {
      data = recentResult.json != null ? recentResult.json : recentResult.text;
    }

    const list = this.toArray(data, ['notebooks', 'documents', 'items', 'recent', 'results', 'data']);
    const notebooks = [];

    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;

      const id = this.firstDefined(raw, ['id', 'uuid', 'documentId', 'hash', 'docId']);
      const name = this.firstDefined(raw, ['name', 'title', 'visibleName', 'displayName']) || '(無題ノート)';
      if (id == null) continue;

      const pages = this.normalizePages(raw);
      if (pages.length === 0) continue;

      notebooks.push({ id: String(id), name: String(name), pages });
    }

    return notebooks;
  }

  /**
   * ノート内の更新ページを正規化
   */
  normalizePages(raw) {
    const rawPages =
      raw.updatedPages ||
      raw.modifiedPages ||
      raw.changedPages ||
      raw.pages ||
      [];

    const arr = Array.isArray(rawPages) ? rawPages : [];
    const pages = [];

    arr.forEach((p, index) => {
      if (p == null) return;

      if (typeof p === 'string' || typeof p === 'number') {
        pages.push({ id: String(p), index, label: String(p) });
        return;
      }

      if (typeof p === 'object') {
        const id = this.firstDefined(p, ['id', 'pageId', 'uuid', 'hash']);
        const pageIndex = this.firstDefined(p, ['index', 'pageNumber', 'number']);
        const idx = pageIndex != null ? Number(pageIndex) : index;
        const resolvedId = id != null ? String(id) : String(idx);
        // recent の応答にOCR済みテキストが含まれる場合は取り込む
        const text = this.firstDefined(p, ['text', 'ocr', 'ocrText', 'content']);
        pages.push({
          id: resolvedId,
          index: idx,
          label: pageIndex != null ? String(pageIndex) : resolvedId,
          text: typeof text === 'string' ? text : undefined,
        });
      }
    });

    return pages;
  }

  /**
   * data から配列を取り出す（配列そのもの or 指定キー配下）
   */
  toArray(data, keys) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    for (const key of keys) {
      if (Array.isArray(data[key])) return data[key];
    }
    return [];
  }

  firstDefined(obj, keys) {
    for (const key of keys) {
      if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
        return obj[key];
      }
    }
    return undefined;
  }
}

module.exports = new RemarkableService();
