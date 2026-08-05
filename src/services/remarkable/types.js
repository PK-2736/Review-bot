/**
 * reMarkable レビュー機能で共有する型定義（JSDoc）。
 *
 * このファイルは実行時の値を持たず、`import('./types').XXX` の形で
 * 各モジュールから型として参照するためだけに存在する。
 */

/**
 * cache.json の1エントリ。
 *
 * キーはノートのパス（例: "/Physics"）。
 *
 * @typedef {Object} CacheEntry
 * @property {number} baseline - 最後にレビュー済みのページ番号
 * @property {string|null} modified - remarkable_browse が返した最終更新日時
 * @property {number|null} totalPages - remarkable_browse が返した総ページ数
 */

/**
 * cache.json 全体（ノートパス -> エントリ）。
 *
 * @typedef {Record<string, CacheEntry>} CacheData
 */

/**
 * remarkable_browse から正規化したノート情報。
 *
 * @typedef {Object} Notebook
 * @property {string} path - ノートのパス（cache.json のキーになる）
 * @property {string} name - 表示名
 * @property {string|null} modified - 最終更新日時
 * @property {number|null} totalPages - 総ページ数（取得できない場合は null）
 */

/**
 * remarkable_page から取得した1ページの画像とメタデータ。
 *
 * remarkable_page のレスポンス JSON をそのまま `meta` に保持する。
 *
 * @typedef {Object} PageImage
 * @property {number} page - ページ番号
 * @property {number|null} totalPages - remarkable_page が返した総ページ数
 * @property {string} mimeType - 画像の MIME タイプ
 * @property {string} data - base64 エンコードされた画像データ
 * @property {Record<string, any>} meta - remarkable_page のレスポンス JSON
 */

/**
 * Gemini Vision がページ画像から生成した解析結果。
 *
 * TODO は 1 ページにつき 1 件を想定する。
 *
 * @typedef {Object} PageAnalysis
 * @property {string} title - 分かりやすいタイトル
 * @property {string} summary - 要約
 * @property {string[]} important_points - 重要ポイント
 * @property {string[]} memorize - 覚えるべき内容
 * @property {string[]} todo - 復習用 TODO（最大 1 件）
 * @property {string[]} tags - タグ
 */

/**
 * 1ページ分の処理結果（将来の拡張機能がここを入力に使える）。
 *
 * @typedef {Object} PageResult
 * @property {string} notebookPath - ノートのパス
 * @property {string} notebookName - ノート名
 * @property {number} page - ページ番号
 * @property {PageAnalysis} analysis - Gemini の解析結果
 * @property {number} createdTodos - Todoist へ登録できた TODO 数
 * @property {number} durationMs - ページ処理にかかった時間（ミリ秒）
 * @property {number} geminiDurationMs - Gemini の応答時間（ミリ秒）
 */

/**
 * 同期処理全体のサマリ。
 *
 * @typedef {Object} SyncSummary
 * @property {number} updatedNotebooks - 更新があり処理したノート数
 * @property {number} skippedNotebooks - modified が変わらずスキップしたノート数
 * @property {number} processedPages - Gemini 解析まで完了したページ数
 * @property {number} createdTodos - Todoist へ登録できた TODO 数
 * @property {string[]} notebookNames - 処理したノート名
 * @property {PageResult[]} pages - ページごとの処理結果
 * @property {string[]} errors - 記録したエラー（同期は継続する）
 * @property {string[]} warnings - 記録した警告（Todoist 失敗など）
 * @property {number} durationMs - 同期処理全体の処理時間（ミリ秒）
 */

module.exports = {};
