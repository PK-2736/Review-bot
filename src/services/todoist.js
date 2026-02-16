const config = require('../config');

const DEFAULT_API_BASE_URL = 'https://api.todoist.com/api/v1';
const DEBUG_TODOIST = process.env.DEBUG_TODOIST === 'true';

function normalizeBaseUrl(value) {
  if (!value) return DEFAULT_API_BASE_URL;
  return value.trim().replace(/\/+$/, '');
}

function mapPayloadForApi(payload) {
  if (!payload) return undefined;
  const mapped = { ...payload };

  if ('projectId' in mapped) {
    mapped.project_id = mapped.projectId;
    delete mapped.projectId;
  }

  if ('sectionId' in mapped) {
    mapped.section_id = mapped.sectionId;
    delete mapped.sectionId;
  }

  if ('parentId' in mapped) {
    mapped.parent_id = mapped.parentId;
    delete mapped.parentId;
  }

  if ('assigneeId' in mapped) {
    mapped.assignee_id = mapped.assigneeId;
    delete mapped.assigneeId;
  }

  if ('assignerId' in mapped) {
    mapped.assigner_id = mapped.assignerId;
    delete mapped.assignerId;
  }

  if ('dueDate' in mapped) {
    mapped.due_date = mapped.dueDate;
    delete mapped.dueDate;
  }

  if ('dueDatetime' in mapped) {
    mapped.due_datetime = mapped.dueDatetime;
    delete mapped.dueDatetime;
  }

  if ('dueTimezone' in mapped) {
    mapped.due_timezone = mapped.dueTimezone;
    delete mapped.dueTimezone;
  }

  return mapped;
}

function mapParamsForApi(params) {
  if (!params) return undefined;
  return mapPayloadForApi(params);
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
}

function createTodoistClient(token, baseUrl) {
  const base = normalizeBaseUrl(baseUrl);

  async function request(method, path, payload, params) {
    const url = new URL(path.replace(/^\/+/, ''), `${base}/`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        if (Array.isArray(value)) {
          url.searchParams.set(key, value.join(','));
          return;
        }
        url.searchParams.set(key, String(value));
      });
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const options = { method, headers };
    if (payload) {
      options.body = JSON.stringify(payload);
    }

    const response = await fetch(url.toString(), options);
    const data = await parseResponse(response);

    if (!response.ok) {
      const error = new Error('Todoist API request failed');
      error.httpStatusCode = response.status;
      error.responseData = data;
      throw error;
    }

    return data;
  }

  return {
    getProjects: () => request('GET', 'projects'),
    addProject: (payload) => request('POST', 'projects', mapPayloadForApi(payload)),
    getTasks: (params) => request('GET', 'tasks', undefined, mapParamsForApi(params)),
    addTask: (payload) => request('POST', 'tasks', mapPayloadForApi(payload)),
    updateTask: (id, payload) => request('POST', `tasks/${id}`, mapPayloadForApi(payload)),
    closeTask: (id) => request('POST', `tasks/${id}/close`),
  };
}

function getTaskDueDate(task) {
  if (!task) return null;
  const due = task.due || {};
  const raw = due.datetime || due.date || task.due_datetime || task.due_date;
  if (!raw) return null;
  return parseDueDate(raw);
}

function parseDueDate(raw) {
  if (typeof raw !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTasksResponse(data) {
  if (Array.isArray(data)) return data;
  if (!data) return [];
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.tasks)) return data.tasks;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

function normalizeProjectsResponse(data) {
  if (Array.isArray(data)) return data;
  if (!data) return [];
  if (Array.isArray(data.projects)) return data.projects;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

function extractTasksPage(data) {
  if (Array.isArray(data)) {
    return { items: data, nextCursor: null };
  }
  if (!data || typeof data !== 'object') {
    return { items: [], nextCursor: null };
  }

  const items = normalizeTasksResponse(data);
  const nextCursor = data.next_cursor || data.nextCursor || null;
  return { items, nextCursor };
}

class TodoistService {
  constructor() {
    this.api = createTodoistClient(config.todoist.apiToken, config.todoist.apiBaseUrl);
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
      const projectsResponse = await this.api.getProjects();
      const projects = normalizeProjectsResponse(projectsResponse);
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
      const tasks = await this.getAllTasks();
      const now = new Date();
      const today = formatLocalDate(now);
      
      // 今日が期限のタスクのみ
      const oneMonthAgo = new Date(now);
      oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
      
      // 今日が期限のタスク かつ 期限日が1ヶ月以内 かつ 未完了のタスクのみ
      const todayTasks = tasks.filter(task => {
        if (!task.due) return false;
        if (task.isCompleted) return false; // 完了済みタスクを除外
        const dueDate = getTaskDueDate(task);
        if (!dueDate) return false;
        if (formatLocalDate(dueDate) !== today) return false;
        return dueDate >= oneMonthAgo;
      });

      if (DEBUG_TODOIST) {
        const sample = tasks.find(task => task && task.due);
        console.log('Todoist debug: total tasks', tasks.length);
        console.log('Todoist debug: today', today, 'sample due', sample ? sample.due : null);
        console.log('Todoist debug: today tasks', todayTasks.length);
      }

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
      const tasks = await this.getAllTasks();
      const now = new Date();
      const today = formatLocalDate(now);
      
      const oneMonthAgo = new Date(now);
      oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
      
      // 昨日以前が期限のタスク かつ 期限日が1ヶ月以内 かつ 未完了のタスクのみ
      const overdueTasks = tasks.filter(task => {
        if (!task.due) return false;
        if (task.isCompleted) return false; // 完了済みタスクを除外
        const dueDate = getTaskDueDate(task);
        if (!dueDate) return false;
        if (formatLocalDate(dueDate) >= today) return false;
        return dueDate >= oneMonthAgo;
      });

      if (DEBUG_TODOIST) {
        console.log('Todoist debug: overdue tasks', overdueTasks.length);
      }

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

  /**
   * Todoistのタスク一覧を配列で取得
   * @returns {Promise<Array>} タスク配列
   */
  async getAllTasks() {
    const pageLimit = 50;
    let cursor;
    let allTasks = [];

    while (true) {
      const response = await this.api.getTasks({ limit: pageLimit, cursor });
      const { items, nextCursor } = extractTasksPage(response);

      if (DEBUG_TODOIST) {
        console.log('Todoist debug: page size', items.length, 'nextCursor', nextCursor ? 'yes' : 'no');
      }

      if (items.length > 0) {
        allTasks = allTasks.concat(items);
      }

      if (!nextCursor) {
        break;
      }

      cursor = nextCursor;
      await sleep(200);
    }

    return allTasks;
  }
}

module.exports = new TodoistService();
