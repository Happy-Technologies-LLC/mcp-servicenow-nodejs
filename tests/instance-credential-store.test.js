import { describe, expect, jest, test } from '@jest/globals';
import {
  CredentialNotFoundError,
  InstanceCredentialStore,
  credentialRefFor
} from '../src/instance-credential-store.js';

function createHarness({ entryOverrides = {}, createEntry = null } = {}) {
  const values = new Map();
  const entryFactory = createEntry || jest.fn((_service, account) => ({
    getPassword: () => values.get(account) ?? null,
    setPassword: (value) => values.set(account, value),
    deletePassword: () => values.delete(account),
    ...entryOverrides
  }));
  return { values, createEntry: entryFactory, store: new InstanceCredentialStore({ createEntry: entryFactory }) };
}

describe('credentialRefFor', () => {
  test('uses deterministic credential references', () => {
    expect(credentialRefFor('dev', 'password'))
      .toBe('keychain:instance/dev/password');
    expect(credentialRefFor('prod', 'client-secret'))
      .toBe('keychain:instance/prod/client-secret');
  });

  test.each([
    ['', 'password'],
    [' dev', 'password'],
    ['dev ', 'password'],
    ['../dev', 'password'],
    ['dev/other', 'password'],
    ['dev?x', 'password'],
    ['dev#x', 'password'],
    ['dev', ''],
    ['dev', 'unknown']
  ])('rejects invalid instance names and credential types (%j, %j)', (name, type) => {
    expect(() => credentialRefFor(name, type)).toThrow();
  });
});

describe('InstanceCredentialStore', () => {
  test('stores and retrieves a secret without returning it from set', async () => {
    const { createEntry, store } = createHarness();
    const ref = credentialRefFor('dev', 'password');

    await expect(store.setSecret(ref, 'fixture-secret')).resolves.toEqual({ stored: true });
    await expect(store.getSecret(ref)).resolves.toBe('fixture-secret');
    expect(createEntry).toHaveBeenCalledWith('happy-platform-mcp', ref);
  });

  test.each([undefined, null, '', 42, {}])('rejects non-empty string requirement for %j', async (value) => {
    const { store } = createHarness();
    await expect(store.setSecret(credentialRefFor('dev', 'password'), value)).rejects.toThrow();
  });

  test('distinguishes a missing credential from keychain failure', async () => {
    const { store } = createHarness();
    const ref = credentialRefFor('dev', 'password');

    await expect(store.getSecret(ref)).rejects.toMatchObject({
      code: 'CREDENTIAL_NOT_FOUND',
      ref
    });
    await expect(store.getSecret(ref)).rejects.toBeInstanceOf(CredentialNotFoundError);
  });

  test('never includes a secret in errors or result objects', async () => {
    const secret = 'fixture-secret';
    const { store } = createHarness();
    const ref = credentialRefFor('dev', 'password');

    await expect(store.setSecret(ref, secret)).resolves.toEqual({ stored: true });
    await expect(store.getSecret(ref)).resolves.toBe(secret);
    try {
      await store.setSecret(ref, '');
      throw new Error('expected setSecret to reject');
    } catch (error) {
      expect(error.message).not.toContain(secret);
    }
  });

  test.each([
    'keychain:instance/dev',
    'keychain:instance//password',
    'keychain:instance/dev/',
    'keychain:instance/dev/unknown',
    'keychain:instance/../password',
    'keychain:instance/dev/../password',
    'keychain:instance/dev/password?query',
    'keychain:instance/dev/password#fragment',
    'keychain:instance/dev/password/extra',
    'other:instance/dev/password'
  ])('rejects malformed credential reference %s', async (ref) => {
    const { store } = createHarness();
    await expect(store.hasSecret(ref)).rejects.toThrow();
    await expect(store.getSecret(ref)).rejects.toThrow();
    await expect(store.setSecret(ref, 'fixture-secret')).rejects.toThrow();
    await expect(store.deleteSecret(ref)).rejects.toThrow();
  });

  test('hasSecret returns false only for a missing null or undefined value', async () => {
    const { values, store } = createHarness();
    const ref = credentialRefFor('dev', 'password');

    await expect(store.hasSecret(ref)).resolves.toBe(false);
    values.set(ref, '');
    await expect(store.hasSecret(ref)).resolves.toBe(true);
    values.set(ref, 'fixture-secret');
    await expect(store.hasSecret(ref)).resolves.toBe(true);
  });

  test('deletes entries and returns a safe status', async () => {
    const { store } = createHarness();
    const ref = credentialRefFor('dev', 'password');

    await store.setSecret(ref, 'fixture-secret');
    await expect(store.deleteSecret(ref)).resolves.toEqual({ deleted: true });
    await expect(store.hasSecret(ref)).resolves.toBe(false);
  });

  test.each(['getPassword', 'setPassword', 'deletePassword'])('propagates keychain %s failures', async (method) => {
    const failure = new Error('keychain locked');
    const { store } = createHarness({
      entryOverrides: { [method]: () => { throw failure; } }
    });
    const ref = credentialRefFor('dev', 'password');
    const operation = method === 'getPassword'
      ? store.getSecret(ref)
      : method === 'setPassword'
        ? store.setSecret(ref, 'fixture-secret')
        : store.deleteSecret(ref);

    await expect(operation).rejects.toBe(failure);
  });
});
