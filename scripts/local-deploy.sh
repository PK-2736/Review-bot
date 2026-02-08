#!/bin/bash
# ローカル開発用デプロイスクリプト

set -e

echo "🚀 Review-bot をローカル環境で起動します..."

# .env ファイルの確認
if [ ! -f .env ]; then
    echo "❌ .env ファイルが見つかりません"
    echo "📝 .env.example をコピーして .env を作成してください:"
    echo "   cp .env.example .env"
    exit 1
fi

# 依存関係のインストール
echo "📦 依存関係をインストール中..."
npm install

# ログディレクトリの作成
echo "📁 ログディレクトリを作成中..."
mkdir -p logs

# PM2 がインストールされているか確認
if ! command -v pm2 &> /dev/null; then
    echo "📦 PM2 をグローバルにインストール中..."
    npm install -g pm2
fi

# PM2 でアプリケーションを起動
echo "🚀 PM2 でアプリケーションを起動中..."
pm2 start ecosystem.config.js

echo ""
echo "✅ アプリケーションが起動しました！"
echo ""
echo "📊 便利なコマンド:"
echo "   pm2 list          - プロセス一覧"
echo "   pm2 logs          - ログを表示"
echo "   pm2 monit         - モニタリング"
echo "   pm2 restart all   - 再起動"
echo "   pm2 stop all      - 停止"
echo "   pm2 delete all    - 削除"
echo ""
