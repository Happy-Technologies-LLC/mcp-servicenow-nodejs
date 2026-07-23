/**
 * Tests for ConfigManager.loadFromEnv() - OAuth client_credentials path
 *
 * Validates:
 * - SERVICENOW_OAUTH_GRANT_TYPE=client_credentials makes USERNAME/PASSWORD optional
 * - Grant type is propagated to the instance config so it reaches ServiceNowClient
 * - Original behaviour (basic auth, ROPC password grant) still requires USERNAME/PASSWORD
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InstanceRegistry } from '../src/instance-registry.js';
import { jest } from '@jest/globals';
import { ConfigManager, instanceToClientOptions } from '../src/config-manager.js';

describe('instanceToClientOptions()', () => {
  it('maps oauth authorization_code fields including the loopback config', () => {
    const opts = instanceToClientOptions({
      authType: 'oauth',
      clientId: 'cid',
      clientSecret: 'csec',
      grantType: 'authorization_code',
      scope: 'useraccount',
      authorizeUrl: 'https://x/oauth_auth.do',
      tokenUrl: 'https://x/oauth_token.do',
      redirectPort: 8455,
      callbackPath: '/callback'
    });
    expect(opts).toMatchObject({
      authType: 'oauth',
      clientId: 'cid',
      clientSecret: 'csec',
      grantType: 'authorization_code',
      scope: 'useraccount',
      authorizeUrl: 'https://x/oauth_auth.do',
      tokenUrl: 'https://x/oauth_token.do',
      redirectPort: 8455,
      callbackPath: '/callback'
    });
  });

  it('defaults authType to basic when the instance does not set it', () => {
    expect(instanceToClientOptions({}).authType).toBe('basic');
  });
});

describe('ConfigManager.validateInstance()', () => {
  it('accepts a public authorization_code client without a secret or password', () => {
    const cm = new ConfigManager();

    expect(cm.validateInstance({
      name: 'public-oauth',
      url: 'https://example.service-now.com',
      authType: 'oauth',
      grantType: 'authorization_code',
      clientId: 'public-client-id'
    })).toBe(true);
  });
});

describe('ConfigManager.loadFromEnv()', () => {
  const originalEnv = process.env;
  const basicAuthFixture = {
    user: 'unit-test-user',
    secret: 'unit-test-non-secret'
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SERVICENOW_INSTANCE_URL;
    delete process.env.SERVICENOW_USERNAME;
    delete process.env.SERVICENOW_PASSWORD;
    delete process.env.SERVICENOW_AUTH_TYPE;
    delete process.env.SERVICENOW_CLIENT_ID;
    delete process.env.SERVICENOW_CLIENT_SECRET;
    delete process.env.SERVICENOW_OAUTH_GRANT_TYPE;
    delete process.env.SERVICENOW_OAUTH_SCOPE;
    delete process.env.SERVICENOW_OAUTH_AUTHORIZE_URL;
    delete process.env.SERVICENOW_OAUTH_TOKEN_URL;
    delete process.env.SERVICENOW_OAUTH_REDIRECT_PORT;
    delete process.env.SERVICENOW_OAUTH_CALLBACK_PATH;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('basic auth (default)', () => {
    it('requires USERNAME and PASSWORD', () => {
      process.env.SERVICENOW_INSTANCE_URL = 'https://example.service-now.com';
      const cm = new ConfigManager();
      expect(() => cm.loadFromEnv()).toThrow(/Missing ServiceNow credentials/);
    });

    it('loads instance with username and password set', () => {
      process.env.SERVICENOW_INSTANCE_URL = 'https://example.service-now.com';
      process.env.SERVICENOW_USERNAME = basicAuthFixture.user;
      process.env.SERVICENOW_PASSWORD = basicAuthFixture.secret;
      const cm = new ConfigManager();
      const [instance] = cm.loadFromEnv();
      expect(instance.username).toBe(basicAuthFixture.user);
      expect(instance.password).toBe(basicAuthFixture.secret);
      expect(instance.authType).toBeUndefined();
      expect(instance.grantType).toBeUndefined();
    });
  });

  describe('OAuth password grant (ROPC)', () => {
    it('still requires USERNAME and PASSWORD', () => {
      process.env.SERVICENOW_INSTANCE_URL = 'https://example.service-now.com';
      process.env.SERVICENOW_AUTH_TYPE = 'oauth';
      process.env.SERVICENOW_OAUTH_GRANT_TYPE = 'password';
      process.env.SERVICENOW_CLIENT_ID = 'cid';
      process.env.SERVICENOW_CLIENT_SECRET = 'csec';
      const cm = new ConfigManager();
      expect(() => cm.loadFromEnv()).toThrow(/Missing ServiceNow credentials/);
    });

    it('propagates grantType to the instance config', () => {
      process.env.SERVICENOW_INSTANCE_URL = 'https://example.service-now.com';
      process.env.SERVICENOW_USERNAME = basicAuthFixture.user;
      process.env.SERVICENOW_PASSWORD = basicAuthFixture.secret;
      process.env.SERVICENOW_AUTH_TYPE = 'oauth';
      process.env.SERVICENOW_OAUTH_GRANT_TYPE = 'password';
      process.env.SERVICENOW_CLIENT_ID = 'cid';
      process.env.SERVICENOW_CLIENT_SECRET = 'csec';
      const cm = new ConfigManager();
      const [instance] = cm.loadFromEnv();
      expect(instance.authType).toBe('oauth');
      expect(instance.grantType).toBe('password');
      expect(instance.clientId).toBe('cid');
      expect(instance.clientSecret).toBe('csec');
    });
  });

  describe('OAuth client_credentials grant', () => {
    it('does NOT require USERNAME or PASSWORD', () => {
      process.env.SERVICENOW_INSTANCE_URL = 'https://example.service-now.com';
      process.env.SERVICENOW_AUTH_TYPE = 'oauth';
      process.env.SERVICENOW_OAUTH_GRANT_TYPE = 'client_credentials';
      process.env.SERVICENOW_CLIENT_ID = 'cid';
      process.env.SERVICENOW_CLIENT_SECRET = 'csec';
      const cm = new ConfigManager();
      const [instance] = cm.loadFromEnv();
      expect(instance.url).toBe('https://example.service-now.com');
      expect(instance.username).toBe('');
      expect(instance.password).toBe('');
      expect(instance.authType).toBe('oauth');
      expect(instance.grantType).toBe('client_credentials');
      expect(instance.clientId).toBe('cid');
      expect(instance.clientSecret).toBe('csec');
    });

    it('still requires SERVICENOW_INSTANCE_URL', () => {
      process.env.SERVICENOW_AUTH_TYPE = 'oauth';
      process.env.SERVICENOW_OAUTH_GRANT_TYPE = 'client_credentials';
      process.env.SERVICENOW_CLIENT_ID = 'cid';
      process.env.SERVICENOW_CLIENT_SECRET = 'csec';
      const cm = new ConfigManager();
      expect(() => cm.loadFromEnv()).toThrow(/Missing ServiceNow credentials/);
    });

    it('passes through SERVICENOW_OAUTH_SCOPE when set', () => {
      process.env.SERVICENOW_INSTANCE_URL = 'https://example.service-now.com';
      process.env.SERVICENOW_AUTH_TYPE = 'oauth';
      process.env.SERVICENOW_OAUTH_GRANT_TYPE = 'client_credentials';
      process.env.SERVICENOW_CLIENT_ID = 'cid';
      process.env.SERVICENOW_CLIENT_SECRET = 'csec';
      process.env.SERVICENOW_OAUTH_SCOPE = 'useraccount';
      const cm = new ConfigManager();
      const [instance] = cm.loadFromEnv();
      expect(instance.scope).toBe('useraccount');
    });
  });

  describe('OAuth authorization_code grant (per-user)', () => {
    it('does NOT require USERNAME or PASSWORD (browser sign-in supplies identity)', () => {
      process.env.SERVICENOW_INSTANCE_URL = 'https://example.service-now.com';
      process.env.SERVICENOW_AUTH_TYPE = 'oauth';
      process.env.SERVICENOW_OAUTH_GRANT_TYPE = 'authorization_code';
      process.env.SERVICENOW_CLIENT_ID = 'cid';
      const cm = new ConfigManager();
      const [instance] = cm.loadFromEnv();
      expect(instance.authType).toBe('oauth');
      expect(instance.grantType).toBe('authorization_code');
      expect(instance.clientId).toBe('cid');
    });

    it('propagates the authorize/token endpoints and loopback config to the instance', () => {
      process.env.SERVICENOW_INSTANCE_URL = 'https://example.service-now.com';
      process.env.SERVICENOW_AUTH_TYPE = 'oauth';
      process.env.SERVICENOW_OAUTH_GRANT_TYPE = 'authorization_code';
      process.env.SERVICENOW_CLIENT_ID = 'cid';
      process.env.SERVICENOW_OAUTH_AUTHORIZE_URL = 'https://example.service-now.com/oauth_auth.do';
      process.env.SERVICENOW_OAUTH_TOKEN_URL = 'https://example.service-now.com/oauth_token.do';
      process.env.SERVICENOW_OAUTH_REDIRECT_PORT = '8455';
      process.env.SERVICENOW_OAUTH_CALLBACK_PATH = '/callback';
      const cm = new ConfigManager();
      const [instance] = cm.loadFromEnv();
      expect(instance.authorizeUrl).toBe('https://example.service-now.com/oauth_auth.do');
      expect(instance.tokenUrl).toBe('https://example.service-now.com/oauth_token.do');
      expect(instance.redirectPort).toBe(8455);
      expect(instance.callbackPath).toBe('/callback');
    });

    it('throws a clear error when SERVICENOW_OAUTH_REDIRECT_PORT is not a number', () => {
      process.env.SERVICENOW_INSTANCE_URL = 'https://example.service-now.com';
      process.env.SERVICENOW_AUTH_TYPE = 'oauth';
      process.env.SERVICENOW_OAUTH_GRANT_TYPE = 'authorization_code';
      process.env.SERVICENOW_CLIENT_ID = 'cid';
      process.env.SERVICENOW_OAUTH_REDIRECT_PORT = 'not-a-port';
      const cm = new ConfigManager();
      expect(() => cm.loadFromEnv()).toThrow(/redirect port/i);
    });
  });

  describe('missing-credentials error message', () => {
    it('mentions authorization_code as an exempt grant type', () => {
      process.env.SERVICENOW_INSTANCE_URL = 'https://example.service-now.com';
      process.env.SERVICENOW_AUTH_TYPE = 'oauth';
      process.env.SERVICENOW_OAUTH_GRANT_TYPE = 'password';
      const cm = new ConfigManager();
      expect(() => cm.loadFromEnv()).toThrow(/authorization_code/);
    });
  });
});

describe('ConfigManager registry facade', () => {
  test('delegates synchronous reads, validation, and reload to the injected registry', () => {
    const instances = [{ name: 'dev', url: 'https://dev.service-now.com', default: true }];
    const registry = {
      load: jest.fn(() => ({ version: 1, instances })),
      reload: jest.fn(() => ({ version: 1, instances })),
      get: jest.fn(() => instances[0]),
      getDefault: jest.fn(() => instances[0]),
      list: jest.fn(() => instances),
      validate: jest.fn(() => true),
      hasFile: jest.fn(() => true)
    };
    const cm = new ConfigManager({ registry });

    expect(cm.loadInstances()).toBe(instances);
    expect(cm.getInstance('dev')).toBe(instances[0]);
    expect(cm.getDefaultInstance()).toBe(instances[0]);
    expect(cm.listInstances()).toEqual([{
      name: 'dev',
      url: 'https://dev.service-now.com',
      default: true,
      description: ''
    }]);
    expect(cm.validateInstance(instances[0])).toBe(true);
    expect(cm.reload()).toBe(instances);
    expect(registry.load).toHaveBeenCalledTimes(1);
    expect(registry.reload).toHaveBeenCalledTimes(1);
    expect(registry.get).toHaveBeenCalledWith('dev');
    expect(registry.getDefault).toHaveBeenCalledTimes(1);
    expect(registry.list).toHaveBeenCalledTimes(1);
    expect(registry.validate).toHaveBeenCalledWith(instances[0]);
  });

  test('falls back to environment credentials only when the registry file is absent', () => {
    const registry = {
      load: jest.fn(() => ({ version: 1, instances: [] })),
      hasFile: jest.fn(() => false)
    };
    process.env.SERVICENOW_INSTANCE_URL = 'https://env.service-now.com';
    process.env.SERVICENOW_USERNAME = 'env-user';
    process.env.SERVICENOW_PASSWORD = 'env-password-fixture';
    const cm = new ConfigManager({ registry });

    expect(cm.loadInstances()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'default', url: 'https://env.service-now.com' })
    ]));
    expect(registry.load).toHaveBeenCalledTimes(1);
  });

  test('uses the configured registry instead of environment fallback when a file exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'happy-config-manager-'));
    const file = path.join(dir, 'instances.json');
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      instances: [{
        name: 'configured',
        url: 'https://configured.service-now.com',
        authType: 'oauth',
        grantType: 'authorization_code',
        clientId: 'configured-client',
        default: true
      }]
    }));
    process.env.SERVICENOW_INSTANCE_URL = 'https://env.service-now.com';
    process.env.SERVICENOW_USERNAME = 'env-user';
    process.env.SERVICENOW_PASSWORD = 'env-password-fixture';
    const cm = new ConfigManager({
      registry: new InstanceRegistry({ readPath: file, writePath: file })
    });

    expect(cm.getDefaultInstance().name).toBe('configured');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
