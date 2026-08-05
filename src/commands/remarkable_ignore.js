const { SlashCommandBuilder } = require('discord.js');
const mcpClient = require('../services/remarkable/mcpClient');
const { normalizeBrowse } = require('../services/remarkable/browseNormalizer');
const ignoreStore = require('../services/remarkable/ignoreStore');

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
    .setName('remarkable_ignore')
    .setDescription('reMarkable のノートを無視リストへ追加/削除します')
    .addSubcommand((sub) => sub.setName('add').setDescription('ノートを無視リストに追加').addStringOption(opt => opt.setName('notebook').setDescription('無視するノートのパス').setRequired(true).setAutocomplete(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('ノートを無視リストから削除').addStringOption(opt => opt.setName('notebook').setDescription('削除するノートのパス').setRequired(true).setAutocomplete(true)))
    .addSubcommand((sub) => sub.setName('list').setDescription('現在の無視リストを表示')),

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
      const list = ignoreStore.listAll();
      if (list.length === 0) {
        await interaction.reply({ content: '無視リストは空です', ephemeral: true });
      } else {
        await interaction.reply({ content: `無視リスト: \n${list.join('\n')}`, ephemeral: true });
      }
      return;
    }

    const notebook = interaction.options.getString('notebook', true);
    if (sub === 'add') {
      ignoreStore.add(notebook);
      await interaction.reply({ content: `ノートを無視リストに追加しました: ${notebook}`, ephemeral: true });
      return;
    }

    if (sub === 'remove') {
      ignoreStore.remove(notebook);
      await interaction.reply({ content: `ノートを無視リストから削除しました: ${notebook}`, ephemeral: true });
      return;
    }
  },
};
