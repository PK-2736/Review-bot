const test = require('node:test');
const assert = require('node:assert/strict');

const todoRegistrar = require('../src/services/remarkable/todoRegistrar');
const todoistService = require('../src/services/todoist');
const retryQueueStore = require('../src/services/remarkable/retryQueueStore');

test('registerTodos schedules retry when createRemarkableTodo throws', async () => {
  const originalCreate = todoistService.createRemarkableTodo;
  const originalSchedule = retryQueueStore.scheduleRetry;
  const scheduled = [];

  todoistService.createRemarkableTodo = async () => { throw new Error('network'); };
  retryQueueStore.scheduleRetry = (entry) => { scheduled.push(entry); return entry; };

  try {
    const res = await todoRegistrar.registerTodos({
      notebookName: 'Demo',
      notebookPath: '/demo',
      page: 1,
      analysis: { todo: ['Test todo'], title: '', summary: '', important_points: [], memorize: [], tags: [] },
    });

    assert.ok(scheduled.length >= 1, 'retry should be scheduled');
    assert.equal(scheduled[0].notebookPath, '/demo');
    assert.equal(scheduled[0].page, 1);
    assert.equal(scheduled[0].attempt, 2);
  } finally {
    todoistService.createRemarkableTodo = originalCreate;
    retryQueueStore.scheduleRetry = originalSchedule;
  }
});

test('registerTodos schedules retry when createRemarkableTodo returns failedDetails', async () => {
  const originalCreate = todoistService.createRemarkableTodo;
  const originalSchedule = retryQueueStore.scheduleRetry;
  const scheduled = [];

  todoistService.createRemarkableTodo = async () => ({ tasks: [], failedDetails: [{ dueDate: '2026-01-01', error: new Error('api') }] });
  retryQueueStore.scheduleRetry = (entry) => { scheduled.push(entry); return entry; };

  try {
    const res = await todoRegistrar.registerTodos({
      notebookName: 'Demo',
      notebookPath: '/demo',
      page: 2,
      analysis: { todo: ['Test todo'], title: '', summary: '', important_points: [], memorize: [], tags: [] },
    });

    assert.ok(scheduled.length >= 1, 'retry should be scheduled for failedDetails');
    assert.equal(scheduled[0].notebookPath, '/demo');
    assert.equal(scheduled[0].page, 2);
    assert.equal(scheduled[0].attempt, 2);
  } finally {
    todoistService.createRemarkableTodo = originalCreate;
    retryQueueStore.scheduleRetry = originalSchedule;
  }
});
