/** Discord へ表示するエラー・警告の最大件数 */
const MAX_ISSUE_LINES = 5;

/**
 * 一覧を指定件数で切り詰めて箇条書きにする。
 * @param {string[]} items
 * @returns {string}
 */
function formatIssues(items) {
  const lines = items.slice(0, MAX_ISSUE_LINES).map((item) => `・${item}`);
  if (items.length > MAX_ISSUE_LINES) {
    lines.push(`・他 ${items.length - MAX_ISSUE_LINES}件`);
  }
  return lines.join('\n');
}

/**
 * 同期結果を Discord へ送るテキストへ整形する。
 *
 * コマンド実行と 23:00 の自動実行で同じ表示になるよう、整形もここに集約する。
 *
 * @param {import('./types').SyncSummary} summary
 * @returns {string}
 */
function formatSyncResult(summary) {
  const sections = [
    'レビュー完了',
    `更新されたノート：${summary.updatedNotebooks}冊`,
    `処理したページ：${summary.processedPages}ページ`,
    `作成したTODO：${summary.createdTodos}件`,
  ];

  if (summary.errors.length > 0) {
    sections.push(`エラー：${summary.errors.length}件\n${formatIssues(summary.errors)}`);
  }
  if (summary.warnings.length > 0) {
    sections.push(`警告：${summary.warnings.length}件\n${formatIssues(summary.warnings)}`);
  }

  // 仕様の実行結果例にあわせて各項目を空行で区切る
  return sections.join('\n\n');
}

module.exports = { formatSyncResult };
