/**
 * Tests for ConfigManager.loadFromEnv() - OAuth client_credentials path
 *
 * Validates:
 * - SERVICENOW_OAUTH_GRANT_TYPE=client_credentials makes USERNAME/PASSWORD optional
 * - Grant type is propagated to the instance config so it reaches ServiceNowClient
 * - Original behaviour (basic auth, ROPC password grant) still requires USERNAME/PASSWORD
 */

import { jest } from '@jest/globals';
import { ConfigManager } from '../src/config-manager.js';

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
});
