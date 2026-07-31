const fs = require('fs');
const path = require('path');

const config = require('../../config');
const logger = require('./logger');

/**
 * cache.json の管理クラス。
 *
 * ファイル形式は仕様（remarkable-review2.md）どおり、
 * ノートパスをキーにした 1 階層の JSON。
 *
 * ```json
 * {
 *   "/Physics": { "baseline": 58, "modified": "2026-07-30T12:58:00.472000" },
 *   "/Math":    { "baseline": 24, "modified": "2026-07-29T18:00:00.000000" }
 * }
 * ```
 *
 * - baseline : 最後にレビュー済みのページ番号
 * - modified : remarkable_browse が返した最終更新日時
 */
class RemarkableCacheStore {
  /**
   * @param {string} filePath - cache.json のパス
   */
  constructor(filePath) {
    /** @type {string} */
    this.filePath = filePath;
    /** @type {import('./types').CacheData|null} 遅延ロードしたキャッシュ */
    this.cache = null;
  }

  /**
   * キャッシュを読み込む（初回のみファイルアクセス）。
   *
   * ファイルが無い場合・壊れている場合は空のキャッシュとして扱い、
   * 同期処理を止めない。
   *
   * @returns {import('./types').CacheData}
   */
  load() {
    if (this.cache) return this.cache;

    if (!fs.existsSync(this.filePath)) {
      logger.info('cache.json が存在しないため空のキャッシュで開始します', { file: this.filePath });
      this.cache = {};
      return this.cache;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      this.cache = this.normalize(raw.trim() ? JSON.parse(raw) : {});
      logger.info('cache.json を読み込みました', {
        file: this.filePath,
        notebooks: Object.keys(this.cache).length,
      });
    } catch (error) {
      // 壊れた JSON でも同期を継続できるよう、空のキャッシュへフォールバックする
      logger.error('cache.json の読み込みに失敗したため空のキャッシュを使用します', {
        file: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      this.cache = {};
    }

    return this.cache;
  }

  /**
   * 読み込んだ JSON を CacheEntry の形へ正規化する。
   * @param {unknown} parsed
   * @returns {import('./types').CacheData}
   */
  normalize(parsed) {
    /** @type {import('./types').CacheData} */
    const normalized = {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return normalized;
    }

    for (const [notebookPath, value] of Object.entries(/** @type {Record<string, any>} */ (parsed))) {
      if (!value || typeof value !== 'object') continue;

      normalized[this.normalizePath(notebookPath)] = {
        baseline: this.normalizeBaseline(value.baseline),
        modified: value.modified != null ? String(value.modified) : null,
      };
    }

    return normalized;
  }

  /**
   * ノートパスをキャッシュのキー形式へ正規化する（先頭スラッシュ付き・末尾スラッシュなし）。
   * @param {string} notebookPath
   * @returns {string}
   */
  normalizePath(notebookPath) {
    const trimmed = String(notebookPath == null ? '' : notebookPath).trim().replace(/\/+$/, '');
    if (!trimmed) return '/';
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }

  /**
   * baseline を 0 以上の整数へ正規化する。
   * @param {unknown} value
   * @returns {number}
   */
  normalizeBaseline(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return 0;
    return Math.floor(numeric);
  }

  /**
   * 指定ノートのキャッシュエントリを取得する。
   * @param {string} notebookPath
   * @returns {import('./types').CacheEntry|null} 未登録の場合は null
   */
  getEntry(notebookPath) {
    const cache = this.load();
    return cache[this.normalizePath(notebookPath)] || null;
  }

  /**
   * baseline（最後にレビュー済みのページ番号）を取得する。
   * 未登録のノートは 0（=1ページ目から処理対象）として扱う。
   * @param {string} notebookPath
   * @returns {number}
   */
  getBaseline(notebookPath) {
    const entry = this.getEntry(notebookPath);
    return entry ? entry.baseline : 0;
  }

  /**
   * キャッシュに記録されている modified を取得する。
   * @param {string} notebookPath
   * @returns {string|null}
   */
  getModified(notebookPath) {
    const entry = this.getEntry(notebookPath);
    return entry ? entry.modified : null;
  }

  /**
   * baseline / modified を更新する（メモリ上のみ。保存は save() で行う）。
   * @param {string} notebookPath
   * @param {{ baseline?: number, modified?: string|null }} values
   * @returns {import('./types').CacheEntry}
   */
  update(notebookPath, values) {
    const cache = this.load();
    const key = this.normalizePath(notebookPath);
    const entry = cache[key] || { baseline: 0, modified: null };

    if (values.baseline !== undefined) {
      entry.baseline = this.normalizeBaseline(values.baseline);
    }
    if (values.modified !== undefined) {
      entry.modified = values.modified != null ? String(values.modified) : null;
    }

    cache[key] = entry;
    return entry;
  }

  /**
   * キャッシュをファイルへ保存する。
   * 保存に失敗しても同期処理を止めないよう、例外は投げず false を返す。
   * @returns {boolean} 保存できたか
   */
  save() {
    const cache = this.load();

    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf-8');
      logger.info('cache.json を保存しました', {
        file: this.filePath,
        notebooks: Object.keys(cache).length,
      });
      return true;
    } catch (error) {
      logger.error('cache.json の保存に失敗しました', {
        file: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

module.exports = {
  RemarkableCacheStore,
  /** アプリ全体で共有するキャッシュインスタンス */
  cacheStore: new RemarkableCacheStore(config.remarkable.cacheFile),
};
