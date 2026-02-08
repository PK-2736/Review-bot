const cron = require('node-cron');
const config = require('./config');
const todoistService = require('./services/todoist');
const ScheduleStore = require('./services/scheduleStore');
const { createTodoEmbed, createTaskSummary } = require('./commands/today');

const DAY_NUMBERS = { '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6, '日': 0 };
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

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

    // 定期通知スケジュール
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

    // 授業スケジュールの自動復習タスク作成
    this.startClassSchedules();

    console.log('✅ スケジューラーが起動しました');
  }

  /**
   * 授業スケジュールに基づいて復習タスクを自動作成
   */
  startClassSchedules() {
    // 毎分チェック（後で最適化可能）
    const scheduleJob = cron.schedule('* * * * *', async () => {
      await this.checkAndCreateAutoTasks();
    }, {
      scheduled: true,
      timezone: 'Asia/Tokyo'
    });

    this.jobs.push(scheduleJob);
    console.log('🔄 授業スケジュール自動実行を開始しました');
  }

  /**
   * 授業スケジュールをチェックして自動タスクを作成
   */
  async checkAndCreateAutoTasks() {
    try {
      const now = new Date();
      const currentDay = DAY_NAMES[now.getDay()];
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      const schedules = ScheduleStore.getByDay(currentDay);

      for (const schedule of schedules) {
        // 時間が一致したら実行
        if (schedule.time === currentTime) {
          await this.createAutoTask(schedule);
        }
      }
    } catch (error) {
      console.error('自動タスク作成エラー:', error);
    }
  }

  /**
   * 自動タスクを作成
   */
  async createAutoTask(schedule) {
    try {
      const taskContent = `${schedule.subject}${schedule.instructor ? ` (${schedule.instructor})` : ''}${schedule.content ? ` - ${schedule.content}` : ''}`;
      
      await todoistService.createReviewSeries(taskContent);

      const channel = await this.client.channels.fetch(config.notification.channelId);
      if (channel) {
        const now = new Date();
        const dateStr = now.toLocaleDateString('ja-JP');
        
        await channel.send({
          content: `📚 **自動タスク作成**\n\n${schedule.subject} の復習スケジュールを作成しました！\n\n⏰ ${dateStr} ${schedule.time} 実行`,
          embeds: []
        });
      }

      console.log(`✅ 自動タスク作成: ${schedule.subject} (スケジュールID: ${schedule.id})`);
    } catch (error) {
      console.error(`自動タスク作成失敗 (${schedule.subject}):`, error);
    }
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
