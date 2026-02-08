const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const todoistService = require('../services/todoist');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('class')
    .setDescription('授業内容を登録して復習タスクを自動作成します')
    .addStringOption(option =>
      option
        .setName('subject')
        .setDescription('授業の科目名・タイトル')
        .setRequired(true)
        .setMaxLength(100)
    )
    .addStringOption(option =>
      option
        .setName('content')
        .setDescription('授業内容の説明（復習のポイント）')
        .setRequired(false)
        .setMaxLength(500)
    )
    .addStringOption(option =>
      option
        .setName('instructor')
        .setDescription('担当講師名（オプション）')
        .setRequired(false)
        .setMaxLength(50)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const subject = interaction.options.getString('subject');
      const content = interaction.options.getString('content') || '';
      const instructor = interaction.options.getString('instructor') || '';

      // 復習タスクを作成
      const baseContent = createTaskContent(subject, content, instructor);
      const tasks = await todoistService.createReviewSeries(baseContent);

      if (tasks.length === 0) {
        await interaction.editReply('❌ 復習タスクの作成に失敗しました。');
        return;
      }

      // 完了メッセージを作成
      const embed = createClassRegistrationEmbed(subject, content, instructor, tasks);
      await interaction.editReply({ embeds: [embed] });

      console.log(`✅ 授業タスク登録: ${subject} (${tasks.length}件の復習タスク作成)`);

    } catch (error) {
      console.error('授業登録エラー:', error);
      await interaction.editReply('❌ エラーが発生しました。Todoist API トークンを確認してください。');
    }
  },
};

/**
 * タスクの内容文を作成
 * @param {string} subject - 科目名
 * @param {string} content - 内容
 * @param {string} instructor - 講師名
 * @returns {string}
 */
function createTaskContent(subject, content, instructor) {
  let taskContent = subject;
  
  if (instructor) {
    taskContent += ` (${instructor}担当)`;
  }
  
  if (content) {
    taskContent += ` - ${content}`;
  }

  return taskContent;
}

/**
 * 授業登録完了のEmbedメッセージを作成
 * @param {string} subject - 科目名
 * @param {string} content - 内容
 * @param {string} instructor - 講師名
 * @param {Array} tasks - 作成されたタスク
 * @returns {EmbedBuilder}
 */
function createClassRegistrationEmbed(subject, content, instructor, tasks) {
  const intervals = config.review.intervals;
  const today = new Date();

  const embed = new EmbedBuilder()
    .setColor('#2196F3')
    .setTitle('📚 授業復習タスク登録完了')
    .setDescription(`**${subject}** の復習スケジュールを作成しました`)
    .setTimestamp();

  if (instructor) {
    embed.addFields({ name: '👨‍🏫 講師', value: instructor, inline: true });
  }

  if (content) {
    embed.addFields({ name: '📝 内容', value: content, inline: false });
  }

  // 復習スケジュール
  let scheduleText = '';
  intervals.forEach((interval, index) => {
    const dueDate = new Date(today);
    dueDate.setDate(today.getDate() + interval);
    const dateStr = dueDate.toLocaleDateString('ja-JP');
    const dayName = dueDate.toLocaleDateString('ja-JP', { weekday: 'long' });
    
    const priority = getPriorityLabel(index);
    scheduleText += `${index + 1}回目: ${interval}日後 (${dateStr} ${dayName}) ${priority}\n`;
  });

  embed.addFields({ 
    name: '📅 復習スケジュール', 
    value: scheduleText,
    inline: false 
  });

  embed.addFields({ 
    name: '✅ 作成済み', 
    value: `${tasks.length}件の復習タスクを自動作成しました\nエビングハウスの忘却曲線に基づいた時間配置です`,
    inline: false 
  });

  embed.setFooter({ text: '💡 Todoistで管理されています' });

  return embed;
}

/**
 * 復習回数に応じた優先度ラベルを取得
 * @param {number} index - 復習回数（0から始まる）
 * @returns {string}
 */
function getPriorityLabel(index) {
  if (index === 0) return '🔴 高';
  if (index === 1) return '🟡 中';
  return '⚪ 通常';
}

module.exports.createTaskContent = createTaskContent;
module.exports.getPriorityLabel = getPriorityLabel;
