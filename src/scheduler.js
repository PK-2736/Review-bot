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

    // 週次レポート
    if (config.notification.weeklyReport.enabled) {
      const reportJob = cron.schedule(config.notification.weeklyReport.time, async () => {
        await this.sendWeeklyReport();
      }, {
        scheduled: true,
        timezone: 'Asia/Tokyo'
      });

      this.jobs.push(reportJob);
      console.log(`📊 週次レポートを設定しました: ${config.notification.weeklyReport.time}`);
    }

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
        // 授業時間から復習作成時間を計算（デフォルト：授業終了3時間後と想定）
        const reviewTime = this.calculateReviewTime(schedule.time, schedule.reviewOffset || 180);
        
        // 復習作成時間が一致したら実行
        if (reviewTime === currentTime) {
          await this.createAutoTask(schedule);
        }
      }
    } catch (error) {
      console.error('自動タスク作成エラー:', error);
    }
  }

  /**
   * 復習タスク作成時間を計算
   * @param {string} classTime - 授業時間（HH:MM形式）
   * @param {number} offsetMinutes - 授業時間からのオフセット（分）
   * @returns {string} 復習作成時間（HH:MM形式）
   */
  calculateReviewTime(classTime, offsetMinutes) {
    const [hours, minutes] = classTime.split(':').map(Number);
    const date = new Date();
    date.setHours(hours);
    date.setMinutes(minutes);
    
    // オフセット分を追加
    date.setMinutes(date.getMinutes() + offsetMinutes);
    
    const reviewHours = String(date.getHours()).padStart(2, '0');
    const reviewMinutes = String(date.getMinutes()).padStart(2, '0');
    
    return `${reviewHours}:${reviewMinutes}`;
  }

  /**
   * 自動タスクを作成
   */
  async createAutoTask(schedule) {
    try {
      const taskContent = `${schedule.subject}${schedule.instructor ? ` (${schedule.instructor})` : ''}${schedule.content ? ` - ${schedule.content}` : ''}`;
      
      // スケジュールにモード設定があればそれを使用、なければ通常モード
      const mode = schedule.reviewMode || 'normal';
      await todoistService.createReviewSeries(taskContent, mode);

      const channel = await this.client.channels.fetch(config.notification.channelId);
      if (channel) {
        const now = new Date();
        const dateStr = now.toLocaleDateString('ja-JP');
        const modeLabel = mode === 'mastery' ? '完全習得モード（8回・半年間）' : '通常モード（5回・1ヶ月）';
        
        await channel.send({
          content: `📚 **自動タスク作成**\n\n${schedule.subject} の復習スケジュールを作成しました！\n📊 ${modeLabel}\n⏰ ${dateStr} 実行`,
          embeds: []
        });
      }

      console.log(`✅ 自動タスク作成: ${schedule.subject} (${mode}モード, スケジュールID: ${schedule.id})`);
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

   

  /**
   * 週次レポートを送信
   */
  async sendWeeklyReport() {
    try {
      const channel = await this.client.channels.fetch(config.notification.weeklyReport.channelId);
      
      if (!channel) {
        console.error('❌ レポートチャンネルが見つかりません:', config.notification.weeklyReport.channelId);
        return;
      }

      // 過去7日間のタスク情報を取得
      const report = await this.generateWeeklyReport();

      // レポート用Embedを作成
      const embed = new EmbedBuilder()
        .setColor(report.color)
        .setTitle('📊 週次お勉強レポート')
        .setDescription(`先週（${report.weekStartDate} ～ ${report.weekEndDate}）の学習成果`)
        .addFields(
          {
            name: '✅ 完了タスク',
            value: `${report.completedCount}件`,
            inline: true
          },
          {
            name: '⏳ 未完了タスク',
            value: `${report.pendingCount}件`,
            inline: true
          },
          {
            name: '📈 消化率',
            value: `${report.completionRate}%`,
            inline: true
          }
        );

      // 評価を追加
      embed.addFields({
        name: '⭐ 評価',
        value: report.evaluation,
        inline: false
      });

      // 未完了タスクがあれば表示
      if (report.pendingTasks.length > 0) {
        const pendingList = report.pendingTasks.slice(0, 10).map(t => `• ${t.content}`).join('\n');
        embed.addFields({
          name: '🔄 この週に完了できなかったタスク',
          value: pendingList || 'なし',
          inline: false
        });

        if (report.pendingTasks.length > 10) {
          embed.addFields({
            name: '他',
            value: `他 ${report.pendingTasks.length - 10}件`,
            inline: false
          });
        }
      }

      // 統計情報
      embed.addFields({
        name: '📋 統計',
        value: `復習タスク: ${report.reviewTaskCount}件\n他のタスク: ${report.otherTaskCount}件`,
        inline: false
      });

      embed.setTimestamp();
      embed.setFooter({ text: '💡 来週も頑張りましょう！' });

      await channel.send({ embeds: [embed] });

      console.log(`✅ 週次レポート送信完了 (完了率: ${report.completionRate}%)`);

    } catch (error) {
      console.error('週次レポート送信エラー:', error);
    }
  }

  /**
   * 週次レポートを生成
   */
  async generateWeeklyReport() {
    try {
      const today = new Date();
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

      // タスク情報を取得
      const allTasks = await todoistService.api.getTasks();
      
      let completedCount = 0;
      let pendingTasks = [];
      let reviewTaskCount = 0;
      let otherTaskCount = 0;

      // タスクを分析
      for (const task of allTasks) {
        if (task.isCompleted) {
          // 完了したタスクをカウント
          if (task.completed_at) {
            const completedDate = new Date(task.completed_at);
            if (completedDate >= weekAgo && completedDate <= today) {
              completedCount++;
            }
          }
        } else {
          // 未完了タスクを記録
          pendingTasks.push(task);
        }

        // タスクの分類
        if (task.labels && task.labels.includes('復習')) {
          reviewTaskCount++;
        } else {
          otherTaskCount++;
        }
      }

      const totalTasksThisWeek = completedCount + pendingTasks.length;
      const completionRate = totalTasksThisWeek > 0 
        ? Math.round((completedCount / totalTasksThisWeek) * 100) 
        : 0;

      // 評価を決定
      let evaluation = '';
      let color = '#4CAF50';

      if (completionRate >= 90) {
        evaluation = '🌟 素晴らしい！ほぼすべてのタスクを完了しました。この調子で！';
        color = '#FFD700';
      } else if (completionRate >= 70) {
        evaluation = '👍 良好です。もう少し頑張ると完璧です。';
        color = '#4CAF50';
      } else if (completionRate >= 50) {
        evaluation = '👌 半分以上完了しました。来週に向けて頑張りましょう。';
        color = '#FF9800';
      } else if (completionRate >= 30) {
        evaluation = '💪 まだまだです。来週は目標達成を目指しましょう！';
        color = '#FF5722';
      } else {
        evaluation = '⚠️ タスクが溜まっています。優先順位をつけて進めましょう。';
        color = '#F44336';
      }

      // 形式化された日付
      const weekStartDate = weekAgo.toLocaleDateString('ja-JP');
      const weekEndDate = today.toLocaleDateString('ja-JP');

      return {
        completedCount,
        pendingCount: pendingTasks.length,
        completionRate,
        evaluation,
        color,
        pendingTasks,
        reviewTaskCount,
        otherTaskCount,
        weekStartDate,
        weekEndDate,
      };

    } catch (error) {
      console.error('週次レポート生成エラー:', error);
      throw error;
    }
  }   const totalTasks = todayTasks.length + overdueTasks.length;
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
