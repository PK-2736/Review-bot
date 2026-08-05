const todoistService = require('../todoist');
const retryQueueStore = require('./retryQueueStore');
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
 * 失敗した reMarkable TODO 作成を再試行キューへ積む。
 * @param {Object} params
 * @param {string} params.notebookName
 * @param {string} params.notebookPath
 * @param {number} params.page
 * @param {string} params.content
 * @param {string} params.description
 * @param {unknown} params.error
 * @param {number} params.attempt
 */
function scheduleRetry(params) {
  retryQueueStore.scheduleRetry({
    notebookName: params.notebookName,
    notebookPath: params.notebookPath,
    page: params.page,
    content: params.content,
    description: params.description,
    error: params.error,
    attempt: params.attempt,
  });
}

/**
 * 期限到来した再試行キューを処理する。
 * @returns {Promise<{ processed: number, succeeded: number, rescheduled: number, failed: number }>}
 */
async function processPendingTodoRetries() {
  const dueEntries = retryQueueStore.getDueEntries();
  /** @type {{ processed: number, succeeded: number, rescheduled: number, failed: number }} */
  const summary = { processed: 0, succeeded: 0, rescheduled: 0, failed: 0 };

  for (const entry of dueEntries) {
    summary.processed += 1;

    try {
      const result = await todoistService.createRemarkableTodo({
        content: entry.content,
        description: entry.description,
      }, entry.notebookName);

      const createdCount = Array.isArray(result.tasks) ? result.tasks.length : 0;
      const hasFailures = Array.isArray(result.failedDetails) && result.failedDetails.length > 0;

      if (!hasFailures) {
        retryQueueStore.remove(entry.notebookPath, entry.page);
        summary.succeeded += 1;
        logger.info('再試行キューの TODO 作成に成功しました', {
          notebook: entry.notebookName,
          page: entry.page,
          createdCount,
          attempt: entry.attempt,
        });
        continue;
      }

      if (entry.attempt < 3) {
        scheduleRetry({
          notebookName: entry.notebookName,
          notebookPath: entry.notebookPath,
          page: entry.page,
          content: entry.content,
          description: entry.description,
          error: new Error(result.failedDetails.map((item) => {
            const error = item && item.error;
            return error instanceof Error ? error.message : String(error);
          }).join('; ')),
          attempt: entry.attempt + 1,
        });
        summary.rescheduled += 1;
      } else {
        retryQueueStore.remove(entry.notebookPath, entry.page);
        summary.failed += 1;
        logger.error('再試行回数の上限に達したため TODO 作成を中止します', {
          notebook: entry.notebookName,
          page: entry.page,
          attempt: entry.attempt,
        });
      }
    } catch (error) {
      if (entry.attempt < 3) {
        scheduleRetry({
          notebookName: entry.notebookName,
          notebookPath: entry.notebookPath,
          page: entry.page,
          content: entry.content,
          description: entry.description,
          error,
          attempt: entry.attempt + 1,
        });
        summary.rescheduled += 1;
      } else {
        retryQueueStore.remove(entry.notebookPath, entry.page);
        summary.failed += 1;
        logger.error('再試行回数の上限に達したため TODO 作成を中止します', {
          notebook: entry.notebookName,
          page: entry.page,
          attempt: entry.attempt,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (summary.processed > 0) {
    retryQueueStore.save();
  }

  return summary;
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
  const todos = Array.isArray(params.analysis.todo) ? params.analysis.todo.slice(0, 1) : [];
  const skippedTodos = Array.isArray(params.analysis.todo) ? Math.max(0, params.analysis.todo.length - todos.length) : 0;
  /** @type {string[]} */
  const warnings = [];
  let created = 0;

  logger.info('Todoist 登録直前', {
    notebook: params.notebookName,
    page: params.page,
    todoCount: todos.length,
    skippedTodos,
    todos,
  });

  if (skippedTodos > 0) {
    logger.warn('Gemini の TODO が複数件だったため先頭 1 件のみ登録します', {
      notebook: params.notebookName,
      page: params.page,
      skippedTodos,
    });
  }

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
      const result = await todoistService.createRemarkableTodo({ content: todo, description }, params.notebookName);
      const createdCount = Array.isArray(result.tasks) ? result.tasks.length : 0;
      created += createdCount;

      if (createdCount > 0) {
        logger.info('Todoist にタスクを作成しました', {
          notebook: params.notebookName,
          page: params.page,
          todo,
          createdCount,
        });
      }

      if (Array.isArray(result.failedDetails) && result.failedDetails.length > 0) {
        // Schedule a retry when Todoist reports per-dueDate failures
        scheduleRetry({
          notebookName: params.notebookName,
          notebookPath: params.notebookPath,
          page: params.page,
          content: todo,
          description,
          error: new Error(result.failedDetails.map((f) => {
            const err = f && f.error;
            return err instanceof Error ? err.message : String(err);
          }).join('; ')),
          attempt: 2,
        });

        for (const failure of result.failedDetails) {
          const error = failure.error;
          const message = error instanceof Error ? error.message : String(error);
          const stack = error && error.stack ? error.stack : null;
          const status = error && error.httpStatusCode ? error.httpStatusCode : (error && error.status ? error.status : null);

          logger.error('Todoist への登録に失敗しました (個別スケジュールタスク) - 続行します', {
            notebook: params.notebookName,
            page: params.page,
            todo,
            dueDate: failure.dueDate,
            status,
            message,
            stack,
          });
          warnings.push(`Failed to create todo for ${failure.dueDate}: ${message}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error && error.stack ? error.stack : null;
      const status = error && error.httpStatusCode ? error.httpStatusCode : (error && error.status ? error.status : null);

      logger.error('Todoist への登録に失敗しました (個別タスク) - 続行します', {
        notebook: params.notebookName,
        page: params.page,
        todo,
        status,
        message,
        stack,
      });

      scheduleRetry({
        notebookName: params.notebookName,
        notebookPath: params.notebookPath,
        page: params.page,
        content: todo,
        description,
        error,
        attempt: 2,
      });

      warnings.push(`Failed to create todo: ${message}`);
      continue;
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
    const totalExpected = todos.length * 3;
    logger.info('Todoist へ TODO を登録しました', {
      notebook: params.notebookName,
      page: params.page,
      created,
      failed: Math.max(0, totalExpected - created),
      expected: totalExpected,
    });
  }

  return { created, warnings };
}

module.exports = { registerTodos, buildDescription, processPendingTodoRetries };
