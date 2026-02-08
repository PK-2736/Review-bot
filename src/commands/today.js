const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const todoistService = require('../services/todoist');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('today')
    .setDescription('今日のTODOリストを表示します'),
  
  async execute(interaction) {
    await interaction.deferReply();

    try {
      const todayTasks = await todoistService.getTodayTasks();
      const overdueTasks = await todoistService.getOverdueTasks();
      
      if (todayTasks.length === 0 && overdueTasks.length === 0) {
        await interaction.editReply('🎉 タスクはありません！お疲れ様でした！');
        return;
      }

      const embed = createTodoEmbed(todayTasks, overdueTasks);
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('今日のタスク取得エラー:', error);
      await interaction.editReply('❌ タスクの取得に失敗しました。Todoist API トークンを確認してください。');
    }
  },
};

/**
 * TODOリストの埋め込みメッセージを作成
 * @param {Array} todayTasks - 今日のタスク
 * @param {Array} overdueTasks - 期限切れタスク
 * @returns {EmbedBuilder}
 */
function createTodoEmbed(todayTasks, overdueTasks) {
  const now = new Date();
  const today = now.toLocaleDateString('ja-JP', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    weekday: 'long'
  });

  const totalTasks = todayTasks.length + overdueTasks.length;
  const embed = new EmbedBuilder()
    .setColor('#E44332')
    .setTitle('📋 今日のTODOリスト')
    .setDescription(`${today}\n\n全 ${totalTasks} 件のタスク`)
    .setTimestamp();

  // 期限切れタスクを表示
  if (overdueTasks.length > 0) {
    const overdueSummary = createTaskSummary(overdueTasks);
    embed.addFields({ 
      name: `⏰ 【積み残し】 ${overdueTasks.length} 件`, 
      value: overdueSummary, 
      inline: false 
    });
  }

  // 今日のタスクを表示
  if (todayTasks.length > 0) {
    const todaySummary = createTaskSummary(todayTasks);
    embed.addFields({ 
      name: `📅 【今日】 ${todayTasks.length} 件`, 
      value: todaySummary, 
      inline: false 
    });
  }

  embed.setFooter({ text: '💡 Todoistで管理されています' });

  return embed;
}

/**
 * タスク一覧を優先度別にまとめる
 * @param {Array} tasks - タスク
 * @returns {string}
 */
function createTaskSummary(tasks) {
  const highPriority = tasks.filter(t => t.priority === 4);
  const mediumPriority = tasks.filter(t => t.priority === 3);
  const normalPriority = tasks.filter(t => t.priority <= 2);

  let summary = '';
  const MAX_ITEMS_PER_PRIORITY = 8;

  if (highPriority.length > 0) {
    const displayItems = highPriority.slice(0, MAX_ITEMS_PER_PRIORITY);
    const taskList = displayItems.map((task, index) => 
      `  ${index + 1}. ${getTaskIcon(task)} ${task.content.substring(0, 60)}`
    ).join('\n');
    summary += `🔴 **高優先度** (${highPriority.length})\n${taskList}`;
    if (highPriority.length > MAX_ITEMS_PER_PRIORITY) {
      summary += `\n  他 ${highPriority.length - MAX_ITEMS_PER_PRIORITY}件`;
    }
    summary += '\n\n';
  }

  if (mediumPriority.length > 0) {
    const displayItems = mediumPriority.slice(0, MAX_ITEMS_PER_PRIORITY);
    const taskList = displayItems.map((task, index) => 
      `  ${index + 1}. ${getTaskIcon(task)} ${task.content.substring(0, 60)}`
    ).join('\n');
    summary += `🟡 **中優先度** (${mediumPriority.length})\n${taskList}`;
    if (mediumPriority.length > MAX_ITEMS_PER_PRIORITY) {
      summary += `\n  他 ${mediumPriority.length - MAX_ITEMS_PER_PRIORITY}件`;
    }
    summary += '\n\n';
  }

  if (normalPriority.length > 0) {
    const displayItems = normalPriority.slice(0, MAX_ITEMS_PER_PRIORITY);
    const taskList = displayItems.map((task, index) => 
      `  ${index + 1}. ${getTaskIcon(task)} ${task.content.substring(0, 60)}`
    ).join('\n');
    summary += `⚪ **通常** (${normalPriority.length})\n${taskList}`;
    if (normalPriority.length > MAX_ITEMS_PER_PRIORITY) {
      summary += `\n  他 ${normalPriority.length - MAX_ITEMS_PER_PRIORITY}件`;
    }
  }

  return summary.trim();
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
module.exports.createTaskSummary = createTaskSummary;
