import { describe, expect, jest, test } from '@jest/globals';
import { createMcpServer } from '../src/mcp-server-consolidated.js';
import { isInstanceSetupTool } from '../src/instance-tools.js';

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

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
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
      if (tool.name.startsWith('SN-Docs-') || INSTANCE_MANAGEMENT_TOOLS.has(tool.name) || isInstanceSetupTool(tool.name)) {
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

  test('reuses the cached prod client across explicit calls', async () => {
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

  test('returns an MCP error for an unknown instance without touching clients', async () => {
    const { primaryClient, createServiceNowClient, callTool } = await createHarness();

    const result = await callTool({
      method: 'tools/call',
      params: {
        name: 'SN-Query-Table',
        arguments: {
          instance: 'missing',
          table_name: 'incident',
          query: 'active=true'
        }
      }
    }, {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Instance 'missing' not found");
    expect(primaryClient.getRecords).not.toHaveBeenCalled();
    expect(createServiceNowClient).not.toHaveBeenCalled();
  });

  test('isolates overlapping dev and prod queries', async () => {
    const { primaryClient, clients, createServiceNowClient, callTool } = await createHarness();
    const devEntered = createDeferred();
    const prodEntered = createDeferred();
    const devRelease = createDeferred();
    const prodRelease = createDeferred();

    clients.dev.getRecords.mockImplementation(async (tableName) => {
      devEntered.resolve();
      await devRelease.promise;
      return [{ client: 'dev', table: tableName }];
    });
    clients.prod.getRecords.mockImplementation(async (tableName) => {
      prodEntered.resolve();
      await prodRelease.promise;
      return [{ client: 'prod', table: tableName }];
    });

    let devSettled = false;
    const devCall = callTool({
      method: 'tools/call',
      params: {
        name: 'SN-Query-Table',
        arguments: {
          instance: 'dev',
          table_name: 'incident',
          query: 'priority=1'
        }
      }
    }, {}).finally(() => {
      devSettled = true;
    });

    await devEntered.promise;
    const devWasPendingBeforeProd = !devSettled;

    let prodSettled = false;
    const prodCall = callTool({
      method: 'tools/call',
      params: {
        name: 'SN-Query-Table',
        arguments: {
          instance: 'prod',
          table_name: 'change_request',
          query: 'active=true'
        }
      }
    }, {}).finally(() => {
      prodSettled = true;
    });

    await prodEntered.promise;
    const callsOverlapped = !devSettled && !prodSettled;

    let prodResult;
    let devResult;
    let devWasPendingAfterProd;
    prodRelease.resolve();
    try {
      prodResult = await prodCall;
      devWasPendingAfterProd = !devSettled;
    } finally {
      devRelease.resolve();
      devResult = await devCall;
    }

    expect(devWasPendingBeforeProd).toBe(true);
    expect(callsOverlapped).toBe(true);
    expect(devWasPendingAfterProd).toBe(true);

    const devText = devResult.content[0].text;
    const prodText = prodResult.content[0].text;
    const devRows = JSON.parse(devText.slice(devText.indexOf('\n') + 1));
    const prodRows = JSON.parse(prodText.slice(prodText.indexOf('\n') + 1));

    expect(devRows).toEqual([{ client: 'dev', table: 'incident' }]);
    expect(prodRows).toEqual([{ client: 'prod', table: 'change_request' }]);
    expect(createServiceNowClient).toHaveBeenCalledTimes(2);
    expect(clients.dev.getRecords).toHaveBeenCalledWith('incident', {
      sysparm_limit: 25,
      sysparm_query: 'priority=1',
      sysparm_fields: undefined,
      sysparm_offset: undefined
    });
    expect(clients.prod.getRecords).toHaveBeenCalledWith('change_request', {
      sysparm_limit: 25,
      sysparm_query: 'active=true',
      sysparm_fields: undefined,
      sysparm_offset: undefined
    });
    expect(primaryClient.getRecords).not.toHaveBeenCalled();
    expect(primaryClient.setInstance).not.toHaveBeenCalled();
  });

  test('keeps a cached explicit client isolated from SN-Set-Instance', async () => {
    const { primaryClient, clients, createServiceNowClient, callTool } = await createHarness();
    const devRequest = {
      method: 'tools/call',
      params: {
        name: 'SN-Query-Table',
        arguments: {
          instance: 'dev',
          table_name: 'incident'
        }
      }
    };

    await callTool(devRequest, {});
    const setInstanceResult = await callTool({
      method: 'tools/call',
      params: {
        name: 'SN-Set-Instance',
        arguments: {
          instance_name: 'prod'
        }
      }
    }, {});
    await callTool(devRequest, {});

    expect(setInstanceResult.isError).not.toBe(true);
    const response = JSON.parse(setInstanceResult.content[0].text);
    expect(response.success).toBe(true);
    expect(response.instance.name).toBe('prod');
    expect(createServiceNowClient).toHaveBeenCalledTimes(1);
    expect(createServiceNowClient).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'dev' })
    );
    expect(clients.dev.getRecords).toHaveBeenCalledTimes(2);
    const expectedDevQuery = {
      sysparm_limit: 25,
      sysparm_query: undefined,
      sysparm_fields: undefined,
      sysparm_offset: undefined
    };
    expect(clients.dev.getRecords).toHaveBeenNthCalledWith(1, 'incident', expectedDevQuery);
    expect(clients.dev.getRecords).toHaveBeenNthCalledWith(2, 'incident', expectedDevQuery);
    expect(clients.prod.getRecords).not.toHaveBeenCalled();
    expect(clients.dev.currentInstanceName).toBe('dev');
    expect(primaryClient.setInstance).toHaveBeenCalledTimes(1);
    expect(primaryClient.setInstance).toHaveBeenCalledWith(
      'https://prod.service-now.com',
      'prod-user',
      'prod-password',
      'prod',
      expect.objectContaining({ authType: 'basic' })
    );
    expect(clients.dev.setInstance).not.toHaveBeenCalled();
    expect(clients.prod.setInstance).not.toHaveBeenCalled();
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
