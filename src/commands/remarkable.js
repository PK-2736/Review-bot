const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const remarkableService = require('../services/remarkableService');
const RemarkablePageCacheStore = require('../services/remarkablePageCacheStore');
const remarkableMcp = require('../services/remarkableMcp');
const config = require('../config');
const { formatPageRange } = require('../services/remarkableCacheUtils');

// Autocomplete: provide document choices from MCP
async function autocomplete(interaction) {
  try {
    if (!remarkableMcp.isConfigured()) {
      return await interaction.respond([]);
    }

    const focused = interaction.options.getFocused();
    const recentRaw = await remarkableMcp.recent({});
    const docs = remarkableService.normalizeRecent(recentRaw);

    const choices = docs.map(d => ({ name: `${d.name} (${d.path})`, value: d.path }));
    const filtered = focused
      ? choices.filter(c => c.name.toLowerCase().includes(String(focused).toLowerCase()) || c.value.toLowerCase().includes(String(focused).toLowerCase()))
      : choices;

    await interaction.respond(filtered.slice(0, 25));
  } catch (error) {
    console.error('remarkable autocomplete error:', error.message);
    try { await interaction.respond([]); } catch (e) {}
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remarkable')
    .setDescription('reMarkable ノートから復習タスクを同期します')
    .addSubcommand(subcommand =>
      subcommand
        .setName('sync')
        .setDescription('今日更新されたノートを解析してTodoistへ登録します（管理者のみ）')
    )
    
    .addSubcommand(subcommand =>
      subcommand
        .setName('cache-list')
        .setDescription('保存されているページキャッシュ一覧を表示します（管理者のみ）')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('cache')
        .setDescription('ページキャッシュを初期化します。先頭ページ以降を /cache します。')
        .addStringOption(option =>
            option
              .setName('document')
              .setDescription('初期化する reMarkable ドキュメントのパス (選択してください)')
              .setRequired(true)
              .setAutocomplete(true)
        )
        .addIntegerOption(option =>
          option
            .setName('page')
            .setDescription('初期化を開始するページ番号（1以上）')
            .setRequired(true)
            .setMinValue(1)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'sync') {
      await handleSync(interaction);
    } else if (subcommand === 'cache-list') {
      await handleCacheList(interaction);
    } else if (subcommand === 'cache') {
      await handleCache(interaction);
    }
  },
  autocomplete,
};

/**
 * 今すぐ同期
 */
async function handleSync(interaction) {
  try {
    // 権限チェック（管理者のみ）
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return await interaction.reply({
        content: '❌ このコマンドは管理者のみが実行できます。',
        ephemeral: true,
      });
    }

    if (!config.remarkable.enabled) {
      return await interaction.reply({
        content: '❌ reMarkable 同期が無効化されています。`.env` の `REMARKABLE_ENABLED=true` を設定してください。',
        ephemeral: true,
      });
    }

    if (!remarkableService.isConfigured()) {
      return await interaction.reply({
        content: `❌ 設定が不足しています: ${remarkableService.missingConfig().join(', ')}`,
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    const startTime = Date.now();
    const result = await remarkableService.syncTodayReviews();
    const duration = (Date.now() - startTime) / 1000;

    if (result.created === 0 && result.notebooks === 0) {
      const embed = new EmbedBuilder()
        .setColor('#808080')
        .setTitle('🖊️ reMarkable 復習同期')
        .setDescription('今日、新しく解析するノートはありませんでした。')
        .addFields({ name: '⏭️ スキップ', value: `${result.skipped}件（解析済みページ）`, inline: true })
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    }

    const embed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle('✅ reMarkable 復習同期完了')
      .addFields(
        { name: '➕ 追加', value: `${result.created}件のタスク`, inline: true },
        { name: '📓 ノート', value: `${result.notebooks}冊`, inline: true },
        { name: '⏭️ スキップ', value: `${result.skipped}件`, inline: true }
      );

    if (result.notebookNames.length > 0) {
      embed.addFields({
        name: '📚 対象ノート',
        value: result.notebookNames.join(' / '),
        inline: false,
      });
    }

    if (result.errors.length > 0) {
      embed.addFields({
        name: '⚠️ エラー',
        value: result.errors.slice(0, 5).join('\n').slice(0, 1000),
        inline: false,
      });
    }

    embed.addFields({ name: '⏱️ 処理時間', value: `${duration.toFixed(2)}秒`, inline: false });
    embed.setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    console.log(`✅ reMarkable手動同期完了 (追加: ${result.created}, ノート: ${result.notebooks}, スキップ: ${result.skipped})`);
  } catch (error) {
    console.error('reMarkable同期エラー:', error);
    const message = `❌ reMarkable の同期に失敗しました。\n\`\`\`\n${error.message}\n\`\`\``;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message });
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  }
}

/**
 * ページキャッシュを初期化
 */
async function handleCache(interaction) {
  try {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return await interaction.reply({
        content: '❌ このコマンドは管理者のみが実行できます。',
        ephemeral: true,
      });
    }

    if (!remarkableMcp.isConfigured()) {
      return await interaction.reply({
        content: '❌ 設定が不足しています: REMARKABLE_MCP_URL',
        ephemeral: true,
      });
    }

    const documentPath = interaction.options.getString('document');
    const page = interaction.options.getInteger('page');
    const normalizedKey = RemarkablePageCacheStore.normalizeDocumentPath(documentPath);

    console.log('Cache key:', `document=${documentPath}`, `normalizedKey=${normalizedKey}`);
    await interaction.deferReply();

    RemarkablePageCacheStore.ensureCacheFile();
    RemarkablePageCacheStore.setDocumentBaseline(documentPath, page);
    RemarkablePageCacheStore.save();

    const embed = new EmbedBuilder()
      .setColor('#FF9800')
      .setTitle('🗂️ reMarkable ページキャッシュ初期化完了')
      .setDescription(`ドキュメント: ${documentPath}`)
      .addFields(
        { name: '📄 baseline', value: String(page), inline: true }
      )
      .setTimestamp();

    return await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('reMarkable cache 初期化エラー:', error);
    const message = `❌ ページキャッシュの初期化に失敗しました。\n\`\`\`\n${error.message}\n\`\`\``;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message });
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  }
}

// `list` subcommand removed per request

/**
 * 保存されているページキャッシュ一覧を表示
 */
async function handleCacheList(interaction) {
  try {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return await interaction.reply({ content: '❌ このコマンドは管理者のみが実行できます。', ephemeral: true });
    }

    await interaction.deferReply();

    const docs = RemarkablePageCacheStore.getCachedDocuments();
    if (!docs || docs.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('#808080')
        .setTitle('🗂️ ページキャッシュ一覧')
        .setDescription('ページキャッシュは登録されていません。`/remarkable cache` で初期化してください。')
        .setTimestamp();
      return await interaction.editReply({ embeds: [embed] });
    }

    const embed = new EmbedBuilder()
      .setColor('#FF9800')
      .setTitle('🗂️ ページキャッシュ一覧')
      .setTimestamp();

    for (const doc of docs) {
      const baseline = RemarkablePageCacheStore.getDocumentBaseline(doc) || 0;
      const pageSummary = `baseline ${baseline}`;
      embed.addFields({ name: doc, value: pageSummary, inline: false });
    }

    embed.addFields({ name: '合計', value: `${docs.length}ドキュメント`, inline: false });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('cache-list 取得エラー:', error);
    await interaction.editReply({ content: '❌ キャッシュ一覧の取得に失敗しました。' });
  }
}
