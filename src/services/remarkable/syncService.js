const config = require('../../config');
const { cacheStore } = require('./cacheStore');
const { normalizeBrowse } = require('./browseNormalizer');
const { fetchPage } = require('./pageFetcher');
const geminiVisionClient = require('./geminiVisionClient');
const logger = require('./logger');
const mcpClient = require('./mcpClient');
const pageAnalyzer = require('./pageAnalyzer');
const todoRegistrar = require('./todoRegistrar');

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
  async sync() {
    if (this.inFlight) {
      logger.warn('同期処理が既に実行中のため、実行中の結果を待機します');
      return this.inFlight;
    }

    this.inFlight = this.runSync().finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  /**
   * 同期本体。
   * @returns {Promise<import('./types').SyncSummary>}
   */
  async runSync() {
    if (!this.isConfigured()) {
      throw new Error(`必要な設定が不足しています: ${this.missingConfig().join(', ')}`);
    }

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

    const notebooks = normalizeBrowse(rawBrowse);
    logger.info('ノート一覧を取得しました', { notebooks: notebooks.length });

    // ③ ノートごとに同期。1冊の失敗で全体を中断しない
    for (const notebook of notebooks) {
      try {
        await this.syncNotebook(notebook, summary);
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
   * @returns {Promise<void>}
   */
  async syncNotebook(notebook, summary) {
    const cachedModified = cacheStore.getModified(notebook.path);
    const baseline = cacheStore.getBaseline(notebook.path);

    // modified が変わっていない場合はスキップ
    if (cachedModified != null && cachedModified === notebook.modified) {
      summary.skippedNotebooks += 1;
      logger.info('スキップ（modified に変更なし）', {
        notebook: notebook.name,
        modified: notebook.modified,
      });
      return;
    }

    // modified が更新されている場合のみ baseline と total_pages を比較する
    const totalPages = notebook.totalPages;
    if (totalPages == null) {
      // ページ数が分からないと処理範囲を決められないため、キャッシュは更新せず次回に委ねる
      summary.errors.push(`ノート: ${notebook.name} - total_pages を取得できませんでした`);
      logger.error('total_pages を取得できないためスキップします', { notebook: notebook.name });
      return;
    }

    logger.info('更新を検知しました', {
      notebook: notebook.name,
      baseline,
      totalPages,
      cachedModified,
      modified: notebook.modified,
    });

    // 新しいページが無い場合は modified のみ更新
    if (totalPages <= baseline) {
      cacheStore.update(notebook.path, { modified: notebook.modified });
      summary.updatedNotebooks += 1;
      summary.notebookNames.push(notebook.name);
      logger.info('新規ページなし（modified のみ更新）', {
        notebook: notebook.name,
        baseline,
        totalPages,
      });
      return;
    }

    // 新しいページがある場合は baseline + 1 ～ total_pages を順に処理
    /** @type {number[]} 処理に失敗したページ番号 */
    const failedPages = [];

    for (let pageNumber = baseline + 1; pageNumber <= totalPages; pageNumber += 1) {
      const succeeded = await this.syncPage(notebook, pageNumber, summary);
      if (!succeeded) failedPages.push(pageNumber);
    }

    // 処理終了後に baseline と modified を更新する
    cacheStore.update(notebook.path, { baseline: totalPages, modified: notebook.modified });
    summary.updatedNotebooks += 1;
    summary.notebookNames.push(notebook.name);

    if (failedPages.length > 0) {
      logger.warn('処理できなかったページがあります', {
        notebook: notebook.name,
        failedPages: failedPages.join(','),
      });
    }

    logger.info('ノートの処理が完了しました', {
      notebook: notebook.name,
      baseline: totalPages,
      modified: notebook.modified,
    });
  }

  /**
   * 1ページを処理する（取得 → Gemini 解析 → Todoist 登録）。
   *
   * ページ単位の失敗は記録するだけで、残りのページ処理は継続する。
   *
   * @param {import('./types').Notebook} notebook
   * @param {number} pageNumber
   * @param {import('./types').SyncSummary} summary - 集計先（副作用で更新する）
   * @returns {Promise<boolean>} 解析まで成功したか
   */
  async syncPage(notebook, pageNumber, summary) {
    const startedAt = Date.now();

    try {
      // remarkable_page（include_ocr=false）でページ画像を取得
      const image = await fetchPage(notebook.path, pageNumber);

      // Gemini Vision で OCR・要約・重要ポイント・TODO・タイトルを生成
      const { analysis, durationMs: geminiDurationMs } = await pageAnalyzer.analyzePage({
        notebookName: notebook.name,
        page: pageNumber,
        image,
      });

      // Todoist へ登録（失敗は Warning のみ）
      const registered = await todoRegistrar.registerTodos({
        notebookName: notebook.name,
        page: pageNumber,
        analysis,
      });
      summary.warnings.push(...registered.warnings);

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

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push(`ページ: ${notebook.name} p.${pageNumber} - ${message}`);
      logger.error('ページの処理に失敗しました（残りのページは継続します）', {
        notebook: notebook.name,
        page: pageNumber,
        error: message,
        durationMs: Date.now() - startedAt,
      });
      return false;
    }
  }
}

module.exports = new RemarkableSyncService();
