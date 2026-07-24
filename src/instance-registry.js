import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfigPaths } from './config-path.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_LEGACY_PATH = path.resolve(__dirname, '../config/servicenow-instances.json');

const ALLOWED_FIELDS = new Set([
  'name', 'url', 'authType', 'grantType', 'username', 'clientId',
  'credentialRef', 'scope', 'authorizeUrl', 'tokenUrl', 'redirectPort',
  'callbackPath', 'default', 'description'
]);
const SECRET_FIELDS = new Set(['password', 'clientSecret']);
const GRANT_TYPES = new Set(['client_credentials', 'password', 'authorization_code']);
const AUTH_TYPES = new Set(['basic', 'oauth']);
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function hasSecretField(value, insideCredentialRef = false) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(nested => hasSecretField(nested, insideCredentialRef));
  return Object.entries(value).some(([key, nested]) => {
    if (!insideCredentialRef && SECRET_FIELDS.has(key)) return true;
    return hasSecretField(nested, insideCredentialRef || key === 'credentialRef');
  });
}

function invalid(message, details = {}) {
  throw new InstanceRegistryError('INVALID_INSTANCE_CONFIG', message, details);
}

function validateUrl(url, name) {
  if (typeof url !== 'string' || !url.trim()) {
    invalid(`Instance '${name || 'unknown'}' requires a URL`, { field: 'url' });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    invalid(`Instance '${name || 'unknown'}' has an invalid URL`, { field: 'url' });
  }
  if (parsed.username || parsed.password) {
    invalid(`Instance '${name || 'unknown'}' URL must not include username or password`, { field: 'url' });
  }

  if (parsed.protocol === 'https:') return;
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (parsed.protocol !== 'http:' || !loopbackHosts.has(hostname)) {
    invalid(`Instance '${name || 'unknown'}' must use HTTPS except for loopback HTTP`, { field: 'url' });
  }
}

function validateOptionalUrl(value, name, field) {
  if (typeof value !== 'string' || !value.trim()) {
    invalid(`Instance '${name}' ${field} must be a non-empty URL`, { field });
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    invalid(`Instance '${name}' ${field} must be a valid URL`, { field });
  }
  if (parsed.username || parsed.password) {
    invalid(`Instance '${name}' ${field} URL must not include username or password`, { field });
  }
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopbackHosts.has(hostname))) {
    invalid(`Instance '${name}' ${field} must use HTTPS except for loopback HTTP`, { field });
  }
}

function validateOptionalString(value, name, field) {
  if (typeof value !== 'string') {
    invalid(`Instance '${name}' ${field} must be a string`, { field });
  }
}

function validateNonEmptyString(value, name, field) {
  if (typeof value !== 'string' || !value.trim()) {
    invalid(`Instance '${name}' ${field} must be a non-empty string`, { field });
  }
}

function validateCallbackPath(value, name) {
  if (typeof value !== 'string' || !value.trim() || !value.startsWith('/') || value.startsWith('//') || value.includes('?') || value.includes('#')) {
    invalid(`Instance '${name}' callbackPath must be a valid absolute path`, { field: 'callbackPath' });
  }
}

function credentialRefString(value, field = 'credentialRef') {
  if (typeof value !== 'string' || !value.trim()) {
    invalid(`Instance credential reference '${field}' must be a non-empty string`, { field });
  }
  return value;
}

function passwordGrantRefs(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid("OAuth password grant requires credentialRef.password and credentialRef.clientSecret", { field: 'credentialRef' });
  }
  const keys = new Set(Object.keys(value));
  for (const key of keys) {
    if (!['password', 'clientSecret', 'passwordRef', 'clientSecretRef'].includes(key)) {
      invalid(`Unknown credential reference field '${key}'`, { field: 'credentialRef' });
    }
  }
  const password = value.password ?? value.passwordRef;
  const clientSecret = value.clientSecret ?? value.clientSecretRef;
  credentialRefString(password, 'credentialRef.password');
  credentialRefString(clientSecret, 'credentialRef.clientSecret');
  return {
    password: password,
    clientSecret: clientSecret
  };
}

