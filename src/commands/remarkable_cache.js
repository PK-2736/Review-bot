const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cacheStore } = require('../services/remarkable/cacheStore');
const allowStore = require('../services/remarkable/allowStore');
const mcpClient = require('../services/remarkable/mcpClient');
const { normalizeBrowse } = require('../services/remarkable/browseNormalizer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remarkable_cache')
    .setDescription('現在の reMarkable キャッシュの状況を表示します')
    .addBooleanOption(opt => opt.setName('enabled_only').setDescription('TODO作成が有効化されたキャッシュのみ表示する').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    try {
      const cache = cacheStore.load();
      const enabledOnly = interaction.options.getBoolean('enabled_only');
      const enabledList = allowStore.listAll();
      const entries = Object.entries(cache).map(([path, entry]) => ({ path, ...entry }));
      // Try to enrich entries with notebook name by calling remarkable_browse
      let notebooks = [];
      try {
        const raw = await mcpClient.browse('/');
        notebooks = normalizeBrowse(raw) || [];
      } catch (e) {
        // ignore: browse may fail in test environment
      }

      const findNotebookByKey = (key) => {
        if (!key) return null;
        const s = String(key);
        // match path exactly
        let found = notebooks.find(nb => String(nb.path) === s);
        if (found) return found;
        // match by name
        found = notebooks.find(nb => String(nb.name) === s);
        if (found) return found;
        // match by id-like (some notebooks may have id stored as cache key)
        found = notebooks.find(nb => nb.path && String(nb.path).includes(s));
        if (found) return found;
        return null;
      };
      const filtered = enabledOnly ? entries.filter(([ ]) => false) : entries;
      let finalEntries = entries;
      if (enabledOnly) {
        finalEntries = entries.filter(e => enabledList.includes(String(e.path)));
      }

      if (finalEntries.length === 0) {
        await interaction.editReply({ content: '該当するキャッシュエントリはありません。' });
        return;
      }

      const lines = finalEntries.map(e => {
        const isEnabled = enabledList.includes(String(e.path)) ? ' (enabled)' : '';
        const nb = findNotebookByKey(e.path);
        const displayName = nb ? nb.name : (e.name || 'unknown');
        return `${e.path}${isEnabled} — name=${displayName} baseline=${e.baseline} modified=${e.modified || 'null'} totalPages=${e.totalPages}`;
      });

      const embed = new EmbedBuilder()
        .setTitle(enabledOnly ? 'reMarkable キャッシュ（有効化済みのみ）' : 'reMarkable キャッシュ')
        .setDescription(lines.slice(0, 25).join('\n'))
        .setFooter({ text: `${finalEntries.length} 件` });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('remarkable_cache error:', err);
      await interaction.editReply({ content: 'エラーが発生しました' });
    }
  },
};
