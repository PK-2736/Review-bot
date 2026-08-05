const { SlashCommandBuilder } = require('discord.js');
const mcpClient = require('../services/remarkable/mcpClient');
const { normalizeBrowse } = require('../services/remarkable/browseNormalizer');
const allowStore = require('../services/remarkable/allowStore');

/** Helper to fetch notebooks for autocomplete (limited to 25) */
async function fetchNotebooks() {
  try {
    const raw = await mcpClient.browse('/');
    const list = normalizeBrowse(raw);
    return list;
  } catch (e) {
    return [];
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remarkable_enable')
    .setDescription('reMarkable のノートについて TODO 作成を有効化/無効化します（排他的）')
    .addSubcommand((sub) => sub.setName('add').setDescription('ノートを TODO 作成有効リストに追加').addStringOption(opt => opt.setName('notebook').setDescription('有効化するノートのパスまたはID').setRequired(true).setAutocomplete(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('ノートを TODO 作成有効リストから削除').addStringOption(opt => opt.setName('notebook').setDescription('削除するノートのパスまたはID').setRequired(true).setAutocomplete(true)))
    .addSubcommand((sub) => sub.setName('list').setDescription('現在の有効化リストを表示')),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const value = focused.value || '';
    const notebooks = await fetchNotebooks();
    const choices = notebooks
      .filter(nb => nb.path.toLowerCase().includes(String(value).toLowerCase()) || nb.name.toLowerCase().includes(String(value).toLowerCase()))
      .slice(0, 25)
      .map(nb => ({ name: `${nb.name} — ${nb.path}`, value: nb.path }));
    await interaction.respond(choices);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const list = allowStore.listAll();
      if (list.length === 0) {
        await interaction.reply({ content: '有効化リストは空です（空なら全ノートが対象）', ephemeral: true });
      } else {
        await interaction.reply({ content: `有効化リスト: \n${list.join('\n')}`, ephemeral: true });
      }
      return;
    }

    const notebook = interaction.options.getString('notebook', true);
    if (sub === 'add') {
      allowStore.add(notebook);
      await interaction.reply({ content: `ノートを TODO 作成有効リストに追加しました: ${notebook}`, ephemeral: true });
      return;
    }

    if (sub === 'remove') {
      allowStore.remove(notebook);
      await interaction.reply({ content: `ノートを TODO 作成有効リストから削除しました: ${notebook}`, ephemeral: true });
      return;
    }
  },
};
