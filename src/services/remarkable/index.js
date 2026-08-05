/**
 * reMarkable レビュー機能のエントリーポイント。
 *
 * 外部（Discord コマンド / スケジューラー）からはこのモジュール経由で参照し、
 * 内部構成の変更が呼び出し側に波及しないようにする。
 */
module.exports = {
  syncService: require('./syncService'),
  formatSyncResult: require('./resultFormatter').formatSyncResult,
  createErrorTextFile: require('./resultFormatter').createErrorTextFile,
  cacheStore: require('./cacheStore').cacheStore,
};
