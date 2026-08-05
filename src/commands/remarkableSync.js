const { SlashCommandBuilder } = require('discord.js');

const config = require('../config');
const { syncService, formatSyncResult } = require('../services/remarkable');

/**
 * /remarkable_sync
 *
 * 同期を即時実行するだけのコマンド。
 * 同期ロジックは syncService に集約されており、23:00 の自動実行と共通。
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('remarkable_sync')
    .setDescription('reMarkable ノートのレビューを即時実行します'),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    if (!config.remarkable.enabled) {
      await interaction.reply({
        content: '❌ reMarkable レビューが無効です。`.env` の `REMARKABLE_ENABLED=true` を設定してください。',
        ephemeral: true,
      });
      return;
    }

    if (!syncService.isConfigured()) {
      await interaction.reply({
        content: `❌ 設定が不足しています: ${syncService.missingConfig().join(', ')}`,
        ephemeral: true,
      });
      return;
    }

    // 同期には時間がかかるため、先に応答を保留する
    await interaction.deferReply();

    try {
      const summary = await syncService.sync();
      const embed = formatSyncResult(summary);
      if (summary.errors && summary.errors.length > 0) {
        // エラーはファイルにして送信
        const filePath = require('../services/remarkable').createErrorTextFile(summary.errors);
        try {
          await interaction.editReply({ embeds: [embed], files: [{ attachment: filePath, name: 'remarkable-errors.txt' }] });
        } finally {
          try { require('fs').unlinkSync(filePath); } catch (e) { /* ignore */ }
        }
      } else {
        await interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('reMarkable レビュー実行エラー:', error);
      await interaction.editReply({
        content: `❌ レビューに失敗しました。\n\`\`\`\n${message}\n\`\`\``,
      });
    }
  },
};
