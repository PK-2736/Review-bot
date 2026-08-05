const test = require('node:test');
const assert = require('node:assert/strict');

const pageAnalyzer = require('../src/services/remarkable/pageAnalyzer');
const todoRegistrar = require('../src/services/remarkable/todoRegistrar');
const todoistService = require('../src/services/todoist');

test('normalizeAnalysis keeps only one todo per page', () => {
  const analysis = pageAnalyzer.normalizeAnalysis({
    title: 'Demo',
    summary: 'Summary',
    important_points: [],
    memorize: [],
    todo: ['First todo', 'Second todo', 'Third todo'],
    tags: [],
  });

  assert.deepEqual(analysis.todo, ['First todo']);
});

test('registerTodos only registers the first todo when multiple are provided', async () => {
  const originalCreateRemarkableTodo = todoistService.createRemarkableTodo;
  const seenPayloads = [];

  todoistService.createRemarkableTodo = async (payload) => {
    seenPayloads.push(payload);
    return { tasks: [{ id: '1' }, { id: '2' }, { id: '3' }], failedDetails: [] };
  };

  try {
    const result = await todoRegistrar.registerTodos({
      notebookName: 'Demo',
      page: 1,
      analysis: {
        title: 'Demo',
        summary: 'Summary',
        important_points: [],
        memorize: [],
        todo: ['First todo', 'Second todo'],
        tags: [],
      },
    });

    assert.equal(seenPayloads.length, 1);
    assert.equal(seenPayloads[0].content, 'First todo');
    assert.equal(result.created, 3);
  } finally {
    todoistService.createRemarkableTodo = originalCreateRemarkableTodo;
  }
});