const fs = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, '../data/classroomTasks.json');

// dataディレクトリが存在しない場合は作成
const dataDir = path.dirname(STORE_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

class ClassroomTaskStore {
  /**
   * すべての登録済みタスクを取得
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
      console.error('Classroomタスク読み込みエラー:', error);
      return [];
    }
  }

  /**
   * キーで取得
   * @param {string} key
   * @returns {Object | undefined}
   */
  static getByKey(key) {
    return this.getAll().find(item => item.key === key);
  }

  /**
   * 追加または更新
   * @param {Object} entry
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
      console.error('Classroomタスク保存エラー:', error);
      throw error;
    }
  }
}

module.exports = ClassroomTaskStore;
