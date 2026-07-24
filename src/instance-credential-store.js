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

function validateCredentialRef(ref) {
  if (typeof ref !== 'string' || ref.includes('?') || ref.includes('#') || !ref.startsWith(CREDENTIAL_PREFIX)) {
    throw new InvalidCredentialReferenceError();
  }

  const segments = ref.slice(CREDENTIAL_PREFIX.length).split('/');
  if (segments.length !== 2) throw new InvalidCredentialReferenceError();
  const [instanceName, type] = segments;
  assertInstanceName(instanceName);
  assertCredentialType(type);
  return ref;
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
    this._keytarPromise = null;
  }

  async _entry(ref) {
    if (this._createEntry) {
      return this._createEntry(this.service, ref);
    }
    if (!this._keytarPromise) {
      this._keytarPromise = import('@postman/node-keytar');
    }
    const keytarModule = await this._keytarPromise;
    const keytar = keytarModule.default || keytarModule;
    return {
      getPassword: () => keytar.getPassword(this.service, ref),
      setPassword: (value) => keytar.setPassword(this.service, ref, value),
      deletePassword: () => keytar.deletePassword(this.service, ref)
    };
  }

  async getSecret(ref) {
    const validatedRef = validateCredentialRef(ref);
    const value = await (await this._entry(validatedRef)).getPassword();
    if (value === null || value === undefined) {
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
    const value = await (await this._entry(validatedRef)).getPassword();
    return value !== null && value !== undefined;
  }

  async deleteSecret(ref) {
    const validatedRef = validateCredentialRef(ref);
    const deleted = await (await this._entry(validatedRef)).deletePassword();
    return { deleted: deleted !== false };
  }
}
