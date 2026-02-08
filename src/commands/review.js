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
      
      // 間隔復習タスクを作成
      const tasks = await todoistService.createReviewSeries(content);
      
      if (tasks.length > 0) {
        const intervals = config.review.intervals;
        let responseMessage = `✅ **${content}** の復習タスクを作成しました！\n\n`;
        responseMessage += '📅 復習スケジュール:\n';
        
        intervals.forEach((interval, index) => {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + interval);
          const dateStr = dueDate.toLocaleDateString('ja-JP');
          responseMessage += `${index + 1}回目: ${interval}日後 (${dateStr})\n`;
        });
        
        responseMessage += '\n💡 Todoistで確認してください！';
        
        await message.reply(responseMessage);
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
