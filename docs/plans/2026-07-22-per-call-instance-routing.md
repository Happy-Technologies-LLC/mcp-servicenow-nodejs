# Per-Call ServiceNow Instance Routing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let every live ServiceNow MCP operation accept an optional `instance` name and route concurrent explicit calls through isolated per-instance clients.

**Architecture:** The tool-list handler injects one shared optional `instance` schema into every eligible ServiceNow tool. The call handler resolves a request-scoped client: omitted selectors retain the injected primary client, while explicit selectors resolve configured instances through `ConfigManager` and reuse dedicated cached clients. `SN-Set-Instance` remains the backward-compatible sequential default switch.

**Tech Stack:** Node.js ES modules, Model Context Protocol SDK, Axios-backed `ServiceNowClient`, Jest 30.

---

### Task 1: Define the tool-schema contract

**Files:**
- Create: `tests/mcp-instance-routing.test.js`
- Modify: `src/mcp-server-consolidated.js:17-18`
- Modify: `src/mcp-server-consolidated.js:69-1373`

**Step 1: Write the failing schema test**

Create `tests/mcp-instance-routing.test.js` with helpers that invoke the server's registered MCP handlers directly:

```js
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
```

**Step 2: Run the focused test to verify it fails**

Run:

```bash
npm test -- tests/mcp-instance-routing.test.js --runInBand
```

Expected: FAIL because tools such as `SN-Query-Table` do not expose `instance`.

**Step 3: Add the shared schema transformer**

Add top-level constants before `createMcpServer`:

```js
const INSTANCE_MANAGEMENT_TOOLS = new Set([
  'SN-Set-Instance',
  'SN-Get-Current-Instance'
]);

const INSTANCE_PARAMETER_SCHEMA = Object.freeze({
  type: 'string',
  description: 'Configured ServiceNow instance name. Optional; uses the current instance when omitted.'
});

function addInstanceParameter(tools) {
  for (const tool of tools) {
    if (tool.name.startsWith('SN-Docs-') || INSTANCE_MANAGEMENT_TOOLS.has(tool.name)) {
      continue;
    }

    tool.inputSchema.properties.instance = INSTANCE_PARAMETER_SCHEMA;
  }

  return tools;
}
```

Change the tool-list return path to pass the newly-created tools array through `addInstanceParameter`. Do not alter docs-only mode.

**Step 4: Run the focused test to verify it passes**

Run:

```bash
npm test -- tests/mcp-instance-routing.test.js --runInBand
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/mcp-server-consolidated.js tests/mcp-instance-routing.test.js
git commit -m "feat(mcp): expose per-call instance selector"
```

### Task 2: Route default and explicit calls

**Files:**
- Modify: `tests/mcp-instance-routing.test.js`
- Modify: `src/mcp-server-consolidated.js:8-18`
- Modify: `src/mcp-server-consolidated.js:34-48`
- Modify: `src/mcp-server-consolidated.js:1375-1495`

**Step 1: Write failing routing tests**

Add these tests:

```js
describe('per-call instance routing', () => {
  test('uses the primary client when instance is omitted', async () => {
    const harness = await createHarness();

    await harness.callTool({
      method: 'tools/call',
      params: {
        name: 'SN-Query-Table',
        arguments: { table_name: 'incident' }
      }
    }, {});

    expect(harness.primaryClient.getRecords).toHaveBeenCalledWith('incident', expect.any(Object));
    expect(harness.createServiceNowClient).not.toHaveBeenCalled();
  });

  test('uses a dedicated configured client when instance is provided', async () => {
    const harness = await createHarness();

    await harness.callTool({
      method: 'tools/call',
      params: {
        name: 'SN-Query-Table',
        arguments: { table_name: 'incident', instance: 'prod' }
      }
    }, {});

    expect(harness.manager.getInstance).toHaveBeenCalledWith('prod');
    expect(harness.createServiceNowClient).toHaveBeenCalledWith(expect.objectContaining({ name: 'prod' }));
    expect(harness.clients.prod.getRecords).toHaveBeenCalledWith('incident', expect.any(Object));
    expect(harness.primaryClient.getRecords).not.toHaveBeenCalled();
  });

  test('routes writes through the explicit instance client', async () => {
    const harness = await createHarness();

    await harness.callTool({
      method: 'tools/call',
      params: {
        name: 'SN-Create-Record',
        arguments: {
          table_name: 'incident',
          data: { short_description: 'isolated write' },
          instance: 'dev'
        }
      }
    }, {});

    expect(harness.clients.dev.createRecord).toHaveBeenCalledWith(
      'incident',
      { short_description: 'isolated write' }
    );
    expect(harness.primaryClient.createRecord).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run the focused tests to verify explicit routing fails**

Run:

```bash
npm test -- tests/mcp-instance-routing.test.js --runInBand
```

Expected: the omitted-instance test passes; explicit read and write tests fail because both still call the primary client.

**Step 3: Add client construction and resolution**

Import `ServiceNowClient` and add an explicit factory inside `createMcpServer`:

```js
import { ServiceNowClient } from './servicenow-client.js';

