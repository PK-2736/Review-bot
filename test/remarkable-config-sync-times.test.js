const test = require('node:test');
const assert = require('node:assert/strict');

const CONFIG_PATH = '../src/config';

function loadRemarkableConfig(envValue) {
  const previous = process.env.REMARKABLE_SYNC_TIMES;
  if (envValue === undefined) {
    delete process.env.REMARKABLE_SYNC_TIMES;
  } else {
    process.env.REMARKABLE_SYNC_TIMES = envValue;
  }

  delete require.cache[require.resolve(CONFIG_PATH)];
  const config = require(CONFIG_PATH);

  if (previous === undefined) {
    delete process.env.REMARKABLE_SYNC_TIMES;
  } else {
    process.env.REMARKABLE_SYNC_TIMES = previous;
  }
  delete require.cache[require.resolve(CONFIG_PATH)];

  return config.remarkable.syncTimes;
}

test('REMARKABLE_SYNC_TIMES keeps single cron expression with hour list', () => {
  const syncTimes = loadRemarkableConfig('0 18,20,22 * * *');
  assert.deepEqual(syncTimes, ['0 18,20,22 * * *']);
});

test('REMARKABLE_SYNC_TIMES supports comma-separated full cron entries', () => {
  const syncTimes = loadRemarkableConfig('0 18 * * *,0 20 * * *,0 22 * * *');
  assert.deepEqual(syncTimes, ['0 18 * * *', '0 20 * * *', '0 22 * * *']);
});
