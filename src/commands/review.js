const { EmbedBuilder } = require('discord.js');
const todoistService = require('../services/todoist');
const config = require('../config');

module.exports = {
  name: 'review',
  description: '復習タスクを作成します',
  
  async execute(message, args) {
    // !review <学習内容>
    if (args.length === 0) {
      return message.reply(
        '📚 使い方: `!review <学習内容>`\n例: `!review JavaScriptの非同期処理`'
      );
    }

    const content = args.join(' ');
    
    try {
      await message.reply('⏳ 復習タスクを作成中...');
      
      const tasks = await todoistService.createReviewSeries(content);
      
      if (tasks.length > 0) {
        const intervals = config.review.intervals.normal;
        const scheduleText = intervals.map((interval, index) => {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + interval);
          const dateStr = dueDate.toLocaleDateString('ja-JP');
          return `${index + 1}回目: ${interval}日後 (${dateStr})`;
        }).join('\n');

        const embed = new EmbedBuilder()
          .setTitle('✅ 復習タスクを作成しました')
          .setDescription(`**${content}** の復習スケジュールを Todoist に登録しました。`)
          .addFields(
            { name: '復習対象', value: content, inline: false },
            { name: 'スケジュール', value: scheduleText, inline: false },
            { name: '確認方法', value: 'Todoist で `review` プロジェクトを確認してください。', inline: false },
          )
          .setColor(0x00AE86)
          .setTimestamp();

        await message.reply({ embeds: [embed] });
      } else {
        await message.reply('❌ タスクの作成に失敗しました。');
      }
    } catch (error) {
      console.error('復習タスク作成エラー:', error);
      await message.reply(
        '❌ エラーが発生しました。Todoist API トークンを確認してください。'
      );
    }
  },
};
