import { describe, expect, jest, test } from '@jest/globals';

const secret = 'fixture-secret';
const keytar = {
  getPassword: jest.fn().mockResolvedValue(secret),
  setPassword: jest.fn().mockResolvedValue(undefined),
  deletePassword: jest.fn().mockResolvedValue(true)
};
const keytarModuleFactory = jest.fn(() => keytar);
const napiModuleFactory = jest.fn(() => ({
  Entry: class {
    getPassword() {
      throw new Error('@napi-rs/keyring must not be used by credential store');
    }
  }
}));

jest.unstable_mockModule('@postman/node-keytar', keytarModuleFactory);
jest.unstable_mockModule('@napi-rs/keyring', napiModuleFactory);

const { InstanceCredentialStore, credentialRefFor } = await import('../src/instance-credential-store.js');

describe('InstanceCredentialStore production adapter', () => {
  test('imports keytar lazily once and wraps service/account arguments', async () => {
    const store = new InstanceCredentialStore();
    const ref = credentialRefFor('dev', 'password');

    expect(keytarModuleFactory).not.toHaveBeenCalled();
    await expect(store.getSecret(ref)).resolves.toBe(secret);
    await expect(store.hasSecret(ref)).resolves.toBe(true);
    await expect(store.setSecret(ref, secret)).resolves.toEqual({ stored: true });
    await expect(store.deleteSecret(ref)).resolves.toEqual({ deleted: true });

    expect(keytarModuleFactory).toHaveBeenCalledTimes(1);
    expect(napiModuleFactory).not.toHaveBeenCalled();
    expect(keytar.getPassword).toHaveBeenCalledWith('happy-platform-mcp', ref);
    expect(keytar.setPassword).toHaveBeenCalledWith('happy-platform-mcp', ref, secret);
    expect(keytar.deletePassword).toHaveBeenCalledWith('happy-platform-mcp', ref);
  });

  test('keeps injected async entry factories on the same adapter contract', async () => {
    const entry = {
      getPassword: jest.fn().mockResolvedValue(null),
      setPassword: jest.fn().mockResolvedValue(undefined),
      deletePassword: jest.fn().mockResolvedValue(false)
    };
    const createEntry = jest.fn(async (service, account) => {
      expect(service).toBe('happy-platform-mcp');
      expect(account).toBe(credentialRefFor('dev', 'password'));
      return entry;
    });
    const store = new InstanceCredentialStore({ createEntry });

    await expect(store.getSecret(credentialRefFor('dev', 'password')))
      .rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });
    await expect(store.deleteSecret(credentialRefFor('dev', 'password')))
      .resolves.toEqual({ deleted: false });
    expect(createEntry).toHaveBeenCalledTimes(2);
    expect(keytarModuleFactory).toHaveBeenCalledTimes(1);
  });
});
