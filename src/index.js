const { Client, GatewayIntentBits, Collection } = require('discord.js');
const config = require('./config');
const reviewCommand = require('./commands/review');

// Discord クライアントの初期化
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// コマンドの登録
client.commands = new Collection();
client.commands.set('review', reviewCommand);

// Bot が準備完了したときの処理
client.once('ready', () => {
  console.log(`✅ ${client.user.tag} としてログインしました！`);
  console.log(`📚 復習管理botが起動しました`);
});

// メッセージを受信したときの処理
client.on('messageCreate', async (message) => {
  // Bot 自身のメッセージは無視
  if (message.author.bot) return;

  // プレフィックスコマンド（!で始まる）
  if (!message.content.startsWith('!')) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const commandName = args.shift().toLowerCase();

  const command = client.commands.get(commandName);
  if (!command) return;

  try {
    await command.execute(message, args);
  } catch (error) {
    console.error(`コマンド実行エラー: ${error}`);
    await message.reply('❌ コマンドの実行中にエラーが発生しました。');
  }
});

// エラーハンドリング
client.on('error', (error) => {
  console.error('Discord クライアントエラー:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('未処理の Promise rejection:', error);
});

// Bot の起動
client.login(config.discord.token).catch((error) => {
  console.error('❌ Botのログインに失敗しました:', error);
  process.exit(1);
});
