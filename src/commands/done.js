const { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const todoistService = require('../services/todoist');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('done')
    .setDescription('タスクを完了にします'),
  
  async execute(interaction) {
    await interaction.deferReply();

    try {
      const todayTasks = await todoistService.getTodayTasks();
      const overdueTasks = await todoistService.getOverdueTasks();
      
      const allTasks = [...overdueTasks, ...todayTasks];

      if (allTasks.length === 0) {
        await interaction.editReply('✅ 完了待ちのタスクはありません！');
        return;
      }

      // セレクトメニューの選択肢を作成
      const options = allTasks.slice(0, 25).map((task, index) => {
        const isOverdue = overdueTasks.some(t => t.id === task.id);
        const label = `${isOverdue ? '⏰' : '📅'} ${task.content.substring(0, 90)}`;
        const description = `優先度: ${getPriorityLabel(task.priority)}`;
        
        return {
          label,
          description,
          value: task.id,
          emoji: getTaskEmoji(task),
        };
      });

      // セレクトメニューを作成
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('task-done-select')
        .setPlaceholder('完了するタスクを選択...')
        .addOptions(options)
        .setMaxValues(Math.min(5, allTasks.length)) // 最大5つまで選択可能
        .setMinValues(1);

      const row = new ActionRowBuilder().addComponents(selectMenu);

      const embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ タスク完了')
        .setDescription(`完了するタスクを選択してください（最大${Math.min(5, allTasks.length)}件まで同時選択可能）`)
        .addFields(
          { 
            name: '📊 タスク一覧', 
            value: `積み残し: ${overdueTasks.length}件\n今日: ${todayTasks.length}件\n合計: ${allTasks.length}件`,
            inline: true
          }
        )
        .setTimestamp();

      await interaction.editReply({ 
        embeds: [embed],
        components: [row] 
      });

    } catch (error) {
      console.error('タスク完了コマンドエラー:', error);
      await interaction.editReply('❌ エラーが発生しました。');
    }
  },
};

/**
 * 優先度ラベルを取得
 * @param {number} priority - 優先度（1-4）
 * @returns {string}
 */
function getPriorityLabel(priority) {
  const labels = {
    4: '🔴 高',
    3: '🟡 中',
    2: '⚪ 通常',
    1: '⚪ 通常'
  };
  return labels[priority] || '⚪ 通常';
}

/**
 * タスクのアイコンを取得
 * @param {Object} task - タスク
 * @returns {string}
 */
function getTaskEmoji(task) {
  const labels = task.labels || [];
  if (labels.includes('復習')) return '📚';
  if (labels.includes('重要')) return '⭐';
  return '📌';
}

module.exports.getPriorityLabel = getPriorityLabel;
module.exports.getTaskEmoji = getTaskEmoji;
