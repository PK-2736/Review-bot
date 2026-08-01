require('dotenv').config();
const syncService = require('./src/services/remarkable/syncService');

(async () => {
  try {
    console.log('Starting full sync...');
    const summary = await syncService.sync();
    console.log('--- SYNC SUMMARY ---');
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('SYNC ERROR:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
