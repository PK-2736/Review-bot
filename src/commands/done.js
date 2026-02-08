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

      // 初期セレクトを表示
      await showPrimarySelect(interaction, allTasks, overdueTasks, todayTasks);

    } catch (error) {
      console.error('タスク完了コマンドエラー:', error);
      await interaction.editReply('❌ エラーが発生しました。');
    }
  },
};

/**
 * 第一段階のセレクトメニュー（slash command response）
 */
async function showPrimarySelect(interaction, allTasks, overdueTasks, todayTasks) {
  const options = createSelectOptions(allTasks);

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('done-select-primary')
    .setPlaceholder('完了するタスクを選択...')
    .addOptions(options)
    .setMaxValues(Math.min(5, allTasks.length))
    .setMinValues(1);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  const embed = new EmbedBuilder()
    .setColor('#2196F3')
    .setTitle('✅ タスク完了')
    .setDescription(`完了するタスクを選択してください（最大${Math.min(5, allTasks.length)}件まで同時選択可能）`)
    .addFields(
      { 
        name: '📊 タスク統計', 
        value: `積み残し: ${overdueTasks.length}件\n今日: ${todayTasks.length}件\n合計: ${allTasks.length}件`,
        inline: true
      }
    )
    .setFooter({ text: '30秒以内に選択してください' })
    .setTimestamp();

  await interaction.editReply({ 
    embeds: [embed],
    components: [row] 
  });

  // 30秒の選択を待つ
  const filter = i => i.customId === 'done-select-primary' && i.user.id === interaction.user.id;
  
  try {
    const collected = await interaction.channel.awaitMessageComponent({ 
      filter, 
      time: 30000 
    });

    // ここで選択確定 - タスク完了処理
    await handleSelectionAndComplete(collected, allTasks);

  } catch (error) {
    if (error.code === 'InteractionCollectorError') {
      // タイムアウト - フォールバックセレクトを表示
      await showFallbackSelect(interaction, allTasks);
    } else {
      throw error;
    }
  }
}

/**
 * 第二段階のセレクトメニュー（フォールバック用メッセージ）
 */
async function showFallbackSelect(interaction, allTasks) {
  const options = createSelectOptions(allTasks);

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('done-select-fallback')
    .setPlaceholder('完了するタスクを選択...')
    .addOptions(options)
    .setMaxValues(Math.min(5, allTasks.length))
    .setMinValues(1);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  const embed = new EmbedBuilder()
    .setColor('#FF9800')
    .setTitle('⏱️ セレクト再表示')
    .setDescription(`完了するタスクを選択してください（最大${Math.min(5, allTasks.length)}件まで同時選択可能）`)
    .setFooter({ text: '60秒以内に選択してください' })
    .setTimestamp();

  const message = await interaction.channel.send({ 
    embeds: [embed],
    components: [row] 
  });

  // 60秒の選択を待つ
  const filter = i => i.customId === 'done-select-fallback' && i.user.id === interaction.user.id;
  
  try {
    const collected = await message.awaitMessageComponent({ 
      filter, 
      time: 60000 
    });

    // ここで選択確定 - タスク完了処理
    await handleSelectionAndComplete(collected, allTasks);

  } catch (error) {
    if (error.code === 'InteractionCollectorError') {
      // 再度タイムアウト
      const timeoutEmbed = new EmbedBuilder()
        .setColor('#F44336')
        .setTitle('⏱️ タイムアウト')
        .setDescription('タスク選択がタイムアウトしました')
        .setTimestamp();

      await message.edit({ embeds: [timeoutEmbed], components: [] });
    } else {
      throw error;
    }
  }
}

/**
 * 選択されたタスクを完了
 */
async function handleSelectionAndComplete(interaction, allTasks) {
  await interaction.deferUpdate();

  try {
    const selectedTaskIds = interaction.values;
    let completed = 0;
    let failed = 0;

    for (const taskId of selectedTaskIds) {
      try {
        await todoistService.completeTask(taskId);
        completed++;
      } catch (error) {
        console.error(`タスク完了エラー (${taskId}):`, error);
        failed++;
      }
    }

    // 完了結果の表示
    let resultMessage = '';
    if (completed > 0) {
      resultMessage += `✅ **${completed}件完了しました！**\n`;
    }
    if (failed > 0) {
      resultMessage += `❌ **${failed}件失敗しました**\n`;
    }

    const embed = new EmbedBuilder()
      .setColor(failed === 0 ? '#4CAF50' : '#FF9800')
      .setTitle('🎉 タスク完了結果')
      .setDescription(resultMessage)
      .setTimestamp();

    await interaction.message.edit({ embeds: [embed], components: [] });

    console.log(`✅ タスク完了: ${completed}件完了, ${failed}件失敗`);

  } catch (error) {
    console.error('タスク完了エラー:', error);
    await interaction.message.edit({ 
      content: '❌ タスクの完了に失敗しました',
      components: [] 
    });
  }
}

/**
 * セレクトメニューの選択肢を作成
 */
function createSelectOptions(allTasks) {
  return allTasks.slice(0, 25).map((task) => {
    const label = `${task.content.substring(0, 90)}`;
    const description = `優先度: ${getPriorityLabel(task.priority)}`;
    
    return {
      label,
      description,
      value: task.id,
      emoji: getTaskEmoji(task),
    };
  });
}

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
