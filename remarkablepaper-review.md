# AI復習スケジューラー 仕様書

> reMarkableで書いた勉強ノートから、自動で復習内容を作成し、Todoistへ復習タスクを登録するシステム

---

# 概要

このシステムは、**reMarkableで今日勉強した内容をAIが解析し、最適な復習スケジュールをTodoistへ自動登録すること**を目的としています。

利用者は普段通りreMarkableに勉強内容を書くだけで、復習計画はAIが自動生成します。

---

# システム構成

```text
reMarkable
      │
      ▼
remarkable-mcp
(MCP URL: https://mcp.recrubo.net)
      │
      ▼
今日更新されたノート・ページ取得
      │
      ▼
Google Vision OCR
      │
      ▼
OCR結果
      │
      ▼
Gemini API
      │
      ▼
復習スケジュール(JSON)
      │
      ▼
Todoist API
      │
      ▼
Todoistへ自動登録
```

---

# 使用するサービス

## MCP

URL

```
https://mcp.recrubo.net
```

利用ツール

* remarkable_recent
* remarkable_read
* remarkable_image

---

## OCR

Google Cloud Vision API

役割

* 手書き文字のOCR
* 印字文字のOCR

※OCRはGoogle Visionのみを利用します。

---

## AI

Gemini API（無料枠）

役割

* OCR結果を理解する
* 今日学習した内容を要約する
* 復習内容を考える
* Todoist登録用JSONを生成する

---

## タスク管理

Todoist REST API

役割

* 復習タスク作成
* 期限設定
* 優先度設定

---

# 処理フロー

## ① 今日更新されたノート取得

remarkable_recent を利用して

**今日更新されたノートのみ取得する。**

---

## ② ノートごとの更新ページ取得

更新されたノートについて

* 更新ページ
* 画像

を取得する。

---

## ③ OCR

取得した画像をGoogle Visionへ送信し、

文字列へ変換する。

OCR結果例

```
数学Ⅲ

プラチカ
45〜50

面積分

途中で立式が分からなかった
```

---

## ④ OCR結果をノートごとにまとめる

例

```
数学Ⅲ

Page 52
・・・

Page 53
・・・

----------------------

物理

Page 18
・・・

----------------------

英語

Page 12
・・・
```

---

## ⑤ Gemini APIへ送信

Geminiへは**1回だけ**リクエストする。

ただし、

**ノートごとに独立して解析すること**を必須とする。

教科同士を混ぜない。

---

# Geminiへ与える指示

各ノートについて以下を判断する。

* 今日学習した内容
* 理解した内容
* 理解が浅そうな内容
* 復習するべき内容
* 優先順位

---

# 復習日のルール

AIは理解度を考慮し、

以下を目安に設定する。

| 理解度  | 復習日  |
| ---- | ---- |
| 低い   | 翌日   |
| 普通   | 7日後  |
| 十分理解 | 30日後 |

必要に応じてAIが柔軟に判断してよい。

---

# Geminiの出力

Geminiは**JSONのみ返すこと。**

説明文は禁止。

Markdown禁止。

例

```json
{
  "notebooks": [
    {
      "name": "数学Ⅲ",
      "summary": "プラチカ45〜50と面積分を学習。",
      "tasks": [
        {
          "title": "プラチカ45〜50を解き直す",
          "due_days": 1,
          "priority": 4
        },
        {
          "title": "面積分の立式を復習",
          "due_days": 3,
          "priority": 3
        }
      ]
    },
    {
      "name": "物理",
      "summary": "交流回路を学習。",
      "tasks": [
        {
          "title": "交流回路の公式確認",
          "due_days": 1,
          "priority": 4
        }
      ]
    }
  ]
}
```

---

# Todoist登録

Geminiが返したJSONを利用してTodoistへ登録する。

例

```
プロジェクト

数学Ⅲ

タスク

プラチカ45〜50を解き直す

期限

明日
```

優先度

```
4 → P1
3 → P2
2 → P3
1 → P4
```

---

# 設計方針

各サービスの役割を明確に分離する。

### remarkable-mcp

担当

* ノート取得
* ページ取得
* 画像取得

---

### Google Vision

担当

* OCRのみ

---

### Gemini

担当

* 学習内容理解
* 復習内容生成
* JSON生成

---

### Todoist

担当

* タスク管理のみ

---

# Discord bot 連携（本機能の位置づけ）

本機能は独立したシステムではなく、既存の **Review-bot（Discord × Todoist 復習管理 bot）** に追加する**新しい同期ソース**として実装する。

Google Classroom 同期（`/classroom`）とまったく同じ統合パターンに従う。

