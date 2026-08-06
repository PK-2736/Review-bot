const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const config = require('./config');
const todoistService = require('./services/todoist');
const classroomService = require('./services/classroomService');
const { syncService: remarkableSyncService, formatSyncResult } = require('./services/remarkable');
const remarkableTodoRegistrar = require('./services/remarkable/todoRegistrar');
const ScheduleStore = require('./services/scheduleStore');
const ReminderStore = require('./services/reminderStore');
const { createTodoEmbed } = require('./commands/today');

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

class TodoScheduler {
  constructor(client) {
    this.client = client;
    this.jobs = [];
  }

  /**
   * reMarkable レビューの自動実行（毎日23:00）
   *
   * /remarkable_sync と全く同じ同期関数を呼び出す（処理を重複実装しない）。
   */
  async syncRemarkableReviews() {
    try {
      if (!remarkableSyncService.isConfigured()) {
        console.warn(`⚠️ reMarkableレビューをスキップ（設定不足: ${remarkableSyncService.missingConfig().join(', ')})`);
        return;
      }

      const summary = await remarkableSyncService.sync();

      // 結果は通知チャンネルへ報告する（コマンド実行時と同じ整形を使う）
      try {
        const channel = await this.client.channels.fetch(config.notification.channelId);
        if (channel && channel.isTextBased() && 'send' in channel) {
          const embed = formatSyncResult(summary);
          const filePath = require('./services/remarkable').createSyncLogTextFile(summary);
          try {
            await channel.send({ embeds: [embed], files: [{ attachment: filePath, name: 'remarkable-sync-log.txt' }] });
          } finally {
            try { require('fs').unlinkSync(filePath); } catch (e) { /* ignore */ }
          }
        } else {
          console.warn('通知チャンネルが取得できませんでした:', config.notification.channelId);
        }
      } catch (notifyError) {
        console.error('reMarkableレビュー結果の通知送信エラー:', notifyError);
      }
    } catch (error) {
      // 自動実行が失敗しても他のスケジュールジョブは継続させる
      console.error('reMarkableレビュー自動実行エラー:', error);
    }
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

    // 週間リマインダーの自動実行
    this.startReminders();

    // Google Classroom 同期
    this.startClassroomSync();

    // reMarkable 復習同期
    this.startRemarkableSync();

    // reMarkable TODO 再試行
    this.startRemarkableTodoRetry();

    // 古い復習タスクの自動削除
    this.startOldReviewCleanup();
    this.cleanupOldReviewTasks();

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
   * 週間リマインダーを開始
   */
  startReminders() {
    // 毎分チェック
    const reminderJob = cron.schedule('* * * * *', async () => {
      await this.checkAndExecuteReminders();
    }, {
      scheduled: true,
      timezone: 'Asia/Tokyo'
    });

    this.jobs.push(reminderJob);
    console.log('🔔 週間リマインダー自動実行を開始しました');
  }

  /**
   * Google Classroom 同期を開始
   */
  startClassroomSync() {
    if (!config.classroom.enabled) {
      return;
    }

    const classroomJob = cron.schedule(config.classroom.syncTime, async () => {
      await this.syncClassroomTasks();
    }, {
      scheduled: true,
      timezone: config.classroom.timezone || 'Asia/Tokyo'
    });

    this.jobs.push(classroomJob);
    console.log(`🎓 Classroom同期を設定しました: ${config.classroom.syncTime}`);
  }

  /**
   * reMarkable レビューの自動実行（毎日23:00）を開始
   */
  startRemarkableSync() {
    if (!config.remarkable.enabled) {
      return;
    }

    // 複数時間帯での実行をサポート。config に `syncTimes` があればそれを使い、なければ従来の `syncTime` を1回設定する
    const times = Array.isArray(config.remarkable.syncTimes) && config.remarkable.syncTimes.length > 0
      ? config.remarkable.syncTimes
      : [config.remarkable.syncTime];

    for (const cronExpr of times) {
      const remarkableJob = cron.schedule(cronExpr, async () => {
        // このジョブがトリガーされた時点の時刻を cutoff として sync を実行する
        const cutoff = Date.now();
        try {
          if (remarkableSyncService.isConfigured()) {
            await remarkableSyncService.sync({ cutoffTime: cutoff });
          } else {
            console.warn(`⚠️ reMarkableレビューをスキップ（設定不足: ${remarkableSyncService.missingConfig().join(', ')})`);
          }
        } catch (err) {
          console.error('scheduled remarkable sync failed', err);
        }
      }, {
        scheduled: true,
        timezone: config.remarkable.timezone || 'Asia/Tokyo'
      });

      this.jobs.push(remarkableJob);
      console.log(`🖊️ reMarkable 自動レビューを設定しました: ${cronExpr}`);
    }
  }

  /**
   * reMarkable TODO の再試行を開始
   */
  startRemarkableTodoRetry() {
    if (!config.remarkable.enabled) {
      return;
    }

    const retryJob = cron.schedule('*/10 * * * *', async () => {
      await this.processRemarkableTodoRetries();
    }, {
      scheduled: true,
      timezone: config.remarkable.timezone || 'Asia/Tokyo'
    });

    this.jobs.push(retryJob);
    console.log('🔁 reMarkable TODO 再試行チェックを開始しました');

    void this.processRemarkableTodoRetries();
  }

  /**
   * 期限到来した reMarkable TODO 再試行を処理
   */
  async processRemarkableTodoRetries() {
    try {
      const result = await remarkableTodoRegistrar.processPendingTodoRetries();
      if (result.processed > 0) {
        console.log(`🔁 reMarkable TODO 再試行結果 (処理: ${result.processed}, 成功: ${result.succeeded}, 再登録: ${result.rescheduled}, 失敗: ${result.failed})`);
      }
    } catch (error) {
      console.error('reMarkable TODO 再試行処理エラー:', error);
    }
  }

  /**
   * 古い復習タスクの自動削除を開始
   */
  startOldReviewCleanup() {
    // 毎日03:10に、2日以上前の復習タスクを削除
    const cleanupJob = cron.schedule('10 3 * * *', async () => {
      await this.cleanupOldReviewTasks();
    }, {
      scheduled: true,
      timezone: 'Asia/Tokyo'
    });

    this.jobs.push(cleanupJob);
    console.log('🧹 古い復習タスク自動削除を設定しました: 10 3 * * *');
  }

  /**
   * 2日以上前の復習タスクを削除
   */
  async cleanupOldReviewTasks() {
    try {
      const result = await todoistService.deleteOldReviewTasks(2);
      console.log(`🧹 古い復習タスク削除完了 (削除: ${result.deleted}, 失敗: ${result.failed})`);
    } catch (error) {
      console.error('古い復習タスク削除エラー:', error);
    }
  }

  /**
   * Google Classroom 課題の同期
   */
  async syncClassroomTasks() {
    try {
      const result = await classroomService.syncPendingTasks();
      console.log(`✅ Classroom同期完了 (追加: ${result.created}, 更新: ${result.updated}, 完了: ${result.closed}, スキップ: ${result.skipped})`);
    } catch (error) {
      console.error('Classroom同期エラー:', error);
    }
  }

  /**
   * リマインダーをチェックして実行
   */
  async checkAndExecuteReminders() {
    try {
      const now = new Date();
      const currentDay = DAY_NAMES[now.getDay()];
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      // 全てのリマインダーを取得
      const allReminders = ReminderStore.getAll();

      for (const reminder of allReminders) {
        // intensive モード（7日集中型）
        if (reminder.mode === 'intensive') {
          // 初回実行か確認
          if (!reminder.intensiveStartDate) {
            // 初回実行時刻チェック
            if (reminder.day === currentDay && reminder.time === currentTime) {
              // intensiveStartDate を記録
              ReminderStore.update(reminder.id, {
                intensiveStartDate: now.toISOString(),
              });
              await this.executeReminder(reminder, 'intensive');
            }
          } else {
            // 2回目以降
            const startDate = new Date(reminder.intensiveStartDate);
            const daysSinceStart = Math.floor((now - startDate) / (24 * 60 * 60 * 1000));

            // 7日経過したら削除
            if (daysSinceStart >= 7) {
              ReminderStore.remove(reminder.id);
              console.log(`✅ 集中型リマインダー期限終了・削除: ID=${reminder.id}`);
              continue;
            }

            // 時刻が一致したら実行
            if (reminder.time === currentTime) {
              await this.executeReminder(reminder, 'intensive');
            }
          }
        }
        // once モード（一度だけ）
        else if (reminder.mode === 'once' || reminder.once) {
          if (reminder.day === currentDay && reminder.time === currentTime) {
            await this.executeReminder(reminder, 'once');
            ReminderStore.remove(reminder.id);
          }
        }
        // normal モード（毎週）
        else {
          if (reminder.day === currentDay && reminder.time === currentTime) {
            await this.executeReminder(reminder, 'normal');
          }
        }
      }
    } catch (error) {
      console.error('リマインダー実行エラー:', error);
    }
  }

  /**
   * リマインダーを実行
   */
  async executeReminder(reminder, mode = 'normal') {
    try {
      // Todoist にタスクを追加
      await todoistService.api.addTask({
        content: reminder.content,
        dueDate: new Date(),
      });

      // Discord チャンネルに通知
      const channel = await this.client.channels.fetch(config.notification.channelId);
      if (channel) {
        const dayName = reminder.day + '曜日';
        let modeLabel = '';
        if (mode === 'intensive') {
          modeLabel = '(7日集中)';
        } else if (mode === 'once') {
          modeLabel = '(1回のみ実行)';
        }

        const embed = new EmbedBuilder()
          .setColor('#FF9800')
          .setTitle('🔔 リマインダー実行')
          .addFields(
            { name: '曜日', value: dayName, inline: true },
            { name: '実行時間', value: reminder.time, inline: true },
            { name: 'リマインダー', value: reminder.content, inline: false }
          )
          .setDescription('📝 TODOリストに追加されました')
          .setFooter({ text: modeLabel })
          .setTimestamp();

        await channel.send({ embeds: [embed] });
      }

      // 実行日時を記録
      ReminderStore.update(reminder.id, {
        lastExecuted: new Date().toISOString(),
      });

      if (mode === 'intensive') {
        console.log(`✅ 集中型リマインダー実行: ID=${reminder.id} - ${reminder.content}`);
      } else if (mode === 'once') {
        console.log(`✅ 一度だけリマインダー実行: ID=${reminder.id} - ${reminder.content}`);
      } else {
        console.log(`✅ リマインダー実行: ID=${reminder.id} - ${reminder.content}`);
      }
    } catch (error) {
      console.error(`リマインダー実行失敗 (ID=${reminder.id}):`, error);
    }
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
  * 通知を送信
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
      const allTasks = await todoistService.getAllTasks();
      
      let completedCount = 0;
      const pendingTasks = [];
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
