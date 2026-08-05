# Review Bot

## 概要

Review Bot は、reMarkable タブレットで作成した手書きノートを自動でレビューする Discord Bot です。

reMarkable と同期し、新しく追加されたページを Gemini Vision で解析して、要約・重要ポイント・TODO を生成し、必要に応じて Todoist へ登録します。

Review Bot は**リアルタイム同期サービスではありません。**

同期が実行されるタイミングは次の2つだけです。

- ユーザーがレビューコマンドを実行したとき
- 毎日 23:00 の自動実行

---

# システム構成

```
レビューコマンド または 23:00 の定期実行
            │
            ▼
cache.json を読み込む
            │
            ▼
remarkable_browse("/")
            │
            ▼
modified を比較
            │
      ┌─────┴─────┐
      │           │
変更なし      更新あり
      │           │
 スキップ     ページ数を比較
                  │
          ┌───────┴────────┐
          │                │
    新規ページなし    新規ページあり
          │                │
 modified更新      remarkable_page()
                           │
                           ▼
                     Gemini Vision
                     ・OCR
                     ・要約
                     ・重要ポイント抽出
                     ・TODO抽出
                     ・タイトル生成
                           │
                           ▼
                 Todoistへ登録（任意）
                           │
                           ▼
                  cache.json を更新
```

---

# キャッシュ

キャッシュは1つの JSON ファイルで管理します。

例：

```json
{
  "/Physics": {
    "baseline": 58,
    "modified": "2026-07-30T12:58:00.472000"
  },
  "/Math": {
    "baseline": 24,
    "modified": "2026-07-29T18:00:00.000000"
  }
}
```

## 各項目の意味

### baseline

最後にレビュー済みのページ番号。

### modified

`remarkable_browse()` が返す最終更新日時。

---

# 同期ロジック

各ノートに対して以下を実行します。

### modified が変わっていない場合

- そのノートはスキップします。

### modified が更新されている場合

現在のページ数と baseline を比較します。

#### 新しいページがない場合

- modified のみ更新します。

#### 新しいページがある場合

以下の範囲を順番に処理します。

```
baseline + 1 ～ total_pages
```

各ページについて

```
remarkable_page()
```

を実行し、Gemini Vision で解析します。

処理完了後、

```
baseline = total_pages
modified = 最新の modified
```

へ更新します。

---

# 使用する MCP ツール

Review Bot が使用する MCP ツールは以下のみです。

## remarkable_browse

用途

- ノート一覧取得
- ノートのパス取得
- modified の取得
- 総ページ数の取得

---

## remarkable_page

用途

- 指定ページの画像取得

現在のレスポンス形式

```json
{
  "mime_type": "image/png",
  "page": 58,
  "total_pages": 59,
  "modified": "...",
  "resource_uri": "...",
  "merged": false,
  "render_source": "strokes",
  "ocr_text": null,
  "ocr_backend": null,
  "ocr_message": "...",
  "_hint": "..."
}
```

この JSON をそのまま利用します。

**compatibility モードは使用しません。**

---

# OCR

Google Vision は使用しません。

OCR は Gemini Vision が直接実行します。

そのため

```
remarkable_page(include_ocr=false)
```

で呼び出し、OCR の二重実行を防ぎます。

---

# Gemini Vision

Gemini には remarkable_page が返した画像を渡します。

返却形式は **JSON のみ** とします。

必要な項目

```json
{
  "title": "",
  "summary": "",
  "important_points": [],
  "memorize": [],
  "todo": [],
  "tags": []
}
```

TODO は 1 ページにつき 1 件だけ返すようにしてください。短く、1 枚のノートに収まる長さにします。

Gemini には以下を依頼します。

- 手書きノートを読み取る
- OCR を実施する
- 内容を要約する
- 重要事項を抽出する
- 覚えるべき内容を抽出する
- 復習用 TODO を生成する
- 分かりやすいタイトルを生成する

---

# Todoist

Gemini が TODO を返した場合は Todoist に登録します。

例

- 問題演習を解く
- 公式を暗記する
- 今日の授業内容を復習する

---

# Discord コマンド

```
/remarkable_sync
```

同期を即時実行します。

実行結果の例

```
レビュー完了

更新されたノート：2冊

処理したページ：5ページ

作成したTODO：8件
```

---

# 自動レビュー

毎日

```
23:00
```

に自動レビューを実行します。

**コマンド実行と23時実行で処理を重複実装しないこと。**

どちらも同じ同期関数を呼び出してください。

---

# エラーハンドリング

### remarkable_page が失敗した場合

- エラーを記録し、残りのページを処理します。

### Gemini が失敗した場合

- 1回だけ再試行します。

### Todoist が失敗した場合

- Warning を出力し、同期処理は継続します。

**1冊のノートの失敗で全体の同期を中断しないこと。**

---

# ログ

以下を記録してください。

- ノート名
- ページ番号
- 処理時間
- Gemini の応答時間
- 作成した TODO 数

---

# 将来的な拡張予定

今後追加する可能性のある機能

- Notion 連携
- 1日の学習ダイジェスト
- Discord Embed 表示
- 問題生成
- フラッシュカード生成
- 週間学習レポート

現在の実装では、これらを追加しやすい拡張性のある設計にしてください。