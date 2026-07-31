// 一時的な動作確認スクリプト（コミット対象外）
process.env.REMARKABLE_CACHE_FILE = require('path').join(__dirname, 'tmp-cache.json');
process.env.GEMINI_API_KEY = 'dummy';
process.env.REMARKABLE_MCP_URL = 'https://example.invalid';
process.env.TODOIST_API_TOKEN = 'dummy';

const fs = require('fs');

// 初期キャッシュ: /Physics は modified 一致でスキップ、/Math は更新あり
fs.writeFileSync(process.env.REMARKABLE_CACHE_FILE, JSON.stringify({
  '/Physics': { baseline: 58, modified: '2026-07-30T12:58:00.472000' },
  '/Math': { baseline: 2, modified: '2026-07-29T18:00:00.000000' },
  '/History': { baseline: 5, modified: '2026-07-01T00:00:00.000000' },
}));

const mcpClient = require('./src/services/remarkable/mcpClient');
const geminiVisionClient = require('./src/services/remarkable/geminiVisionClient');
const todoistService = require('./src/services/todoist');
const syncService = require('./src/services/remarkable/syncService');
const { formatSyncResult } = require('./src/services/remarkable/resultFormatter');
const remarkableSyncCommand = require('./src/commands/remarkableSync');

const pageCalls = [];

mcpClient.browse = async (browsePath) => {
  console.log('[stub] remarkable_browse', browsePath);
  return {
    text: '',
    images: [],
    json: {
      items: [
        { path: '/Physics', name: 'Physics', modified: '2026-07-30T12:58:00.472000', total_pages: 59 },
        { path: '/Math', name: 'Math', modified: '2026-07-31T09:00:00.000000', total_pages: 4 },
        { path: '/History', name: 'History', modified: '2026-07-31T09:00:00.000000', total_pages: 5 },
        { path: '/Folder', name: 'Folder', type: 'folder' },
      ],
    },
  };
};

mcpClient.page = async (args) => {
  pageCalls.push(`${args.path}#${args.page} include_ocr=${args.include_ocr}`);
  if (args.page === 4) throw new Error('stub page failure');
  return {
    text: '',
    json: { mime_type: 'image/png', page: args.page, total_pages: 4, ocr_text: null },
    images: [{ data: 'BASE64DATA', mimeType: 'image/png' }],
  };
};

let geminiCalls = 0;
geminiVisionClient.generate = async () => {
  geminiCalls += 1;
  // 1回目は壊れた JSON → 1回だけ再試行されることを確認
  if (geminiCalls === 1) return 'not json at all';
  return JSON.stringify({
    title: '三角関数の加法定理',
    summary: '加法定理の導出と例題',
    important_points: ['sin(a+b) の展開'],
    memorize: ['加法定理'],
    todo: ['公式を暗記する', '問題演習を解く'],
    tags: ['数学'],
  });
};

const createdTodos = [];
todoistService.createRemarkableTodo = async (payload) => {
  createdTodos.push(payload.content);
  if (payload.content === '問題演習を解く') throw new Error('stub todoist failure');
  return { id: 'x' };
};

(async () => {
  console.log('slash command JSON:', JSON.stringify(remarkableSyncCommand.data.toJSON()));

  const summary = await syncService.sync();

  console.log('--- pageCalls ---');
  console.log(pageCalls);
  console.log('--- createdTodos ---');
  console.log(createdTodos);
  console.log('--- summary ---');
  console.log(JSON.stringify({ ...summary, pages: summary.pages.length }, null, 2));
  console.log('--- discord message ---');
  console.log(formatSyncResult(summary));
  console.log('--- cache.json ---');
  console.log(fs.readFileSync(process.env.REMARKABLE_CACHE_FILE, 'utf-8'));
})().catch((error) => {
  console.error('SMOKE FAILED:', error);
  process.exit(1);
});
