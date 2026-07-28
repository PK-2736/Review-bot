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
 *   recent → documents取得 → キャッシュ除外 → remarkable_read(document) → OCR取得
 *          → Gemini(1回) → JSON検証 → Todoist登録 → キャッシュ記録
 */
class RemarkableService {
  /**
   * 必要な認証情報がそろっているか
   */
  isConfigured() {
    return remarkableMcp.isConfigured() && geminiService.isConfigured();
  }

  /**
   * 設定不足の項目を返す（エラーメッセージ用）
   */
  missingConfig() {
    const missing = [];
    if (!remarkableMcp.isConfigured()) missing.push('REMARKABLE_MCP_URL');
    if (!geminiService.isConfigured()) missing.push('GEMINI_API_KEY');
    return missing;
  }

  /**
   * 今日更新されたドキュメントを解析し、復習タスクをTodoistへ登録
   * @returns {Promise<{created:number, skipped:number, notebooks:number, notebookNames:string[], errors:string[]}>}
   */
  async syncTodayReviews() {
    const summary = { created: 0, skipped: 0, notebooks: 0, notebookNames: [], errors: [] };

    if (!this.isConfigured()) {
      throw new Error(`必要な設定が不足しています: ${this.missingConfig().join(', ')}`);
    }

    const recentRaw = await remarkableMcp.recent({});
    const documents = this.normalizeRecent(recentRaw);

    console.log('🖊️ reMarkable sync: documents count=', documents.length);
    console.log('🖊️ reMarkable sync: documents=', documents.map(doc => ({ id: doc.id, name: doc.name, path: doc.path })));
    if (DEBUG) console.log('reMarkable debug: recentRaw', JSON.stringify(recentRaw).slice(0, 2000));

    if (documents.length === 0) {
      console.warn('⚠️ reMarkable sync: no documents found after normalization');
      return summary;
    }

    const groups = [];
    const processedKeys = [];

    for (const document of documents) {
      const key = document.id;
      console.log('🖊️ reMarkable sync: processing document', { key, name: document.name, path: document.path });

      try {
        const text = await this.getDocumentText(document);
        console.log('🖊️ reMarkable sync: OCR total length =', text.length, 'document=', document.name);

        if (text) {
          groups.push({
            name: document.name,
            pages: [{ key, label: document.name, text }],
          });
          processedKeys.push({ key, notebook: document.name, page: 'document' });
        } else {
          console.warn(`⚠️ reMarkable sync: empty OCR text for document=${document.name}`);
          processedKeys.push({ key, notebook: document.name, page: 'document', empty: true });
        }
      } catch (error) {
        console.error(`ドキュメント取得失敗 (${document.name}):`, error.message);
        summary.errors.push(`取得: ${document.name} - ${error.message}`);
      }
    }

    console.log('🖊️ reMarkable sync: groups count=', groups.length);
    if (groups.length === 0) {
      this.commitCache(processedKeys);
      return summary;
    }

    const groupedText = this.buildGroupedText(groups);
    if (DEBUG) console.log('reMarkable debug: groupedText\n', groupedText.slice(0, 1000));

    const plan = await geminiService.generateReviewPlan(groupedText);

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

    this.commitCache(processedKeys);

    return summary;
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

  async getDocumentText(document) {
    const pages = [];
    let page = 1;

    while (true) {
      const readArgs = { document: document.name, include_ocr: true };
      if (page > 1) {
        readArgs.page = page;
      }

      console.log('🖊️ reMarkable sync: remarkable_read args', readArgs);
      const readResult = await remarkableMcp.read(readArgs);
      try {
        console.log('🖊️ reMarkable sync: remarkable_read RAW:', JSON.stringify(readResult, null, 2));
      } catch (error) {
        console.dir(readResult, { depth: null });
      }

      const parsed = this.parseReadResult(readResult);
      console.log('🖊️ reMarkable sync: remarkable_read result', {
        hasText: typeof readResult.text === 'string',
        hasJson: typeof readResult.json === 'object',
        hasResult: typeof readResult.json?.result === 'string',
        hasParsedContent: typeof parsed.content === 'string',
        hasParsedText: typeof parsed.text === 'string',
        more: parsed.more,
        images: readResult.images?.length || 0,
      });

      let text = '';
      if (typeof readResult.text === 'string' && readResult.text.trim() !== '') {
        text = readResult.text.trim();
      } else if (readResult.json && typeof readResult.json.text === 'string' && readResult.json.text.trim() !== '') {
        text = readResult.json.text.trim();
      } else if (parsed.content) {
        text = parsed.content;
      } else if (parsed.text) {
        text = parsed.text;
      }

      if (text) {
        pages.push(text);
      }

      if (!parsed.more) {
        break;
      }

      page += 1;
    }

    return pages.filter(Boolean).join('\n\n');
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
        if (DEBUG) console.log('reMarkable debug: parse readResult.json.result failed', error.message);
      }
    }

    return result;
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
   * @returns {Array<{id:string, name:string, path:string, modified?:string}>}
   */
  normalizeRecent(recentResult) {
    let data = recentResult;
    if (recentResult && typeof recentResult === 'object' && 'json' in recentResult) {
      if (recentResult.json != null) {
        let parsed = recentResult.json;
        if (typeof parsed === 'string') {
          try {
            parsed = JSON.parse(parsed);
          } catch (error) {
            if (DEBUG) console.log('reMarkable debug: parse recentResult.json failed', error.message);
            return [];
          }
        }

        if (parsed && typeof parsed === 'object' && typeof parsed.result === 'string') {
          try {
            parsed = JSON.parse(parsed.result);
          } catch (error) {
            if (DEBUG) console.log('reMarkable debug: parse recentResult.json.result failed', error.message);
            return [];
          }
        }

        data = parsed;
      } else {
        data = recentResult.text;
      }
    }

    const list = this.toArray(data, ['documents']);
    if (DEBUG) console.log('reMarkable debug: normalizeRecent', {
      dataType: typeof data,
      dataKeys: data && typeof data === 'object' ? Object.keys(data) : null,
      listLength: list.length,
    });

    const documents = [];

    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;

      const id = this.firstDefined(raw, ['path']);
      const name = this.firstDefined(raw, ['name']) || '(無題ドキュメント)';
      const modified = this.firstDefined(raw, ['modified', 'updated', 'timestamp']);
      if (id == null) continue;

      documents.push({
        id: String(id),
        name: String(name),
        path: String(id),
        modified: modified != null ? String(modified) : undefined,
      });
    }

    return documents;
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
