/**
 * Happy MCP Server - Multi-Instance Configuration Manager
 *
 * Copyright (c) 2025 Happy Technologies LLC
 * Licensed under the MIT License - see LICENSE file for details
 */

import { InstanceRegistry } from './instance-registry.js';

/**
 * Map a loaded instance config to the options object ServiceNowClient expects.
 * Single source of truth so every call site (server, stdio, resources,
 * instance-switch) forwards the same auth fields — including the per-user
 * authorization_code loopback config.
 * @param {object} instance
 * @returns {object} ServiceNowClient options
 */
export function instanceToClientOptions(instance) {
  return {
    authType: instance.authType || 'basic',
    clientId: instance.clientId,
    clientSecret: instance.clientSecret,
    grantType: instance.grantType,
    scope: instance.scope,
    authorizeUrl: instance.authorizeUrl,
    tokenUrl: instance.tokenUrl,
    redirectPort: instance.redirectPort,
    callbackPath: instance.callbackPath
  };
}

export class ConfigManager {
  constructor(options = {}) {
    const injectedRegistry = options && typeof options.load === 'function'
      ? options
      : options.registry || options.instanceRegistry;
    this.registry = injectedRegistry || new InstanceRegistry();
    this.instances = null;
    this._usingEnvFallback = false;
  }

  loadInstances() {
    if (this.instances) {
      return this.instances;
    }

    let document;
    try {
      document = this.registry.load();
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'REGISTRY_FILE_NOT_FOUND') {
        this._usingEnvFallback = true;
        return this.loadFromEnv();
      }
      throw error;
    }

    const hasFile = typeof this.registry.hasFile === 'function'
      ? this.registry.hasFile()
      : true;
    if (!hasFile) {
      this._usingEnvFallback = true;
      return this.loadFromEnv();
    }

    this._usingEnvFallback = false;
    this.instances = document.instances || this.registry.list();
    return this.instances;
  }

  loadFromEnv() {
    const isOAuth = process.env.SERVICENOW_AUTH_TYPE === 'oauth';
    const grantType = process.env.SERVICENOW_OAUTH_GRANT_TYPE;
    const passwordlessGrant = grantType === 'client_credentials' || grantType === 'authorization_code';
    const requiresUserPass = !(isOAuth && passwordlessGrant);

    if (!process.env.SERVICENOW_INSTANCE_URL) {
      throw new Error('Missing ServiceNow credentials. Create config/servicenow-instances.json or set SERVICENOW_INSTANCE_URL (and SERVICENOW_USERNAME / SERVICENOW_PASSWORD unless SERVICENOW_OAUTH_GRANT_TYPE=client_credentials or authorization_code) in .env');
    }
    if (requiresUserPass && (!process.env.SERVICENOW_USERNAME || !process.env.SERVICENOW_PASSWORD)) {
      throw new Error('Missing ServiceNow credentials. Create config/servicenow-instances.json or set SERVICENOW_INSTANCE_URL, SERVICENOW_USERNAME, SERVICENOW_PASSWORD in .env (USERNAME and PASSWORD not required when SERVICENOW_AUTH_TYPE=oauth and SERVICENOW_OAUTH_GRANT_TYPE=client_credentials or authorization_code)');
    }

    const instance = {
      name: 'default',
      url: process.env.SERVICENOW_INSTANCE_URL,
      username: process.env.SERVICENOW_USERNAME || '',
      password: process.env.SERVICENOW_PASSWORD || '',
      default: true,
      description: 'Loaded from .env'
    };

    if (isOAuth) {
      instance.authType = 'oauth';
      instance.clientId = process.env.SERVICENOW_CLIENT_ID;
      instance.clientSecret = process.env.SERVICENOW_CLIENT_SECRET;
      instance.scope = process.env.SERVICENOW_OAUTH_SCOPE;
      if (grantType) {
        instance.grantType = grantType;
      }
      if (grantType === 'authorization_code') {
        instance.authorizeUrl = process.env.SERVICENOW_OAUTH_AUTHORIZE_URL;
        instance.tokenUrl = process.env.SERVICENOW_OAUTH_TOKEN_URL;
        if (process.env.SERVICENOW_OAUTH_REDIRECT_PORT) {
          const port = parseInt(process.env.SERVICENOW_OAUTH_REDIRECT_PORT, 10);
          if (Number.isNaN(port) || port < 0 || port > 65535) {
            throw new Error(`Invalid SERVICENOW_OAUTH_REDIRECT_PORT: "${process.env.SERVICENOW_OAUTH_REDIRECT_PORT}" is not a valid redirect port (0-65535).`);
          }
          instance.redirectPort = port;
        }
        instance.callbackPath = process.env.SERVICENOW_OAUTH_CALLBACK_PATH;
      }
    }

    this.instances = [instance];
    return this.instances;
  }

  reload() {
    this.instances = null;
    this._usingEnvFallback = false;
    const document = this.registry.reload();
    const hasFile = typeof this.registry.hasFile === 'function'
      ? this.registry.hasFile()
      : true;
    if (!hasFile) {
      this._usingEnvFallback = true;
      return this.loadFromEnv();
    }
    this.instances = document.instances || this.registry.list();
    return this.instances;
  }

  getInstance(name) {
    const instances = this.loadInstances();
    if (this._usingEnvFallback) {
      const instance = instances.find(candidate => candidate.name === name);
      if (!instance) {
        throw new Error(`Instance '${name}' not found. Available instances: ${instances.map(i => i.name).join(', ')}`);
      }
      return instance;
    }
    return this.registry.get(name);
  }

  getDefaultInstance() {
    const instances = this.loadInstances();
    if (this._usingEnvFallback) {
      return instances.find(instance => instance.default === true) || instances[0];
    }
    return this.registry.getDefault();
  }

  getInstanceOrDefault(name = null) {
    if (name) {
      return this.getInstance(name);
    }

    const envInstance = process.env.SERVICENOW_INSTANCE;
    if (envInstance) {
      return this.getInstance(envInstance);
    }

    return this.getDefaultInstance();
  }

  listInstances() {
    const instances = this.loadInstances();
    const source = this._usingEnvFallback ? instances : this.registry.list();
    return source.map(instance => ({
      name: instance.name,
      url: instance.url,
      default: instance.default || false,
      description: instance.description || ''
    }));
  }

  validateInstance(instance) {
    return this.registry.validate(instance);
  }
}

// Singleton instance
export const configManager = new ConfigManager();
