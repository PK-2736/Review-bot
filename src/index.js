const { Client, GatewayIntentBits, Collection, REST, Routes, EmbedBuilder } = require('discord.js');
const config = require('./config');
const reviewCommand = require('./commands/review');
const todayCommand = require('./commands/today');
const doneCommand = require('./commands/done');
const classCommand = require('./commands/class');
const scheduleCommand = require('./commands/schedule');
const reminderCommand = require('./commands/reminder');
const classroomCommand = require('./commands/classroom');
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
client.commands.set('schedule', scheduleCommand);
client.commands.set('reminder', reminderCommand);
client.commands.set('classroom', classroomCommand);

// スラッシュコマンドの登録
const commands = [todayCommand.data.toJSON(), doneCommand.data.toJSON(), classCommand.data.toJSON(), scheduleCommand.data.toJSON(), reminderCommand.data.toJSON(), classroomCommand.data.toJSON()];

const rest = new REST({ version: '10' }).setToken(config.discord.token);

// Bot が準備完了したときの処理
client.once('clientReady', async () => {
  console.log(`✅ ${client.user.tag} としてログインしました！`);
  console.log(`📚 復習管理botが起動しました`);

  try {
    console.log('🔄 スラッシュコマンドを登録中...');
    console.log(`📝 登録するコマンド: ${commands.map(c => c.name).join(', ')}`);
    
    await rest.put(
      Routes.applicationCommands(config.discord.clientId),
      { body: commands },
    );
    console.log('✅ スラッシュコマンドの登録が完了しました');
  } catch (error) {
    console.error('❌ スラッシュコマンドの登録に失敗しました:', error);
    console.error('エラー詳細:', error.message);
    if (error.rawError) {
      console.error('Raw Error:', JSON.stringify(error.rawError, null, 2));
    }
  }

  // TODOスケジューラーを開始
  const scheduler = new TodoScheduler(client);
  scheduler.start();
});

// スラッシュコマンドの処理
client.on('interactionCreate', async (interaction) => {
  // Autocomplete 処理
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (!command || !command.autocomplete) return;

    try {
      await command.autocomplete(interaction);
    } catch (error) {
      console.error(`Autocomplete エラー: ${error}`);
    }
    return;
  }

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
    if (interaction.customId === 'done-select-primary') {
      // done.js が直接処理するため、ここでは何もしない
    }
  }
});

// メッセージを受信したときの処理
client.on('messageCreate', async (message) => {
  // Bot 自身のメッセージは無視
  if (message.author.bot) return;

  // 自動復習タスク登録チェック
  if (config.autoReview.enabled && 
      message.channelId === config.autoReview.channelId && 
      message.author.id === config.autoReview.userId) {
    
    try {
      await handleAutoReviewMessage(message);
    } catch (error) {
      console.error('自動復習タスク登録エラー:', error);
    }
    return;
  }

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

/**
 * 自動復習タスク登録処理
 */
async function handleAutoReviewMessage(message) {
  try {
    const content = message.content.trim();
    
    if (content.length === 0) {
      await message.react('❌');
      return;
    }

    // 復習タスクを作成
    const tasks = await todoistService.createReviewSeries(content, 'normal');

    // 確認メッセージを送信
    const embed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle('✅ 復習タスク自動登録完了')
      .setDescription(`**${content}** の復習スケジュールを作成しました`)
      .addFields(
        { name: '📊 作成内容', value: `${tasks.length}件の復習タスク`, inline: false },
        { name: '📅 期間', value: 'エビングハウス忘却曲線に基づいた1ヶ月間', inline: false }
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });
    await message.react('👍');

    console.log(`✅ 自動復習タスク登録: "${content}" (${tasks.length}件)`);

  } catch (error) {
    console.error('自動復習タスク登録エラー:', error);
    await message.react('❌');
  }
}

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
