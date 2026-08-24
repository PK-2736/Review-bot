const config = require('../../config');
const { cacheStore } = require('./cacheStore');
const { normalizeBrowse } = require('./browseNormalizer');
const pageFetcher = require('./pageFetcher');
const geminiVisionClient = require('./geminiVisionClient');
const logger = require('./logger');
const mcpClient = require('./mcpClient');
const pageAnalyzer = require('./pageAnalyzer');
const todoRegistrar = require('./todoRegistrar');
const allowStore = require('./allowStore');

/**
 * Gemini のクォータ超過エラーかどうかを判定する。
 * @param {unknown} error
 * @returns {boolean}
 */
function isGeminiQuotaError(error) {
  const msg = error instanceof Error ? error.message : String(error);
  return /quota.?exceeded|exceeded.*quota|resource.?exhausted/i.test(msg);
}

/**
 * reMarkable レビューの同期サービス。
 *
 * ここが唯一の同期実装であり、
 *   - /remarkable_sync コマンド
 *   - 毎日 23:00 の自動実行
 * のどちらも `sync()` を呼び出す（処理を重複実装しない）。
 *
 * 同期ロジック（仕様: remarkable-review2.md）:
 *   1. cache.json を読み込む
 *   2. remarkable_browse("/") でノート一覧を取得
 *   3. modified が変わっていないノートはスキップ
 *   4. modified が更新されたノートは baseline と total_pages を比較
 *      - 新しいページが無い → modified のみ更新
 *      - 新しいページがある → baseline + 1 ～ total_pages を順に処理
 *   5. 処理完了後 baseline = total_pages / modified = 最新の modified へ更新
 */
class RemarkableSyncService {
  constructor() {
    /** @type {Promise<import('./types').SyncSummary>|null} 実行中の同期処理 */
    this.inFlight = null;
  }

  /**
   * 必要な設定がそろっているか。
   * @returns {boolean}
   */
  isConfigured() {
    return mcpClient.isConfigured() && geminiVisionClient.isConfigured();
  }

  /**
   * 不足している設定項目を返す（エラーメッセージ用）。
   * @returns {string[]}
   */
  missingConfig() {
    /** @type {string[]} */
    const missing = [];
    if (!mcpClient.isConfigured()) missing.push('REMARKABLE_MCP_URL');
    if (!geminiVisionClient.isConfigured()) missing.push('GEMINI_API_KEY');
    return missing;
  }

  /**
   * 空のサマリを作る。
   * @returns {import('./types').SyncSummary}
   */
  createSummary() {
    return {
      updatedNotebooks: 0,
      skippedNotebooks: 0,
      processedPages: 0,
      createdTodos: 0,
      notebookNames: [],
      pages: [],
      errors: [],
      warnings: [],
      durationMs: 0,
    };
  }

