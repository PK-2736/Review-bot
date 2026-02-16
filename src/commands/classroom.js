const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const classroomService = require('../services/classroomService');
const ClassroomTaskStore = require('../services/classroomTaskStore');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('classroom')
    .setDescription('Google Classroom の課題を表示します')
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('期限が近い課題を表示します')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('sync')
        .setDescription('今すぐClassroom課題を同期します（管理者のみ）')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'list') {
      await handleList(interaction);
    } else if (subcommand === 'sync') {
      await handleSync(interaction);
    }
  },
};

/**
 * 課題一覧を表示
 */
async function handleList(interaction) {
  try {
    await interaction.deferReply();

    if (!config.classroom.enabled) {
      return await interaction.editReply({
        content: '❌ Google Classroom 同期が無効化されています。',
        ephemeral: true
      });
    }

    // 保存済みのタスク情報を取得
    const storedTasks = ClassroomTaskStore.getAll();

    if (storedTasks.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('#808080')
        .setTitle('📚 Google Classroom 課題')
        .setDescription('登録済みの課題がありません。\n\n`/classroom sync` を実行して同期してください。')
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    }

    // 期限でソート
    const sorted = [...storedTasks].sort((a, b) => {
      const dateA = new Date(a.dueKey);
      const dateB = new Date(b.dueKey);
      return dateA - dateB;
    });

    // Embedを分割（フィールド数制限対応）
    const now = new Date();
    const daysFromNow = config.classroom.dueWithinDays || 7;
    const limitDate = new Date(now.getTime() + daysFromNow * 24 * 60 * 60 * 1000);

    const urgent = sorted.filter(t => {
      const dueDate = new Date(t.dueKey);
      return dueDate <= now;
    });

    const upcoming = sorted.filter(t => {
      const dueDate = new Date(t.dueKey);
      return dueDate > now && dueDate <= limitDate;
    });

    const future = sorted.filter(t => {
      const dueDate = new Date(t.dueKey);
      return dueDate > limitDate;
    });

    const embeds = [];

    // 緊急（期限切れ）
    if (urgent.length > 0) {
      const embed = new EmbedBuilder()
        .setColor('#F44336')
        .setTitle('🚨 期限切れ課題')
        .setDescription(`${urgent.length} 件`)
        .setTimestamp();

      urgent.slice(0, 10).forEach(task => {
        const dueDate = new Date(task.dueKey);
        const dateStr = dueDate.toLocaleDateString('ja-JP', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }).replace(/:/g, ':');

        embed.addFields({
          name: task.content,
          value: `📅 ${dateStr}`,
          inline: false
        });
      });

      if (urgent.length > 10) {
        embed.addFields({
          name: '他',
          value: `他 ${urgent.length - 10} 件`,
          inline: false
        });
      }

      embeds.push(embed);
    }

    // 近い予定（${daysFromNow}日以内）
    if (upcoming.length > 0) {
      const embed = new EmbedBuilder()
        .setColor('#FF9800')
        .setTitle(`⏰ ${daysFromNow}日以内の課題`)
        .setDescription(`${upcoming.length} 件`)
        .setTimestamp();

      upcoming.slice(0, 10).forEach(task => {
        const dueDate = new Date(task.dueKey);
        const daysLeft = Math.ceil((dueDate - now) / (24 * 60 * 60 * 1000));
        const dateStr = dueDate.toLocaleDateString('ja-JP', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }).replace(/:/g, ':');

        const daysLabel = daysLeft === 0 ? '今日' : daysLeft === 1 ? '明日' : `${daysLeft}日後`;

        embed.addFields({
          name: task.content,
          value: `📅 ${dateStr} (${daysLabel})`,
          inline: false
        });
      });

      if (upcoming.length > 10) {
        embed.addFields({
          name: '他',
          value: `他 ${upcoming.length - 10} 件`,
          inline: false
        });
      }

      embeds.push(embed);
    }

    // 将来の課題
    if (future.length > 0) {
      const embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('📋 将来の課題')
        .setDescription(`${future.length} 件（表示: 最新5件）`)
        .setTimestamp();

      future.slice(0, 5).forEach(task => {
        const dueDate = new Date(task.dueKey);
        const daysLeft = Math.ceil((dueDate - now) / (24 * 60 * 60 * 1000));
        const dateStr = dueDate.toLocaleDateString('ja-JP', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }).replace(/:/g, ':');

        embed.addFields({
          name: task.content,
          value: `📅 ${dateStr} (${daysLeft}日後)`,
          inline: false
        });
      });

      if (future.length > 5) {
        embed.addFields({
          name: '他',
          value: `他 ${future.length - 5} 件`,
          inline: false
        });
      }

      embeds.push(embed);
    }

    // embeds がない場合
    if (embeds.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('#808080')
        .setTitle('📚 Google Classroom 課題')
        .setDescription('期限が近い課題がありません。')
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    }

    // 統計情報を追加
    const summaryEmbed = new EmbedBuilder()
      .setColor('#2196F3')
      .setTitle('📊 統計情報')
      .addFields(
        { name: '🚨 期限切れ', value: `${urgent.length}件`, inline: true },
        { name: `⏰ ${daysFromNow}日以内`, value: `${upcoming.length}件`, inline: true },
        { name: '📋 それ以降', value: `${future.length}件`, inline: true }
      )
      .setTimestamp();

    // 設定値を表示
    summaryEmbed.addFields({
      name: '⚙️ 同期設定',
      value: `期限: ${daysFromNow}日以内\n実行時刻: ${config.classroom.syncTime}\nプロジェクト: ${config.classroom.projectName}`,
      inline: false
    });

    await interaction.editReply({
      embeds: [...embeds, summaryEmbed]
    });

  } catch (error) {
    console.error('Classroom課題一覧取得エラー:', error);
    await interaction.editReply({
      content: '❌ Classroom課題の取得に失敗しました。',
      ephemeral: true
    });
  }
}

/**
 * 今すぐ同期
 */
async function handleSync(interaction) {
  try {
    // 権限チェック（管理者のみ）
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return await interaction.reply({
        content: '❌ このコマンドは管理者のみが実行できます。',
        ephemeral: true
      });
    }

    if (!config.classroom.enabled) {
      return await interaction.reply({
        content: '❌ Google Classroom 同期が無効化されています。',
        ephemeral: true
      });
    }

    await interaction.deferReply();

    const startTime = Date.now();
    const result = await classroomService.syncPendingTasks();
    const duration = (Date.now() - startTime) / 1000;

    const embed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle('✅ Classroom課題の同期完了')
      .addFields(
        { name: '➕ 追加', value: `${result.created}件`, inline: true },
        { name: '🔄 更新', value: `${result.updated}件`, inline: true },
        { name: '✔️ 完了', value: `${result.closed}件`, inline: true },
        { name: '⏭️ スキップ', value: `${result.skipped}件`, inline: true }
      )
      .addFields({
        name: '⏱️ 処理時間',
        value: `${duration.toFixed(2)}秒`,
        inline: false
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    console.log(`✅ 手動同期完了 (追加: ${result.created}, 更新: ${result.updated}, 完了: ${result.closed}, スキップ: ${result.skipped})`);

  } catch (error) {
    console.error('Classroom同期エラー:', error);
    await interaction.editReply({
      content: `❌ Classroom課題の同期に失敗しました。\n\`\`\`\n${error.message}\n\`\`\``,
      ephemeral: true
    });
  }
}
