const todoistService = require('../todoist');
const logger = require('./logger');

/**
 * Todoist に付ける補足説明を組み立てる。
 * @param {Object} params
 * @param {string} params.notebookName - ノート名
 * @param {number} params.page - ページ番号
 * @param {import('./types').PageAnalysis} params.analysis - Gemini の解析結果
 * @returns {string}
 */
function buildDescription(params) {
  const lines = [`ノート: ${params.notebookName}`, `ページ: ${params.page}`];

  if (params.analysis.title) lines.push(`タイトル: ${params.analysis.title}`);
  if (params.analysis.summary) lines.push('', params.analysis.summary);

  return lines.join('\n');
}

/**
 * Gemini が返した todo 配列を Todoist へ登録する。
 *
 * Todoist の失敗は Warning のみで、同期処理は継続する（仕様）。
 * そのため例外は投げず、成功件数と警告メッセージを返す。
 *
 * @param {Object} params
 * @param {string} params.notebookName - ノート名
 * @param {number} params.page - ページ番号
 * @param {import('./types').PageAnalysis} params.analysis - Gemini の解析結果
 * @returns {Promise<{ created: number, warnings: string[] }>}
 */
async function registerTodos(params) {
  const todos = params.analysis.todo;
  /** @type {string[]} */
  const warnings = [];
  let created = 0;

  if (todos.length === 0) {
    return { created, warnings };
  }

  const description = buildDescription(params);

  for (const todo of todos) {
    try {
      await todoistService.createRemarkableTodo({ content: todo, description });
      created += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Todoist: ${params.notebookName} p.${params.page} "${todo}" - ${message}`);
      logger.warn('Todoist への登録に失敗しました（同期は継続します）', {
        notebook: params.notebookName,
        page: params.page,
        todo,
        error: message,
      });
    }
  }

  logger.info('Todoist へ TODO を登録しました', {
    notebook: params.notebookName,
    page: params.page,
    created,
    failed: todos.length - created,
  });

  return { created, warnings };
}

module.exports = { registerTodos, buildDescription };
