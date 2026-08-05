const test = require('node:test');
const assert = require('node:assert/strict');

const todoRegistrar = require('../src/services/remarkable/todoRegistrar');
const retryQueueStore = require('../src/services/remarkable/retryQueueStore');
const todoistService = require('../src/services/todoist');

test('registerTodos schedules a retry when todo creation fails', async () => {
  const originalCreateRemarkableTodo = todoistService.createRemarkableTodo;
  const originalScheduleRetry = retryQueueStore.scheduleRetry;
  const scheduled = [];

  todoistService.createRemarkableTodo = async () => {
    throw new Error('temporary failure');
  };
  retryQueueStore.scheduleRetry = (entry) => {
    scheduled.push(entry);
    return entry;
  };

  try {
    const result = await todoRegistrar.registerTodos({
      notebookName: 'Physics',
      notebookPath: '/physics',
      page: 4,
      analysis: {
        title: 'Demo',
        summary: 'Summary',
        important_points: [],
        memorize: [],
        todo: ['Review chapter'],
        tags: [],
      },
    });

    assert.equal(result.created, 0);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].attempt, 2);
    assert.equal(scheduled[0].content, 'Review chapter');
  } finally {
    todoistService.createRemarkableTodo = originalCreateRemarkableTodo;
    retryQueueStore.scheduleRetry = originalScheduleRetry;
  }
});

test('processPendingTodoRetries removes entries after success', async () => {
  const originalGetDueEntries = retryQueueStore.getDueEntries;
  const originalRemove = retryQueueStore.remove;
  const originalSave = retryQueueStore.save;
  const originalCreateRemarkableTodo = todoistService.createRemarkableTodo;
  const removed = [];

  retryQueueStore.getDueEntries = () => [{
    notebookPath: '/physics',
    notebookName: 'Physics',
    page: 4,
    content: 'Review chapter',
    description: 'ノート: Physics\nページ: 4',
    attempt: 2,
  }];
  retryQueueStore.remove = (notebookPath, page) => {
    removed.push({ notebookPath, page });
    return true;
  };
  retryQueueStore.save = () => true;
  todoistService.createRemarkableTodo = async () => ({ tasks: [{ id: '1' }, { id: '2' }, { id: '3' }], failedDetails: [] });

  try {
    const result = await todoRegistrar.processPendingTodoRetries();

    assert.equal(result.processed, 1);
    assert.equal(result.succeeded, 1);
    assert.equal(removed.length, 1);
    assert.deepEqual(removed[0], { notebookPath: '/physics', page: 4 });
  } finally {
    retryQueueStore.getDueEntries = originalGetDueEntries;
    retryQueueStore.remove = originalRemove;
    retryQueueStore.save = originalSave;
    todoistService.createRemarkableTodo = originalCreateRemarkableTodo;
  }
});

test('createRemarkableTodo reuses existing tasks and avoids duplicates', async () => {
  const originalGetAllTasks = todoistService.getAllTasks;
  const originalGetOrCreateProjectByName = todoistService.getOrCreateProjectByName;
  const originalAddTask = todoistService.api.addTask;
  const createdPayloads = [];

  todoistService.getOrCreateProjectByName = async () => 123;
  todoistService.getAllTasks = async () => [{
    project_id: 123,
    content: 'Review chapter (2026-08-06)',
    due: { date: '2026-08-06' },
  }];
  todoistService.api.addTask = async (payload) => {
    createdPayloads.push(payload);
    return { id: String(createdPayloads.length), content: payload.content };
  };

  try {
    const originalDate = Date;
    const fixedNow = new Date('2026-08-05T00:00:00Z');
    global.Date = class extends originalDate {
      constructor(...args) {
        if (args.length === 0) return new originalDate(fixedNow);
        return new originalDate(...args);
      }
      static now() {
        return fixedNow.getTime();
      }
      static parse(value) {
        return originalDate.parse(value);
      }
      static UTC(...args) {
        return originalDate.UTC(...args);
      }
    };

    try {
      const result = await todoistService.createRemarkableTodo({
        content: 'Review chapter',
        description: 'ノート: Physics\nページ: 4',
      }, 'Physics');

      assert.equal(createdPayloads.length, 2);
      assert.equal(result.tasks.length, 3);
    } finally {
      global.Date = originalDate;
    }
  } finally {
    todoistService.getAllTasks = originalGetAllTasks;
    todoistService.getOrCreateProjectByName = originalGetOrCreateProjectByName;
    todoistService.api.addTask = originalAddTask;
  }
});