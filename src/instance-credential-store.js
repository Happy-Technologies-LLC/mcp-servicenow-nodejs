import { randomUUID } from 'node:crypto';

const SERVICE_NAME = 'happy-platform-mcp';
const CREDENTIAL_PREFIX = 'keychain:instance/';
const INSTANCE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const CREDENTIAL_TYPES = new Set(['password', 'client-secret']);

export class InvalidCredentialReferenceError extends Error {
  constructor() {
    super('Invalid instance credential reference');
    this.name = 'InvalidCredentialReferenceError';
    this.code = 'INVALID_CREDENTIAL_REF';
  }
}

export class CredentialNotFoundError extends Error {
  constructor(ref) {
    super(`Credential not found for reference "${ref}"`);
    this.name = 'CredentialNotFoundError';
    this.code = 'CREDENTIAL_NOT_FOUND';
    this.ref = ref;
    this.details = { ref };
  }
}

export class KeychainUnavailableError extends Error {
  constructor(cause) {
    super('Keychain backend unavailable', cause === undefined ? undefined : { cause });
    this.name = 'KeychainUnavailableError';
    this.code = 'KEYCHAIN_UNAVAILABLE';
  }
}

export class KeychainOperationError extends Error {
  constructor() {
    super('Keychain operation failed');
    this.name = 'KeychainOperationError';
    this.code = 'KEYCHAIN_OPERATION_FAILED';
  }
}

function assertInstanceName(instanceName) {
  if (
    typeof instanceName !== 'string' ||
    !INSTANCE_NAME_PATTERN.test(instanceName) ||
    instanceName !== instanceName.trim()
  ) {
    throw new InvalidCredentialReferenceError();
  }
}

function assertCredentialType(type) {
  if (typeof type !== 'string' || !CREDENTIAL_TYPES.has(type)) {
    throw new InvalidCredentialReferenceError();
  }
}

export function parseCredentialRef(ref) {
  if (typeof ref !== 'string' || ref.includes('?') || ref.includes('#') || !ref.startsWith(CREDENTIAL_PREFIX)) {
    throw new InvalidCredentialReferenceError();
  }

  const segments = ref.slice(CREDENTIAL_PREFIX.length).split('/');
  if (segments.length !== 2) throw new InvalidCredentialReferenceError();
  const [instanceName, type] = segments;
  assertInstanceName(instanceName);
  assertCredentialType(type);
  return { ref, instanceName, type };
}

function validateCredentialRef(ref) {
  return parseCredentialRef(ref).ref;
}

export function credentialRefFor(instanceName, type) {
  assertInstanceName(instanceName);
  assertCredentialType(type);
  return `${CREDENTIAL_PREFIX}${instanceName}/${type}`;
}

export class InstanceCredentialStore {
  constructor({ service = SERVICE_NAME, createEntry } = {}) {
    this.service = service;
    this._createEntry = createEntry || null;
    this._keyringPromise = null;
  }

  async _entry(account) {
    if (this._createEntry) {
      return this._createEntry(this.service, account);
    }
    try {
      if (!this._keyringPromise) {
        this._keyringPromise = import('@napi-rs/keyring');
      }
      const keyringModule = await this._keyringPromise;
      const Entry = keyringModule.Entry;
      return new Entry(this.service, account);
    } catch (cause) {
      throw new KeychainUnavailableError(cause);
    }
  }

  async _verifyBackendHealth() {
    const account = `keychain:health-check/${randomUUID()}`;
    let probeValue = `health-check-${randomUUID()}`;
    let entry;
    let primaryError = null;
    let cleanupError = null;
    let setMayHaveSucceeded = false;

    try {
      entry = await this._entry(account);
      setMayHaveSucceeded = true;
      await entry.setPassword(probeValue);
      const observed = await entry.getPassword();
      if (typeof observed !== 'string' || observed !== probeValue) {
        throw new Error('health probe read mismatch');
      }
    } catch (error) {
      primaryError = error instanceof KeychainUnavailableError
        ? error
        : new KeychainUnavailableError();
    } finally {
      if (entry && setMayHaveSucceeded) {
        try {
          const deleted = await entry.deletePassword();
          if (deleted !== true) {
            cleanupError = new Error('health probe cleanup failed');
          }
        } catch {
          cleanupError = new Error('health probe cleanup failed');
        }
      }
      probeValue = null;
    }

    if (primaryError) {
      throw primaryError;
    }
    if (cleanupError) {
      throw new KeychainUnavailableError();
    }
  }

  async getSecret(ref) {
    const validatedRef = validateCredentialRef(ref);
    const entry = await this._entry(validatedRef);
    const value = await entry.getPassword();
    if (typeof value === 'string' && value.trim().length === 0) {
      throw new CredentialNotFoundError(validatedRef);
    }
    if (typeof value !== 'string') {
      await this._verifyBackendHealth();
      throw new CredentialNotFoundError(validatedRef);
    }
    return value;
  }

  async setSecret(ref, value) {
    const validatedRef = validateCredentialRef(ref);
    if (typeof value !== 'string' || value.length === 0) {
      throw new TypeError('Credential value must be a non-empty string');
    }
    await (await this._entry(validatedRef)).setPassword(value);
    return { stored: true };
  }

  async hasSecret(ref) {
    const validatedRef = validateCredentialRef(ref);
    const entry = await this._entry(validatedRef);
    const value = await entry.getPassword();
    if (typeof value === 'string' && value.trim().length === 0) {
      return false;
    }
    if (typeof value !== 'string') {
      await this._verifyBackendHealth();
      return false;
    }
    return true;
  }

  async deleteSecret(ref) {
    const validatedRef = validateCredentialRef(ref);
    const entry = await this._entry(validatedRef);
    let targetValue;
    try {
      targetValue = await entry.getPassword();
      if (typeof targetValue !== 'string') {
        await this._verifyBackendHealth();
        return { deleted: false };
      }

      const deleted = await entry.deletePassword();
      if (deleted === false) {
        throw new KeychainOperationError();
      }
      return { deleted: deleted !== false };
    } finally {
      targetValue = null;
    }
  }
}
