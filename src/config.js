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
    intervals: [1, 3, 7, 14, 30],
  },
  notification: {
    channelId: process.env.TODO_NOTIFICATION_CHANNEL_ID || '1468959638052540439',
    // 通知スケジュール（cron形式）
    schedules: [
      { time: '20 8 * * *', label: '朝' },   // 朝8:20
      { time: '0 12 * * *', label: '昼' },   // 昼12:00
      { time: '20 19 * * *', label: '夜' },  // 夜19:20
    ],
  },
};
