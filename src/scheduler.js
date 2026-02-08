const cron = require('node-cron');
const config = require('./config');
const todoistService = require('./services/todoist');
const { createTodoEmbed, createTaskSummary } = require('./commands/today');

class TodoScheduler {
  constructor(client) {
    this.client = client;
    this.jobs = [];
  }

  /**
   * スケジューラーを開始
   */
  start() {
    console.log('📅 TODOリスト通知スケジューラーを開始します...');

    config.notification.schedules.forEach(schedule => {
      const job = cron.schedule(schedule.time, async () => {
        await this.sendTodoNotification(schedule.label);
      }, {
        scheduled: true,
        timezone: 'Asia/Tokyo'
      });

      this.jobs.push(job);
      console.log(`⏰ ${schedule.label}の通知を設定しました: ${schedule.time}`);
    });

    console.log('✅ スケジューラーが起動しました');
  }

  /**
   * TODO通知を送信
   * @param {string} label - 時間帯ラベル
   */
  async sendTodoNotification(label) {
    try {
      const channel = await this.client.channels.fetch(config.notification.channelId);
      
      if (!channel) {
        console.error('❌ 通知チャンネルが見つかりません:', config.notification.channelId);
        return;
      }

      const todayTasks = await todoistService.getTodayTasks();
      const overdueTasks = await todoistService.getOverdueTasks();
      
      if (todayTasks.length === 0 && overdueTasks.length === 0) {
        await channel.send(`🎉 **${label}の確認**\nタスクはありません！お疲れ様でした！`);
        return;
      }

      const embed = createTodoEmbed(todayTasks, overdueTasks);
      await channel.send({ 
        content: `📢 **${label}の時間です！** 今日のTODOを確認しましょう！`, 
        embeds: [embed] 
      });

      const totalTasks = todayTasks.length + overdueTasks.length;
      console.log(`✅ ${label}のTODO通知を送信しました (積み残し: ${overdueTasks.length}件, 今日: ${todayTasks.length}件, 合計: ${totalTasks}件)`);
    } catch (error) {
      console.error(`❌ ${label}のTODO通知送信エラー:`, error);
    }
  }

  /**
   * スケジューラーを停止
   */
  stop() {
    this.jobs.forEach(job => job.stop());
    console.log('⏹️  スケジューラーを停止しました');
  }
}

module.exports = TodoScheduler;
