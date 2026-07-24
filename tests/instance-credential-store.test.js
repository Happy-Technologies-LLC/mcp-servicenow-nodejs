import { describe, expect, jest, test } from '@jest/globals';
import {
  CredentialNotFoundError,
  KeychainOperationError,
  KeychainUnavailableError,
  InstanceCredentialStore,
  credentialRefFor
} from '../src/instance-credential-store.js';

function createHarness({ entryOverrides = {}, createEntry = null } = {}) {
  const values = new Map();
  const entryFactory = createEntry || jest.fn(async (_service, account) => ({
    getPassword: async () => values.get(account) ?? null,
    setPassword: async (value) => values.set(account, value),
    deletePassword: async () => values.delete(account),
    ...entryOverrides
  }));
  return { values, createEntry: entryFactory, store: new InstanceCredentialStore({ createEntry: entryFactory }) };
}
function createMapProbeHarness({ targetValue = null, healthRead = 'stored', healthDelete = 'delete' } = {}) {
  const values = new Map();
  const calls = { set: [], get: [], delete: [] };
  const createEntry = jest.fn(async (_service, account) => ({
    getPassword: async () => {
      calls.get.push(account);
      if (account === 'keychain:instance/dev/password') return targetValue;
      if (healthRead instanceof Error) throw healthRead;
      if (healthRead !== 'stored') return healthRead;
      return values.has(account) ? values.get(account) : null;
    },
    setPassword: async (value) => {
      calls.set.push({ account, value });
      values.set(account, value);
    },
    deletePassword: async () => {
      calls.delete.push(account);
      const deleted = values.delete(account);
      if (healthDelete instanceof Error) {
        throw healthDelete;
      }
      if (healthDelete === 'false') return false;
      return deleted;
    }
  }));
  return { values, calls, createEntry, store: new InstanceCredentialStore({ createEntry }) };
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

test.each([null, undefined, false, 42, {}])(
  'treats a non-string target value %j as anomalous and uses the missing contract',
  async (targetValue) => {
    const ref = credentialRefFor('dev', 'password');
    const getHarness = createMapProbeHarness({ targetValue });
    await expect(getHarness.store.getSecret(ref)).rejects.toMatchObject({
      code: 'CREDENTIAL_NOT_FOUND',
      ref
    });

    const hasHarness = createMapProbeHarness({ targetValue });
    await expect(hasHarness.store.hasSecret(ref)).resolves.toBe(false);

    const deleteHarness = createMapProbeHarness({ targetValue });
    await expect(deleteHarness.store.deleteSecret(ref)).resolves.toEqual({ deleted: false });
  }
);

test.each([
  ['null', null],
  ['false', false],
  ['mismatch', 'different-probe-value'],
  ['get exception', new Error('probe read failed')]
])('cleans up a health probe after %s', async (_label, healthRead) => {
  const { values, calls, store } = createMapProbeHarness({ healthRead });
  const ref = credentialRefFor('dev', 'password');
  await expect(store.hasSecret(ref)).rejects.toBeInstanceOf(KeychainUnavailableError);

  const probeAccount = calls.set[0].account;
  expect(calls.delete).toContain(probeAccount);
  expect(values.has(probeAccount)).toBe(false);
});

test('reports unavailable when health probe cleanup returns false', async () => {
  const { values, calls, store } = createMapProbeHarness({ healthDelete: 'false' });
  const ref = credentialRefFor('dev', 'password');
  await expect(store.hasSecret(ref)).rejects.toBeInstanceOf(KeychainUnavailableError);

  const probeAccount = calls.set[0].account;
  expect(calls.delete).toContain(probeAccount);
  expect(values.has(probeAccount)).toBe(false);
});

test('reports unavailable when health probe cleanup throws', async () => {
  const cleanupError = new Error('probe cleanup failed');
  const { values, calls, store } = createMapProbeHarness({ healthDelete: cleanupError });
  const ref = credentialRefFor('dev', 'password');
  await expect(store.hasSecret(ref)).rejects.toBeInstanceOf(KeychainUnavailableError);

  const probeAccount = calls.set[0].account;
  expect(calls.delete).toContain(probeAccount);
  expect(values.has(probeAccount)).toBe(false);
});

test('keeps the original unavailable error when probe cleanup also fails', async () => {
  const originalError = new KeychainUnavailableError();
  const cleanupError = new Error('probe cleanup failed');
  const { values, calls, store } = createMapProbeHarness({
    healthRead: originalError,
    healthDelete: cleanupError
  });
  const ref = credentialRefFor('dev', 'password');

  await expect(store.hasSecret(ref)).rejects.toBe(originalError);
  const probeAccount = calls.set[0].account;
  expect(calls.delete).toContain(probeAccount);
  expect(values.has(probeAccount)).toBe(false);
});

test('cleans up when setting a health probe throws after storing it', async () => {
  const values = new Map();
  const calls = { set: [], delete: [] };
  const createEntry = jest.fn(async (_service, account) => ({
    getPassword: async () => null,
    setPassword: async (value) => {
      calls.set.push(account);
      values.set(account, value);
      throw new Error('probe write failed');
    },
    deletePassword: async () => {
      calls.delete.push(account);
      values.delete(account);
      return true;
    }
  }));
  const store = new InstanceCredentialStore({ createEntry });

  await expect(store.hasSecret(credentialRefFor('dev', 'password')))
    .rejects.toBeInstanceOf(KeychainUnavailableError);
  const probeAccount = calls.set[0];
  expect(calls.delete).toContain(probeAccount);
  expect(values.has(probeAccount)).toBe(false);
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
      entryOverrides: { [method]: async () => { throw failure; } }
    });
    const ref = credentialRefFor('dev', 'password');
    if (method === 'deletePassword') {
      await store.setSecret(ref, 'fixture-secret');
    }
    const operation = method === 'getPassword'
      ? store.getSecret(ref)
      : method === 'setPassword'
        ? store.setSecret(ref, 'fixture-secret')
        : store.deleteSecret(ref);

    await expect(operation).rejects.toBe(failure);
  });

  test('returns false for a missing credential after a successful backend health probe', async () => {
    const values = new Map();
    const createEntry = jest.fn(async (_service, account) => ({
      getPassword: async () => values.has(account) ? values.get(account) : null,
      setPassword: async (value) => values.set(account, value),
      deletePassword: async () => values.delete(account)
    }));
    const store = new InstanceCredentialStore({ createEntry });
    const ref = credentialRefFor('dev', 'password');

    await expect(store.hasSecret(ref)).resolves.toBe(false);
    await expect(store.getSecret(ref)).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });
  });

  test('throws an unavailable error when a missing read has a null health probe', async () => {
    const entry = {
      getPassword: jest.fn().mockResolvedValue(null),
      setPassword: jest.fn().mockResolvedValue(undefined),
      deletePassword: jest.fn().mockResolvedValue(true)
    };
    const { store } = createHarness({ createEntry: jest.fn(async () => entry) });
    const ref = credentialRefFor('dev', 'password');

    await expect(store.getSecret(ref)).rejects.toMatchObject({ code: 'KEYCHAIN_UNAVAILABLE' });
    await expect(store.hasSecret(ref)).rejects.toBeInstanceOf(KeychainUnavailableError);
  });

  test('does not expose the health probe in unavailable errors', async () => {
    let probeValue = null;
    const entry = {
      getPassword: jest.fn()
        .mockResolvedValueOnce(null)
        .mockImplementationOnce(() => 'unexpected-probe-read'),
      setPassword: jest.fn(async (value) => { probeValue = value; }),
      deletePassword: jest.fn().mockResolvedValue(true)
    };
    const store = new InstanceCredentialStore({ createEntry: async () => entry });
    const ref = credentialRefFor('dev', 'password');

    try {
      await store.hasSecret(ref);
      throw new Error('expected hasSecret to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(KeychainUnavailableError);
      expect(error.message).not.toContain(probeValue);
      expect(JSON.stringify(error)).not.toContain(probeValue);
    }
  });

  test('throws an operation error when deleting a present credential returns false', async () => {
    const secret = 'fixture-secret';
    const entry = {
      getPassword: jest.fn().mockResolvedValue(secret),
      deletePassword: jest.fn().mockResolvedValue(false)
    };
    const store = new InstanceCredentialStore({ createEntry: async () => entry });
    const ref = credentialRefFor('dev', 'password');

    try {
      await store.deleteSecret(ref);
      throw new Error('expected deleteSecret to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(KeychainOperationError);
      expect(error.code).toBe('KEYCHAIN_OPERATION_FAILED');
      expect(error.message).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });
  test('wraps native entry construction failures with a safe typed error', async () => {
    const store = new InstanceCredentialStore({ service: null });

    try {
      await store.getSecret(credentialRefFor('dev', 'password'));
      throw new Error('expected getSecret to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(KeychainUnavailableError);
      expect(error.code).toBe('KEYCHAIN_UNAVAILABLE');
      expect(error.message).toBe('Keychain backend unavailable');
      expect(error.message).not.toContain('Null');
      expect(error.cause).toBeDefined();
      expect(error.cause.message).toContain('Null');
    }
  });
});
