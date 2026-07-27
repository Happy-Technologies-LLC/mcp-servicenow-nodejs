/**
 * Happy MCP Server - Multi-Instance Configuration Manager
 *
 * Copyright (c) 2025 Happy Technologies LLC
 * Licensed under the MIT License - see LICENSE file for details
 */

import { InstanceRegistry, InstanceRegistryError, canonicalizeInstanceUrl } from './instance-registry.js';

const MISSING_INSTANCE_URL_ERROR = 'Missing ServiceNow credentials. Create config/servicenow-instances.json or set SERVICENOW_INSTANCE_URL (and SERVICENOW_USERNAME / SERVICENOW_PASSWORD unless SERVICENOW_OAUTH_GRANT_TYPE=client_credentials or authorization_code) in .env';
const MISSING_INSTANCE_CREDENTIALS_ERROR = 'Missing ServiceNow credentials. Create config/servicenow-instances.json or set SERVICENOW_INSTANCE_URL, SERVICENOW_USERNAME, SERVICENOW_PASSWORD in .env (USERNAME and PASSWORD not required when SERVICENOW_AUTH_TYPE=oauth and SERVICENOW_OAUTH_GRANT_TYPE=client_credentials or authorization_code)';

function isCredentialValidationError(error) {
  return error?.code === 'INVALID_INSTANCE_CONFIG'
    && /requires (?:clientId|username|credentialRef)|credential reference/i.test(error.message || '');
}

/**
 * Map a loaded instance config to the options object ServiceNowClient expects.
 * Single source of truth so every call site (server, stdio, resources,
 * instance-switch) forwards the same auth fields — including the per-user
 * authorization_code loopback config.
 * @param {object} instance
 * @param {object} options
 * @returns {object} ServiceNowClient options
 */
export function instanceToClientOptions(instance, options = {}) {
  return {
    authType: instance.authType || 'basic',
    clientId: instance.clientId,
    clientSecret: instance.clientSecret,
    password: instance.password,
    credentialRef: instance.credentialRef,
    credentialStore: options.credentialStore,
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
    this.instances = typeof this.registry._listForClient === 'function'
      ? this.registry._listForClient()
      : document.instances || this.registry.list();
    return this.instances;
  }

  loadFromEnv() {
    this._usingEnvFallback = true;
    const isOAuth = process.env.SERVICENOW_AUTH_TYPE === 'oauth';
    const grantType = process.env.SERVICENOW_OAUTH_GRANT_TYPE;
    const passwordlessGrant = grantType === 'client_credentials' || grantType === 'authorization_code';
    const requiresUserPass = !(isOAuth && passwordlessGrant);

    if (!process.env.SERVICENOW_INSTANCE_URL) {
      throw new Error(MISSING_INSTANCE_URL_ERROR);
    }
    if (requiresUserPass && (!process.env.SERVICENOW_USERNAME || !process.env.SERVICENOW_PASSWORD)) {
      throw new Error(MISSING_INSTANCE_CREDENTIALS_ERROR);
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
        const rawRedirectPort = process.env.SERVICENOW_OAUTH_REDIRECT_PORT;
        if (rawRedirectPort !== undefined) {
          const trimmedRedirectPort = rawRedirectPort.trim();
          if (!/^\d+$/.test(trimmedRedirectPort)) {
            throw new Error('Invalid SERVICENOW_OAUTH_REDIRECT_PORT: expected a decimal redirect port integer from 0 to 65535.');
          }
          const port = Number(trimmedRedirectPort);
          if (!Number.isInteger(port) || port < 0 || port > 65535) {
            throw new Error('Invalid SERVICENOW_OAUTH_REDIRECT_PORT: expected a decimal redirect port integer from 0 to 65535.');
          }
          instance.redirectPort = port;
        }
        instance.callbackPath = process.env.SERVICENOW_OAUTH_CALLBACK_PATH;
      }
    }

    const validationInstance = isOAuth && passwordlessGrant
      ? { ...instance, username: undefined, password: undefined }
      : instance;
    if (typeof this.registry.validate === 'function') {
      try {
        this.registry.validate(validationInstance);
      } catch (error) {
        if (isCredentialValidationError(error)) {
          throw new Error(MISSING_INSTANCE_CREDENTIALS_ERROR);
        }
        throw error;
      }
    }
    instance.url = canonicalizeInstanceUrl(instance.url);
    this.instances = [instance];
    return this.instances;
  }

  reload() {
    const previousInstances = this.instances;
    const previousUsingEnvFallback = this._usingEnvFallback;
    this.instances = null;
    this._usingEnvFallback = false;
    try {
      const document = this.registry.reload();
      const hasFile = typeof this.registry.hasFile === 'function'
        ? this.registry.hasFile()
        : true;
      if (!hasFile) {
        this._usingEnvFallback = true;
        return this.loadFromEnv();
      }
      this.instances = typeof this.registry._listForClient === 'function'
        ? this.registry._listForClient()
        : document.instances || this.registry.list();
      return this.instances;
    } catch (error) {
      this.instances = previousInstances;
      this._usingEnvFallback = previousUsingEnvFallback;
      throw error;
    }
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
    return typeof this.registry._getForClient === 'function'
      ? this.registry._getForClient(name)
      : this.registry.get(name);
  }

  getDefaultInstance() {
    const instances = this.loadInstances();
    const instance = this._usingEnvFallback
      ? (instances.find(candidate => candidate.default === true) || instances[0])
      : (typeof this.registry._getDefaultForClient === 'function'
        ? this.registry._getDefaultForClient()
        : this.registry.getDefault());
    if (!instance) {
      const path = this.registry.writePath || this.registry.readPath;
      throw new InstanceRegistryError(
        'REGISTRY_EMPTY',
        'Instance registry contains no instances',
        path ? { path } : {}
      );
    }
    return instance;
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
