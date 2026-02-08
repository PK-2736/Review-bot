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
   * @param {string} mode - 復習モード ('normal' または 'mastery')
   */
  async createReviewSeries(baseContent, mode = 'normal') {
    const intervals = config.review.intervals[mode] || config.review.intervals.normal;
    const tasks = [];
    const today = new Date();

    for (let i = 0; i < intervals.length; i++) {
      const dueDate = new Date(today);
      dueDate.setDate(today.getDate() + intervals[i]);
      
      const content = `${baseContent} (${i + 1}回目の復習)`;
      const priority = i === 0 ? 4 : i === 1 ? 3 : 2;

      try {
        const task = await this.createReviewTask(content, dueDate, priority);
        tasks.push({ ...task, interval: intervals[i] });
      } catch (error) {
        console.error(`タスク作成失敗 (${i + 1}回目):`, error);
      }
    }

    return tasks;
  }

  /**
   * 今日のタスクを取得
   * @returns {Promise<Array>} 今日のタスクリスト
   */
  async getTodayTasks() {
    try {
      const tasks = await this.api.getTasks();
      const today = new Date().toISOString().split('T')[0];
      
      // 今日が期限のタスクのみ
      const todayTasks = tasks.filter(task => {
        if (!task.due) return false;
        return task.due.date === today;
      });

      // 優先度でソート（高優先度が先）
      return todayTasks.sort((a, b) => b.priority - a.priority);
    } catch (error) {
      console.error('今日のタスク取得エラー:', error);
      throw error;
    }
  }

  /**
   * 昨日以前の期限切れタスクを取得
   * @returns {Promise<Array>} 期限切れタスクリスト
   */
  async getOverdueTasks() {
    try {
      const tasks = await this.api.getTasks();
      const today = new Date().toISOString().split('T')[0];
      
      // 昨日以前が期限のタスク
      const overdueTasks = tasks.filter(task => {
        if (!task.due) return false;
        return task.due.date < today;
      });

      // 優先度でソート（高優先度が先）
      return overdueTasks.sort((a, b) => b.priority - a.priority);
    } catch (error) {
      console.error('期限切れタスク取得エラー:', error);
      throw error;
    }
  }

  /**
   * タスクを完了としてマーク
   * @param {string} taskId - タスクID
   */
  async completeTask(taskId) {
    try {
      await this.api.closeTask(taskId);
      return true;
    } catch (error) {
      console.error('タスク完了エラー:', error);
      throw error;
    }
  }
}

module.exports = new TodoistService();
