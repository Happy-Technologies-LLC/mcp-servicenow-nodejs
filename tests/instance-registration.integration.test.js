import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { createMcpServer } from '../src/mcp-server-consolidated.js';
import { handleInstanceSetupTool } from '../src/instance-tools.js';
import { ConfigManager, instanceToClientOptions } from '../src/config-manager.js';
import { InstanceCredentialStore, credentialRefFor } from '../src/instance-credential-store.js';
import { InstanceRegistry } from '../src/instance-registry.js';
import { ServiceNowClient } from '../src/servicenow-client.js';

const tempDirs = [];
const serviceNowEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key === 'HAPPY_CONFIG_PATH' || key.startsWith('SERVICENOW_'))
);

function tempRegistryPath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'happy-instance-registration-integration-'));
  tempDirs.push(directory);
  return path.join(directory, 'instances.json');
}

function sanitizeServiceNowEnv() {
  for (const key of Object.keys(process.env)) {
    if (key === 'HAPPY_CONFIG_PATH' || key.startsWith('SERVICENOW_')) delete process.env[key];
  }
}

function restoreServiceNowEnv() {
  sanitizeServiceNowEnv();
  for (const [key, value] of Object.entries(serviceNowEnv)) process.env[key] = value;
}

function parseResponse(response) {
  return JSON.parse(response.content[0].text);
}

function callToolHandler(server, name, arguments_) {
  const handler = server._requestHandlers.get('tools/call');
  return handler({
    method: 'tools/call',
    params: { name, arguments: arguments_ }
  }, {});
}

function assertNoSecretFields(value) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoSecretFields(item);
    return;
  }
  expect(value).not.toHaveProperty('password');
  expect(value).not.toHaveProperty('clientSecret');
  for (const nested of Object.values(value)) assertNoSecretFields(nested);
}

