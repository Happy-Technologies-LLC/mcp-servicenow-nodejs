import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, expect, jest, test } from '@jest/globals';
import { createMcpServer } from '../src/mcp-server-consolidated.js';
import { docsToolDefinitions } from '../src/docs/tool-definitions.js';
import { handleDocsTool } from '../src/docs/tool-handlers.js';

function parseToolResponse(response) {
  return JSON.parse(response.content[0].text);
}

describe('docs MCP tools', () => {
  test('defines initial docs tools', () => {
    expect(docsToolDefinitions.map((tool) => tool.name)).toEqual([
      'SN-Docs-Families',
      'SN-Docs-Status',
      'SN-Docs-Sync',
      'SN-Docs-Search',
      'SN-Docs-Get'
    ]);
  });

  test('adds docs tools to consolidated MCP tool list', async () => {
    const server = await createMcpServer({ setProgressCallback() {} });
    const handler = server._requestHandlers.get('tools/list');
    const result = await handler({ method: 'tools/list', params: {} }, {});
    const docsTools = result.tools.filter((tool) => tool.name.startsWith('SN-Docs-'));

    expect(docsTools.map((tool) => tool.name)).toEqual([
      'SN-Docs-Families',
      'SN-Docs-Status',
      'SN-Docs-Sync',
      'SN-Docs-Search',
      'SN-Docs-Get'
    ]);
  });

  test('can expose only docs tools without a ServiceNow client', async () => {
    const server = await createMcpServer(null, { docsOnly: true });
    const handler = server._requestHandlers.get('tools/list');
    const result = await handler({ method: 'tools/list', params: {} }, {});

    expect(result.tools.map((tool) => tool.name)).toEqual([
      'SN-Register-Instance',
      'SN-Docs-Families',
      'SN-Docs-Status',
      'SN-Docs-Sync',
      'SN-Docs-Search',
      'SN-Docs-Get'
    ]);
  });

  test('defaults docs sync to the australia branch', async () => {
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'happy-docs-default-'));
    const client = {
      getLlms: jest.fn().mockResolvedValue(''),
      getMarkdown: jest.fn()
    };

    const response = await handleDocsTool('SN-Docs-Sync', {}, {
      config: {
        cacheDir,
        localIndexEnabled: true,
        enableVector: false,
        embeddingProvider: 'none',
        githubToken: ''
      },
      client
    });

    expect(parseToolResponse(response)).toMatchObject({
      family: 'australia',
      branch: 'australia',
      documentsSynced: 0
    });
    expect(client.getLlms).toHaveBeenCalledWith('australia');
  });

  test('defaults docs get to the australia branch', async () => {
    const client = {
      getMarkdown: jest.fn().mockResolvedValue('# Australia docs')
    };

    const response = await handleDocsTool('SN-Docs-Get', { path: 'platform/example.md' }, {
      config: {
        cacheDir: '/tmp/happy-docs-unused',
        localIndexEnabled: false,
        enableVector: false,
        embeddingProvider: 'none',
        githubToken: ''
      },
      client
    });

    expect(parseToolResponse(response).document).toMatchObject({
      family: 'australia',
      path: 'platform/example.md',
      markdown: '# Australia docs'
    });
    expect(client.getMarkdown).toHaveBeenCalledWith('australia', 'platform/example.md');
  });
});
