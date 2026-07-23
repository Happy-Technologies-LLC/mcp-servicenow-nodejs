import { describe, expect, jest, test } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHttpApp } from '../src/http-server.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const stdioServerPath = path.join(projectRoot, 'src', 'stdio-server.js');

function createSdkClient(name) {
  return new Client({ name, version: '1.0.0' });
}

async function listenOnEphemeralLoopback(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return server;
}

async function closeHttpServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections?.();
  });
}

async function closeClientAndServer(client, server) {
  try {
    await client?.close();
  } finally {
    if (server) {
      await closeHttpServer(server);
    }
  }
}

describe('real SDK production transports', () => {
  test('round-trips tools over HTTP/SSE with the production server transport', async () => {
    const records = [{ sys_id: 'smoke-record', short_description: 'SDK transport smoke' }];
    const serviceNowClient = {
      setProgressCallback: jest.fn(),
      getRecords: jest.fn(async () => records)
    };
    const defaultInstance = {
      name: 'smoke',
      url: 'https://smoke.invalid'
    };
    const createServiceNowClient = jest.fn(() => serviceNowClient);
    const app = createHttpApp({ defaultInstance, createServiceNowClient });
    let server;
    let client;

    try {
      server = await listenOnEphemeralLoopback(app);
      const { port } = server.address();
      const transport = new SSEClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
      client = createSdkClient('http-sse-smoke');

      await client.connect(transport);
      const tools = await client.listTools();
      const result = await client.callTool({
        name: 'SN-Query-Table',
        arguments: {
          table_name: 'incident',
          query: 'active=true',
          fields: 'sys_id,short_description',
          limit: 1
        }
      });

      expect(client.getServerVersion()).toEqual({
        name: 'servicenow-server',
        version: '2.0.0'
      });
      expect(tools.tools.some((tool) => tool.name === 'SN-Query-Table')).toBe(true);
      expect(createServiceNowClient).toHaveBeenCalledTimes(1);
      expect(createServiceNowClient).toHaveBeenCalledWith(defaultInstance);
      expect(serviceNowClient.getRecords).toHaveBeenCalledWith('incident', {
        sysparm_limit: 1,
        sysparm_query: 'active=true',
        sysparm_fields: 'sys_id,short_description',
        sysparm_offset: undefined
      });
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual([{
        type: 'text',
        text: `Found 1 records in incident:\n${JSON.stringify(records, null, 2)}`
      }]);
    } finally {
      await closeClientAndServer(client, server);
    }
  });

  test('round-trips a deterministic docs-only tool over production stdio', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [stdioServerPath, '--docs-only'],
      cwd: projectRoot,
      env: {
        HAPPY_MCP_DOCS_ONLY: 'true',
        HAPPY_DOCS_ENABLE_LOCAL_INDEX: 'false',
        HAPPY_DOCS_ENABLE_VECTOR: 'false',
        HAPPY_CONFIG_PATH: path.join(projectRoot, 'tests', '__missing-smoke-config.json'),
        SERVICENOW_INSTANCE_URL: '',
        SERVICENOW_USERNAME: '',
        SERVICENOW_PASSWORD: ''
      },
      stderr: 'pipe'
    });
    const client = createSdkClient('stdio-smoke');

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const result = await client.callTool({
        name: 'SN-Docs-Status',
        arguments: {}
      });
      const status = JSON.parse(result.content[0].text);

      expect(client.getServerVersion()).toEqual({
        name: 'servicenow-server',
        version: '2.0.0'
      });
      expect(tools.tools.some((tool) => tool.name === 'SN-Docs-Status')).toBe(true);
      expect(result.isError).not.toBe(true);
      expect(status).toMatchObject({
        localIndexEnabled: false,
        ftsAvailable: false,
        families: []
      });
    } finally {
      await client.close();
    }
  });
});
