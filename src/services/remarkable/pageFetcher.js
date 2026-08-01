const mcpClient = require('./mcpClient');
const logger = require('./logger');

/** 画像 base64 が入り得るキーの候補（content に image が無い実装への保険） */
const IMAGE_DATA_KEYS = ['image', 'image_base64', 'imageBase64', 'data', 'base64', 'png'];

/**
 * remarkable_page のレスポンス JSON から総ページ数を取り出す。
 * @param {Record<string, any>} meta
 * @returns {number|null}
 */
function extractTotalPages(meta) {
  const numeric = Number(meta.total_pages != null ? meta.total_pages : meta.totalPages);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.floor(numeric);
}

/**
 * レスポンス JSON から base64 画像データを探す。
 * @param {Record<string, any>} meta
 * @returns {string|null}
 */
function extractInlineImage(meta) {
  for (const key of IMAGE_DATA_KEYS) {
    const value = meta[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

/**
 * data URI 形式（`data:image/png;base64,...`）が渡された場合に base64 部分だけを取り出す。
 * @param {string} data
 * @returns {string}
 */
function stripDataUri(data) {
  const match = data.match(/^data:[^;]+;base64,(.*)$/s);
  return match ? match[1] : data;
}

/**
 * 指定ページの画像を remarkable_page から取得する。
 *
 * remarkable_page が返す JSON はそのまま `meta` に保持し、
 * compatibility モードは使用しない。OCR は Gemini Vision が担当するため
 * include_ocr=false で呼び出す（mcpClient.page() 側で固定）。
 *
 * @param {string} notebookPath - ノートのパス
 * @param {number} pageNumber - ページ番号
 * @returns {Promise<import('./types').PageImage>}
 * @throws {Error} 画像を取得できなかった場合
 */
async function fetchPage(notebookPath, pageNumber) {
  const content = await mcpClient.page({ document: notebookPath, page: pageNumber, include_ocr: false });

  /** @type {Record<string, any>} remarkable_page のレスポンス JSON */
  const meta = content.json && typeof content.json === 'object' ? content.json : {};

  // MCP の image / resource コンテンツを優先し、無い場合は JSON 内の base64 を探す
  const image = content.images[0];
  const data = image ? image.data : extractInlineImage(meta);

  if (!data) {
    const hint = meta.ocr_message || meta._hint;
    throw new Error(`remarkable_page が画像を返しませんでした${hint ? `: ${hint}` : ''}`);
  }

  const mimeType = image ? image.mimeType : (meta.mime_type || 'image/png');

  logger.info('image found', {
    mimeType,
    dataLength: data.length,
    notebookPath,
    pageNumber,
  });

  return {
    // レスポンスがページ番号を返す場合はそれを信頼する
    page: Number.isFinite(Number(meta.page)) ? Number(meta.page) : pageNumber,
    totalPages: extractTotalPages(meta),
    mimeType: String(mimeType),
    data: stripDataUri(String(data)),
    meta,
  };
}

module.exports = { fetchPage };
