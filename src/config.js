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
};
