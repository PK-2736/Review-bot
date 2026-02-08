# Review-bot

DiscordとTodoistを連携した復習管理bot

## 概要

Review-botは、Discordから学習内容を登録すると、科学的な復習間隔（エビングハウスの忘却曲線に基づく）でTodoistに復習タスクを自動作成するbotです。

## 機能

- 📚 Discordコマンドで簡単に復習タスクを登録
- ⏰ 自動的に最適な間隔で復習タスクを作成（1日後、3日後、7日後、14日後、30日後）
- ✅ Todoistで復習タスクを管理
- 📋 今日のTODOリストを定期的に通知（朝8:20、昼12:00、夜19:20）
- 🔔 スラッシュコマンドで手動でTODOリストを確認可能

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env.example` を `.env` にコピーして、必要な情報を設定してください。

```bash
cp .env.example .env
```

#### Discord Bot の作成

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセス
2. 「New Application」をクリックして新しいアプリケーションを作成
3. 「Bot」タブに移動して Bot を作成
4. **⚠️ 重要: Privileged Gateway Intents で「MESSAGE CONTENT INTENT」をONにする**
5. Token をコピーして `.env` の `DISCORD_TOKEN` に設定
6. 「General Information」タブでアプリケーションIDをコピーして `DISCORD_CLIENT_ID` に設定
7. 「OAuth2」→「URL Generator」でBot招待URLを生成
   - SCOPES: `bot`, `applications.commands`
   - BOT PERMISSIONS: `Send Messages`, `Read Message History`, `Use Slash Commands`

#### Todoist API Token の取得

1. [Todoist Settings](https://todoist.com/prefs/integrations) にアクセス
2. 「Developer」タブで API トークンを確認
3. トークンをコピーして `.env` の `TODOIST_API_TOKEN` に設定

### 3. Bot の起動

```bash
npm start
```

開発モード（自動リロード）:
```bash
npm run dev
```

## 使い方

### 復習タスクの作成

Discordで以下のコマンドを使用します：

```
!review <学習内容>
```

**例:**
```
!review JavaScriptの非同期処理
!review Reactのhooksについて
!review アルゴリズム：二分探索
```

コマンドを実行すると、以下のスケジュールで復習タスクがTodoistに作成されます：

- 1回目: 1日後
- 2回目: 3日後
- 3回目: 7日後
- 4回目: 14日後
- 5回目: 30日後

### 今日のTODOリストを確認

スラッシュコマンドで今日のタスクを確認できます：

```
/today
```

このコマンドは、以下の時間に自動的に指定チャンネルに送信されます：
- 🌅 朝 8:20
- 🌞 昼 12:00
- 🌙 夜 19:20

TODOリストは優先度別に色分けされて表示されます：
- 🔴 高優先度
- 🟡 中優先度
- ⚪ 通常

### タスクを完了にする

スラッシュコマンドで完了にしたいタスクを選択します：

```
/done
```

セレクトメニューから完了したいタスクを選択（最大5件まで同時選択可能）すると、Todoistでそのタスクが完了になります：

```
✅ 5件完了しました！
```

### 授業内容を登録して復習スケジュール作成

毎週木曜日の授業など、定期的に学ぶ内容を登録して復習スケジュールを自動作成できます：

```
/class
```

以下の情報を入力：

| オプション | 説明 | 例 |
|-----------|------|-----|
| `subject` | 科目名・授業タイトル（必須） | `データ構造とアルゴリズム` |
| `content` | 授業内容の説明（オプション） | `グラフ理論とトポロジカルソート` |
| `instructor` | 担当講師名（オプション） | `山田太郎` |

**例：**
```
/class subject: データ構造とアルゴリズム content: グラフ理論とトポロジカルソート instructor: 山田太郎
```

実行すると、以下のスケジュールで5つの復習タスクが自動作成されます：

```
📚 授業復習タスク登録完了

【データ構造とアルゴリズム】 (山田太郎担当)

📝 内容
グラフ理論とトポロジカルソート

