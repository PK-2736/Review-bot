const { Client, GatewayIntentBits, Collection, REST, Routes, EmbedBuilder } = require('discord.js');
const config = require('./config');
const reviewCommand = require('./commands/review');
const todayCommand = require('./commands/today');
const doneCommand = require('./commands/done');
const classCommand = require('./commands/class');
const TodoScheduler = require('./scheduler');
const todoistService = require('./services/todoist');

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
client.commands.set('done', doneCommand);
client.commands.set('class', classCommand);

// スラッシュコマンドの登録
const commands = [todayCommand.data.toJSON(), doneCommand.data.toJSON(), classCommand.data.toJSON()];

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
  if (interaction.isChatInputCommand()) {
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
  }

  // スレクトメニュー処理
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'task-done-select') {
      await handleTaskCompletion(interaction);
    }
  }
});

/**
 * タスク完了処理
 * @param {Interaction} interaction
 */
async function handleTaskCompletion(interaction) {
  await interaction.deferReply();

  try {
    const selectedTaskIds = interaction.values;
    const completedTasks = [];
    const failedTasks = [];

    for (const taskId of selectedTaskIds) {
      try {
        await todoistService.completeTask(taskId);
        completedTasks.push(taskId);
      } catch (error) {
        console.error(`タスク完了エラー (${taskId}):`, error);
        failedTasks.push(taskId);
      }
    }

    // 完了結果のメッセージを作成
    let resultMessage = '';
    if (completedTasks.length > 0) {
      resultMessage += `✅ **${completedTasks.length}件完了しました！**\n`;
    }
    if (failedTasks.length > 0) {
      resultMessage += `❌ **${failedTasks.length}件失敗しました**\n`;
    }

    const embed = new EmbedBuilder()
      .setColor(failedTasks.length === 0 ? '#4CAF50' : '#FF9800')
      .setTitle('🎉 タスク完了結果')
      .setDescription(resultMessage)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed], components: [] });

    console.log(`✅ タスク完了: ${completedTasks.length}件完了, ${failedTasks.length}件失敗`);

  } catch (error) {
    console.error('タスク完了エラー:', error);
    await interaction.editReply('❌ タスクの完了に失敗しました。');
  }
}

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