export async function createMcpServer(serviceNowClient, options = {}) {
  const docsOnly = options.docsOnly === true;
  const instanceManager = options.configManager || configManager;
  const createServiceNowClient = options.createServiceNowClient || ((instance) => {
    const client = new ServiceNowClient(
      instance.url,
      instance.username,
      instance.password,
      instanceToClientOptions(instance)
    );
    client.currentInstanceName = instance.name;
    return client;
  });
  const instanceClients = new Map();
```

Extract the current notification callback so both primary and named clients receive progress forwarding:

```js
  const configureProgress = (client) => {
    if (!client?.setProgressCallback) return;

    client.setProgressCallback((message) => {
      try {
        server.notification({
          method: 'notifications/progress',
          params: { progress: message }
        });
      } catch (error) {
        console.error('Failed to send progress notification:', error.message);
      }
    });
  };

  configureProgress(serviceNowClient);

  const resolveClient = (instanceName) => {
    if (!instanceName) return serviceNowClient;

    let client = instanceClients.get(instanceName);
    if (client) return client;

    const instance = instanceManager.getInstance(instanceName);
    client = createServiceNowClient(instance);
    client.currentInstanceName = instance.name;
    configureProgress(client);
    instanceClients.set(instanceName, client);
    return client;
  };
```

After docs-only validation in the call handler, resolve one request-scoped client:

```js
      const requestClient = resolveClient(args?.instance);
```

Update the `SN-Query-Table` and `SN-Create-Record` cases to use `requestClient`.

Update `SN-Set-Instance` to resolve configuration through `instanceManager`; it must continue mutating only the primary `serviceNowClient`.

**Step 4: Run the focused tests to verify they pass**

Run:

```bash
npm test -- tests/mcp-instance-routing.test.js --runInBand
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/mcp-server-consolidated.js tests/mcp-instance-routing.test.js
git commit -m "feat(mcp): route calls by instance"
```

### Task 3: Migrate every ServiceNow operation to the request client

**Files:**
- Modify: `src/mcp-server-consolidated.js:1483-3002`
- Modify: `tests/mcp-instance-routing.test.js`

**Step 1: Add a failing non-core handler test**

Add a representative catalog client method to `createClient`:

```js
getCatalogCategories: jest.fn(async () => [])
```

Add the test:

```js
test('routes catalog operations through the explicit instance client', async () => {
  const harness = await createHarness();

  await harness.callTool({
    method: 'tools/call',
    params: {
      name: 'SN-Catalog-Get-Categories',
      arguments: { instance: 'prod' }
    }
  }, {});

  expect(harness.clients.prod.getCatalogCategories).toHaveBeenCalled();
  expect(harness.primaryClient.getCatalogCategories).not.toHaveBeenCalled();
});
```

**Step 2: Run the focused test to verify it fails**

Run:

```bash
npm test -- tests/mcp-instance-routing.test.js --runInBand
```

Expected: FAIL because the catalog handler still calls `serviceNowClient`.

**Step 3: Replace handler-local client usage**

Within the `CallToolRequestSchema` switch only, change every ServiceNow operation after the instance-management cases from `serviceNowClient` to `requestClient`. This includes direct CRUD, schema discovery, ITSM convenience operations, batch operations, update-set operations, workflow operations, background scripts, natural-language search, and catalog operations.

Do not change:

- Initial progress setup outside the call handler.
- `SN-Set-Instance`, which must call `serviceNowClient.setInstance`.
- `SN-Get-Current-Instance`, which must call `serviceNowClient.getCurrentInstance`.
- Resource handlers, which retain current-instance semantics.

**Step 4: Run the focused test to verify it passes**

Run:

```bash
npm test -- tests/mcp-instance-routing.test.js --runInBand
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/mcp-server-consolidated.js tests/mcp-instance-routing.test.js
git commit -m "refactor(mcp): isolate request client usage"
```

### Task 4: Prove cache, errors, concurrency, and compatibility

**Files:**
- Modify: `tests/mcp-instance-routing.test.js`

**Step 1: Add cache and invalid-instance tests**

```js
test('reuses one dedicated client per configured instance', async () => {
  const harness = await createHarness();
  const request = {
    method: 'tools/call',
    params: {
      name: 'SN-Query-Table',
      arguments: { table_name: 'incident', instance: 'prod' }
    }
  };

  await harness.callTool(request, {});
  await harness.callTool(request, {});

  expect(harness.createServiceNowClient).toHaveBeenCalledTimes(1);
  expect(harness.clients.prod.getRecords).toHaveBeenCalledTimes(2);
});

test('rejects an unknown instance before an outbound call', async () => {
  const harness = await createHarness();

  const result = await harness.callTool({
    method: 'tools/call',
    params: {
      name: 'SN-Query-Table',
      arguments: { table_name: 'incident', instance: 'missing' }
    }
  }, {});

  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain("Instance 'missing' not found");
  expect(harness.primaryClient.getRecords).not.toHaveBeenCalled();
  expect(harness.createServiceNowClient).not.toHaveBeenCalled();
});
```

**Step 2: Add a concurrent isolation test**

```js
test('keeps simultaneous explicit instance calls isolated', async () => {
  const harness = await createHarness();

  await Promise.all([
    harness.callTool({
      method: 'tools/call',
      params: {
        name: 'SN-Query-Table',
        arguments: { table_name: 'incident', query: 'state=1', instance: 'dev' }
      }
    }, {}),
    harness.callTool({
      method: 'tools/call',
      params: {
        name: 'SN-Query-Table',
        arguments: { table_name: 'change_request', query: 'active=true', instance: 'prod' }
      }
    }, {})
  ]);

  expect(harness.clients.dev.getRecords).toHaveBeenCalledWith(
    'incident',
    expect.objectContaining({ sysparm_query: 'state=1' })
  );
  expect(harness.clients.prod.getRecords).toHaveBeenCalledWith(
    'change_request',
    expect.objectContaining({ sysparm_query: 'active=true' })
  );
  expect(harness.primaryClient.setInstance).not.toHaveBeenCalled();
});
```

**Step 3: Add the `SN-Set-Instance` regression test**

```js
test('keeps SN-Set-Instance as the sequential default switch', async () => {
  const harness = await createHarness();

  const result = await harness.callTool({
    method: 'tools/call',
    params: {
      name: 'SN-Set-Instance',
      arguments: { instance_name: 'prod' }
    }
  }, {});

  expect(result.isError).not.toBe(true);
  expect(harness.primaryClient.setInstance).toHaveBeenCalledWith(
    'https://prod.service-now.com',
    'prod-user',
    'prod-password',
    'prod',
    expect.objectContaining({ authType: 'basic' })
  );
  expect(harness.createServiceNowClient).not.toHaveBeenCalled();
});
```

**Step 4: Run the focused suite**

Run:

```bash
npm test -- tests/mcp-instance-routing.test.js --runInBand
```

Expected: PASS with all schema, routing, cache, error, concurrency, and compatibility tests.

**Step 5: Commit**

```bash
git add tests/mcp-instance-routing.test.js
git commit -m "test(mcp): cover concurrent instance routing"
```

### Task 5: Verify the changed contract end to end

**Files:**
- Verify: `src/mcp-server-consolidated.js`
- Verify: `tests/mcp-instance-routing.test.js`

**Step 1: Run directly affected tests**

Run:

```bash
npm test -- tests/mcp-instance-routing.test.js tests/config-manager.test.js tests/docs-tools.test.js tests/http-server.test.js --runInBand
```

Expected: PASS.

**Step 2: Run the full test suite**

Run:

```bash
npm test -- --runInBand
```

Expected: all suites pass.

**Step 3: Smoke-test two concurrent MCP calls**

Use the MCP call handler with an injected config manager and two mock clients. Invoke `SN-Query-Table` concurrently with `instance: "dev"` and `instance: "prod"`. Observe:

```text
dev -> incident
prod -> change_request
primary setInstance calls -> 0
client factory calls -> 2
```

Any cross-target call fails the smoke test.

**Step 4: Check diagnostics**

Run the JavaScript language-server diagnostics for:

```text
src/mcp-server-consolidated.js
tests/mcp-instance-routing.test.js
```

Expected: no new errors.

**Step 5: Commit any verification-only correction**

Only if verification required a source or test correction:

```bash
git add src/mcp-server-consolidated.js tests/mcp-instance-routing.test.js
git commit -m "fix(mcp): correct instance routing regression"
```
