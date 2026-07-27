import { describe, expect, jest, test } from '@jest/globals';
import {
  createConfiguredMcpServer,
  shouldUseDocsOnlyMode
} from '../src/stdio-server.js';

describe('stdio docs-only startup', () => {
  test('uses docs-only mode when explicitly enabled', () => {
    expect(shouldUseDocsOnlyMode({ HAPPY_MCP_DOCS_ONLY: 'true' })).toBe(true);
  });

  test('does not use docs-only mode when ServiceNow credentials are present', () => {
    expect(shouldUseDocsOnlyMode({
      SERVICENOW_INSTANCE_URL: 'https://example.service-now.com',
      SERVICENOW_USERNAME: 'admin',
      SERVICENOW_PASSWORD: 'password'
    })).toBe(false);
  });

  test('does not force docs-only mode solely because env credentials are absent', () => {
    expect(shouldUseDocsOnlyMode({})).toBe(false);
  });

  test('creates docs-only MCP server without reading ServiceNow config', async () => {
    const manager = {
      getInstanceOrDefault: jest.fn(() => {
        throw new Error('should not load ServiceNow config');
      })
    };
    const createServer = jest.fn(async () => ({ id: 'server' }));

    const result = await createConfiguredMcpServer({
      env: { HAPPY_MCP_DOCS_ONLY: 'true' },
      manager,
      createServer
    });

    expect(result).toMatchObject({ docsOnly: true, instance: null });
    expect(manager.getInstanceOrDefault).not.toHaveBeenCalled();
    expect(createServer).toHaveBeenCalledWith(null, expect.objectContaining({
      docsOnly: true,
      configManager: manager,
      credentialStore: expect.any(Object)
    }));
  });
  test('forwards the selected manager registry and credential store to docs-only servers', async () => {
    const registry = { marker: 'registry' };
    const manager = { registry };
    const credentialStore = { marker: 'credential-store' };
    const createServer = jest.fn(async () => ({ id: 'server' }));

    await createConfiguredMcpServer({
      env: { HAPPY_MCP_DOCS_ONLY: 'true' },
      manager,
      credentialStore,
      createServer
    });

    expect(createServer).toHaveBeenCalledWith(null, {
      docsOnly: true,
      configManager: manager,
      instanceRegistry: registry,
      credentialStore
    });
  });

  test('production docs-only server advertises registration without touching keychain', async () => {
    const result = await createConfiguredMcpServer({
      env: { HAPPY_MCP_DOCS_ONLY: 'true' }
    });
    const listTools = result.server._requestHandlers.get('tools/list');
    const tools = await listTools({ method: 'tools/list', params: {} }, {});

    expect(tools.tools.filter(tool => tool.name === 'SN-Register-Instance')).toHaveLength(1);
    expect(result.docsOnly).toBe(true);
  });

  test('falls back to docs-only mode when ServiceNow config and env credentials are missing', async () => {
    const manager = {
      getInstanceOrDefault: jest.fn(() => {
        throw new Error('Missing ServiceNow credentials. Create config/servicenow-instances.json or set SERVICENOW_INSTANCE_URL, SERVICENOW_USERNAME, SERVICENOW_PASSWORD in .env');
      })
    };
    const createServer = jest.fn(async () => ({ id: 'server' }));

    const result = await createConfiguredMcpServer({
      env: {},
      manager,
      createServer
    });

    expect(result).toMatchObject({ docsOnly: true, instance: null });
    expect(manager.getInstanceOrDefault).toHaveBeenCalledWith(undefined);
    expect(createServer).toHaveBeenCalledWith(null, expect.objectContaining({
      docsOnly: true,
      configManager: manager,
      credentialStore: expect.any(Object)
    }));
  });

  test('creates full MCP server when ServiceNow credentials are configured', async () => {
    const instance = {
      name: 'dev',
      url: 'https://example.service-now.com',
      username: 'admin',
      password: 'password',
      default: true
    };
    const manager = {
      getInstanceOrDefault: jest.fn(() => instance)
    };
    const ServiceNowClientClass = jest.fn(function ServiceNowClientMock() {});
    const createServer = jest.fn(async () => ({ id: 'server' }));

    const result = await createConfiguredMcpServer({
      env: {
        SERVICENOW_INSTANCE_URL: instance.url,
        SERVICENOW_USERNAME: instance.username,
        SERVICENOW_PASSWORD: instance.password
      },
      manager,
      ServiceNowClientClass,
      createServer
    });

    expect(result).toMatchObject({ docsOnly: false, instance });
    expect(manager.getInstanceOrDefault).toHaveBeenCalledWith(undefined);
    expect(ServiceNowClientClass).toHaveBeenCalledWith(
      instance.url,
      instance.username,
      instance.password,
      expect.objectContaining({ authType: 'basic' })
    );
    expect(createServer).toHaveBeenCalledWith(expect.any(ServiceNowClientClass), expect.objectContaining({
      configManager: manager,
      credentialStore: expect.any(Object)
    }));
  });
  test('forwards manager and credential dependencies on normal startup', async () => {
    const instance = {
      name: 'dev',
      url: 'https://example.service-now.com',
      username: 'admin',
      password: 'password'
    };
    const registry = { marker: 'registry' };
    const manager = {
      registry,
      getInstanceOrDefault: jest.fn(() => instance)
    };
    const credentialStore = { marker: 'credential-store' };
    const ServiceNowClientClass = jest.fn(function ServiceNowClientMock() {});
    const createServer = jest.fn(async () => ({ id: 'server' }));

    await createConfiguredMcpServer({
      env: { SERVICENOW_INSTANCE_URL: instance.url },
      manager,
      credentialStore,
      ServiceNowClientClass,
      createServer
    });

    expect(createServer).toHaveBeenCalledWith(expect.any(ServiceNowClientClass), {
      configManager: manager,
      instanceRegistry: registry,
      credentialStore
    });
  });

  test('does NOT silently fall back to docs-only when a passwordless (authorization_code) config errors', async () => {
    const manager = {
      getInstanceOrDefault: jest.fn(() => {
        throw new Error('Missing ServiceNow credentials. Set SERVICENOW_INSTANCE_URL, ...');
      })
    };
    const createServer = jest.fn(async () => ({ id: 'server' }));

    // A passwordless grant is configured → the user clearly intends real SN,
    // so a config error must surface, not vanish into docs-only mode.
    await expect(createConfiguredMcpServer({
      env: {
        SERVICENOW_INSTANCE_URL: 'https://example.service-now.com',
        SERVICENOW_AUTH_TYPE: 'oauth',
        SERVICENOW_OAUTH_GRANT_TYPE: 'authorization_code'
      },
      manager,
      createServer
    })).rejects.toThrow(/Missing ServiceNow credentials/);
    expect(createServer).not.toHaveBeenCalled();
  });
});