function validateNewInstance(instance, { allowSecrets = false } = {}) {
  if (!instance || typeof instance !== 'object' || Array.isArray(instance)) {
    invalid('Instance configuration must be an object');
  }

  for (const field of Object.keys(instance)) {
    if (!ALLOWED_FIELDS.has(field) && !(allowSecrets && SECRET_FIELDS.has(field))) {
      invalid(`Unknown instance field '${field}'`, { field });
    }
  }

  const name = typeof instance.name === 'string' ? instance.name.trim() : '';
  if (!name || !NAME_PATTERN.test(name) || name !== instance.name) {
    invalid('Instance name must be a trimmed identifier containing only letters, numbers, underscores, and hyphens', { field: 'name' });
  }
  validateUrl(instance.url, name);

  const authType = instance.authType === undefined ? 'basic' : instance.authType;
  if (!AUTH_TYPES.has(authType)) {
    invalid(`Instance '${name}' has an unsupported authType`, { field: 'authType' });
  }
  if (instance.default !== undefined && typeof instance.default !== 'boolean') {
    invalid(`Instance '${name}' default must be a boolean`, { field: 'default' });
  }
  if (instance.scope !== undefined) validateOptionalString(instance.scope, name, 'scope');
  if (instance.description !== undefined) validateOptionalString(instance.description, name, 'description');
  if (instance.authorizeUrl !== undefined) validateOptionalUrl(instance.authorizeUrl, name, 'authorizeUrl');
  if (instance.tokenUrl !== undefined) validateOptionalUrl(instance.tokenUrl, name, 'tokenUrl');
  if (instance.callbackPath !== undefined) validateCallbackPath(instance.callbackPath, name);
  if (instance.redirectPort !== undefined && (!Number.isInteger(instance.redirectPort) || instance.redirectPort < 0 || instance.redirectPort > 65535)) {
    invalid(`Instance '${name}' redirectPort must be an integer from 0 to 65535`, { field: 'redirectPort' });
  }
  if (instance.username !== undefined) validateNonEmptyString(instance.username, name, 'username');
  if (instance.clientId !== undefined) validateNonEmptyString(instance.clientId, name, 'clientId');
  if (allowSecrets && instance.password !== undefined) validateNonEmptyString(instance.password, name, 'password');
  if (allowSecrets && instance.clientSecret !== undefined) validateNonEmptyString(instance.clientSecret, name, 'clientSecret');

  if (authType === 'basic') {
    if (instance.grantType !== undefined) {
      invalid(`Basic instance '${name}' cannot specify grantType`, { field: 'grantType' });
    }
    if (typeof instance.username !== 'string' || !instance.username.trim()) {
      invalid(`Basic instance '${name}' requires username as a non-empty string`, { field: 'username' });
    }
    if (allowSecrets && instance.password) return true;
    credentialRefString(instance.credentialRef);
    return true;
  }

  const grantType = instance.grantType === undefined ? 'password' : instance.grantType;
  if (!GRANT_TYPES.has(grantType)) {
    invalid(`OAuth instance '${name}' has an unsupported grantType`, { field: 'grantType' });
  }
  if (typeof instance.clientId !== 'string' || !instance.clientId.trim()) {
    invalid(`OAuth instance '${name}' requires clientId as a non-empty string`, { field: 'clientId' });
  }

  if (grantType === 'authorization_code') {
    if (instance.credentialRef !== undefined) {
      invalid(`Public authorization-code instance '${name}' must not specify credentialRef`, { field: 'credentialRef' });
    }
    return true;
  }

  if (grantType === 'client_credentials') {
    if (allowSecrets && instance.clientSecret) return true;
    credentialRefString(instance.credentialRef);
    return true;
  }

  if (typeof instance.username !== 'string' || !instance.username.trim()) {
    invalid(`OAuth password instance '${name}' requires username as a non-empty string`, { field: 'username' });
  }
  if (allowSecrets && instance.password && instance.clientSecret) return true;
  passwordGrantRefs(instance.credentialRef);
  return true;
}

function validateDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new InstanceRegistryError('REGISTRY_RELOAD_FAILED', 'Instance registry document must be an object');
  }
  if (document.version !== undefined && document.version !== 1) {
    throw new InstanceRegistryError('REGISTRY_RELOAD_FAILED', 'Unsupported instance registry version', { version: document.version });
  }
  if (!Array.isArray(document.instances)) {
    throw new InstanceRegistryError('REGISTRY_RELOAD_FAILED', 'Instance registry instances must be an array');
  }
  const seen = new Set();
  let defaultCount = 0;
  for (const instance of document.instances) {
    const name = instance && instance.name;
    if (seen.has(name)) {
      throw new InstanceRegistryError('REGISTRY_RELOAD_FAILED', `Duplicate instance name '${name}' in registry`, { field: 'name' });
    }
    seen.add(name);
    if (instance && instance.default === true) {
      defaultCount += 1;
      if (defaultCount > 1) {
        throw new InstanceRegistryError('REGISTRY_RELOAD_FAILED', 'Instance registry may contain at most one default instance', { field: 'default' });
      }
    }
    if (!hasSecretField(instance)) {
      validateNewInstance(instance);
    }
  }
  return document;
}

export class InstanceRegistryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'InstanceRegistryError';
    this.code = code;
    this.details = details;
  }
}

export class InstanceRegistry {
  constructor(options = {}) {
    const suppliedRegistry = options && typeof options.load === 'function' ? options : null;
    const config = suppliedRegistry ? {} : options;
    const paths = config.readPath && config.writePath
      ? { readPath: config.readPath, writePath: config.writePath, source: 'explicit' }
      : resolveConfigPaths({
        env: config.env || process.env,
        homeDir: config.homeDir || os.homedir(),
        legacyPath: config.legacyPath || DEFAULT_LEGACY_PATH,
        existsSync: config.existsSync || fs.existsSync
      });

    this.readPath = path.resolve(paths.readPath);
    this.writePath = path.resolve(paths.writePath);
    this.source = paths.source;
    this.fs = config.fs || fs;
    this._document = null;
    this._loaded = false;
    this._legacyPlaintext = false;
    this._mutationQueue = Promise.resolve();
  }

  get document() {
    return clone(this.load());
  }

  hasFile() {
    return this.fs.existsSync(this.readPath);
  }

  load() {
    if (this._loaded) return this._document;
    let document;
    try {
      document = JSON.parse(this.fs.readFileSync(this.readPath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') {
        document = { version: 1, instances: [] };
      } else if (error instanceof SyntaxError) {
        throw new InstanceRegistryError('REGISTRY_RELOAD_FAILED', 'Failed to parse instance registry JSON', { path: this.readPath });
      } else {
        throw new InstanceRegistryError('REGISTRY_RELOAD_FAILED', `Failed to load instance registry: ${error.message}`, { path: this.readPath });
      }
    }

    try {
      validateDocument(document);
    } catch (error) {
      const details = error instanceof InstanceRegistryError ? error.details : {};
      const message = error instanceof Error ? error.message : 'Invalid instance registry document';
      throw new InstanceRegistryError('REGISTRY_RELOAD_FAILED', message, {
        ...details,
        path: this.readPath
      });
    }
    if (document.version === undefined) document = { ...document, version: 1 };
    this._document = document;
    this._legacyPlaintext = hasSecretField(document);
    this._loaded = true;
    return this._document;
  }

  reload() {
    const previous = this._document;
    const previousLoaded = this._loaded;
    const previousLegacy = this._legacyPlaintext;
    this._loaded = false;
    try {
      return this.load();
    } catch (error) {
      this._document = previous;
      this._loaded = previousLoaded;
      this._legacyPlaintext = previousLegacy;
      if (error instanceof InstanceRegistryError && error.code === 'REGISTRY_RELOAD_FAILED') throw error;
      throw new InstanceRegistryError('REGISTRY_RELOAD_FAILED', `Failed to reload instance registry: ${error.message}`, { path: this.readPath });
    }
  }

  list() {
    return clone(this.load().instances);
  }

  get(name) {
    const instance = this.load().instances.find(candidate => candidate.name === name);
    if (!instance) {
      throw new InstanceRegistryError('INSTANCE_NOT_FOUND', `Instance '${name}' not found`, { name });
    }
    return clone(instance);
  }

  getDefault() {
    const instances = this.load().instances;
    return clone(instances.find(instance => instance.default === true) || instances[0]);
  }

  validate(instance) {
    return validateNewInstance(instance, { allowSecrets: true });
  }

  register(instance, { makeDefault = false } = {}) {
    if (typeof makeDefault !== 'boolean') {
      invalid('register options makeDefault must be a boolean', { field: 'makeDefault' });
    }
    return this._enqueueMutation(() => {
      validateNewInstance(instance);
      const current = this._document.instances;
      if (current.some(candidate => candidate.name === instance.name)) {
        throw new InstanceRegistryError('INSTANCE_ALREADY_EXISTS', `Instance '${instance.name}' already exists`, { name: instance.name });
      }
      const shouldDefault = current.length === 0 || makeDefault || instance.default === true;
      const candidate = {
        ...clone(instance),
        authType: instance.authType === undefined ? 'basic' : instance.authType,
        default: shouldDefault
      };
      const instances = current.map(existing => shouldDefault ? { ...existing, default: false } : existing);
      instances.push(candidate);
      return { ...this._document, version: 1, instances };
    }, updated => updated.instances.find(candidate => candidate.name === instance.name));
  }

  update(name, patch) {
    return this._enqueueMutation(() => {
      const current = this._document.instances.find(instance => instance.name === name);
      if (!current) throw new InstanceRegistryError('INSTANCE_NOT_FOUND', `Instance '${name}' not found`, { name });
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) invalid('Instance update must be an object');
      if (patch.name !== undefined && patch.name !== name) invalid('Instance name cannot be changed', { field: 'name' });
      const merged = { ...current, ...clone(patch), name };
      validateNewInstance(merged);
      const shouldDefault = merged.default === true;
      const instances = this._document.instances.map(instance => {
        if (instance.name === name) return { ...merged, default: shouldDefault };
        return shouldDefault ? { ...instance, default: false } : instance;
      });
      return { ...this._document, version: 1, instances };
    }, updated => updated.instances.find(candidate => candidate.name === name));
  }

