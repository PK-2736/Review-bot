require('dotenv').config();

module.exports = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
  },
  todoist: {
    apiToken: process.env.TODOIST_API_TOKEN,
  },
  review: {
    defaultProjectName: process.env.DEFAULT_PROJECT_NAME || '復習タスク',
    // 復習間隔（日数）- エビングハウスの忘却曲線に基づく
    intervals: {
      normal: [1, 3, 7, 14, 30],           // 通常モード（5回）
      mastery: [1, 3, 7, 14, 30, 60, 90, 180], // 完全習得モード（8回、半年まで）
    },
  },
  notification: {
    channelId: process.env.TODO_NOTIFICATION_CHANNEL_ID || '1468959638052540439',
    // 通知スケジュール（cron形式）
    schedules: [
      { time: '20 8 * * *', label: '朝' },   // 朝8:20
      { time: '0 12 * * *', label: '昼' },   // 昼12:00
      { time: '20 19 * * *', label: '夜' },  // 夜19:20
    ],
    // 週次レポート（毎週日曜日 21:00）
    weeklyReport: {
      enabled: true,
      time: '0 21 * * 0',  // 毎週日曜21:00
      channelId: '1468959638052540439',
    },
  },
  classroom: {
    enabled: process.env.CLASSROOM_ENABLED === 'true',
    syncTime: process.env.CLASSROOM_SYNC_TIME || '0 7 * * *',
    dueWithinDays: Number(process.env.CLASSROOM_DUE_WITHIN_DAYS || 7),
    courseIds: process.env.CLASSROOM_COURSE_IDS
      ? process.env.CLASSROOM_COURSE_IDS.split(',').map(item => item.trim()).filter(Boolean)
      : [],
    projectName: process.env.CLASSROOM_PROJECT_NAME || 'Classroom',
    timezone: process.env.CLASSROOM_TIMEZONE || 'Asia/Tokyo',
    autoCloseCompleted: process.env.CLASSROOM_AUTO_CLOSE === 'true',
    auth: {
      serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
      impersonateUser: process.env.GOOGLE_IMPERSONATE_USER,
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
      redirectUri: process.env.GOOGLE_REDIRECT_URI,
    },
  },
  autoReview: {
    // 自動復習タスク登録
    enabled: true,
    channelId: '1468960514238582878',  // メッセージを受け取るチャンネルID
    userId: '726195003780628621',      // 対象ユーザーID
  },
};