📅 復習スケジュール
1回目: 1日後 (2月15日 金) 🔴 高
2回目: 3日後 (2月17日 日) 🟡 中
3回目: 7日後 (2月21日 木) ⚪ 通常
4回目: 14日後 (2月28日 木) ⚪ 通常
5回目: 30日後 (3月16日 日) ⚪ 通常

✅ 5件の復習タスクを自動作成しました
エビングハウスの忘却曲線に基づいた時間配置です
```

### 授業スケジュール自動実行

毎週木曜日など定期的な授業をあらかじめ登録して、授業の時間に自動的に復習TODOが作成される機能です：

#### スケジュール追加
```
/schedule add day:木 time:18:00 subject:データ構造とアルゴリズム
```

**パラメータ：**

| パラメータ | 説明 | 必須 | 例 |
|-----------|------|------|-----|
| `day` | 授業の曜日 | ✅ | 月/火/水/木/金/土/日 |
| `time` | 授業時間（HH:MM形式） | ✅ | 18:00 |
| `subject` | 授業科目名 | ✅ | データ構造 |
| `content` | 授業内容の説明 | ❌ | グラフ理論 |
| `instructor` | 担当講師名 | ❌ | 山田太郎 |

**例：**
```
/schedule add day:木 time:18:00 subject:データ構造 content:グラフ理論 instructor:山田太郎
```

実行すると、登録情報が確認され、毎週木曜日18:00に自動的に復習タスクが作成されます。

#### スケジュール確認
```
/schedule list
```

登録済みのすべての授業スケジュールを表示：

```
📅 登録済み授業スケジュール

合計 2 件

スケジュール一覧
**ID: 1** | 木曜日 18:00 | データ構造 (山田太郎)
**ID: 2** | 金曜日 10:00 | 線形代数 (佐藤花子)

/schedule remove [ID] で削除できます
```

#### スケジュール削除
```
/schedule remove id:1
```

指定したIDのスケジュールを削除します。

## ワークフロー例

### 定期授業の場合

1. **最初に一度だけ登録**
   ```
   /schedule add day:木 time:18:00 subject:データ構造 instructor:山田太郎
   ```

2. **毎週木曜日18:00に自動実行**
   - 自動的に復習スケジュールが作成される
   - 通知チャンネルに自動作成の報告が届く

3. **定期確認**
   ```
   /today
   ```
   で今日やるべき復習を確認

4. **完了したら**
   ```
   /done
   ```
   でチェック✓

### 単発の授業内容の場合

1. **授業当日に手動登録**
   ```
   /class subject: データ構造とアルゴリズム content: グラフ理論とトポロジカルソート
   ```

2. **復習スケジュール作成**
   - 自動的に5つの復習タスクが作成される

定期授業も単発の授業も、効率的に学習内容が復習できます！ 🎓

## プロジェクト構造

```
Review-bot/
├── src/
│   ├── index.js              # メインエントリーポイント
│   ├── config.js             # 設定管理
│   ├── commands/
│   │   └── review.js         # 復習コマンド
│   └── services/
│       └── todoist.js        # Todoist API クライアント
├── .env.example              # 環境変数のテンプレート
├── .gitignore
├── package.json
└── README.md
```

## カスタマイズ

### 復習間隔の変更

`src/config.js` の `intervals` を編集することで、復習間隔をカスタマイズできます：

```javascript
intervals: [1, 3, 7, 14, 30], // 日数の配列
```

### プロジェクト名の変更

`.env` ファイルで `DEFAULT_PROJECT_NAME` を変更できます。

### 通知チャンネルの変更

`.env` ファイルで `TODO_NOTIFICATION_CHANNEL_ID` を変更することで、TODOリストを送信するチャンネルを変更できます。

### 通知時間の変更

[src/config.js](src/config.js) の `notification.schedules` を編集することで、通知時間をカスタマイズできます：

```javascript
schedules: [
  { time: '20 8 * * *', label: '朝' },   // 朝8:20
  { time: '0 12 * * *', label: '昼' },   // 昼12:00
  { time: '20 19 * * *', label: '夜' },  // 夜19:20
],
```

cron形式で指定します（分 時 日 月 曜日）。

## デプロイ（Oracle Ubuntu + GitHub Actions）

### サーバー初期セットアップ

Oracle Ubuntu サーバーで以下を実行：

```bash
# セットアップスクリプトをダウンロード
wget https://raw.githubusercontent.com/PK-2736/Review-bot/main/scripts/setup-server.sh
chmod +x setup-server.sh
./setup-server.sh
```

または手動でセットアップ：

```bash
# Node.js のインストール
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