  /**
   * 同期を実行する。
   *
   * 同時に複数の同期が走らないよう、実行中は同じ Promise を返す。
   *
   * @returns {Promise<import('./types').SyncSummary>}
   */
  async sync(options = {}) {
    if (this.inFlight) {
      logger.warn('同期処理が既に実行中のため、実行中の結果を待機します');
      return this.inFlight;
    }

    this.inFlight = this.runSync(options).finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  /**
   * 同期本体。
   * @returns {Promise<import('./types').SyncSummary>}
   */
  async runSync(options = {}) {
    if (!this.isConfigured()) {
      throw new Error(`必要な設定が不足しています: ${this.missingConfig().join(', ')}`);
    }

    const cutoffTime = options.cutoffTime && Number.isFinite(Number(options.cutoffTime))
      ? Number(options.cutoffTime)
      : null;

    const summary = this.createSummary();
    const startedAt = Date.now();
    logger.info('同期処理を開始します');

    // ① cache.json を読み込む
    cacheStore.load();

    // ② remarkable_browse("/") でノート一覧を取得
    const rawBrowse = await mcpClient.browse(config.remarkable.browseRoot);
    // デバッグ: 生のレスポンスを簡潔にログ出力して原因追跡を容易にする
    try {
      logger.info('raw remarkable_browse response', {
        textPreview: rawBrowse.text ? String(rawBrowse.text).slice(0, 1000) : null,
        jsonPreview: rawBrowse.json ? (typeof rawBrowse.json === 'string' ? rawBrowse.json.slice(0, 1000) : JSON.stringify(rawBrowse.json).slice(0, 1000)) : null,
        images: Array.isArray(rawBrowse.images) ? rawBrowse.images.length : 0,
      });
    } catch (err) {
      logger.warn('raw browse logging failed', { error: err instanceof Error ? err.message : String(err) });
    }

    let notebooks = normalizeBrowse(rawBrowse);
    // cutoffTime が指定されている場合、指定時刻より後に更新されたノートは今回の実行では処理しない
    if (cutoffTime) {
      notebooks = notebooks.filter((nb) => {
        if (!nb.modified) return true;
        const nbMs = Number(new Date(nb.modified).getTime());
        return nbMs <= cutoffTime;
      });
    }
    logger.info('ノート一覧を取得しました', { notebooks: notebooks.length });

    // ③ ノートごとに同期。1冊の失敗で全体を中断しない
    /** @type {{ geminiQuotaExceeded: boolean }} */
    const syncState = { geminiQuotaExceeded: false };

    for (const notebook of notebooks) {
      try {
        await this.syncNotebook(notebook, summary, syncState);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        summary.errors.push(`ノート: ${notebook.name} - ${message}`);
        logger.error('ノートの処理に失敗しました（他のノートは継続します）', {
          notebook: notebook.name,
          error: message,
        });
      }
    }

    // ④ cache.json を保存
    cacheStore.save();

    summary.durationMs = Date.now() - startedAt;
    logger.info('同期処理が完了しました', {
      updatedNotebooks: summary.updatedNotebooks,
      skippedNotebooks: summary.skippedNotebooks,
      processedPages: summary.processedPages,
      createdTodos: summary.createdTodos,
      errors: summary.errors.length,
      warnings: summary.warnings.length,
      durationMs: summary.durationMs,
    });

    return summary;
  }

  /**
   * 1冊のノートを同期する。
   *
   * @param {import('./types').Notebook} notebook
   * @param {import('./types').SyncSummary} summary - 集計先（副作用で更新する）
   * @param {{ geminiQuotaExceeded: boolean }} syncState - 同期ごとの共有状態
   * @returns {Promise<void>}
   */
  async syncNotebook(notebook, summary, syncState = { geminiQuotaExceeded: false }) {
    // PDF 判定: remarkable_browse が返す `type` フィールドが 'pdf' の場合は無条件で TODO を作成しない
    try {
      const isPdfType = notebook.type && String(notebook.type).toLowerCase() === 'pdf';
      const lower = String(notebook.path || notebook.name || '').toLowerCase();
      const isPdfExt = lower.endsWith('.pdf');
      if (isPdfType || isPdfExt) {
        logger.info('PDF ノートのため TODO 作成をスキップします', { notebook: notebook.name, notebookPath: notebook.path, type: notebook.type });
        // 更新はキャッシュに反映する（ページ処理は行わない）
        const totalPages = notebook.totalPages != null ? notebook.totalPages : 0;
        cacheStore.update(notebook.path, { baseline: totalPages, modified: notebook.modified, totalPages });
        summary.updatedNotebooks += 1;
        summary.notebookNames.push(notebook.name);
        return;
      }
    } catch (e) {
      logger.warn('PDF 判定に失敗しました', { notebook: notebook.path, error: String(e) });
    }

    const entry = cacheStore.getEntry(notebook.path);
    logger.info('cache entry', {
      notebook: notebook.name,
      notebookPath: notebook.path,
      cacheEntry: entry,
    });

    const cachedModified = entry ? entry.modified : null;
    const baseline = entry ? entry.baseline : 0;
    const cachedTotalPages = entry && entry.totalPages != null ? entry.totalPages : null;
    const baselineSource = entry ? 'cached baseline' : 'default 0';

    // modified が変わっていない場合はスキップ
    if (cachedModified != null && cachedModified === notebook.modified) {
      summary.skippedNotebooks += 1;
      logger.info('スキップ（modified に変更なし）', {
        notebook: notebook.name,
        modified: notebook.modified,
        baseline,
        baselineSource,
       cachedTotalPages,
      });
      return;
    }

    const totalPages = notebook.totalPages != null ? notebook.totalPages : (cachedTotalPages != null ? cachedTotalPages : baseline);
    logger.info('totalPages extracted', { notebook: notebook.name, totalPages });

    // 有効化リストが空でない場合、リストに含まれているノートのみ TODO 作成する（排他動作）
    const enableList = allowStore.listAll();
    if (Array.isArray(enableList) && enableList.length > 0) {
      const keyCandidates = [notebook.path, notebook.name, notebook.id].filter(Boolean).map(String);
      const enabled = keyCandidates.some((k) => allowStore.has(k));
      if (!enabled) {
        if (totalPages > baseline) {
          const warning = `ノート: ${notebook.name} - TODO 作成が有効化されていないため新規ページを保留しました`;
          summary.warnings.push(warning);
          logger.warn('有効化リスト外のノートで新規ページを検知したためキャッシュ更新を保留します', {
            notebook: notebook.name,
            notebookPath: notebook.path,
            baseline,
            totalPages,
          });
          return;
        }

        logger.info('有効化リスト外のノート（新規ページなし）のためキャッシュのみ更新します', {
          notebook: notebook.name,
          notebookPath: notebook.path,
          baseline,
          totalPages,
        });
        cacheStore.update(notebook.path, { baseline: totalPages, modified: notebook.modified, totalPages });
        summary.updatedNotebooks += 1;
        summary.notebookNames.push(notebook.name);
        return;
      }
    }

    // baseline と比較して処理対象ページを決定する
    logger.info('更新を検知しました', {
      notebook: notebook.name,
      baseline,
      totalPages,
      cachedModified,
      modified: notebook.modified,
    });

    /** @type {number[]} 処理に失敗したページ番号 */
    const failedPages = [];
    /** @type {number[]} TODO を作成できなかったページ番号 */
    const todoCreationFailedPages = [];

    if (totalPages > baseline) {
      // 新しいページがある場合は baseline + 1 ～ total_pages を順に処理
      for (let pageNumber = baseline + 1; pageNumber <= totalPages; pageNumber += 1) {
        const result = await this.syncPage(notebook, pageNumber, summary, syncState);
        if (!result.succeeded) {
          failedPages.push(pageNumber);
          continue;
        }
        if (result.createdTodos <= 0) {
          todoCreationFailedPages.push(pageNumber);
        }
      }
    }

    if (failedPages.length > 0) {
      logger.warn('処理できなかったページがあるためキャッシュは更新しません', {
        notebook: notebook.name,
        failedPages: failedPages.join(','),
      });
      return;
    }

    if (todoCreationFailedPages.length > 0) {
      logger.warn('TODO を作成できなかったページがあるためキャッシュは更新しません', {
        notebook: notebook.name,
        failedPages: todoCreationFailedPages.join(','),
      });
      summary.warnings.push(`ノート: ${notebook.name} - TODO を作成できなかったページ: ${todoCreationFailedPages.join(', ')}`);
      return;
    }

    // すべてのページ処理が成功した場合のみキャッシュを更新する
    cacheStore.update(notebook.path, { baseline: totalPages, modified: notebook.modified, totalPages });
    summary.updatedNotebooks += 1;
    summary.notebookNames.push(notebook.name);

    logger.info('ノートの処理が完了したためキャッシュを更新しました', {
      notebook: notebook.name,
      baseline: totalPages,
      modified: notebook.modified,
      totalPages,
    });
  }

  /**
   * 1ページを処理する（取得 → Gemini 解析 → Todoist 登録）。
   *
   * ページ単位の失敗は記録するだけで、残りのページ処理は継続する。
   * Gemini のクォータ超過が発生した場合は最小 TODO へフォールバックし、
   * 以降のページは Gemini をスキップして最小 TODO を作成する。
   *
   * @param {import('./types').Notebook} notebook
   * @param {number} pageNumber
   * @param {import('./types').SyncSummary} summary - 集計先（副作用で更新する）
   * @param {{ geminiQuotaExceeded: boolean }} syncState - 同期ごとの共有状態
   * @returns {Promise<{ succeeded: boolean, createdTodos: number }>}
   */
  async syncPage(notebook, pageNumber, summary, syncState = { geminiQuotaExceeded: false }) {
    const startedAt = Date.now();

    // クォータ超過フラグが立っている場合は Gemini をスキップして最小 TODO を作成する
    if (syncState.geminiQuotaExceeded) {
      logger.info('Gemini クォータ超過フラグが立っているため最小 TODO を作成します', {
        notebook: notebook.name,
        page: pageNumber,
      });
      return this.syncPageMinimal(notebook, pageNumber, summary, startedAt);
    }

    try {
      // remarkable_page（include_ocr=false）でページ画像を取得
      const image = await pageFetcher.fetchPage(notebook.path, pageNumber, notebook.name);

      // Gemini Vision で OCR・要約・重要ポイント・TODO・タイトルを生成
      let analysis;
      let geminiDurationMs;
      try {
        const geminiResult = await pageAnalyzer.analyzePage({
          notebookName: notebook.name,
          page: pageNumber,
          image,
        });
        analysis = geminiResult.analysis;
        geminiDurationMs = geminiResult.durationMs;
      } catch (geminiError) {
        if (isGeminiQuotaError(geminiError)) {
          syncState.geminiQuotaExceeded = true;
          logger.warn('Gemini クォータ超過を検知しました。このページ以降は最小 TODO にフォールバックします', {
            notebook: notebook.name,
            page: pageNumber,
            error: geminiError instanceof Error ? geminiError.message : String(geminiError),
          });
          return this.syncPageMinimal(notebook, pageNumber, summary, startedAt);
        }
        throw geminiError;
      }

      // Todoist へ登録（失敗はページの失敗として扱う）
      // 呼び出し直前に todo 情報をログ出力して追跡しやすくする
      try {
        logger.info('Todoist 登録直前 (syncService)', {
          notebook: notebook.name,
          page: pageNumber,
          todoCount: Array.isArray(analysis.todo) ? analysis.todo.length : 0,
          todos: Array.isArray(analysis.todo) ? analysis.todo : [],
        });
      } catch (e) {
        logger.warn('Todoist 登録前ログの生成に失敗しました', { error: String(e) });
      }

      const registered = await todoRegistrar.registerTodos({
        notebookName: notebook.name,
        notebookPath: notebook.path,
        page: pageNumber,
        analysis,
      });
      // registerTodos は個別失敗を warnings に蓄積して返す。
      // 警告はページ処理全体の失敗としない（仕様どおり継続する）。
      if (registered.warnings && registered.warnings.length > 0) {
        summary.warnings.push(...registered.warnings);
      }

      const durationMs = Date.now() - startedAt;

      summary.processedPages += 1;
      summary.createdTodos += registered.created;
      summary.pages.push({
        notebookPath: notebook.path,
        notebookName: notebook.name,
        page: pageNumber,
        analysis,
        createdTodos: registered.created,
        durationMs,
        geminiDurationMs,
      });

      logger.info('ページを処理しました', {
        notebook: notebook.name,
        page: pageNumber,
        title: analysis.title,
        createdTodos: registered.created,
        geminiMs: geminiDurationMs,
        durationMs,
      });

      return { succeeded: true, createdTodos: registered.created };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push(`ページ: ${notebook.name} p.${pageNumber} - ${message}`);
      logger.error('ページの処理に失敗しました（残りのページは継続します）', {
        notebook: notebook.name,
        page: pageNumber,
        error: message,
        durationMs: Date.now() - startedAt,
      });
      return { succeeded: false, createdTodos: 0 };
    }
  }

  /**
   * Gemini をスキップして最小限の TODO を作成する（クォータ超過フォールバック）。
   *
   * @param {import('./types').Notebook} notebook
   * @param {number} pageNumber
   * @param {import('./types').SyncSummary} summary - 集計先（副作用で更新する）
   * @param {number} startedAt - Date.now() の開始時刻
   * @returns {Promise<{ succeeded: boolean, createdTodos: number }>}
   */
  async syncPageMinimal(notebook, pageNumber, summary, startedAt) {
    try {
      const registered = await todoRegistrar.registerMinimalTodo({
        notebookName: notebook.name,
        notebookPath: notebook.path,
        page: pageNumber,
      });

      if (registered.warnings && registered.warnings.length > 0) {
        summary.warnings.push(...registered.warnings);
      }

      const durationMs = Date.now() - startedAt;

      summary.processedPages += 1;
      summary.createdTodos += registered.created;
      summary.pages.push({
        notebookPath: notebook.path,
        notebookName: notebook.name,
        page: pageNumber,
        analysis: null,
        createdTodos: registered.created,
        durationMs,
        geminiDurationMs: 0,
      });

      logger.info('最小 TODO でページを処理しました', {
        notebook: notebook.name,
        page: pageNumber,
        createdTodos: registered.created,
        durationMs,
      });

      return { succeeded: true, createdTodos: registered.created };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push(`ページ: ${notebook.name} p.${pageNumber} - ${message}`);
      logger.error('最小 TODO の作成に失敗しました（残りのページは継続します）', {
        notebook: notebook.name,
        page: pageNumber,
        error: message,
        durationMs: Date.now() - startedAt,
      });
      return { succeeded: false, createdTodos: 0 };
    }
  }
}

module.exports = new RemarkableSyncService();
