import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { createMcpServer } from '../src/mcp-server-consolidated.js';
import { credentialRefFor } from '../src/instance-credential-store.js';
import { InstanceRegistry } from '../src/instance-registry.js';

const tempDirs = [];

function tempRegistryPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'happy-mcp-registration-'));
  tempDirs.push(dir);
  return path.join(dir, 'instances.json');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function parseResponse(response) {
  return JSON.parse(response.content[0].text);
}

async function createHarness({ docsOnly = false, credentialStore, reload = true } = {}) {
  const registry = new InstanceRegistry({
    readPath: tempRegistryPath(),
    writePath: tempRegistryPath()
  });
  // Keep the read and write paths identical so assertions observe the committed registry.
  registry.readPath = registry.writePath;
  const configManager = {
    registry,
    reload: jest.fn(() => {
      if (reload) return registry.reload();
      throw new Error('configuration reload failed with secret-value');
    })
  };
  const store = credentialStore || { hasSecret: jest.fn(async () => true) };
  const server = await createMcpServer({ setProgressCallback() {} }, {
    docsOnly,
    configManager,
    instanceRegistry: registry,
    credentialStore: store
  });
  const listTools = server._requestHandlers.get('tools/list');
  const callTool = server._requestHandlers.get('tools/call');
  return {
    registry,
    configManager,
    credentialStore: store,
    listTools: () => listTools({ method: 'tools/list', params: {} }, {}),
    callTool: (name, args) => callTool({
      method: 'tools/call',
      params: { name, arguments: args }
    }, {})
  };
}

const publicMetadata = (name = 'dev') => ({
  name,
  url: `https://${name}.service-now.com`,
  authType: 'oauth',
  grantType: 'authorization_code',
  clientId: 'public-client',
  makeDefault: true
});

