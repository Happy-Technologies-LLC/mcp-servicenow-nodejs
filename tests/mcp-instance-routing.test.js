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
    createRecord: jest.fn(async () => ({ sys_id: `${name}-record` })),
    getCatalogCategories: jest.fn(async () => [])
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

describe('per-call instance routing', () => {
  test('uses the primary client and does not invoke the factory when instance is omitted', async () => {
    const { primaryClient, createServiceNowClient, callTool } = await createHarness();

    await callTool({
      method: 'tools/call',
      params: {
        name: 'SN-Query-Table',
        arguments: {
          table_name: 'incident',
          query: 'active=true'
        }
      }
    }, {});

    expect(primaryClient.getRecords).toHaveBeenCalledWith('incident', {
      sysparm_limit: 25,
      sysparm_query: 'active=true',
      sysparm_fields: undefined,
      sysparm_offset: undefined
    });
    expect(createServiceNowClient).not.toHaveBeenCalled();
  });

  test('routes SN-Query-Table through the explicitly selected prod client', async () => {
    const { primaryClient, clients, createServiceNowClient, callTool } = await createHarness();

    const request = {
      method: 'tools/call',
      params: {
        name: 'SN-Query-Table',
        arguments: {
          instance: 'prod',
          table_name: 'change_request',
          query: 'active=true'
        }
      }
    };

    await callTool(request, {});
    await callTool(request, {});

    expect(createServiceNowClient).toHaveBeenCalledTimes(1);
    expect(clients.prod.setProgressCallback).toHaveBeenCalledTimes(1);
    expect(clients.prod.getRecords).toHaveBeenCalledTimes(2);
    expect(clients.prod.getRecords).toHaveBeenCalledWith('change_request', {
      sysparm_limit: 25,
      sysparm_query: 'active=true',
      sysparm_fields: undefined,
      sysparm_offset: undefined
    });
    expect(primaryClient.getRecords).not.toHaveBeenCalled();
  });

  test('relabels a factory-created client to the explicitly selected instance', async () => {
    const injectedClient = createClient('default');
    const createServiceNowClient = jest.fn(() => injectedClient);
    const { callTool } = await createHarness({ createServiceNowClient });

    await callTool({
      method: 'tools/call',
      params: {
        name: 'SN-Query-Table',
        arguments: {
          instance: 'prod',
          table_name: 'incident'
        }
      }
    }, {});

    expect(injectedClient.currentInstanceName).toBe('prod');
  });

  test('routes SN-Create-Record through the explicitly selected dev client', async () => {
    const { primaryClient, clients, createServiceNowClient, callTool } = await createHarness();
    const data = { short_description: 'Created through dev' };

    await callTool({
      method: 'tools/call',
      params: {
        name: 'SN-Create-Record',
        arguments: {
          instance: 'dev',
          table_name: 'incident',
          data
        }
      }
    }, {});

    expect(createServiceNowClient).toHaveBeenCalledTimes(1);
    expect(clients.dev.createRecord).toHaveBeenCalledWith('incident', data);
    expect(primaryClient.createRecord).not.toHaveBeenCalled();
  });

  test('routes SN-Create-Incident without including instance in the record payload', async () => {
    const { primaryClient, clients, callTool } = await createHarness();
    const incident = { short_description: 'Created through prod' };

    await callTool({
      method: 'tools/call',
      params: {
        name: 'SN-Create-Incident',
        arguments: {
          instance: 'prod',
          ...incident
        }
      }
    }, {});

    expect(clients.prod.createRecord).toHaveBeenCalledWith('incident', incident);
    expect(primaryClient.createRecord).not.toHaveBeenCalled();
  });

  test('routes SN-Catalog-Get-Categories through the explicitly selected prod client', async () => {
    const { primaryClient, clients, callTool } = await createHarness();

    await callTool({
      method: 'tools/call',
      params: {
        name: 'SN-Catalog-Get-Categories',
        arguments: {
          instance: 'prod'
        }
      }
    }, {});

    expect(clients.prod.getCatalogCategories).toHaveBeenCalledTimes(1);
    expect(primaryClient.getCatalogCategories).not.toHaveBeenCalled();
  });

});
