const { TodoistApi } = require('@doist/todoist-api-typescript');
const config = require('../config');

class TodoistService {
  constructor() {
    this.api = new TodoistApi(config.todoist.apiToken);
    this.projectId = null;
  }

  /**
   * 復習用プロジェクトを取得または作成
   */
  async getOrCreateProject() {
    if (this.projectId) return this.projectId;

    try {
      const projects = await this.api.getProjects();
      const reviewProject = projects.find(
        (p) => p.name === config.review.defaultProjectName
      );

      if (reviewProject) {
        this.projectId = reviewProject.id;
      } else {
        const newProject = await this.api.addProject({
          name: config.review.defaultProjectName,
        });
        this.projectId = newProject.id;
      }

      return this.projectId;
    } catch (error) {
      console.error('Todoist プロジェクト取得エラー:', error);
      throw error;
    }
  }

  /**
   * 復習タスクを作成
   * @param {string} content - タスクの内容
   * @param {Date} dueDate - 期限日
   * @param {number} priority - 優先度（1-4）
   */
  async createReviewTask(content, dueDate, priority = 1) {
    try {
      const projectId = await this.getOrCreateProject();
      
      const task = await this.api.addTask({
        content,
        projectId,
        dueDate: dueDate.toISOString().split('T')[0],
        priority,
        labels: ['復習'],
      });

      return task;
    } catch (error) {
      console.error('Todoist タスク作成エラー:', error);
      throw error;
    }
  }

  /**
   * 複数の復習タスクを一度に作成（間隔復習用）
   * @param {string} baseContent - タスクのベース内容
   * @param {number[]} intervals - 復習間隔（日数）の配列
   */
  async createReviewSeries(baseContent, intervals = config.review.intervals) {
    const tasks = [];
    const today = new Date();

    for (let i = 0; i < intervals.length; i++) {
      const dueDate = new Date(today);
      dueDate.setDate(today.getDate() + intervals[i]);
      
      const content = `${baseContent} (${i + 1}回目の復習)`;
      const priority = i === 0 ? 4 : i === 1 ? 3 : 2;

      try {
        const task = await this.createReviewTask(content, dueDate, priority);
        tasks.push(task);
      } catch (error) {
        console.error(`タスク作成失敗 (${i + 1}回目):`, error);
      }
    }

    return tasks;
  }
}

module.exports = new TodoistService();
