const test = require('node:test');
const assert = require('node:assert/strict');

const mcpClient = require('../src/services/remarkable/mcpClient');
const pageFetcher = require('../src/services/remarkable/pageFetcher');

test('extractContent picks image data from a direct resource blob payload', () => {
  const content = mcpClient.extractContent({
    content: [
      {
        type: 'resource',
        mimeType: 'image/png',
        blob: 'resource-blob-data',
      },
    ],
  });

  assert.deepEqual(content.images, [{
    data: 'resource-blob-data',
    mimeType: 'image/png',
  }]);
});

test('fetchPage returns image data from a resource blob payload', async () => {
  const originalCallTool = mcpClient.callTool;
  mcpClient.callTool = async () => ({
    content: [
      {
        type: 'resource',
        mimeType: 'image/png',
        blob: 'resource-blob-data',
      },
    ],
  });

  try {
    const page = await pageFetcher.fetchPage('/notebooks/demo', 3);
    assert.equal(page.data, 'resource-blob-data');
    assert.equal(page.mimeType, 'image/png');
  } finally {
    mcpClient.callTool = originalCallTool;
  }
});

test('fetchPage uses the provided document identifier for remarkable_page', async () => {
  const originalPage = mcpClient.page;
  const seen = [];
  mcpClient.page = async (args) => {
    seen.push(args.document);
    return {
      text: '',
      json: null,
      images: [{ data: 'resource-blob-data', mimeType: 'image/png' }],
    };
  };

  try {
    await pageFetcher.fetchPage('/notebooks/demo', 1, '物理');
    assert.deepEqual(seen, ['物理']);
  } finally {
    mcpClient.page = originalPage;
  }
});
