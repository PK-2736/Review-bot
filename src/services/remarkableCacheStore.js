const fs = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, '../data/remarkableCache.json');

// dataディレクトリが存在しない場合は作成
const dataDir = path.dirname(STORE_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

/**
 * 解析済みページの記録ストア
 *
 * 目的:
 *   - 同じページの再解析防止（OCR/Gemini/Todoist登録の重複を防ぐ）
 *   - key は `${notebookId}:${pageId}` を想定
 */
class RemarkableCacheStore {
  /**
   * すべての記録を取得
   * @returns {Array}
   */
  static getAll() {
    try {
      if (!fs.existsSync(STORE_FILE)) {
        return [];
      }
      const data = fs.readFileSync(STORE_FILE, 'utf-8');
      return JSON.parse(data) || [];
    } catch (error) {
      console.error('reMarkableキャッシュ読み込みエラー:', error);
      return [];
    }
  }

  /**
   * 指定キーが解析済みか
   * @param {string} key
   * @returns {boolean}
   */
  static has(key) {
    return this.getAll().some(item => item.key === key);
  }

  /**
   * 解析済みとして記録（追加または更新）
   * @param {Object} entry - { key, notebook, page, ... }
   * @returns {Object}
   */
  static upsert(entry) {
    const items = this.getAll();
    const index = items.findIndex(item => item.key === entry.key);

    if (index >= 0) {
      items[index] = { ...items[index], ...entry };
    } else {
      items.push(entry);
    }

    this._save(items);
    return entry;
  }

  /**
   * キーで削除
   * @param {string} key
   * @returns {boolean}
   */
  static removeByKey(key) {
    const items = this.getAll();
    const filtered = items.filter(item => item.key !== key);

    if (filtered.length === items.length) {
      return false;
    }

    this._save(filtered);
    return true;
  }

  /**
   * 保存
   * @private
   * @param {Array} items
   */
  static _save(items) {
    try {
      fs.writeFileSync(STORE_FILE, JSON.stringify(items, null, 2), 'utf-8');
    } catch (error) {
      console.error('reMarkableキャッシュ保存エラー:', error);
      throw error;
    }
  }
}

module.exports = RemarkableCacheStore;
