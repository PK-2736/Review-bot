#!/bin/bash
# Oracle Ubuntu サーバーの初期セットアップスクリプト

set -e

echo "🚀 Review-bot サーバーセットアップを開始します..."

# システムの更新
echo "📦 システムパッケージを更新中..."
sudo apt update && sudo apt upgrade -y

# Node.js と npm のインストール（Node.js 20.x を使用）
if ! command -v node &> /dev/null; then
    echo "📦 Node.js をインストール中..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "✅ Node.js は既にインストールされています: $(node --version)"
fi

# Git のインストール
if ! command -v git &> /dev/null; then
    echo "📦 Git をインストール中..."
    sudo apt install -y git
else
    echo "✅ Git は既にインストールされています: $(git --version)"
fi

# PM2 のグローバルインストール
if ! command -v pm2 &> /dev/null; then
    echo "📦 PM2 をインストール中..."
    sudo npm install -g pm2
else
    echo "✅ PM2 は既にインストールされています: $(pm2 --version)"
fi

# PM2 の起動設定（システム起動時に自動起動）
echo "⚙️  PM2 スタートアップを設定中..."
pm2 startup systemd -u $USER --hp $HOME
sudo env PATH=$PATH:/usr/bin $(which pm2) startup systemd -u $USER --hp $HOME

# ログディレクトリの作成
echo "📁 ログディレクトリを作成中..."
mkdir -p ~/Review-bot/logs

# SSH鍵の設定案内
echo ""
echo "✅ サーバーセットアップが完了しました！"
echo ""
echo "📋 次のステップ:"
echo "1. SSH公開鍵をGitHubに登録（リポジトリへのアクセス用）"
echo "   - ssh-keygen -t ed25519 -C 'your_email@example.com' を実行"
echo "   - cat ~/.ssh/id_ed25519.pub でキーを表示"
echo "   - GitHub Settings > SSH and GPG keys で登録"
echo ""
echo "2. GitHub Secrets に以下の情報を登録:"
echo "   - SSH_PRIVATE_KEY: このサーバーへのSSH秘密鍵"
echo "   - SSH_HOST: このサーバーのIPアドレス/ホスト名"
echo "   - SSH_USER: $USER"
echo "   - SSH_PORT: 22 (カスタムポートの場合は変更)"
echo "   - DISCORD_TOKEN: Discord Bot トークン"
echo "   - DISCORD_CLIENT_ID: Discord クライアントID"
echo "   - TODOIST_API_TOKEN: Todoist API トークン"
echo ""
echo "3. GitHub Actions からデプロイを実行"
echo ""
echo "🎉 準備完了です！"