  remove(name) {
    return this._enqueueMutation(() => {
      if (!this._document.instances.some(instance => instance.name === name)) {
        throw new InstanceRegistryError('INSTANCE_NOT_FOUND', `Instance '${name}' not found`, { name });
      }
      return {
        ...this._document,
        version: 1,
        instances: this._document.instances.filter(instance => instance.name !== name)
      };
    }, () => undefined);
  }

  _enqueueMutation(operation, resultSelector) {
    const mutation = this._mutationQueue.then(async () => {
      this.load();
      if (this._legacyPlaintext) {
        throw new InstanceRegistryError(
          'LEGACY_MIGRATION_REQUIRED',
          'This registry contains plaintext credentials; migrate it before changing instances',
          { path: this.readPath }
        );
      }

      const nextDocument = operation();
      validateDocument(nextDocument);
      await this._writeAtomic(nextDocument);
      this._document = nextDocument;
      this._loaded = true;
      this._legacyPlaintext = false;
      if (this.readPath !== this.writePath) {
        this.readPath = this.writePath;
        this.source = 'user';
      }
      return clone(resultSelector(nextDocument));
    });
    this._mutationQueue = mutation.catch(() => undefined);
    return mutation;
  }

  async _writeAtomic(document) {
    const directory = path.dirname(this.writePath);
    const basename = path.basename(this.writePath);
    let tempPath;
    let handle;
    try {
      await this.fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const candidatePath = path.join(directory, `.${basename}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.${attempt}.tmp`);
        try {
          handle = await this.fs.promises.open(candidatePath, 'wx', 0o600);
          tempPath = candidatePath;
          break;
        } catch (error) {
          if (error.code !== 'EEXIST' || attempt === 9) throw error;
        }
      }
      await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
      await handle.close();
      handle = undefined;
      await this.fs.promises.rename(tempPath, this.writePath);
    } catch (error) {
      if (handle) {
        try { await handle.close(); } catch { /* cleanup best effort */ }
      }
      if (tempPath) {
        try { await this.fs.promises.unlink(tempPath); } catch { /* cleanup best effort */ }
      }
      if (error instanceof InstanceRegistryError) throw error;
      throw new InstanceRegistryError('REGISTRY_WRITE_FAILED', `Failed to write instance registry: ${error.message}`, { path: this.writePath });
    }
  }
}
