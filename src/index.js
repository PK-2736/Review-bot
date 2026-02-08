const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const config = require('./config');
const reviewCommand = require('./commands/review');
const todayCommand = require('./commands/today');
const TodoScheduler = require('./scheduler');

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
client.commands.set('today', todayCommand);

// スラッシュコマンドの登録
const commands = [todayCommand.data.toJSON()];

const rest = new REST({ version: '10' }).setToken(config.discord.token);

// Bot が準備完了したときの処理
client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} としてログインしました！`);
  console.log(`📚 復習管理botが起動しました`);

  try {
    console.log('🔄 スラッシュコマンドを登録中...');
    await rest.put(
      Routes.applicationCommands(config.discord.clientId),
      { body: commands },
    );
    console.log('✅ スラッシュコマンドの登録が完了しました');
  } catch (error) {
    console.error('❌ スラッシュコマンドの登録に失敗しました:', error);
  }

  // TODOスケジューラーを開始
  const scheduler = new TodoScheduler(client);
  scheduler.start();
});

// スラッシュコマンドの処理
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`スラッシュコマンド実行エラー: ${error}`);
    const reply = { content: '❌ コマンドの実行中にエラーが発生しました。', ephemeral: true };
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
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
