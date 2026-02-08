const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const ReminderStore = require('../services/reminderStore');

const DAYS = ['月', '火', '水', '木', '金', '土', '日'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reminder')
    .setDescription('週間リマインダーを管理します')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('リマインダーを追加します')
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
            .setDescription('実行時間（HH:MM形式、例：20:00）')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('content')
            .setDescription('リマインダーのテキスト（この内容でTODOを作成します）')
            .setRequired(true)
            .setMaxLength(200)
        )
        .addBooleanOption(option =>
          option
            .setName('once')
            .setDescription('一度だけ実行するか（指定時のみ実行、デフォルト：毎週）')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('登録されているリマインダーを表示します')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('リマインダーを削除します')
        .addIntegerOption(option =>
          option
            .setName('id')
            .setDescription('削除するリマインダーのID')
            .setRequired(true)
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
 * リマインダー追加処理
 */
async function handleAdd(interaction) {
  try {
    const day = interaction.options.getString('day');
    const time = interaction.options.getString('time');
    const content = interaction.options.getString('content');
    const once = interaction.options.getBoolean('once') || false;

    // 時間フォーマットチェック
    if (!/^\d{1,2}:\d{2}$/.test(time)) {
      return await interaction.reply({
        content: '❌ 時間は `HH:MM` 形式で指定してください（例：20:00）',
        ephemeral: true
      });
    }

    // 時間の妥当性チェック
    const [hours, minutes] = time.split(':').map(Number);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return await interaction.reply({
        content: '❌ 有効な時間を指定してください（00:00 ～ 23:59）',
        ephemeral: true
      });
    }

    // リマインダーを追加
    const reminder = ReminderStore.add({
      day,
      time,
      content,
      once,
    });

    const dayName = `${day}曜日`;
    const onceLabel = once ? '（次の週のみ）' : '（毎週）';
    const embed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle('✅ リマインダー追加完了')
      .addFields(
        { name: 'ID', value: `${reminder.id}`, inline: true },
        { name: '曜日', value: dayName, inline: true },
        { name: '実行時間', value: time, inline: true },
        { name: 'リマインダー', value: content, inline: false },
        { name: '実行タイプ', value: onceLabel, inline: false }
      )
      .setFooter({ text: once ? '1回だけ実行後は自動削除されます' : '毎週このタイミングでTODOが追加されます' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    console.log(`✅ リマインダー追加: ID=${reminder.id}, ${dayName} ${time} - ${content}${once ? ' (一度だけ)' : ''}`);

  } catch (error) {
    console.error('リマインダー追加エラー:', error);
    await interaction.reply({
      content: '❌ リマインダーの追加に失敗しました。',
      ephemeral: true
    });
  }
}}

/**
 * リマインダー一覧表示処理
 */
async function handleList(interaction) {
  try {
    const reminders = ReminderStore.getAll();

    if (reminders.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('#808080')
        .setTitle('📋 リマインダー一覧')
        .setDescription('登録されているリマインダーはありません。\n\n`/reminder add` で新しいリマインダーを作成してください。')
        .setTimestamp();

      return await interaction.reply({ embeds: [embed] });
    }

    // 曜日ごとにグループ化
    const grouped = {};
    DAYS.forEach(day => {
      grouped[day] = [];
    });

    reminders.forEach(reminder => {
      grouped[reminder.day].push(reminder);
    });

    const embed = new EmbedBuilder()
      .setColor('#2196F3')
      .setTitle('📋 リマインダー一覧')
      .setDescription(`合計 ${reminders.length} 件のリマインダーが登録されています`)
      .setTimestamp();

    DAYS.forEach(day => {
      const dayReminders = grouped[day];
      if (dayReminders.length > 0) {
        const reminderList = dayReminders
          .map(r => {
            const onceLabel = r.once ? ' (1回のみ)' : '';
            return `🔔 **${r.time}** - ${r.content}${onceLabel} (ID: ${r.id})`;
          })
          .join('\n');
        
        embed.addFields({
          name: `${day}曜日`,
          value: reminderList,
          inline: false
        });
      }
    });

    embed.setFooter({ text: '削除するには /reminder remove id:<ID> で実行' });

    await interaction.reply({ embeds: [embed] });

  } catch (error) {
    console.error('リマインダー一覧取得エラー:', error);
    await interaction.reply({
      content: '❌ リマインダー一覧の取得に失敗しました。',
      ephemeral: true
    });
  }
}

/**
 * リマインダー削除処理
 */
async function handleRemove(interaction) {
  try {
    const id = interaction.options.getInteger('id');
    const reminders = ReminderStore.getAll();
    const reminder = reminders.find(r => r.id === id);

    if (!reminder) {
      return await interaction.reply({
        content: `❌ ID \`${id}\` のリマインダーが見つかりません。\n\n\`/reminder list\` で登録済みのリマインダーを確認してください。`,
        ephemeral: true
      });
    }

    ReminderStore.remove(id);

    const embed = new EmbedBuilder()
      .setColor('#FF9800')
      .setTitle('🗑️ リマインダー削除完了')
      .addFields(
        { name: 'ID', value: `${reminder.id}`, inline: true },
        { name: '曜日', value: `${reminder.day}曜日`, inline: true },
        { name: '実行時間', value: reminder.time, inline: true },
        { name: 'リマインダー', value: reminder.content, inline: false }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    console.log(`✅ リマインダー削除: ID=${id}`);

  } catch (error) {
    console.error('リマインダー削除エラー:', error);
    await interaction.reply({
      content: '❌ リマインダーの削除に失敗しました。',
      ephemeral: true
    });
  }
}
