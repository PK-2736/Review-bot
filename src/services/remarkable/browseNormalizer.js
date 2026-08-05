const logger = require('./logger');

/** ノート一覧が入り得るキーの候補 */
const LIST_KEYS = ['items', 'entries', 'documents', 'notebooks', 'children', 'files', 'results'];
/** パスが入り得るキーの候補 */
const PATH_KEYS = ['path', 'full_path', 'fullPath'];
/** 表示名が入り得るキーの候補 */
const NAME_KEYS = ['name', 'title', 'visible_name', 'visibleName'];
/** ドキュメント種別が入り得るキーの候補 */
const TYPE_KEYS = ['type', 'doc_type', 'format', 'mime_type'];
/** 最終更新日時が入り得るキーの候補 */
const MODIFIED_KEYS = ['modified', 'last_modified', 'lastModified', 'updated', 'updated_at'];
/** 総ページ数が入り得るキーの候補 */
const TOTAL_PAGES_KEYS = ['total_pages', 'totalPages', 'page_count', 'pageCount', 'pages'];
/** フォルダを示す type の値 */
const FOLDER_TYPES = ['folder', 'collection', 'directory', 'dir'];

/**
 * 値から最初に見つかった非空の要素を返す。
 * @param {Record<string, any>} source
 * @param {string[]} keys
 * @returns {any}
 */
function pick(source, keys) {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

/**
 * 0 以上の整数へ変換する（変換できない場合は null）。
 * @param {unknown} value
 * @returns {number|null}
 */
function toPageCount(value) {
  if (Array.isArray(value)) return value.length;

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.floor(numeric);
}

/**
 * remarkable_browse の応答本体（配列 or ラップされたオブジェクト）から配列を取り出す。
 * @param {any} data
 * @returns {any[]}
 */
function toArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];

  for (const key of LIST_KEYS) {
    if (Array.isArray(data[key])) return data[key];
  }
  return [];
}

/**
 * MCP の応答が二重に JSON 文字列化されている実装にも対応して展開する。
 * @param {import('./mcpClient').McpContent} content
 * @returns {any}
 */
function unwrap(content) {
  let data = content.json != null ? content.json : content.text;

  // 文字列で返ってきた場合は最大2段階まで JSON として展開する
  for (let depth = 0; depth < 2 && typeof data === 'string'; depth += 1) {
    try {
      data = JSON.parse(data);
    } catch (error) {
      return null;
    }
  }

  // { result: "<json string>" } 形式への対応
  if (data && typeof data === 'object' && typeof data.result === 'string') {
    try {
      data = JSON.parse(data.result);
    } catch (error) {
      // そのまま扱う
    }
  }

  return data;
}

/**
 * エントリがフォルダかどうかを判定する。
 * @param {Record<string, any>} raw
 * @returns {boolean}
 */
function isFolder(raw) {
  const type = String(pick(raw, ['type', 'kind']) || '').toLowerCase();
  if (FOLDER_TYPES.includes(type)) return true;
  return raw.is_folder === true || raw.isFolder === true;
}

/**
 * remarkable_browse の応答を Notebook[] へ正規化する。
 *
 * MCP サーバー実装差に耐えられるよう、キー名は候補から探索する。
 * フォルダは対象外とし、パスを持たないエントリは無視する。
 *
 * @param {import('./mcpClient').McpContent} content - mcpClient.browse() の戻り値
 * @returns {import('./types').Notebook[]}
 */
function normalizeBrowse(content) {
  const data = unwrap(content);
  const list = toArray(data);

  // 配列が得られない場合は、オブジェクトの値をノート候補として扱うフォールバックを行う
  let effectiveList = list;
  if (effectiveList.length === 0 && data && typeof data === 'object') {
    const candidates = [];
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object') {
        const entry = Object.assign({}, v);
        if (entry.path == null) entry.path = k;
        candidates.push(entry);
      }
    }
    if (candidates.length > 0) {
      effectiveList = candidates;
      logger.info('remarkable_browse: object-map 形式の応答を配列へ変換しました', { candidates: candidates.length });
    }
  }

  if (effectiveList.length === 0) {
    logger.warn('remarkable_browse からノート一覧を取得できませんでした');
    return [];
  }

  /** @type {import('./types').Notebook[]} */
  const notebooks = [];

  for (const raw of effectiveList) {
    if (!raw || typeof raw !== 'object') continue;
    if (isFolder(raw)) continue;

    let notebookPath = pick(raw, PATH_KEYS);
    // フォールバック: path が無ければ id / uuid を path として利用する
    if (notebookPath == null) {
      notebookPath = pick(raw, ['id', 'uuid', 'documentId']);
    }
    if (notebookPath == null) {
      // 最後の手段として表示名を path にする（ユニーク性は保証されない）
      const nameFallback = pick(raw, NAME_KEYS);
      if (nameFallback != null) {
        notebookPath = nameFallback;
      }
    }
    if (notebookPath == null) continue;

    const name = pick(raw, NAME_KEYS);
    const modified = pick(raw, MODIFIED_KEYS);

    notebooks.push({
      path: String(notebookPath),
      name: name != null ? String(name) : String(notebookPath),
      modified: modified != null ? String(modified) : null,
      totalPages: toPageCount(pick(raw, TOTAL_PAGES_KEYS)),
      type: pick(raw, TYPE_KEYS) != null ? String(pick(raw, TYPE_KEYS)).toLowerCase() : null,
    });
  }

  return notebooks;
}

module.exports = { normalizeBrowse };
