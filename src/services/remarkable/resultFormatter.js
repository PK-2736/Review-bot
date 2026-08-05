const { EmbedBuilder } = require('discord.js');

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
 * 同期結果を Discord 埋め込みへ整形する。
 *
 * コマンド実行と 23:00 の自動実行で同じ表示になるよう、整形もここに集約する。
 *
 * @param {import('./types').SyncSummary} summary
 * @returns {EmbedBuilder}
 */
function formatSyncResult(summary) {
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('reMarkable レビュー完了')
    .setDescription('同期結果をまとめました。')
    .addFields(
      { name: '更新されたノート', value: `${summary.updatedNotebooks}冊`, inline: true },
      { name: '処理したページ', value: `${summary.processedPages}ページ`, inline: true },
      { name: '作成したTODO', value: `${summary.createdTodos}件`, inline: true },
    )
    .setTimestamp();

  if (summary.errors.length > 0) {
    embed.addFields({
      name: `エラー ${summary.errors.length}件`,
      value: formatIssues(summary.errors),
      inline: false,
    });
  }
  if (summary.warnings.length > 0) {
    embed.addFields({
      name: `警告 ${summary.warnings.length}件`,
      value: formatIssues(summary.warnings),
      inline: false,
    });
  }

  embed.setFooter({ text: 'reMarkable / Todoist' });
  return embed;
}

module.exports = { formatSyncResult };
