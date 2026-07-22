import { describe, expect, jest, test } from '@jest/globals';
import { createMcpServer } from '../src/mcp-server-consolidated.js';

const INSTANCE_MANAGEMENT_TOOLS = new Set([
  'SN-Set-Instance',
  'SN-Get-Current-Instance'
]);

function createClient(name = 'primary') {
  return {
    currentInstanceName: name,
    setProgressCallback: jest.fn(),
    setInstance: jest.fn(),
    getCurrentInstance: jest.fn(() => ({
      name,
      url: `https://${name}.service-now.com`
    })),
    getRecords: jest.fn(async () => []),
    createRecord: jest.fn(async () => ({ sys_id: `${name}-record` }))
  };
}

function createManager() {
  const instances = {
    dev: {
      name: 'dev',
      url: 'https://dev.service-now.com',
      username: 'dev-user',
      password: 'dev-password'
    },
    prod: {
      name: 'prod',
      url: 'https://prod.service-now.com',
      username: 'prod-user',
      password: 'prod-password'
    }
  };

  return {
    getInstance: jest.fn((name) => {
      if (!instances[name]) {
        throw new Error(`Instance '${name}' not found. Available instances: dev, prod`);
      }
      return instances[name];
    }),
    listInstances: jest.fn(() => Object.values(instances))
  };
}

async function createHarness(overrides = {}) {
  const primaryClient = overrides.primaryClient || createClient();
  const manager = overrides.manager || createManager();
  const clients = overrides.clients || {
    dev: createClient('dev'),
    prod: createClient('prod')
  };
  const createServiceNowClient = overrides.createServiceNowClient
    || jest.fn((instance) => clients[instance.name]);
  const server = await createMcpServer(primaryClient, {
    configManager: manager,
    createServiceNowClient
  });

  return {
    primaryClient,
    manager,
    clients,
    createServiceNowClient,
    listTools: server._requestHandlers.get('tools/list'),
    callTool: server._requestHandlers.get('tools/call')
  };
}

describe('per-call instance schemas', () => {
  test('adds optional instance to every live ServiceNow operation', async () => {
    const { listTools } = await createHarness();
    const result = await listTools({ method: 'tools/list', params: {} }, {});

    for (const tool of result.tools) {
      if (tool.name.startsWith('SN-Docs-') || INSTANCE_MANAGEMENT_TOOLS.has(tool.name)) {
        expect(tool.inputSchema.properties.instance).toBeUndefined();
        continue;
      }

      expect(tool.inputSchema.properties.instance).toEqual({
        type: 'string',
        description: 'Configured ServiceNow instance name. Optional; uses the current instance when omitted.'
      });
      expect(tool.inputSchema.required || []).not.toContain('instance');
    }
  });
});
