# Review-bot

DiscordとTodoistを連携した復習管理bot

## 概要

Review-botは、Discordから学習内容を登録すると、科学的な復習間隔（エビングハウスの忘却曲線に基づく）でTodoistに復習タスクを自動作成するbotです。

## 機能

- 📚 Discordコマンドで簡単に復習タスクを登録
- ⏰ 自動的に最適な間隔で復習タスクを作成（1日後、3日後、7日後、14日後、30日後）
- ✅ Todoistで復習タスクを管理

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
4. Token をコピーして `.env` の `DISCORD_TOKEN` に設定
5. 「OAuth2」→「URL Generator」でBot招待URLを生成
   - SCOPES: `bot`
   - BOT PERMISSIONS: `Send Messages`, `Read Message History`

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

### メモリ不足の場合

ecosystem.config.js の `max_memory_restart` を調整：

```javascript
max_memory_restart: '512M', // 1G から 512M に削減
```

## ライセンス

MIT