# PM2 のインストール
sudo npm install -g pm2

# PM2 自動起動設定
pm2 startup systemd
```

### GitHub Secrets の設定

GitHub リポジトリの Settings > Secrets and variables > Actions で以下を設定：

| Secret 名 | 説明 | 例 |
|-----------|------|-----|
| `SSH_PRIVATE_KEY` | サーバーへのSSH秘密鍵 | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `SSH_HOST` | サーバーのIPアドレス/ホスト名 | `123.456.789.012` |
| `SSH_USER` | SSHユーザー名 | `ubuntu` |
| `SSH_PORT` | SSHポート（オプション） | `22` |
| `DISCORD_TOKEN` | Discord Bot トークン | `MTIz...` |
| `DISCORD_CLIENT_ID` | Discord クライアントID | `123456789...` |
| `TODOIST_API_TOKEN` | Todoist API トークン | `abc123...` |
| `DEFAULT_PROJECT_NAME` | プロジェクト名（オプション） | `復習タスク` |

### SSH鍵の作成と登録

```bash
# ローカルマシンで SSH鍵ペアを生成（まだない場合）
ssh-keygen -t ed25519 -C "github-actions@review-bot"

# 公開鍵をサーバーに登録
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@your-server

# 秘密鍵の内容を GitHub Secrets の SSH_PRIVATE_KEY に登録
cat ~/.ssh/id_ed25519
```

### デプロイの実行

main ブランチに push すると自動的にデプロイされます：

```bash
git add .
git commit -m "Update bot"
git push origin main
```

手動でデプロイを実行する場合：
- GitHub > Actions > "Deploy to Oracle Ubuntu" > "Run workflow"

### PM2 管理コマンド

サーバー上で以下のコマンドが使用できます：

```bash
# プロセス一覧
pm2 list

# ログ表示
pm2 logs review-bot

# リアルタイムモニタリング
pm2 monit

# 再起動
pm2 restart review-bot

# 停止
pm2 stop review-bot

# 削除
pm2 delete review-bot

# 起動時の自動起動設定を保存
pm2 save
```

### ローカル環境でPM2を使う

開発環境でもPM2を使ってテストできます：

```bash
# PM2で起動
npm run pm2:start

# ログ確認
npm run pm2:logs

# 再起動
npm run pm2:restart

# 停止
npm run pm2:stop
```

または、スクリプトを直接実行：

```bash
chmod +x scripts/local-deploy.sh
./scripts/local-deploy.sh
```

## トラブルシューティング

### デプロイが失敗する場合

1. GitHub Secrets が正しく設定されているか確認
2. サーバーへのSSH接続を手動でテスト
3. サーバー上でディスク容量を確認: `df -h`
4. PM2のログを確認: `pm2 logs review-bot --lines 100`

### Bot が起動しない場合

1. 環境変数を確認: `cat ~/Review-bot/.env`
2. Discord/Todoist トークンが有効か確認
3. エラーログを確認: `pm2 logs review-bot --err`
4. **Discord Developer Portal で「MESSAGE CONTENT INTENT」が有効になっているか確認**

### TODOリスト通知が届かない場合

1. `.env` の `TODO_NOTIFICATION_CHANNEL_ID` が正しいか確認
2. Botがそのチャンネルにアクセスできるか確認
3. スケジューラーのログを確認: `pm2 logs review-bot | grep "📅"`

### メモリ不足の場合

ecosystem.config.js の `max_memory_restart` を調整：

```javascript
max_memory_restart: '512M', // 1G から 512M に削減
```

## ライセンス

MIT