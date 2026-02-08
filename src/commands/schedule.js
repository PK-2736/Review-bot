const { SlashCommandBuilder, EmbedBuilder, StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
const ScheduleStore = require('../services/scheduleStore');

const DAYS = ['月', '火', '水', '木', '金', '土', '日'];
const DAY_NUMBERS = { '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6, '日': 0 };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('授業スケジュールを管理します')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('授業スケジュールを追加します')
        .addStringOption(option =>
          option
            .setName('day')
            .setDescription('曜日')
            .setRequired(true)
            .addChoices(
              { name: '月曜日', value: '月' },
              { name: '火曜日', value: '火' },
              { name: '水曜日', value: '水' },
              { name: '木曜日', value: '木' },
              { name: '金曜日', value: '金' },
              { name: '土曜日', value: '土' },
              { name: '日曜日', value: '日' }
            )
        )
        .addStringOption(option =>
          option
            .setName('time')
            .setDescription('授業時間（HH:MM形式、例：18:00）')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('subject')
            .setDescription('授業科目名')
            .setRequired(true)
            .setMaxLength(100)
        )
        .addStringOption(option =>
          option
            .setName('content')
            .setDescription('授業内容（オプション）')
            .setRequired(false)
            .setMaxLength(200)
        )
        .addStringOption(option =>
          option
            .setName('instructor')
            .setDescription('担当講師名（オプション）')
            .setRequired(false)
            .setMaxLength(50)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('登録済みの授業スケジュール一覧を表示します')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('授業スケジュールを削除します')
        .addIntegerOption(option =>
          option
            .setName('id')
            .setDescription('削除するスケジュールのID')
            .setRequired(true)
            .setMinValue(1)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'add') {
      await handleAdd(interaction);
    } else if (subcommand === 'list') {
      await handleList(interaction);
    } else if (subcommand === 'remove') {
      await handleRemove(interaction);
    }
  },
};

/**
 * スケジュール追加処理
 */
async function handleAdd(interaction) {
  await interaction.deferReply();

  try {
    const day = interaction.options.getString('day');
    const time = interaction.options.getString('time');
    const subject = interaction.options.getString('subject');
    const content = interaction.options.getString('content') || '';
    const instructor = interaction.options.getString('instructor') || '';

    // 時間フォーマットの検証
    if (!/^\d{2}:\d{2}$/.test(time)) {
      await interaction.editReply('❌ 時間は HH:MM 形式で指定してください（例：18:00）');
      return;
    }

    const schedule = ScheduleStore.add({
      day,
      time,
      subject,
      content,
      instructor,
    });

    const embed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle('✅ 授業スケジュール追加完了')
      .addFields(
        { name: 'ID', value: `${schedule.id}`, inline: true },
        { name: '曜日', value: `${day}曜日`, inline: true },
        { name: '時間', value: time, inline: true },
        { name: '科目', value: subject, inline: true },
      );

    if (instructor) {
      embed.addFields({ name: '講師', value: instructor, inline: true });
    }

    if (content) {
      embed.addFields({ name: '内容', value: content, inline: false });
    }

    embed.addFields({
      name: '📝 自動実行',
      value: `毎週${day}曜日 ${time} に復習TODOが自動作成されます`,
      inline: false,
    });

    await interaction.editReply({ embeds: [embed] });

    console.log(`✅ 授業スケジュール追加: ${subject} (毎週${day}曜日 ${time})`);

  } catch (error) {
    console.error('スケジュール追加エラー:', error);
    await interaction.editReply('❌ エラーが発生しました。');
  }
}

/**
 * スケジュール一覧表示処理
 */
async function handleList(interaction) {
  await interaction.deferReply();

  try {
    const schedules = ScheduleStore.getAll();

    if (schedules.length === 0) {
      await interaction.editReply('📭 授業スケジュールが登録されていません。\n`/schedule add` で追加できます。');
      return;
    }

    // 曜日でソート
    schedules.sort((a, b) => DAY_NUMBERS[a.day] - DAY_NUMBERS[b.day]);

    const embed = new EmbedBuilder()
      .setColor('#2196F3')
      .setTitle('📅 登録済み授業スケジュール')
      .setDescription(`合計 ${schedules.length} 件`)
      .setTimestamp();

    let scheduleText = '';
    schedules.forEach(schedule => {
      const line = `**ID: ${schedule.id}** | ${schedule.day}曜日 ${schedule.time} | ${schedule.subject}`;
      const instructor = schedule.instructor ? ` (${schedule.instructor})` : '';
      scheduleText += line + instructor + '\n';
    });

    embed.addFields({
      name: 'スケジュール一覧',
      value: scheduleText,
      inline: false,
    });

    embed.setFooter({ text: '/schedule remove [ID] で削除できます' });

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('スケジュール一覧取得エラー:', error);
    await interaction.editReply('❌ エラーが発生しました。');
  }
}

/**
 * スケジュール削除処理
 */
async function handleRemove(interaction) {
  await interaction.deferReply();

  try {
    const id = interaction.options.getInteger('id');
    const schedules = ScheduleStore.getAll();
    const schedule = schedules.find(s => s.id === id);

    if (!schedule) {
      await interaction.editReply(`❌ ID ${id} のスケジュールが見つかりません。`);
      return;
    }

    ScheduleStore.remove(id);

    const embed = new EmbedBuilder()
      .setColor('#FF5722')
      .setTitle('🗑️ 授業スケジュール削除完了')
      .addFields(
        { name: '削除されたスケジュール', value: `${schedule.day}曜日 ${schedule.time} - ${schedule.subject}`, inline: false }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    console.log(`✅ 授業スケジュール削除: ID ${id} (${schedule.subject})`);

  } catch (error) {
    console.error('スケジュール削除エラー:', error);
    await interaction.editReply('❌ エラーが発生しました。');
  }
}
