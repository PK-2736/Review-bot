const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const remarkableService = require('../services/remarkableService');
const RemarkablePageSyncService = require('../services/remarkablePageSyncService');
const RemarkableCacheStore = require('../services/remarkableCacheStore');
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
        .setName('list')
        .setDescription('直近で解析したノート・ページを表示します')
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
    } else if (subcommand === 'list') {
      await handleList(interaction);
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

    const result = await RemarkablePageSyncService.initializeCacheForDocument(documentPath, page);

    const embed = new EmbedBuilder()
      .setColor('#FF9800')
      .setTitle('🗂️ reMarkable ページキャッシュ初期化完了')
      .setDescription(`ドキュメント: ${documentPath}`)
      .addFields(
        { name: '📄 開始ページ', value: String(page), inline: true },
        { name: '✅ 登録ページ', value: `${result.registeredPages}件`, inline: true },
        { name: '🔁 変更ページ', value: `${result.changedPages.length}件`, inline: true }
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

/**
 * 直近で解析したノート・ページを表示
 */
async function handleList(interaction) {
  try {
    await interaction.deferReply();

    const items = RemarkableCacheStore.getAll();

    if (items.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('#808080')
        .setTitle('🖊️ reMarkable 解析履歴')
        .setDescription('まだ解析したノートがありません。\n\n`/remarkable sync` を実行してください。')
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    }

    // ノートごとにページ数を集計
    const byNotebook = new Map();
    for (const item of items) {
      const name = item.notebook || '(無題ノート)';
      byNotebook.set(name, (byNotebook.get(name) || 0) + 1);
    }

    // 直近の処理日時
    const sorted = [...items].sort((a, b) => {
      const ta = a.processedAt ? new Date(a.processedAt).getTime() : 0;
      const tb = b.processedAt ? new Date(b.processedAt).getTime() : 0;
      return tb - ta;
    });
    const latest = sorted[0] && sorted[0].processedAt
      ? new Date(sorted[0].processedAt).toLocaleString('ja-JP')
      : '不明';

    const embed = new EmbedBuilder()
      .setColor('#2196F3')
      .setTitle('🖊️ reMarkable 解析履歴')
      .setDescription(`解析済みページ: ${items.length}件`)
      .setTimestamp();

    [...byNotebook.entries()].slice(0, 15).forEach(([name, count]) => {
      embed.addFields({ name, value: `${count}ページ`, inline: true });
    });

    embed.addFields(
      { name: '🕒 最終解析', value: latest, inline: false },
      {
        name: '⚙️ 同期設定',
        value: `自動実行: ${config.remarkable.enabled ? '有効' : '無効'}\n実行時刻: ${config.remarkable.syncTime}`,
        inline: false,
      }
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('reMarkable履歴取得エラー:', error);
    await interaction.editReply({ content: '❌ 解析履歴の取得に失敗しました。' });
  }
}

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

    let totalPages = 0;
    for (const doc of docs) {
      const pages = RemarkablePageCacheStore.getPageNumbers(doc);
      totalPages += pages.length;
      const range = formatPageRange(pages);
      embed.addFields({ name: doc, value: `${pages.length}ページ${range ? ` (${range})` : ''}`, inline: false });
    }

    embed.addFields({ name: '合計', value: `${docs.length}ドキュメント / ${totalPages}ページ`, inline: false });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('cache-list 取得エラー:', error);
    await interaction.editReply({ content: '❌ キャッシュ一覧の取得に失敗しました。' });
  }
}