```text
                    ┌─────────────────────────┐
                    │      Review-bot         │
                    │      (Discord bot)      │
                    └───────────┬─────────────┘
        ┌───────────────┬───────┴────────┬────────────────┐
        ▼               ▼                ▼                ▼
   !review 等      /classroom        /remarkable      定期スケジューラ
  （手動登録）    （Classroom同期）  （本機能:新規）   （node-cron）
                                        │
                                        ▼
                            reMarkable → OCR → Gemini → Todoist
```

つまり利用者から見ると、Classroom 課題の自動同期と並んで **「reMarkable ノートの自動復習化」** が bot の一機能として増える形になる。

---

## 追加するスラッシュコマンド

Classroom の `/classroom` に倣い、`/remarkable` コマンドを追加する。

| サブコマンド | 説明 | 権限 |
| ----------- | ---- | ---- |
| `/remarkable sync` | 今日更新されたノートを**今すぐ**解析し、Todoist へ復習タスクを登録する | 管理者のみ |
| `/remarkable list` | 直近で登録された復習タスク（ノート別サマリー）を表示する | 全員 |

`sync` 実行後は Classroom 同期と同じ形式の結果 Embed を返す。

```text
✅ reMarkable 復習同期完了
➕ 追加 : 5 件のタスク
📓 ノート : 3 冊（数学Ⅲ / 物理 / 英語）
⏭️ スキップ : 2 件（解析済みページ）
⏱️ 処理時間 : 8.42 秒
```

---

## 自動同期（スケジューラー連携）

`src/scheduler.js` に、Classroom 同期（`startClassroomSync`）と同じ構造で **`startRemarkableSync`** を追加する。

* `config.remarkable.enabled === true` のときのみ起動
* `config.remarkable.syncTime`（cron 形式、デフォルト毎日 22:00）に実行
* 実行結果を通知チャンネル（`config.notification.channelId`）へ Embed で報告

```javascript
// scheduler.js（追加イメージ）
startRemarkableSync() {
  if (!config.remarkable.enabled) return;

  const job = cron.schedule(config.remarkable.syncTime, async () => {
    await this.syncRemarkableReviews();
  }, { scheduled: true, timezone: config.remarkable.timezone || 'Asia/Tokyo' });

  this.jobs.push(job);
  console.log(`🖊️ reMarkable同期を設定しました: ${config.remarkable.syncTime}`);
}

async syncRemarkableReviews() {
  try {
    const result = await remarkableService.syncTodayReviews();
    console.log(`✅ reMarkable同期完了 (追加: ${result.created}, ノート: ${result.notebooks}, スキップ: ${result.skipped})`);
  } catch (error) {
    console.error('reMarkable同期エラー:', error);
  }
}
```

`start()` の中で `this.startClassroomSync();` の直後に `this.startRemarkableSync();` を呼び出す。

---

## 設定（config.js）

`src/config.js` に `remarkable` セクションを追加する（`classroom` と同じ構成）。

```javascript
remarkable: {
  enabled: process.env.REMARKABLE_ENABLED === 'true',
  syncTime: process.env.REMARKABLE_SYNC_TIME || '0 22 * * *', // 毎日22:00
  timezone: process.env.REMARKABLE_TIMEZONE || 'Asia/Tokyo',
  projectPrefix: process.env.REMARKABLE_PROJECT_PREFIX || '', // Todoistプロジェクト名の接頭辞
  mcp: {
    // MCP側で reMarkable認証・データ取得・Google Vision OCR まで実施し、OCR済みテキストを返す
    url: process.env.REMARKABLE_MCP_URL || 'https://mcp.recrubo.net',
    token: process.env.REMARKABLE_MCP_TOKEN,
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
  },
},
```

> **役割分担（重要）**
> OCR（Google Vision）は **MCP サーバー側（mcp.recrubo.net）で実施**され、bot は MCP から
> **OCR 済みテキスト**を受け取るだけ。したがって `GOOGLE_VISION_API_KEY` は bot 側の `.env` には不要
> （MCP サーバー側に設定される）。bot 側が担当するのは **Gemini による復習内容生成**と **Todoist 登録**のみ。

---

## 環境変数（.env）

`.env.example` に以下を追加する。

```env
# reMarkable 復習同期
REMARKABLE_ENABLED=false
REMARKABLE_SYNC_TIME=0 22 * * *
REMARKABLE_TIMEZONE=Asia/Tokyo
REMARKABLE_PROJECT_PREFIX=

# remarkable-mcp（reMarkable認証・取得・OCRはMCP側で実施済み。botはOCR済みテキストを受け取るだけ）
REMARKABLE_MCP_URL=https://mcp.recrubo.net
REMARKABLE_MCP_TOKEN=

# Gemini API（無料枠）
GEMINI_API_KEY=
GEMINI_MODEL=gemini-1.5-flash
```

