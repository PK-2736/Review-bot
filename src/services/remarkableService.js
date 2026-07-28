const config = require('../config');
const remarkableMcp = require('./remarkableMcp');
const geminiService = require('./geminiService');
const RemarkableCacheStore = require('./remarkableCacheStore');
const RemarkablePageCacheStore = require('./remarkablePageCacheStore');
const remarkablePageSyncService = require('./remarkablePageSyncService');
const { formatPageRange, formatPageRangeForDescription } = require('./remarkableCacheUtils');
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
    const summary = {
      created: 0,
      skipped: 0,
      notebooks: 0,
      notebookNames: [],
      errors: [],
      changedPages: 0,
      skippedPages: 0,
      todoistCreated: 0,
      geminiRequests: 0,
    };

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

    if (!RemarkablePageCacheStore.hasCacheFile()) {
      throw new Error('ページキャッシュが存在しません。/cache コマンドで初期化してください。');
    }

    const groups = [];
    const processedKeys = [];

    const cachedDocuments = RemarkablePageCacheStore.getCachedDocuments();
    console.log('Cache found:', cachedDocuments.map(doc => `document=${doc}`).join(', '));

    for (const document of documents) {
      const key = document.id;
      const normalizedKey = RemarkablePageCacheStore.normalizeDocumentPath(document.path);
      if (!RemarkablePageCacheStore.hasDocument(document.path)) {
        console.log('Skip document (no cache):', `document=${document.path}`, `normalizedKey=${normalizedKey}`);
        continue;
      }
      console.log('Cache matched:', `document=${document.path}`, `normalizedKey=${normalizedKey}`);

      console.log('🖊️ reMarkable sync: processing document', { key, name: document.name, path: document.path });

      try {
        const baseline = RemarkablePageCacheStore.getDocumentBaseline(document.path);
        const startPage = Math.max(1, baseline + 1);
        console.log('remarkable sync document baseline:', { documentPath: document.path, baseline, startPage });

        const result = await remarkablePageSyncService.getChangedPagesForDocument(document.path, startPage);
        summary.changedPages += result.changedPages.length;
        summary.skippedPages += result.skippedPages;

        if (result.changedPages.length > 0) {
          groups.push({
            name: document.name,
            documentPath: document.path,
            pages: result.changedPages.map(pageData => ({
              key: `${key}:${pageData.page}`,
              document: document.name,
              documentPath: document.path,
              page: pageData.page,
              label: String(pageData.page),
              content: pageData.content,
              text: pageData.content,
              hash: pageData.hash,
            })),
          });
        }
      } catch (error) {
        console.error(`ドキュメント取得失敗 (${document.name}):`, error.message);
        summary.errors.push(`取得: ${document.name} - ${error.message}`);
      }
    }

    console.log('🖊️ reMarkable sync: Changed pages=', summary.changedPages);
    console.log('🖊️ reMarkable sync: Skipped pages=', summary.skippedPages);
    console.log('🖊️ reMarkable sync: groups count=', groups.length);

    summary.skipped = summary.skippedPages;
    summary.geminiRequests = groups.length;

    if (groups.length === 0) {
      RemarkablePageCacheStore.save();
      this.commitCache(processedKeys);
      return summary;
    }

    const groupedText = this.buildGroupedText(groups);
    if (DEBUG) console.log('reMarkable debug: groupedText\n', groupedText.slice(0, 1000));

    const plan = await geminiService.generateReviewPlan(groupedText);
    summary.geminiRequests = groups.length;

    const today = new Date();

    const successfulPages = [];

    const findGroupForNotebook = (notebook, groups, index) => {
      const normalizedName = String(notebook.name || '').trim().toLowerCase();
      let group = groups.find(g => String(g.name || '').trim().toLowerCase() === normalizedName);
      if (!group && groups[index]) {
        group = groups[index];
      }
      return group;
    };

    // Create a single Todoist task per notebook, consolidating multiple Gemini tasks
    for (let notebookIndex = 0; notebookIndex < plan.notebooks.length; notebookIndex += 1) {
      const notebook = plan.notebooks[notebookIndex];
      const projectName = `${config.remarkable.projectPrefix || ''}${notebook.name}`;
      summary.notebookNames.push(notebook.name);

      const matchedGroup = findGroupForNotebook(notebook, groups, notebookIndex);
      const pageNumbers = matchedGroup?.pages.map(p => Number(p.page)) || [];
      const pageHeader = formatPageRangeForDescription(pageNumbers);

      // Combine Gemini tasks into one description/content
      const combinedBody = notebook.tasks.map(t => t.title).join('\n\n');
      const description = `${pageHeader ? pageHeader + '\n\n' : ''}${notebook.name}\n\n${combinedBody}`;

      // Choose earliest due date and highest priority among tasks
      const minDueDays = Math.min(...notebook.tasks.map(t => t.due_days || 0));
      const maxPriority = Math.max(...notebook.tasks.map(t => t.priority || 1));
      const dueDate = new Date(today);
      dueDate.setDate(today.getDate() + minDueDays);

      const content = notebook.tasks.map(t => t.title).join(' / ');

      try {
        await todoistService.createRemarkableTask({
          projectName,
          content: content || notebook.name,
          description,
          dueDate,
          priority: maxPriority,
        });
        summary.created += 1;
        summary.todoistCreated += 1;

        if (matchedGroup) {
          matchedGroup.pages.forEach(pageData => {
            if (!successfulPages.some(sp => sp.documentPath === pageData.documentPath && sp.page === pageData.page)) {
              successfulPages.push({ documentPath: pageData.documentPath, page: pageData.page, hash: pageData.hash });
            }
          });
          matchedGroup.pages.forEach(pageData => {
            RemarkablePageCacheStore.setPageEntry(pageData.documentPath, pageData.page, pageData.hash, new Date().toISOString());
          });
          RemarkablePageCacheStore.save();
        } else {
          console.warn(`Todoist succeeded but notebook group not found for cache update: ${notebook.name}`);
        }
      } catch (error) {
        console.error(`Todoist登録失敗 (${notebook.name}):`, error.message);
        summary.errors.push(`Todoist: ${notebook.name} - ${error.message}`);
      }
    }

    summary.notebooks = plan.notebooks.length;

    this.commitCache(processedKeys);

    console.log(summary);
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

  async getChangedPagesForDocument(document) {
    return remarkablePageSyncService.getChangedPagesForDocument(document.path, 1);
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
