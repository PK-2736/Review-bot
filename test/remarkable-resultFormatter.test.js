const test = require('node:test');
const assert = require('node:assert/strict');

const { formatSyncResult } = require('../src/services/remarkable');

test('formatSyncResult returns a Discord embed', () => {
  const embed = formatSyncResult({
    updatedNotebooks: 2,
    skippedNotebooks: 1,
    processedPages: 5,
    createdTodos: 3,
    notebookNames: [],
    pages: [],
    errors: ['page failed'],
    warnings: ['todo skipped'],
    durationMs: 123,
  });

  const json = embed.toJSON();

  assert.equal(json.title, 'reMarkable レビュー完了');
  assert.equal(json.fields.length, 4);
  assert.equal(json.fields[0].name, '更新されたノート');
  assert.equal(json.fields[2].value, '3件');
});