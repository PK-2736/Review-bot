/**
 * reMarkable レビュー機能専用のロガー。
 *
 * 仕様（remarkable-review2.md）で要求されている記録項目:
 *   - ノート名
 *   - ページ番号
 *   - 処理時間
 *   - Gemini の応答時間
 *   - 作成した TODO 数
 *
 * すべて同じ接頭辞を付けて出力し、`pm2 logs | grep reMarkable` で追えるようにする。
 */

const PREFIX = '🖊️ [reMarkable]';

/**
 * 付加情報を `key=value` 形式の文字列へ変換する。
 * @param {Record<string, unknown>} [meta]
 * @returns {string}
 */
function formatMeta(meta) {
  if (!meta) return '';

  const parts = Object.entries(meta)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);

  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

/**
 * @param {string} message
 * @param {Record<string, unknown>} [meta]
 */
function info(message, meta) {
  console.log(`${PREFIX} ${message}${formatMeta(meta)}`);
}

/**
 * @param {string} message
 * @param {Record<string, unknown>} [meta]
 */
function warn(message, meta) {
  console.warn(`${PREFIX} ⚠️ ${message}${formatMeta(meta)}`);
}

/**
 * @param {string} message
 * @param {Record<string, unknown>} [meta]
 */
function error(message, meta) {
  console.error(`${PREFIX} ❌ ${message}${formatMeta(meta)}`);
}

module.exports = { info, warn, error };
