const { TodoistApi } = require('@doist/todoist-api-typescript');
const config = require('../config');

function getTaskDueDate(task) {
  if (!task || !task.due) return null;
  const raw = task.due.datetime || task.due.date;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

class TodoistService {
  constructor() {
    this.api = new TodoistApi(config.todoist.apiToken);
    this.projectId = null;
    this.projectCache = new Map();
  }

  /**
   * 復習用プロジェクトを取得または作成
   */
  async getOrCreateProject() {
    if (this.projectId) return this.projectId;

    const projectId = await this.getOrCreateProjectByName(config.review.defaultProjectName);
    this.projectId = projectId;
    return projectId;
  }

  /**
   * 指定名のプロジェクトを取得または作成
   * @param {string} projectName
   */
  async getOrCreateProjectByName(projectName) {
    if (this.projectCache.has(projectName)) {
      return this.projectCache.get(projectName);
    }

    try {
      const projects = await this.api.getProjects();
      const reviewProject = projects.find(
        (p) => p.name === projectName
      );

      if (reviewProject) {
        this.projectCache.set(projectName, reviewProject.id);
      } else {
        const newProject = await this.api.addProject({
          name: projectName,
        });
        this.projectCache.set(projectName, newProject.id);
      }

      return this.projectCache.get(projectName);
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
   * Google Classroom タスクを作成
   * @param {Object} payload
   */
  async createClassroomTask(payload) {
    try {
      const projectId = await this.getOrCreateProjectByName(config.classroom.projectName);
      const task = await this.api.addTask({
        content: payload.content,
        description: payload.description,
        projectId,
        dueDate: payload.dueDate,
        dueDatetime: payload.dueDatetime,
        dueTimezone: payload.dueTimezone,
        labels: ['Classroom'],
      });

      return task;
    } catch (error) {
      console.error('Todoist Classroom タスク作成エラー:', error);
      throw error;
    }
  }

  /**
   * タスクを更新
   * @param {string} taskId
   * @param {Object} payload
   */
  async updateTask(taskId, payload) {
    try {
      await this.api.updateTask(taskId, payload);
      return true;
    } catch (error) {
      console.error('Todoist タスク更新エラー:', error);
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
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      
      // 今日が期限のタスクのみ
      const oneMonthAgo = new Date(now);
      oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
      
      // 今日が期限のタスク かつ 期限日が1ヶ月以内 かつ 未完了のタスクのみ
      const todayTasks = tasks.filter(task => {
        if (!task.due) return false;
        if (task.due.date !== today) return false;
        if (task.isCompleted) return false; // 完了済みタスクを除外
        const dueDate = getTaskDueDate(task);
        if (!dueDate) return false;
        return dueDate >= oneMonthAgo;
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
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      
      const oneMonthAgo = new Date(now);
      oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
      
      // 昨日以前が期限のタスク かつ 期限日が1ヶ月以内 かつ 未完了のタスクのみ
      const overdueTasks = tasks.filter(task => {
        if (!task.due) return false;
        if (task.due.date >= today) return false;
        if (task.isCompleted) return false; // 完了済みタスクを除外
        const dueDate = getTaskDueDate(task);
        if (!dueDate) return false;
        return dueDate >= oneMonthAgo;
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
