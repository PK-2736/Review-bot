const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const todoistService = require('../services/todoist');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('today')
    .setDescription('今日のTODOリストを表示します'),
  
  async execute(interaction) {
    await interaction.deferReply();

    try {
      const tasks = await todoistService.getTodayTasks();
      
      if (tasks.length === 0) {
        await interaction.editReply('🎉 今日のタスクはありません！お疲れ様でした！');
        return;
      }

      const embed = createTodoEmbed(tasks);
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('今日のタスク取得エラー:', error);
      await interaction.editReply('❌ タスクの取得に失敗しました。Todoist API トークンを確認してください。');
    }
  },
};

/**
 * TODOリストの埋め込みメッセージを作成
 * @param {Array} tasks - タスクリスト
 * @returns {EmbedBuilder}
 */
function createTodoEmbed(tasks) {
  const now = new Date();
  const today = now.toLocaleDateString('ja-JP', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    weekday: 'long'
  });

  const embed = new EmbedBuilder()
    .setColor('#E44332')
    .setTitle('📋 今日のTODOリスト')
    .setDescription(`${today}\n\n全 ${tasks.length} 件のタスク`)
    .setTimestamp();

  // 優先度別にグループ化
  const highPriority = tasks.filter(t => t.priority === 4);
  const mediumPriority = tasks.filter(t => t.priority === 3);
  const normalPriority = tasks.filter(t => t.priority <= 2);

  if (highPriority.length > 0) {
    const taskList = highPriority.map((task, index) => 
      `${index + 1}. ${getTaskIcon(task)} ${task.content}`
    ).join('\n');
    embed.addFields({ 
      name: '🔴 高優先度', 
      value: taskList, 
      inline: false 
    });
  }

  if (mediumPriority.length > 0) {
    const taskList = mediumPriority.map((task, index) => 
      `${index + 1}. ${getTaskIcon(task)} ${task.content}`
    ).join('\n');
    embed.addFields({ 
      name: '🟡 中優先度', 
      value: taskList, 
      inline: false 
    });
  }

  if (normalPriority.length > 0) {
    const taskList = normalPriority.map((task, index) => 
      `${index + 1}. ${getTaskIcon(task)} ${task.content}`
    ).join('\n');
    embed.addFields({ 
      name: '⚪ 通常', 
      value: taskList, 
      inline: false 
    });
  }

  embed.setFooter({ text: '💡 Todoistで管理されています' });

  return embed;
}

/**
 * タスクのアイコンを取得
 * @param {Object} task - タスク
 * @returns {string}
 */
function getTaskIcon(task) {
  const labels = task.labels || [];
  if (labels.includes('復習')) return '📚';
  if (labels.includes('重要')) return '⭐';
  return '📌';
}

module.exports.createTodoEmbed = createTodoEmbed;