describe('SN-Register-Instance', () => {
  test('appears once in normal and docs-only tool lists with metadata-only schema', async () => {
    const normal = await createHarness();
    const docsOnly = await createHarness({ docsOnly: true });

    for (const tools of [
      (await normal.listTools()).tools,
      (await docsOnly.listTools()).tools
    ]) {
      const definitions = tools.filter(tool => tool.name === 'SN-Register-Instance');
      expect(definitions).toHaveLength(1);
      expect(definitions[0].inputSchema.additionalProperties).toBe(false);
      expect(Object.keys(definitions[0].inputSchema.properties).sort()).toEqual([
        'authType',
        'authorizeUrl',
        'callbackPath',
        'clientId',
        'description',
        'grantType',
        'makeDefault',
        'name',
        'redirectPort',
        'scope',
        'tokenUrl',
        'url',
        'username'
      ].sort());
      expect(definitions[0].inputSchema.properties).not.toHaveProperty('password');
      expect(definitions[0].inputSchema.properties).not.toHaveProperty('clientSecret');
    }
  });

  test('registers public authorization-code metadata and reloads normal configuration once', async () => {
    const harness = await createHarness();
    const result = await harness.callTool('SN-Register-Instance', publicMetadata());
    const payload = parseResponse(result);

    expect(payload).toMatchObject({ success: true, restartRequired: false });
    expect(payload.metadata).toMatchObject({ name: 'dev', clientId: 'public-client' });
    expect(harness.configManager.reload).toHaveBeenCalledTimes(1);
    expect(harness.registry.list()).toEqual([
      expect.objectContaining({ name: 'dev', default: true })
    ]);
    expect(JSON.stringify(result)).not.toMatch(/password|clientSecret|fixture-secret/i);
  });

  test('allows docs-only registration but asks the process to restart', async () => {
    const harness = await createHarness({ docsOnly: true });
    const result = await harness.callTool('SN-Register-Instance', publicMetadata());
    const payload = parseResponse(result);

    expect(payload).toMatchObject({
      success: true,
      restartRequired: true,
      message: 'Instance registered. Restart the MCP server to enable live ServiceNow tools.'
    });
    expect(harness.configManager.reload).toHaveBeenCalledTimes(1);
  });

  test('dispatches setup before the docs-only rejection guard', async () => {
    const harness = await createHarness({ docsOnly: true });
    const result = await harness.callTool('SN-Set-Instance', { instance_name: 'dev' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('unavailable in docs-only mode');
  });

  test('requires an existing basic password credential without mutating the registry', async () => {
    const store = { hasSecret: jest.fn(async () => false) };
    const harness = await createHarness({ credentialStore: store });
    const result = await harness.callTool('SN-Register-Instance', {
      name: 'dev',
      url: 'https://dev.service-now.com',
      authType: 'basic',
      username: 'developer'
    });
    const payload = parseResponse(result);

    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      success: false,
      code: 'CREDENTIAL_NOT_FOUND',
      commands: ['happy-platform-mcp instance credential set dev --type password']
    });
    expect(harness.registry.list()).toEqual([]);
    expect(harness.configManager.reload).not.toHaveBeenCalled();
    expect(store.hasSecret).toHaveBeenCalledWith(credentialRefFor('dev', 'password'));
  });

  test.each([
    ['client_credentials', 'client-secret'],
    ['password', 'password']
  ])('requires existing %s credentials', async (grantType, type) => {
    const store = { hasSecret: jest.fn(async () => false) };
    const harness = await createHarness({ credentialStore: store });
    const metadata = {
      name: grantType === 'password' ? 'password-grant' : 'client-grant',
      url: 'https://oauth.service-now.com',
      authType: 'oauth',
      grantType,
      clientId: 'client-id',
      ...(grantType === 'password' ? { username: 'user' } : {})
    };
    const result = await harness.callTool('SN-Register-Instance', metadata);
    const payload = parseResponse(result);

    expect(result.isError).toBe(true);
    expect(payload.code).toBe('CREDENTIAL_NOT_FOUND');
    if (grantType === 'client_credentials') {
      expect(payload.commands).toEqual([
        'happy-platform-mcp instance credential set client-grant --type client-secret'
      ]);
    } else {
      expect(payload.commands).toEqual([
        'happy-platform-mcp instance credential set password-grant --type password',
        'happy-platform-mcp instance credential set password-grant --type client-secret'
      ]);
    }
    expect(harness.registry.list()).toEqual([]);
    expect(type).toBeTruthy();
  });

  test('attaches deterministic existing credential references for all credentialed grants', async () => {
    const store = { hasSecret: jest.fn(async () => true) };
    const harness = await createHarness({ credentialStore: store });
    await harness.callTool('SN-Register-Instance', {
      name: 'basic',
      url: 'https://basic.service-now.com',
      authType: 'basic',
      username: 'user'
    });
    await harness.callTool('SN-Register-Instance', {
      name: 'client',
      url: 'https://client.service-now.com',
      authType: 'oauth',
      grantType: 'client_credentials',
      clientId: 'client-id'
    });
    await harness.callTool('SN-Register-Instance', {
      name: 'password',
      url: 'https://password.service-now.com',
      authType: 'oauth',
      grantType: 'password',
      clientId: 'client-id',
      username: 'user'
    });

    expect(harness.registry.get('basic').credentialRef)
      .toBe(credentialRefFor('basic', 'password'));
    expect(harness.registry.get('client').credentialRef)
      .toBe(credentialRefFor('client', 'client-secret'));
    expect(harness.registry.get('password').credentialRef).toEqual({
      password: credentialRefFor('password', 'password'),
      clientSecret: credentialRefFor('password', 'client-secret')
    });
    expect(harness.configManager.reload).toHaveBeenCalledTimes(3);
  });

  test('rejects secret-shaped and unknown nested keys when schema validation is bypassed', async () => {
    const harness = await createHarness();
    for (const args of [
      { ...publicMetadata('secret-key'), password: 'fixture-secret' },
      { ...publicMetadata('nested-key'), nested: { clientSecret: 'fixture-secret' } }
    ]) {
      const result = await harness.callTool('SN-Register-Instance', args);
      const payload = parseResponse(result);
      expect(result.isError).toBe(true);
      expect(payload.code).toBe('INVALID_INSTANCE_CONFIG');
      expect(JSON.stringify(result)).not.toContain('fixture-secret');
    }
    expect(harness.registry.list()).toEqual([]);
    expect(harness.configManager.reload).not.toHaveBeenCalled();
  });

  test('rejects a grant type on basic authentication before credential lookup', async () => {
    const store = { hasSecret: jest.fn(async () => true) };
    const harness = await createHarness({ credentialStore: store });
    const result = await harness.callTool('SN-Register-Instance', {
      name: 'invalid-basic-grant',
      url: 'https://invalid.service-now.com',
      authType: 'basic',
      grantType: 'authorization_code',
      username: 'user'
    });
    const payload = parseResponse(result);

    expect(result.isError).toBe(true);
    expect(payload.code).toBe('INVALID_INSTANCE_CONFIG');
    expect(store.hasSecret).not.toHaveBeenCalled();
    expect(harness.registry.list()).toEqual([]);
  });

  test('rejects a non-boolean makeDefault when schema validation is bypassed', async () => {
    const harness = await createHarness();
    const result = await harness.callTool('SN-Register-Instance', {
      ...publicMetadata('invalid-default'),
      makeDefault: 'yes'
    });
    const payload = parseResponse(result);

    expect(result.isError).toBe(true);
    expect(payload.code).toBe('INVALID_INSTANCE_CONFIG');
    expect(harness.registry.list()).toEqual([]);
    expect(harness.configManager.reload).not.toHaveBeenCalled();
  });

  test('rejects duplicate names without replacing the existing metadata', async () => {
    const harness = await createHarness();
    const first = await harness.callTool('SN-Register-Instance', publicMetadata());
    const duplicate = await harness.callTool('SN-Register-Instance', {
      ...publicMetadata(),
      url: 'https://other.service-now.com',
      description: 'replacement'
    });
    const payload = parseResponse(duplicate);

    expect(parseResponse(first).success).toBe(true);
    expect(duplicate.isError).toBe(true);
    expect(payload.code).toBe('INSTANCE_ALREADY_EXISTS');
    expect(harness.registry.get('dev')).toEqual(expect.objectContaining({
      url: 'https://dev.service-now.com',
      clientId: 'public-client'
    }));
    expect(harness.configManager.reload).toHaveBeenCalledTimes(1);
  });

  test('does not mutate when credential backend fails and reports a safe error', async () => {
    const store = {
      hasSecret: jest.fn(async () => {
        throw new Error('keychain backend failed with fixture-secret');
      })
    };
    const harness = await createHarness({ credentialStore: store });
    const result = await harness.callTool('SN-Register-Instance', {
      name: 'broken-keychain',
      url: 'https://broken.service-now.com',
      authType: 'basic',
      username: 'user'
    });
    const payload = parseResponse(result);

    expect(result.isError).toBe(true);
    expect(payload.code).toBe('KEYCHAIN_UNAVAILABLE');
    expect(JSON.stringify(result)).not.toContain('fixture-secret');
    expect(harness.registry.list()).toEqual([]);
    expect(harness.configManager.reload).not.toHaveBeenCalled();
  });

  test('persists metadata but asks for restart when config reload fails', async () => {
    const harness = await createHarness({ reload: false });
    const result = await harness.callTool('SN-Register-Instance', publicMetadata());
    const payload = parseResponse(result);

    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      success: false,
      code: 'REGISTRY_RELOAD_FAILED',
      restartRequired: true
    });
    expect(payload.message).toMatch(/restart/i);
    expect(harness.registry.get('dev')).toEqual(expect.objectContaining({ name: 'dev' }));
    expect(JSON.stringify(result)).not.toContain('secret-value');
    expect(harness.configManager.reload).toHaveBeenCalledTimes(1);
  });

  test('serializes concurrent duplicate registrations', async () => {
    const harness = await createHarness();
    const [first, second] = await Promise.all([
      harness.callTool('SN-Register-Instance', publicMetadata()),
      harness.callTool('SN-Register-Instance', publicMetadata())
    ]);
    const payloads = [parseResponse(first), parseResponse(second)];

    expect(payloads.filter(payload => payload.success)).toHaveLength(1);
    expect(payloads.filter(payload => payload.code === 'INSTANCE_ALREADY_EXISTS')).toHaveLength(1);
    expect(harness.registry.list()).toHaveLength(1);
    expect(harness.configManager.reload).toHaveBeenCalledTimes(1);
  });
});
