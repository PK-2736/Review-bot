const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('./logger');

class AllowStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.list = null;
  }

  load() {
    if (this.list) return this.list;
    if (!fs.existsSync(this.filePath)) {
      this.list = [];
      return this.list;
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = raw && raw.trim() ? JSON.parse(raw) : [];
      this.list = Array.isArray(parsed) ? parsed.map(String) : [];
      logger.info('remarkable enable list loaded', { file: this.filePath, count: this.list.length });
    } catch (err) {
      logger.error('failed to load remarkable enable list, using empty', { file: this.filePath, error: String(err) });
      this.list = [];
    }
    return this.list;
  }

  save() {
    const list = this.load();
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, `${JSON.stringify(list, null, 2)}\n`, 'utf-8');
      logger.info('remarkable enable list saved', { file: this.filePath, count: list.length });
      return true;
    } catch (err) {
      logger.error('failed to save remarkable enable list', { file: this.filePath, error: String(err) });
      return false;
    }
  }

  listAll() {
    return this.load();
  }

  has(key) {
    const list = this.load();
    const s = String(key || '');
    // exact match against stored keys
    return list.includes(s);
  }

  add(key) {
    const list = this.load();
    const normalized = String(key);
    if (!list.includes(normalized)) {
      list.push(normalized);
      this.save();
    }
    return list;
  }

  remove(key) {
    const list = this.load();
    const normalized = String(key);
    const filtered = list.filter((p) => p !== normalized);
    this.list = filtered;
    this.save();
    return this.list;
  }
}

module.exports = new AllowStore(config.remarkable.enableFile);
