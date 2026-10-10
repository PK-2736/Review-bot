const test = require('node:test');
const assert = require('node:assert/strict');

const todoistService = require('../src/services/todoist');

test('deleteOldReviewTasks removes review tasks due three or more days ago', async () => {
  const originalGetAllTasks = todoistService.getAllTasks;
  const originalDeleteTask = todoistService.api.deleteTask;
  const deletedTaskIds = [];
  const today = new Date();
  const dateDaysAgo = (days) => {
    const date = new Date(today);
    date.setDate(date.getDate() - days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  todoistService.getAllTasks = async () => [
    { id: 'three-days-old', due: { date: dateDaysAgo(3) }, labels: ['復習'] },
    { id: 'four-days-old', due: { date: dateDaysAgo(4) }, labels: ['復習'] },
    { id: 'two-days-old', due: { date: dateDaysAgo(2) }, labels: ['復習'] },
    { id: 'old-non-review', due: { date: dateDaysAgo(4) }, labels: ['Classroom'] },
    { id: 'old-completed', due: { date: dateDaysAgo(4) }, labels: ['復習'], isCompleted: true },
  ];
  todoistService.api.deleteTask = async (taskId) => {
    deletedTaskIds.push(taskId);
  };

  try {
    const result = await todoistService.deleteOldReviewTasks();

    assert.deepEqual(deletedTaskIds, ['three-days-old', 'four-days-old']);
    assert.deepEqual(result, { deleted: 2, failed: 0 });
  } finally {
    todoistService.getAllTasks = originalGetAllTasks;
    todoistService.api.deleteTask = originalDeleteTask;
  }
});
