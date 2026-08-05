const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cacheStore } = require('../services/remarkable/cacheStore');
const ignoreStore = require('../services/remarkable/ignoreStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remarkable_cache')
    .setDescription('現在の reMarkable キャッシュの状況を表示します'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    try {
      const cache = cacheStore.load();
      const ignored = ignoreStore.listAll();
      const entries = Object.entries(cache).map(([path, entry]) => ({ path, ...entry }));

      if (entries.length === 0) {
        await interaction.editReply({ content: 'キャッシュにノートの情報は登録されていません。' });
        return;
      }

      const lines = entries.map(e => {
        const isIgnored = ignored.includes(e.path) ? ' (ignored)' : '';
        return `${e.path}${isIgnored} — baseline=${e.baseline} modified=${e.modified || 'null'} totalPages=${e.totalPages}`;
      });

      const embed = new EmbedBuilder()
        .setTitle('reMarkable キャッシュ')
        .setDescription(lines.slice(0, 25).join('\n'))
        .setFooter({ text: `${entries.length} 件` });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('remarkable_cache error:', err);
      await interaction.editReply({ content: 'エラーが発生しました' });
    }
  },
};
