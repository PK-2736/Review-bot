# Review-bot

DiscordとTodoistを連携した復習管理bot

## 概要

Review-botは、Discordから学習内容を登録すると、科学的な復習間隔（エビングハウスの忘却曲線に基づく）でTodoistに復習タスクを自動作成するbotです。

## 機能

- 📚 Discordコマンドで簡単に復習タスクを登録
- ⏰ 自動的に最適な間隔で復習タスクを作成（**通常モード**: 1日後、3日後、7日後、14日後、30日後 / **完全習得モード**: 1,3,7,14,30,60,90,180日後）
- ✅ Todoistで復習タスクを管理
- 📋 今日のTODOリストを定期的に通知（朝8:20、昼12:00、夜19:20）
- 📊 毎週日曜21:00に学習成果をレポート表示
- 🔔 スラッシュコマンドで手動でTODOリストを確認可能
- 🔄 毎週決まった時間にリマインダーとしてTODOを自動追加
- 🎓 Google Classroom の課題を Todoist に自動同期（期限が近い課題のみ）

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

#### Google Classroom 連携の設定（オプション）

**Google OAuth（リフレッシュトークン方式）の場合：**

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. プロジェクトを作成し、Google Classroom API を有効化
3. 「OAuth同意画面」で同意を設定
4. 「認証情報」→「OAuth クライアント」を作成（種類: Webアプリケーション）
5. [OAuth Playground](https://developers.google.com/oauthplayground) で以下スコープで認可：
   ```
   https://www.googleapis.com/auth/classroom.courses.readonly
   https://www.googleapis.com/auth/classroom.coursework.me.readonly
   https://www.googleapis.com/auth/classroom.student-submissions.me.readonly
   ```
6. 取得したトークンを `.env` に設定：
   ```
   CLASSROOM_ENABLED=true
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REFRESH_TOKEN=...
   GOOGLE_REDIRECT_URI=https://developers.google.com/oauthplayground
   ```

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

セレクトメニューから完了したいタスクを選択すると、Todoistでそのタスクが完了になります。

### 週間リマインダーを設定

毎週決まった時間にTODOを自動追加できます：

```
/reminder add <曜日> <時間> <内容>
```

**例：**
```
/reminder add 金曜日 20:00 週末の読書
/reminder add 月曜日 08:00 1週間の計画立案
```

登録済みのリマインダーを確認：
```
/reminder list
```

リマインダーを削除：
```
/reminder remove <ID>
```

### 授業スケジュール自動実行

毎週木曜日など定期的な授業をあらかじめ登録して、**授業のX時間後**に自動的に復習TODOが作成される機能です：

#### スケジュール追加
```
/schedule add day:木 time:18:00 subject:データ構造とアルゴリズム review_offset:180 review_mode:normal
```

**パラメータ：**

| パラメータ | 説明 | 必須 | 例 |
|-----------|------|------|-----|
| `day` | 授業の曜日 | ✅ | 月/火/水/木/金/土/日 |
| `time` | 授業時間（HH:MM形式） | ✅ | 18:00 |
| `subject` | 授業科目名 | ✅ | データ構造 |
| `content` | 授業内容の説明 | ❌ | グラフ理論 |
| `instructor` | 担当講師名 | ❌ | 山田太郎 |
| `review_offset` | 授業時間からのオフセット（分、デフォルト180） | ❌ | 180 |
| `review_mode` | 復習モード: normal または mastery（デフォルト normal） | ❌ | normal |

**例：**
```
/schedule add day:木 time:18:00 subject:データ構造 content:グラフ理論 instructor:山田太郎 review_offset:180 review_mode:normal
```

実行すると、登録情報が確認され、毎週木曜日21:00（18:00 + 180分）に自動的に復習タスクが作成されます。

**復習モード説明：**
- **normal**: 5回の復習（1,3,7,14,30日後）- 1ヶ月かけて学習
- **mastery**: 8回の復習（1,3,7,14,30,60,90,180日後）- 6ヶ月かけて完全習得

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

### Google Classroom 課題を自動同期

Google Classroom の課題を Todoist に自動同期できます（期限が近い課題のみ）：

```
/classroom list
```

期限が近い課題を表示：
- 🚨 期限切れ課題
- ⏰ 指定日数以内の課題（デフォルト7日以内）
- 📋 将来の課題

今すぐ同期する場合は（管理者のみ）：
```
/classroom sync
```

追加・更新・完了した件数と処理時間を表示します。

**同期設定：**
- `.env` の `CLASSROOM_ENABLED=true` で有効化
- `CLASSROOM_SYNC_TIME` で実行時刻を指定（デフォルト 毎日7:00）
- `CLASSROOM_DUE_WITHIN_DAYS` で取り込み対象の日数を指定（デフォルト 7日以内）

## ワークフロー例

### Google Classroom を使っている場合

1. **最初に一度だけ設定**
   ```
   .env で：
   CLASSROOM_ENABLED=true
   CLASSROOM_SYNC_TIME=0 7 * * *  （毎日7:00）
   CLASSROOM_DUE_WITHIN_DAYS=7    （7日以内）
   ```

2. **毎日7:00に自動同期**
   - 期限が7日以内の課題が自動取得される
   - Todoistの「Classroom」プロジェクトに追加される

3. **実行状況を確認**
   ```
   /classroom list
   ```
   で期限が近い課題を確認

4. **Today コマンドで統合表示**
   ```
   /today
   ```
   で復習タスク＆Classroom課題を一覧表示

5. **完了したら**
   ```
   /done
   ```
   でチェック✓

### 定期授業の場合

1. **最初に一度だけ登録**
   ```
   /schedule add day:木 time:18:00 subject:データ構造 instructor:山田太郎 review_mode:normal
   ```

2. **毎週木曜日21:00に自動実行（180分後）**
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

### 週間リマインダーを設定

1. **リマインダーを登録**
   ```
   /reminder add 金曜日 20:00 週末の読書
   /reminder add 日曜日 21:00 1週間の復習
   ```

2. **毎週自動実行**
   - 指定時刻にTODOリストに自動追加
   - Discordで完了報告

複数のシステムを組み合わせて、効率的に学習管理できます！ 🎓

## プロジェクト構造

```
Review-bot/
├── src/
│   ├── index.js                    # メインエントリーポイント
│   ├── config.js                   # 設定管理
│   ├── scheduler.js                # スケジューラージョブ
│   ├── commands/
│   │   ├── review.js               # 復習タスク登録
│   │   ├── today.js                # 本日のTODO表示
│   │   ├── done.js                 # タスク完了
│   │   ├── schedule.js             # 授業スケジュール管理
│   │   ├── reminder.js             # 週間リマインダー管理
│   │   └── classroom.js            # Google Classroom 同期
│   └── services/
│       ├── todoist.js             # Todoist API クライアント
│       ├── classroomService.js    # Google Classroom API クライアント  
│       ├── classroomTaskStore.js  # Classroom タスク重複管理
│       ├── reminderStore.js       # リマインダー管理
│       └── scheduleStore.js       # スケジュール伝管理
├── data/                         # データストア (自動作成)
├── .env.example                # 環境変数テンプレート
├── .gitignore
├── package.json
├── ecosystem.config.js         # PM2 設定
└── README.md
```

## カスタマイズ

### 復習間隔の変更

`src/config.js` の `intervals` を編集することで、復習間隔をカスタマイズできます：

```javascript
// 通常モード
intervals: [1, 3, 7, 14, 30],

// 完全習得モード
intervals: [1, 3, 7, 14, 30, 60, 90, 180],
```

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

### Classroom 同期設定の変更

`.env` で以下を設定できます：

```env
# Classroom 同期の有効化 (true/false)
CLASSROOM_ENABLED=true

# 同期実行時刻 (cron 形式)
CLASSROOM_SYNC_TIME=0 7 * * *

# 取り込み対象の日数
CLASSROOM_DUE_WITHIN_DAYS=7

# 取り込み対象のコースID (空白=全て)
CLASSROOM_COURSE_IDS=
```

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
| `CLASSROOM_ENABLED` | Classroom 同期の有効化 | `true` |
| `CLASSROOM_SYNC_TIME` | Classroom 同期時刻（cron） | `0 7 * * *` |
| `CLASSROOM_DUE_WITHIN_DAYS` | 取り込み対象日数 | `7` |
| `GOOGLE_CLIENT_ID` | Google OAuth クライアントID | `xxxx...googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth クライアントシークレット | `GOCSPX-...` |
| `GOOGLE_REFRESH_TOKEN` | Google リフレッシュトークン | `1//0...` |
| `GOOGLE_REDIRECT_URI` | Google リダイレクトURI | `https://developers.google.com/oauthplayground` |

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