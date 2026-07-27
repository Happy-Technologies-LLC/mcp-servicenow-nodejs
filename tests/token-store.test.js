/**
 * Tests for the TokenStore contract.
 *
 * A TokenStore persists the OAuth refresh token per account key so a fresh
 * process can refresh without a new browser sign-in. The client depends only
 * on this interface; production uses an OS-keychain-backed store, tests use
 * the in-memory one.
 */

import { jest } from '@jest/globals';
import { InMemoryTokenStore, KeychainTokenStore } from '../src/token-store.js';

describe('InMemoryTokenStore', () => {
  it('returns null for an account with no stored token', async () => {
    const store = new InMemoryTokenStore();
    expect(await store.getRefreshToken('acct')).toBeNull();
  });

  it('round-trips a stored refresh token per account', async () => {
    const store = new InMemoryTokenStore();
    await store.setRefreshToken('caleb@dev', 'rt-1');
    await store.setRefreshToken('caleb@prod', 'rt-2');
    expect(await store.getRefreshToken('caleb@dev')).toBe('rt-1');
    expect(await store.getRefreshToken('caleb@prod')).toBe('rt-2');
  });

  it('clears a stored token', async () => {
    const store = new InMemoryTokenStore();
    await store.setRefreshToken('acct', 'rt-1');
    await store.clearRefreshToken('acct');
    expect(await store.getRefreshToken('acct')).toBeNull();
  });
});

describe('KeychainTokenStore (with injected entry factory)', () => {
  it('returns null when the keychain has no entry (getPassword returns null)', async () => {
    const store = new KeychainTokenStore({
      createEntry: () => ({ getPassword: () => null })
    });
    expect(await store.getRefreshToken('acct')).toBeNull();
  });

  it('fails loud (rethrows) when the keychain itself errors, instead of masking it as "no token"', async () => {
    const store = new KeychainTokenStore({
      createEntry: () => ({ getPassword: () => { throw new Error('keychain locked'); } })
    });
    await expect(store.getRefreshToken('acct')).rejects.toThrow(/keychain locked/);
  });
  it('waits for an async keychain write before resolving', async () => {
    let release;
    const writePending = new Promise(resolve => { release = resolve; });
    let writes = 0;
    const store = new KeychainTokenStore({
      createEntry: () => ({
        setPassword: async () => {
          writes++;
          await writePending;
          return 'stored';
        }
      })
    });

    const write = store.setRefreshToken('acct', 'refresh-secret');
    await Promise.resolve();
    expect(writes).toBe(1);
    expect(await Promise.race([write.then(() => 'settled'), Promise.resolve('pending')])).toBe('pending');
    release();
    expect(await write).toBe('stored');
  });

  it('propagates an async keychain write rejection', async () => {
    const backendError = new Error('keychain write failed refresh-secret');
    const store = new KeychainTokenStore({
      createEntry: () => ({
        setPassword: async () => { throw backendError; }
      })
    });

    await expect(store.setRefreshToken('acct', 'refresh-secret')).rejects.toBe(backendError);
  });

  it('does not log raw keychain backend details or account identifiers on read failure', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const store = new KeychainTokenStore({
      createEntry: () => ({ getPassword: async () => { throw new Error('backend-secret-detail'); } })
    });

    await expect(store.getRefreshToken('sensitive-account')).rejects.toThrow();
    expect(consoleError).toHaveBeenCalledWith('Keychain read failed');
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('backend-secret-detail');
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('sensitive-account');
    consoleError.mockRestore();
  });

  it('fails loud when clearing the keychain throws', async () => {
    const backendError = new Error('keychain locked');
    const store = new KeychainTokenStore({
      createEntry: () => ({ deletePassword: () => { throw backendError; } })
    });
    await expect(store.clearRefreshToken('acct')).rejects.toBe(backendError);
  });

  it('treats a false delete result as an idempotent missing entry', async () => {
    const store = new KeychainTokenStore({
      createEntry: () => ({ deletePassword: () => false })
    });
    await expect(store.clearRefreshToken('acct')).resolves.toBeUndefined();
  });
});
