const test = require('node:test');
const assert = require('node:assert/strict');

const syncService = require('../src/services/remarkable/syncService');
const cacheStoreModule = require('../src/services/remarkable/cacheStore');
const pageFetcher = require('../src/services/remarkable/pageFetcher');
const pageAnalyzer = require('../src/services/remarkable/pageAnalyzer');
const todoRegistrar = require('../src/services/remarkable/todoRegistrar');

test('syncNotebook uses browse totalPages to process new pages', async () => {
  const originalGetEntry = cacheStoreModule.cacheStore.getEntry;
  const originalUpdate = cacheStoreModule.cacheStore.update;
  const originalFetchPage = pageFetcher.fetchPage;
  const originalAnalyzePage = pageAnalyzer.analyzePage;
  const originalRegisterTodos = todoRegistrar.registerTodos;

  cacheStoreModule.cacheStore.getEntry = () => ({ baseline: 0, modified: '2026-07-31T00:00:00Z', totalPages: 3 });
  cacheStoreModule.cacheStore.update = () => ({ baseline: 0, modified: '2026-08-01T00:00:00Z', totalPages: 5 });

  pageFetcher.fetchPage = async () => ({ page: 4, totalPages: 5, mimeType: 'image/png', data: 'img-data', meta: {} });
  pageAnalyzer.analyzePage = async () => ({
    analysis: {
      title: 'Demo',
      summary: 'Summary',
      important_points: [],
      memorize: [],
      todo: ['Review chapter'],
      tags: [],
    },
    durationMs: 1,
  });
  todoRegistrar.registerTodos = async () => ({ created: 1, warnings: [] });

  try {
    const summary = {
      updatedNotebooks: 0,
      skippedNotebooks: 0,
      processedPages: 0,
      createdTodos: 0,
      notebookNames: [],
      pages: [],
      errors: [],
      warnings: [],
      durationMs: 0,
    };

    await syncService.syncNotebook({
      path: '/demo',
      name: 'Demo',
      modified: '2026-08-01T00:00:00Z',
      totalPages: 5,
    }, summary);

    assert.equal(summary.processedPages, 5);
    assert.equal(summary.createdTodos, 5);
  } finally {
    cacheStoreModule.cacheStore.getEntry = originalGetEntry;
    cacheStoreModule.cacheStore.update = originalUpdate;
    pageFetcher.fetchPage = originalFetchPage;
    pageAnalyzer.analyzePage = originalAnalyzePage;
    todoRegistrar.registerTodos = originalRegisterTodos;
  }
});

test('syncNotebook does not update cache when any page fails', async () => {
  const originalGetEntry = cacheStoreModule.cacheStore.getEntry;
  const originalUpdate = cacheStoreModule.cacheStore.update;
  const originalFetchPage = pageFetcher.fetchPage;
  const originalAnalyzePage = pageAnalyzer.analyzePage;
  const originalRegisterTodos = todoRegistrar.registerTodos;

  let updateCount = 0;
  cacheStoreModule.cacheStore.getEntry = () => ({ baseline: 0, modified: '2026-07-31T00:00:00Z', totalPages: 3 });
  cacheStoreModule.cacheStore.update = () => {
    updateCount += 1;
    return { baseline: 0, modified: '2026-08-01T00:00:00Z', totalPages: 5 };
  };

  pageFetcher.fetchPage = async () => ({ page: 1, totalPages: 2, mimeType: 'image/png', data: 'img-data', meta: {} });
  pageAnalyzer.analyzePage = async () => ({
    analysis: {
      title: 'Demo',
      summary: 'Summary',
      important_points: [],
      memorize: [],
      todo: ['Review chapter'],
      tags: [],
    },
    durationMs: 1,
  });
  todoRegistrar.registerTodos = async () => ({ created: 0, warnings: ['Todoist failed'] });

  try {
    const summary = {
      updatedNotebooks: 0,
      skippedNotebooks: 0,
      processedPages: 0,
      createdTodos: 0,
      notebookNames: [],
      pages: [],
      errors: [],
      warnings: [],
      durationMs: 0,
    };

    await syncService.syncNotebook({
      path: '/demo',
      name: 'Demo',
      modified: '2026-08-01T00:00:00Z',
      totalPages: 2,
    }, summary);

    assert.equal(updateCount, 0);
    assert.ok(summary.errors.length >= 1);
  } finally {
    cacheStoreModule.cacheStore.getEntry = originalGetEntry;
    cacheStoreModule.cacheStore.update = originalUpdate;
    pageFetcher.fetchPage = originalFetchPage;
    pageAnalyzer.analyzePage = originalAnalyzePage;
    todoRegistrar.registerTodos = originalRegisterTodos;
  }
});
