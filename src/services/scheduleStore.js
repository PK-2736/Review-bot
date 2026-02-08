const fs = require('fs');
const path = require('path');

const SCHEDULE_FILE = path.join(__dirname, '../data/schedules.json');

// dataディレクトリが存在しない場合は作成
const dataDir = path.dirname(SCHEDULE_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

class ScheduleStore {
  /**
   * すべてのスケジュールを取得
   * @returns {Array}
   */
  static getAll() {
    try {
      if (!fs.existsSync(SCHEDULE_FILE)) {
        return [];
      }
      const data = fs.readFileSync(SCHEDULE_FILE, 'utf-8');
      return JSON.parse(data) || [];
    } catch (error) {
      console.error('スケジュール読み込みエラー:', error);
      return [];
    }
  }

  /**
   * 新しいスケジュールを追加
   * @param {Object} schedule - スケジュール情報
   * @returns {Object} 追加されたスケジュール
   */
  static add(schedule) {
    const schedules = this.getAll();
    const id = schedules.length > 0 ? Math.max(...schedules.map(s => s.id)) + 1 : 1;
    
    const newSchedule = {
      id,
      day: schedule.day,
      time: schedule.time,
      subject: schedule.subject,
      content: schedule.content || '',
      instructor: schedule.instructor || '',
      createdAt: new Date().toISOString(),
    };

    schedules.push(newSchedule);
    this._save(schedules);

    return newSchedule;
  }

  /**
   * スケジュールを削除
   * @param {number} id - スケジュールID
   * @returns {boolean}
   */
  static remove(id) {
    const schedules = this.getAll();
    const filtered = schedules.filter(s => s.id !== id);
    
    if (filtered.length === schedules.length) {
      return false; // 削除対象が見つからない
    }

    this._save(filtered);
    return true;
  }

  /**
   * 特定の曜日のスケジュールを取得
   * @param {string} day - 曜日（月、火、水、木、金、土、日）
   * @returns {Array}
   */
  static getByDay(day) {
    return this.getAll().filter(s => s.day === day);
  }

  /**
   * スケジュールをファイルに保存
   * @private
   * @param {Array} schedules
   */
  static _save(schedules) {
    try {
      fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedules, null, 2), 'utf-8');
    } catch (error) {
      console.error('スケジュール保存エラー:', error);
      throw error;
    }
  }
}

module.exports = ScheduleStore;
