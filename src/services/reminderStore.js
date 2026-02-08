const fs = require('fs');
const path = require('path');

const REMINDER_FILE = path.join(__dirname, '../data/reminders.json');

// dataディレクトリが存在しない場合は作成
const dataDir = path.dirname(REMINDER_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

class ReminderStore {
  /**
   * すべてのリマインダーを取得
   * @returns {Array}
   */
  static getAll() {
    try {
      if (!fs.existsSync(REMINDER_FILE)) {
        return [];
      }
      const data = fs.readFileSync(REMINDER_FILE, 'utf-8');
      return JSON.parse(data) || [];
    } catch (error) {
      console.error('リマインダー読み込みエラー:', error);
      return [];
    }
  }

  /**
   * 新しいリマインダーを追加
   * @param {Object} reminder - リマインダー情報
   * @returns {Object} 追加されたリマインダー
   */
  static add(reminder) {
    const reminders = this.getAll();
    const id = reminders.length > 0 ? Math.max(...reminders.map(r => r.id)) + 1 : 1;
    
    const newReminder = {
      id,
      day: reminder.day,           // 曜日（月、火、水、木、金、土、日）
      time: reminder.time,         // HH:MM形式
      content: reminder.content,   // リマインダーのテキスト
      once: reminder.once || false,// 一度だけ実行するか
      createdAt: new Date().toISOString(),
      lastExecuted: null,          // 最後に実行した日時
    };

    reminders.push(newReminder);
    this._save(reminders);

    return newReminder;
  }

  /**
   * リマインダーを削除
   * @param {number} id - リマインダーID
   * @returns {boolean}
   */
  static remove(id) {
    const reminders = this.getAll();
    const filtered = reminders.filter(r => r.id !== id);
    
    if (filtered.length === reminders.length) {
      return false; // 削除対象が見つからない
    }

    this._save(filtered);
    return true;
  }

  /**
   * 特定の曜日のリマインダーを取得
   * @param {string} day - 曜日（月、火、水、木、金、土、日）
   * @returns {Array}
   */
  static getByDay(day) {
    return this.getAll().filter(r => r.day === day);
  }

  /**
   * リマインダーを更新
   * @param {number} id - リマインダーID
   * @param {Object} updates - 更新内容
   * @returns {boolean}
   */
  static update(id, updates) {
    const reminders = this.getAll();
    const reminder = reminders.find(r => r.id === id);
    
    if (!reminder) {
      return false;
    }

    Object.assign(reminder, updates);
    this._save(reminders);
    return true;
  }

  /**
   * リマインダーをファイルに保存
   * @private
   * @param {Array} reminders
   */
  static _save(reminders) {
    try {
      fs.writeFileSync(REMINDER_FILE, JSON.stringify(reminders, null, 2), 'utf-8');
    } catch (error) {
      console.error('リマインダー保存エラー:', error);
      throw error;
    }
  }
}

module.exports = ReminderStore;
