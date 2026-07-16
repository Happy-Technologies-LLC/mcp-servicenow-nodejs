/**
 * TokenStore — persists the OAuth refresh token per account key.
 *
 * The client depends only on the async interface:
 *   getRefreshToken(account)   -> Promise<string|null>
 *   setRefreshToken(account, t)-> Promise<void>
 *   clearRefreshToken(account) -> Promise<void>
 *
 * `account` is a stable per-identity key (e.g. "<username>@<instanceName>").
 * Production defaults to the OS keychain; tests inject InMemoryTokenStore.
 */

const SERVICE_NAME = 'happy-platform-mcp';

/** In-memory store — no persistence across processes. Used by tests and as a fallback. */
export class InMemoryTokenStore {
  constructor() {
    this._tokens = new Map();
  }

  async getRefreshToken(account) {
    return this._tokens.has(account) ? this._tokens.get(account) : null;
  }

  async setRefreshToken(account, token) {
    this._tokens.set(account, token);
  }

  async clearRefreshToken(account) {
    this._tokens.delete(account);
  }
}

/**
 * OS-keychain-backed store (macOS Keychain / libsecret / Windows Credential
 * Manager) via @napi-rs/keyring. Lazily imported so environments without the
 * native module (or that inject a different store) never load it.
 */
export class KeychainTokenStore {
  constructor({ service = SERVICE_NAME, createEntry } = {}) {
    this.service = service;
    this._createEntry = createEntry || null;
    this._Entry = null;
  }

  async _entry(account) {
    if (this._createEntry) {
      return this._createEntry(this.service, account);
    }
    if (!this._Entry) {
      ({ Entry: this._Entry } = await import('@napi-rs/keyring'));
    }
    return new this._Entry(this.service, account);
  }

  async getRefreshToken(account) {
    // A missing entry returns null (no throw). A real fault — missing native
    // module, locked keychain, permission denied — must FAIL LOUD rather than
    // masquerade as "no token" and trigger a silent re-auth.
    try {
      return (await this._entry(account)).getPassword() ?? null;
    } catch (err) {
      console.error(`Keychain read failed for "${account}": ${err.message}`);
      throw err;
    }
  }

  async setRefreshToken(account, token) {
    (await this._entry(account)).setPassword(token);
  }

  async clearRefreshToken(account) {
    try {
      (await this._entry(account)).deletePassword();
    } catch {
      // Nothing to delete.
    }
  }
}