デプロイ時は既存の GitHub Secrets と同様に、上記のうち機密値（`REMARKABLE_MCP_TOKEN` / `GEMINI_API_KEY`）を Secrets へ登録する。
`GOOGLE_VISION_API_KEY` は **MCP サーバー側**で管理されるため、bot 側の Secrets には登録不要。

---

## 追加するファイル構成

既存の「サービスとコマンドの分離」方針に合わせ、以下を追加する。

```text
src/
├── commands/
│   └── remarkable.js          # /remarkable sync・list（classroom.js と同型）
└── services/
    ├── remarkableService.js   # 同期のオーケストレーション（本機能の中核）
    ├── remarkableMcp.js        # remarkable-mcp クライアント（recent/read/image）
    ├── geminiService.js        # Gemini API クライアント（JSON生成）
    └── remarkableCacheStore.js # 解析済みページの記録（再解析防止・重複登録防止）
```

> OCR は MCP サーバー側で完了しているため、bot 側に OCR クライアント（Vision）は持たない。
> `remarkableMcp` は OCR 済みテキストを `remarkable_recent` / `remarkable_read` から受け取る。

`src/index.js` へは Classroom と同じ 3 箇所を追加する。

```javascript
const remarkableCommand = require('./commands/remarkable');
client.commands.set('remarkable', remarkableCommand);
// commands 配列に remarkableCommand.data.toJSON() を追加
```

---

## 同期処理シーケンス（remarkableService.syncTodayReviews）

スケジューラーからも `/remarkable sync` からも呼ばれる共通の中核処理。

1. `remarkable_recent` で**今日更新されたノート**を取得する（MCP側で認証・OCRまで完了済み）
2. 各更新ページの **OCR 済みテキスト**を取得する（`remarkable_recent` の応答に含まれていればそれを使い、なければ `remarkable_read` で取得）
3. `remarkableCacheStore` で**既に解析済みのページを除外**する（`skipped` としてカウント）
4. 取得したテキストを**ノート別にまとめる**（教科を混在させない）
5. `geminiService` へ **1 回だけ**リクエストし、ノートごとに独立した復習 JSON を得る
6. JSON を検証（`notebooks[].tasks[]` のスキーマ）し、`due_days` / `priority` を Todoist 形式へ変換する
7. `todoistService.createRemarkableTask()` でノート名をプロジェクト、`due_days` を期限、`priority` を P1〜P4 に対応させて登録する
8. 解析済みページを `remarkableCacheStore` に記録し、通知チャンネルへ結果 Embed を送信する

```text
戻り値: { created, updated, skipped, notebooks, notebookNames }
```

> 既存 `todoistService` の `createReviewSeries`（忘却曲線で複数回登録）とは別で、
> 本機能は **Gemini が理解度から決めた `due_days` の 1 タスク**を登録する点が異なる。
> 忘却曲線ベースの多段登録に寄せたい場合は、Gemini の出力を起点に `createReviewSeries` を呼ぶ拡張も可能。

---

## セットアップ（本機能で追加が必要なもの）

既存の Discord / Todoist セットアップに加えて以下を行う。

### 1. remarkable-mcp

* MCP URL: `https://mcp.recrubo.net`
* 利用ツール: `remarkable_recent` / `remarkable_read` / `remarkable_image`
* `REMARKABLE_MCP_TOKEN` は、MCP サーバーがトークン認証を要求する場合のみ設定します
* **reMarkable 認証・データ取得・Google Vision OCR は MCP サーバー側で完了**する。
  bot は MCP へ接続して **OCR 済みテキスト**を受け取るだけなので、
  `GOOGLE_VISION_API_KEY` の設定は bot 側では不要（MCP サーバー側で管理）。

### 2. Gemini API（無料枠）

1. [Google AI Studio](https://aistudio.google.com/) で API キーを取得
2. `GEMINI_API_KEY` に設定（モデルは `GEMINI_MODEL` で変更可）

### 3. 有効化

```env
REMARKABLE_ENABLED=true
```

を設定して bot を再起動すると、`/remarkable` コマンドと毎日 22:00 の自動同期が有効になる。

---

# 将来的に追加したい機能

* OCR結果のキャッシュ
* 同じページの再解析防止
* 復習履歴管理
* 学習履歴分析
* 理解度推定
* 週間レビュー生成
* 月間学習レポート
* Todoist完了タスクとの連携
* 間隔反復アルゴリズムの改善
* 学習ダッシュボード

---

# 最終目標

ユーザーは**普段通りreMarkableで勉強するだけ**で、

* 今日勉強した内容をAIが理解
* 自動で復習計画を作成
* Todoistへ復習タスクを登録
* Discord bot（Review-bot）の一機能として、毎日自動同期＋ `/remarkable sync` による手動同期を提供

までを完全自動化する。

ユーザーは「何をいつ復習するか」を考える必要がなくなり、学習そのものに集中できるシステムを目指す。
