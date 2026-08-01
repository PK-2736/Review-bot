const config = require('../config');

const DEFAULT_API_BASE_URL = 'https://api.todoist.com/api/v1';
const DEBUG_TODOIST = process.env.DEBUG_TODOIST === 'true';

/**
 * Todoist API 由来のエラー
 *
 * HTTPステータスやレスポンス本文、独自エラーコードを型付きで保持する。
 */
class TodoistError extends Error {
  /**
   * @param {string} message
   * @param {{ httpStatusCode?: number, responseData?: any, code?: string }} [details]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'TodoistError';
    /** @type {number|undefined} HTTPステータスコード */
    this.httpStatusCode = details.httpStatusCode;
    /** @type {any} レスポンス本文 */
    this.responseData = details.responseData;
    /** @type {string|undefined} 独自エラーコード */
    this.code = details.code;
  }
}

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
    if (mapped.dueDate instanceof Date) {
      mapped.due_date = mapped.dueDate.toISOString().split('T')[0];
    } else {
      mapped.due_date = mapped.dueDate;
    }
    delete mapped.dueDate;
  }

  if ('dueDatetime' in mapped) {
    if (mapped.dueDatetime instanceof Date) {
      mapped.due_datetime = mapped.dueDatetime.toISOString();
    } else {
      mapped.due_datetime = mapped.dueDatetime;
    }
    delete mapped.dueDatetime;
  }

  if ('dueTimezone' in mapped) {
    mapped.due_timezone = mapped.dueTimezone;
    delete mapped.dueTimezone;
  }

  if ('labelIds' in mapped) {
    mapped.label_ids = mapped.labelIds;
    delete mapped.labelIds;
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

    const fullUrl = url.toString();
    let rmLogger;
    try {
      rmLogger = require('./remarkable/logger');
    } catch (e) {
      rmLogger = undefined;
    }

    if (rmLogger) {
      try {
        rmLogger.info('Todoist API request', { method, url: fullUrl, path, payload: payload ? (payload.content ? { ...payload, content: payload.content } : payload) : null });
      } catch (e) {
        console.warn('Todoist request logging failed', e && e.message ? e.message : e);
      }
    }

    const response = await fetch(fullUrl, options);
    const data = await parseResponse(response);

    if (rmLogger) {
      try {
        rmLogger.info('Todoist API response', { method, url: fullUrl, path, status: response.status, responseData: data });
      } catch (e) {
        console.warn('Todoist response logging failed', e && e.message ? e.message : e);
      }
    }

    if (!response.ok) {
      const err = new TodoistError('Todoist API request failed', {
        httpStatusCode: response.status,
        responseData: data,
      });
      if (rmLogger) {
        try {
          rmLogger.error('Todoist API エラー', { method, path, status: response.status, responseData: data });
        } catch (e) {
          console.warn('Todoist error logging failed', e && e.message ? e.message : e);
        }
      }
      throw err;
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
    deleteTask: (id) => request('DELETE', `tasks/${id}`),
    getLabels: () => request('GET', 'labels'),
    addLabel: (payload) => request('POST', 'labels', mapPayloadForApi(payload)),
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

function normalizeLabelsResponse(data) {
  if (Array.isArray(data)) return data;
  if (!data) return [];
  if (Array.isArray(data.labels)) return data.labels;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

class TodoistService {
  constructor() {
    this.api = createTodoistClient(config.todoist.apiToken, config.todoist.apiBaseUrl);
    this.projectId = null;
    this.projectCache = new Map();
    this.labelIdToName = new Map();
    this.labelNameToId = new Map();
  }

  normalizeProjectName(projectName) {
    return String(projectName || '').trim();
  }

  findMatchingProjectId(projects, projectNameStr) {
    const lower = projectNameStr.toLowerCase();
    const exact = projects.find((p) => p && p.name === projectNameStr);
    if (exact) return exact.id;
    const ciExact = projects.find((p) => p && String(p.name).toLowerCase() === lower);
    if (ciExact) return ciExact.id;
    const contains = projects.find((p) => p && String(p.name).toLowerCase().includes(lower));
    if (contains) return contains.id;
    const starts = projects.find((p) => p && String(p.name).toLowerCase().startsWith(lower));
    if (starts) return starts.id;
    return null;
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
      // Search existing projects for exact and fuzzy matches
      const projectNameStr = String(projectName || '').trim();
      const reviewProjectExact = projects.find((p) => p && p.name === projectNameStr);
      if (reviewProjectExact) {
        console.log('Todoist: existing project found (exact), reusing', { projectName: projectNameStr, projectId: reviewProjectExact.id });
        this.projectCache.set(projectName, reviewProjectExact.id);
        return this.projectCache.get(projectName);
      }

      // case-insensitive exact
      const lower = projectNameStr.toLowerCase();
      const reviewProjectCi = projects.find((p) => p && String(p.name).toLowerCase() === lower);
      if (reviewProjectCi) {
        console.log('Todoist: existing project found (case-insensitive exact), reusing', { projectName: projectNameStr, projectId: reviewProjectCi.id });
        this.projectCache.set(projectName, reviewProjectCi.id);
        return this.projectCache.get(projectName);
      }

      // contains (case-insensitive)
      const reviewProjectContains = projects.find((p) => p && String(p.name).toLowerCase().includes(lower));
      if (reviewProjectContains) {
        console.log('Todoist: existing project found (contains), reusing', { projectName: projectNameStr, projectId: reviewProjectContains.id, matchedName: reviewProjectContains.name });
        this.projectCache.set(projectName, reviewProjectContains.id);
        return this.projectCache.get(projectName);
      }

      // startsWith (case-insensitive)
      const reviewProjectStarts = projects.find((p) => p && String(p.name).toLowerCase().startsWith(lower));
      if (reviewProjectStarts) {
        console.log('Todoist: existing project found (startsWith), reusing', { projectName: projectNameStr, projectId: reviewProjectStarts.id, matchedName: reviewProjectStarts.name });
        this.projectCache.set(projectName, reviewProjectStarts.id);
        return this.projectCache.get(projectName);
      }

      // Log reason why not found (list size may be large; log names only)
      try {
        const projectNames = projects.map(p => (p && p.name) ? p.name : String(p));
        console.warn('Todoist: project not found by name', { searchedName: projectNameStr, totalProjects: projectNames.length, projectNamesSample: projectNames.slice(0, 50) });
      } catch (e) {
        console.warn('Todoist: project not found, and failed to enumerate projects for logging', e.message);
      }

      // Respect an optional configured project limit to avoid hitting Todoist account limits
      const configuredLimit = process.env.TODOIST_PROJECT_LIMIT ? Number(process.env.TODOIST_PROJECT_LIMIT) : null;
      const fallbackProjectName = this.normalizeProjectName(config.review.defaultProjectName);
      const fallbackProjectId = this.findMatchingProjectId(projects, fallbackProjectName);
      if (configuredLimit != null && Number.isFinite(configuredLimit) && projects.length >= configuredLimit) {
        if (projectNameStr !== fallbackProjectName && fallbackProjectId) {
          console.warn('Todoist: configured project limit reached; falling back to default review project', { requestedProject: projectNameStr, fallbackProjectName, fallbackProjectId });
          this.projectCache.set(projectName, fallbackProjectId);
          return fallbackProjectId;
        }

        const msg = `Todoist project limit reached: ${projects.length} >= configured limit ${configuredLimit}. Will not attempt to create project.`;
        console.error(msg);
        throw new TodoistError(msg, { code: 'TODOIST_PROJECT_LIMIT_REACHED' });
      }

      // Try creating new project (only if we didn't detect a configured limit or not exceeded)
      try {
        const newProject = await this.api.addProject({ name: projectNameStr });
        console.log('Todoist: created new project', { projectName: projectNameStr, projectId: newProject.id });
        this.projectCache.set(projectName, newProject.id);
        return this.projectCache.get(projectName);
      } catch (createError) {
        // If Todoist reports project limit reached, throw a clear error code
        try {
          const tag = createError && createError.responseData && createError.responseData.error_tag;
          if (tag === 'MAX_PROJECTS_LIMIT_REACHED' || (createError.httpStatusCode === 403 && createError.responseData && typeof createError.responseData.error === 'string' && createError.responseData.error.includes('Maximum number of projects'))) {
            if (projectNameStr !== fallbackProjectName && fallbackProjectId) {
              console.warn('Todoist: project creation aborted due to account limit; falling back to default review project', { projectName: projectNameStr, fallbackProjectName, fallbackProjectId });
              this.projectCache.set(projectName, fallbackProjectId);
              return fallbackProjectId;
            }
            console.error('Todoist: project creation aborted due to account limit', { projectName: projectNameStr, response: createError.responseData });
            throw new TodoistError(`Todoist project limit reached while creating '${projectNameStr}'`, {
              code: 'TODOIST_PROJECT_LIMIT_REACHED',
            });
          }
        } catch (e) {
          // fallthrough
        }

        console.error('Todoist: failed to create project', { projectName: projectNameStr, error: createError });
        createError.message = `Failed to create Todoist project '${projectNameStr}': ${createError.message}`;
        throw createError;
      }
    } catch (error) {
      console.error('Todoist プロジェクト取得エラー:', error);
      throw error;
    }
  }
  async loadLabels() {
    try {
      const labelsResponse = await this.api.getLabels();
      const labels = normalizeLabelsResponse(labelsResponse);
      this.labelIdToName.clear();
      this.labelNameToId.clear();

      for (const label of labels) {
        if (!label || !label.id || !label.name) continue;
        this.labelIdToName.set(label.id, label.name);
        this.labelNameToId.set(label.name, label.id);
      }

      return labels;
    } catch (error) {
      console.error('Todoist ラベル読み込みエラー:', error);
      throw error;
    }
  }

  async getLabelId(labelName) {
    if (!labelName) return null;
    const normalizedName = String(labelName).trim();
    if (!normalizedName) return null;

    if (this.labelNameToId.has(normalizedName)) {
      return this.labelNameToId.get(normalizedName);
    }

    if (this.labelNameToId.size === 0) {
      await this.loadLabels();
      if (this.labelNameToId.has(normalizedName)) {
        return this.labelNameToId.get(normalizedName);
      }
    }

    const lower = normalizedName.toLowerCase();
    const existing = Array.from(this.labelNameToId.entries()).find(([name]) => name.toLowerCase() === lower);
    if (existing) {
      return existing[1];
    }

    const createdLabel = await this.api.addLabel({ name: normalizedName });
    if (createdLabel && createdLabel.id) {
      this.labelIdToName.set(createdLabel.id, createdLabel.name);
      this.labelNameToId.set(createdLabel.name, createdLabel.id);
      return createdLabel.id;
    }

    throw new TodoistError(`Todoist label creation failed for '${normalizedName}'`, {
      responseData: createdLabel,
    });
  }

  async resolveLabelIds(payload) {
    if (!payload || !Array.isArray(payload.labels) || payload.labels.length === 0) {
      return payload;
    }

    const labelIds = [];
    for (const labelName of payload.labels) {
      const labelId = await this.getLabelId(labelName);
      if (labelId) {
        labelIds.push(labelId);
      }
    }

    if (labelIds.length > 0) {
      payload.labelIds = [...new Set(labelIds)];
    }
    delete payload.labels;
    return payload;
  }

  async hydrateTaskLabels(tasks) {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return tasks;
    }

    if (this.labelIdToName.size === 0) {
      await this.loadLabels();
    }

    for (const task of tasks) {
      if (Array.isArray(task.label_ids)) {
        task.labels = task.label_ids
          .map((labelId) => this.labelIdToName.get(labelId))
          .filter(Boolean);
      }
    }

    return tasks;
  }

  async createReviewTask(content, dueDate, priority = 1) {
    try {
      const projectId = await this.getOrCreateProject();
      const payload = await this.resolveLabelIds({
        content,
        projectId,
        dueDate: dueDate instanceof Date ? dueDate.toISOString().split('T')[0] : dueDate,
        priority,
        labels: ['復習'],
      });
      const task = await this.api.addTask(payload);

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
      const taskPayload = await this.resolveLabelIds({
        content: payload.content,
        description: payload.description,
        projectId,
        dueDate: payload.dueDate,
        dueDatetime: payload.dueDatetime,
        dueTimezone: payload.dueTimezone,
        labels: ['Classroom'],
      });
      const task = await this.api.addTask(taskPayload);

      return task;
    } catch (error) {
      console.error('Todoist Classroom タスク作成エラー:', error);
      throw error;
    }
  }

  /**
   * reMarkable ノート由来の TODO を1件作成
   *
   * Gemini が返した todo 配列の各要素をそのままタスクとして登録する。
   * 期限や優先度は仕様に含まれないため設定しない。
   *
   * @param {Object} payload
   * @param {string} payload.content - タスク内容（Gemini の todo 要素）
   * @param {string} [payload.description] - 補足説明（ノート名・ページ番号など）
   * @returns {Promise<Object>} 作成したタスク
   */
  /**
   * reMarkable ノート由来の TODO を1件作成
   *
   * @param {Object} payload
   * @param {string} payload.content - タスク内容（Gemini の todo 要素）
   * @param {string} [payload.description] - 補足説明（ノート名・ページ番号など）
   * @param {string} [projectName] - 任意のプロジェクト名（指定があればそのプロジェクトを使用／初回のみ作成）
   * @returns {Promise<Object>} 作成したタスク
   */
  async createRemarkableTodo(payload, projectName) {
    // TODO は常に固定の review プロジェクトに登録する。
    // notebook 名ごとのプロジェクト作成はプロジェクト数上限に影響するため避ける。
    const projectId = await this.getOrCreateProjectByName(config.review.defaultProjectName);

    const taskPayload = await this.resolveLabelIds({
      content: payload.content,
      description: payload.description,
      projectId,
      priority: 1,
      labels: ['reMarkable', '復習'],
    });

    return this.api.addTask(taskPayload);
  }

  /**
   * タスクを更新
   * @param {string} taskId
   * @param {Object} payload
   */
  async updateTask(taskId, payload) {
    try {
      const normalizedPayload = await this.resolveLabelIds(payload);
      await this.api.updateTask(taskId, normalizedPayload);
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
   * 指定日数以上前の復習タスクを削除
   * @param {number} olderThanDays - 何日以上前を削除対象にするか
   * @returns {Promise<{deleted: number, failed: number}>}
   */
  async deleteOldReviewTasks(olderThanDays = 2) {
    try {
      const tasks = await this.getAllTasks();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - olderThanDays);
      const cutoffStr = formatLocalDate(cutoff);

      let deleted = 0;
      let failed = 0;

      const targets = tasks.filter(task => {
        if (task.isCompleted) return false;
        if (!task.labels || !task.labels.includes('復習')) return false;

        const dueDate = getTaskDueDate(task);
        if (!dueDate) return false;

        return formatLocalDate(dueDate) <= cutoffStr;
      });

      for (const task of targets) {
        try {
          await this.api.deleteTask(task.id);
          deleted++;
        } catch (error) {
          failed++;
          console.error(`復習タスク削除失敗 (${task.id}):`, error);
        }
      }

      return { deleted, failed };
    } catch (error) {
      console.error('古い復習タスク削除エラー:', error);
      throw error;
    }
  }

  /**
   * Todoistのタスク一覧を配列で取得
   * @returns {Promise<Array>} タスク配列
   */
  async getAllTasks() {
    try {
      const response = await this.api.getTasks();
      const tasks = normalizeTasksResponse(response);
      await this.hydrateTaskLabels(tasks);
      return tasks;
    } catch (error) {
      console.error('Todoist タスク一覧取得エラー:', error);
      throw error;
    }
  }
}

module.exports = new TodoistService();
