const { google } = require('googleapis');
const config = require('../config');
const ClassroomTaskStore = require('./classroomTaskStore');
const todoistService = require('./todoist');

const SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
];

class ClassroomService {
  constructor() {
    this.auth = null;
    this.client = null;
  }

  async getAuthClient() {
    if (this.auth) {
      return this.auth;
    }

    const serviceAccountJson = config.classroom.auth.serviceAccountJson;
    if (serviceAccountJson) {
      const key = this.parseServiceAccountJson(serviceAccountJson);
      this.auth = new google.auth.JWT({
        email: key.client_email,
        key: key.private_key,
        scopes: SCOPES,
        subject: config.classroom.auth.impersonateUser || undefined,
      });
      return this.auth;
    }

    const { clientId, clientSecret, refreshToken, redirectUri } = config.classroom.auth;
    if (clientId && clientSecret && refreshToken) {
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri || undefined);
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      this.auth = oauth2Client;
      return this.auth;
    }

    throw new Error('Google Classroom 認証情報が設定されていません');
  }

  async getClient() {
    if (this.client) {
      return this.client;
    }
    const auth = await this.getAuthClient();
    this.client = google.classroom({ version: 'v1', auth });
    return this.client;
  }

  parseServiceAccountJson(value) {
    try {
      const trimmed = value.trim();
      if (trimmed.startsWith('{')) {
        return JSON.parse(trimmed);
      }
      const decoded = Buffer.from(trimmed, 'base64').toString('utf-8');
      return JSON.parse(decoded);
    } catch (error) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON の形式が不正です');
    }
  }

  async listCourses() {
    const client = await this.getClient();
    const courses = [];
    let pageToken;

    do {
      const res = await client.courses.list({
        courseStates: ['ACTIVE'],
        pageSize: 100,
        pageToken,
      });
      courses.push(...(res.data.courses || []));
      pageToken = res.data.nextPageToken;
    } while (pageToken);

    return courses;
  }

  async listCourseWork(courseId) {
    const client = await this.getClient();
    const items = [];
    let pageToken;

    do {
      const res = await client.courses.courseWork.list({
        courseId,
        pageSize: 100,
        pageToken,
      });
      items.push(...(res.data.courseWork || []));
      pageToken = res.data.nextPageToken;
    } while (pageToken);

    return items;
  }

  async listStudentSubmissions(courseId, courseWorkId) {
    const client = await this.getClient();
    const items = [];
    let pageToken;

    do {
      const res = await client.courses.courseWork.studentSubmissions.list({
        courseId,
        courseWorkId,
        userId: 'me',
        pageToken,
      });
      items.push(...(res.data.studentSubmissions || []));
      pageToken = res.data.nextPageToken;
    } while (pageToken);

    return items;
  }

  buildDueInfo(courseWork) {
    if (!courseWork.dueDate) {
      return null;
    }

    const dueDate = courseWork.dueDate;
    const dueTime = courseWork.dueTime || { hours: 23, minutes: 59, seconds: 0 };

    const dateTime = new Date(
      dueDate.year,
      dueDate.month - 1,
      dueDate.day,
      dueTime.hours || 0,
      dueTime.minutes || 0,
      dueTime.seconds || 0
    );

    const dueDateString = `${dueDate.year}-${this.pad(dueDate.month)}-${this.pad(dueDate.day)}`;
    const dueTimeString = `${this.pad(dueTime.hours || 0)}:${this.pad(dueTime.minutes || 0)}`;
    const dueDateTimeString = `${dueDateString}T${dueTimeString}:00`;

    return {
      dateTime,
      dueDateString,
      dueDateTimeString,
      display: `${dueDateString} ${dueTimeString}`,
      hasTime: !!courseWork.dueTime,
    };
  }

  pad(value) {
    return String(value).padStart(2, '0');
  }

  async syncPendingTasks() {
    if (!config.classroom.enabled) {
      return { created: 0, updated: 0, closed: 0, skipped: 0 };
    }

    const summary = { created: 0, updated: 0, closed: 0, skipped: 0 };
    const now = new Date();
    const limitDate = new Date(now.getTime());
    limitDate.setDate(limitDate.getDate() + config.classroom.dueWithinDays);

    const courses = await this.listCourses();
    const courseFilter = config.classroom.courseIds;
    const filteredCourses = courseFilter.length > 0
      ? courses.filter(course => courseFilter.includes(course.id))
      : courses;

    for (const course of filteredCourses) {
      const courseWorkList = await this.listCourseWork(course.id);

      for (const courseWork of courseWorkList) {
        if (courseWork.state !== 'PUBLISHED') {
          continue;
        }

        const dueInfo = this.buildDueInfo(courseWork);
        if (!dueInfo) {
          continue;
        }

        if (dueInfo.dateTime > limitDate) {
          continue;
        }

        const submissions = await this.listStudentSubmissions(course.id, courseWork.id);
        const submission = submissions[0];
        const state = submission ? submission.state : 'NEW';
        const isCompleted = state === 'TURNED_IN' || state === 'RETURNED';

        const key = `${course.id}:${courseWork.id}`;
        const existing = ClassroomTaskStore.getByKey(key);

        if (isCompleted) {
          if (config.classroom.autoCloseCompleted && existing && existing.taskId) {
            try {
              await todoistService.completeTask(existing.taskId);
              ClassroomTaskStore.removeByKey(key);
              summary.closed += 1;
            } catch (error) {
              console.error('Todoistタスク完了エラー:', error);
            }
          }
          continue;
        }

        const taskContent = `${courseWork.title} (${course.name})`;
        const taskDescription = [
          `クラス: ${course.name}`,
          `期限: ${dueInfo.display}`,
          `URL: ${courseWork.alternateLink || 'なし'}`,
        ].join('\n');

        const duePayload = dueInfo.hasTime
          ? { dueDatetime: dueInfo.dueDateTimeString, dueTimezone: config.classroom.timezone }
          : { dueDate: dueInfo.dueDateString };

        if (!existing) {
          const task = await todoistService.createClassroomTask({
            content: taskContent,
            description: taskDescription,
            ...duePayload,
          });

          ClassroomTaskStore.upsert({
            key,
            taskId: task.id,
            dueKey: dueInfo.hasTime ? dueInfo.dueDateTimeString : dueInfo.dueDateString,
            content: taskContent,
            updatedAt: new Date().toISOString(),
          });

          summary.created += 1;
          continue;
        }

        const nextDueKey = dueInfo.hasTime ? dueInfo.dueDateTimeString : dueInfo.dueDateString;
        if (existing.dueKey !== nextDueKey || existing.content !== taskContent) {
          await todoistService.updateTask(existing.taskId, {
            content: taskContent,
            description: taskDescription,
            ...duePayload,
          });

          ClassroomTaskStore.upsert({
            key,
            taskId: existing.taskId,
            dueKey: nextDueKey,
            content: taskContent,
            updatedAt: new Date().toISOString(),
          });

          summary.updated += 1;
        } else {
          summary.skipped += 1;
        }
      }
    }

    return summary;
  }
}

module.exports = new ClassroomService();
