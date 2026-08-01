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

  logger.info('Todoist 登録直前', {
    notebook: params.notebookName,
    page: params.page,
    todoCount: todos.length,
    todos,
  });

  if (todos.length === 0) {
    logger.warn('Todoist 登録をスキップしました', {
      notebook: params.notebookName,
      page: params.page,
      reason: 'Gemini 解析結果の todo 配列が空でした',
    });
    return { created, warnings };
  }

  const description = buildDescription(params);

  for (const todo of todos) {
    try {
      const task = await todoistService.createRemarkableTodo({ content: todo, description });
      created += 1;
      logger.info('Todoist にタスクを作成しました', { notebook: params.notebookName, page: params.page, taskId: task && task.id ? task.id : null, content: todo });
    } catch (error) {
      // ログには status / message / stack を含める
      const message = error instanceof Error ? error.message : String(error);
      const stack = error && error.stack ? error.stack : null;
      const status = error && error.httpStatusCode ? error.httpStatusCode : (error && error.status ? error.status : null);

      logger.error('Todoist への登録に失敗しました', {
        notebook: params.notebookName,
        page: params.page,
        todo,
        status,
        message,
        stack,
      });

      // 例外は握りつぶさず呼び出し元へ伝播させる
      throw error;
    }
  }

  if (created === 0) {
    logger.warn('Todoist へ TODO を登録できませんでした', {
      notebook: params.notebookName,
      page: params.page,
      reason: '登録対象の todo が存在したが、すべての登録で失敗しました',
      warnings,
    });
  } else {
    logger.info('Todoist へ TODO を登録しました', {
      notebook: params.notebookName,
      page: params.page,
      created,
      failed: todos.length - created,
    });
  }

  return { created, warnings };
}

module.exports = { registerTodos, buildDescription };