describe('instance registration end-to-end', () => {
  beforeEach(() => {
    sanitizeServiceNowEnv();
  });

  afterEach(() => {
    restoreServiceNowEnv();
    for (const directory of tempDirs.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('registers, reloads, routes, and resolves Basic and client-credentials OAuth instances without persisting secrets', async () => {
    const registryPath = tempRegistryPath();
    const devRef = credentialRefFor('dev', 'password');
    const prodRef = credentialRefFor('prod', 'client-secret');
    const devCredential = 'fixture-dev-password';
    const prodCredential = 'fixture-prod-client-secret';
    const credentialValues = new Map();
    const createEntry = jest.fn(async (_service, account) => ({
      async setPassword(value) {
        credentialValues.set(account, value);
      },
      async getPassword() {
        return credentialValues.get(account);
      },
      async deletePassword() {
        return credentialValues.delete(account);
      }
    }));
    const credentialStore = new InstanceCredentialStore({ createEntry });

    expect(Object.keys(process.env).filter(key => key.startsWith('SERVICENOW_'))).toEqual([]);
    expect(fs.existsSync(registryPath)).toBe(false);

    const docsServer = await createMcpServer(null, { docsOnly: true });
    const docsTools = await docsServer._requestHandlers.get('tools/list')(
      { method: 'tools/list', params: {} }, {}
    );
    const registrationTools = docsTools.tools.filter(tool => tool.name === 'SN-Register-Instance');
    expect(registrationTools).toHaveLength(1);
    expect(registrationTools[0].inputSchema.additionalProperties).toBe(false);
    expect(registrationTools[0].inputSchema.properties.password).toBeUndefined();
    expect(registrationTools[0].inputSchema.properties.clientSecret).toBeUndefined();
    expect(registrationTools[0].inputSchema.properties.credentialRef).toBeUndefined();

    await credentialStore.setSecret(devRef, devCredential);
    await credentialStore.setSecret(prodRef, prodCredential);

    const registry = new InstanceRegistry({ readPath: registryPath, writePath: registryPath });
    const configManager = new ConfigManager({ registry });
    const registrationServer = await createMcpServer({ setProgressCallback() {} }, {
      configManager,
      instanceRegistry: registry,
      credentialStore
    });

    const devRegistration = parseResponse(await callToolHandler(registrationServer, 'SN-Register-Instance', {
      name: 'dev',
      url: 'https://dev.service-now.com',
      authType: 'basic',
      username: 'dev-user',
      makeDefault: true
    }));
    expect(devRegistration).toMatchObject({ success: true, restartRequired: false });
    assertNoSecretFields(devRegistration);

    const prodRegistration = parseResponse(await callToolHandler(registrationServer, 'SN-Register-Instance', {
      name: 'prod',
      url: 'https://prod.service-now.com',
      authType: 'oauth',
      grantType: 'client_credentials',
      clientId: 'prod-client',
      scope: 'api',
      makeDefault: false
    }));
    expect(prodRegistration).toMatchObject({ success: true, restartRequired: false });
    assertNoSecretFields(prodRegistration);

    const reloadedRegistry = new InstanceRegistry({ readPath: registryPath, writePath: registryPath });
    const reloadedConfigManager = new ConfigManager({ registry: reloadedRegistry });
    const reloadedInstances = reloadedConfigManager.loadInstances();
    expect(reloadedInstances.map(instance => instance.name).sort()).toEqual(['dev', 'prod']);
    expect(reloadedConfigManager.listInstances().map(instance => instance.name).sort()).toEqual(['dev', 'prod']);
    assertNoSecretFields(reloadedInstances);
    assertNoSecretFields(reloadedConfigManager.listInstances());
    expect(JSON.stringify(reloadedInstances)).not.toContain(devCredential);
    expect(JSON.stringify(reloadedInstances)).not.toContain(prodCredential);

    const rawRegistry = fs.readFileSync(registryPath, 'utf8');
    const persisted = JSON.parse(rawRegistry);
    expect(persisted.instances).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'dev', credentialRef: devRef }),
      expect.objectContaining({ name: 'prod', credentialRef: prodRef })
    ]));
    assertNoSecretFields(persisted);
    expect(rawRegistry).not.toContain(devCredential);
    expect(rawRegistry).not.toContain(prodCredential);

    const devInstance = reloadedRegistry.get('dev');
    const prodInstance = reloadedRegistry.get('prod');
    const requests = [];
    const previousAdapter = axios.defaults.adapter;
    axios.defaults.adapter = async (config) => {
      const request = {
        baseURL: config.baseURL,
        url: config.url,
        method: config.method,
        data: config.data,
        authorization: config.headers?.Authorization || config.headers?.authorization
      };
      requests.push(request);
      if (String(config.url).endsWith('/oauth_token.do')) {
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
          data: { access_token: 'fixture-prod-access-token', expires_in: 3600 }
        };
      }
      return {
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
        data: { result: [{ instance: config.baseURL }] }
      };
    };

    const devClient = new ServiceNowClient(
      devInstance.url,
      devInstance.username,
      devInstance.password,
      instanceToClientOptions(devInstance, { credentialStore })
    );
    devClient.currentInstanceName = devInstance.name;
    const prodClient = new ServiceNowClient(
      prodInstance.url,
      prodInstance.username,
      prodInstance.password,
      instanceToClientOptions(prodInstance, { credentialStore })
    );
    prodClient.currentInstanceName = prodInstance.name;

    try {
      const routedServer = await createMcpServer(devClient, {
        configManager: reloadedConfigManager,
        instanceRegistry: reloadedRegistry,
        credentialStore,
        createServiceNowClient: jest.fn(instance => ({ dev: devClient, prod: prodClient })[instance.name])
      });
      const [devQuery, prodQuery] = await Promise.all([
        callToolHandler(routedServer, 'SN-Query-Table', {
          instance: 'dev',
          table_name: 'incident'
        }),
        callToolHandler(routedServer, 'SN-Query-Table', {
          instance: 'prod',
          table_name: 'incident'
        })
      ]);
      expect(devQuery.isError).toBeUndefined();
      expect(prodQuery.isError).toBeUndefined();

      const devRequest = requests.find(request => request.baseURL === 'https://dev.service-now.com');
      expect(devRequest.authorization).toBe(
        `Basic ${Buffer.from(`dev-user:${devCredential}`).toString('base64')}`
      );

      const tokenRequest = requests.find(request => String(request.url).endsWith('/oauth_token.do'));
      expect(tokenRequest).toBeDefined();
      const tokenBody = new URLSearchParams(tokenRequest.data);
      expect(tokenBody.get('grant_type')).toBe('client_credentials');
      expect(tokenBody.get('client_id')).toBe('prod-client');
      expect(tokenBody.get('client_secret')).toBe(prodCredential);

      const prodRequest = requests.find(request => request.baseURL === 'https://prod.service-now.com');
      expect(prodRequest.authorization).toBe('Bearer fixture-prod-access-token');
    } finally {
      axios.defaults.adapter = previousAdapter;
    }

    const publicResult = parseResponse(await handleInstanceSetupTool('SN-Register-Instance', {
      name: 'public-web',
      url: 'https://public.service-now.com',
      authType: 'oauth',
      grantType: 'authorization_code',
      clientId: 'public-client',
      authorizeUrl: 'https://public.service-now.com/oauth/authorize',
      tokenUrl: 'https://public.service-now.com/oauth/token'
    }, {
      docsOnly: true,
      configManager: reloadedConfigManager,
      instanceRegistry: reloadedRegistry,
      credentialStore
    }));
    expect(publicResult).toMatchObject({ success: true, restartRequired: true });
    assertNoSecretFields(publicResult);
    expect(publicResult.metadata.credentialRef).toBeUndefined();

    await reloadedRegistry.remove('public-web');
    expect(reloadedRegistry.list().some(instance => instance.name === 'public-web')).toBe(false);
    await credentialStore.deleteSecret(devRef);
    await credentialStore.deleteSecret(prodRef);
    expect(credentialValues).toEqual(new Map());
  });
});
