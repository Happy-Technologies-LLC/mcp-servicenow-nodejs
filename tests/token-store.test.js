/**
 * Tests for the TokenStore contract.
 *
 * A TokenStore persists the OAuth refresh token per account key so a fresh
 * process can refresh without a new browser sign-in. The client depends only
 * on this interface; production uses an OS-keychain-backed store, tests use
 * the in-memory one.
 */

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
});
