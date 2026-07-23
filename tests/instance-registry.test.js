import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { InstanceRegistry, InstanceRegistryError } from '../src/instance-registry.js';

const tempDirs = [];

function tempPaths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'happy-instance-registry-'));
  tempDirs.push(dir);
  return {
    dir,
    file: path.join(dir, 'instances.json'),
    legacyFile: path.join(dir, 'legacy.json'),
    userFile: path.join(dir, 'user', 'instances.json')
  };
}

function writeJson(file, document) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(document)}\n`);
}

function publicInstance(name, extra = {}) {
  return {
    name,
    url: `https://${name}.service-now.com`,
    authType: 'oauth',
    grantType: 'authorization_code',
    clientId: `${name}-public-client`,
    ...extra
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  jest.restoreAllMocks();
});

describe('InstanceRegistry reads', () => {
  test('loads versioned instances and preserves unrelated document properties', () => {
    const { file } = tempPaths();
    writeJson(file, {
      version: 1,
      docs: { localIndexEnabled: true },
      other: { preserved: 'yes' },
      instances: [publicInstance('dev', { default: true })]
    });

    const registry = new InstanceRegistry({ readPath: file, writePath: file });

    expect(registry.load()).toEqual(expect.objectContaining({ version: 1 }));
    expect(registry.list()).toHaveLength(1);
    expect(registry.get('dev').clientId).toBe('dev-public-client');
    expect(registry.document.docs.localIndexEnabled).toBe(true);
    expect(registry.document.other.preserved).toBe('yes');
  });

  test('returns an empty versioned document when the registry does not exist', () => {
    const { file } = tempPaths();
    const registry = new InstanceRegistry({ readPath: file, writePath: file });

    expect(registry.load()).toEqual({ version: 1, instances: [] });
    expect(registry.list()).toEqual([]);
    expect(registry.getDefault()).toBeUndefined();
  });
});

describe('InstanceRegistry validation and defaults', () => {
  test('rejects duplicate names and invalid non-HTTPS URLs', async () => {
    const { file } = tempPaths();
    const registry = new InstanceRegistry({ readPath: file, writePath: file });
    await registry.register(publicInstance('dev'));

    await expect(registry.register(publicInstance('dev', { clientId: 'other' })))
      .rejects.toMatchObject({ code: 'INSTANCE_ALREADY_EXISTS' });
    await expect(registry.register({
      name: 'bad',
      url: 'http://remote.service-now.com',
      authType: 'oauth',
      grantType: 'authorization_code',
      clientId: 'public-client'
    })).rejects.toMatchObject({ code: 'INVALID_INSTANCE_CONFIG' });
  });

  test('allows explicit loopback HTTP URLs only', async () => {
    const { file } = tempPaths();
    const registry = new InstanceRegistry({ readPath: file, writePath: file });

    await expect(registry.register(publicInstance('loopback', {
      url: 'http://127.0.0.1:8080'
    }))).resolves.toEqual(expect.objectContaining({ name: 'loopback' }));
    await expect(registry.register(publicInstance('remote', {
      url: 'http://localhost.example.com'
    }))).rejects.toMatchObject({ code: 'INVALID_INSTANCE_CONFIG' });
  });

  test('makes the first registration default and makeDefault changes it', async () => {
    const { file } = tempPaths();
    const registry = new InstanceRegistry({ readPath: file, writePath: file });

    await registry.register(publicInstance('dev'));
    await registry.register(publicInstance('prod'));
    expect(registry.getDefault().name).toBe('dev');

    await registry.update('prod', { description: 'Production', default: true });
    expect(registry.getDefault().name).toBe('prod');
    expect(registry.list().filter(instance => instance.default)).toHaveLength(1);

    await registry.register(publicInstance('staging'), { makeDefault: true });
    expect(registry.getDefault().name).toBe('staging');
    expect(registry.list().filter(instance => instance.default)).toHaveLength(1);
  });

  test('enforces auth requirements for basic, client credentials, and password grants', async () => {
    const { file } = tempPaths();
    const registry = new InstanceRegistry({ readPath: file, writePath: file });

    await expect(registry.register({
      name: 'basic', url: 'https://basic.service-now.com', authType: 'basic', username: 'user'
    })).rejects.toMatchObject({ code: 'INVALID_INSTANCE_CONFIG' });
    await expect(registry.register({
      name: 'cc', url: 'https://cc.service-now.com', authType: 'oauth', grantType: 'client_credentials', credentialRef: 'secret/ref'
    })).rejects.toMatchObject({ code: 'INVALID_INSTANCE_CONFIG' });
    await expect(registry.register({
      name: 'ropc', url: 'https://ropc.service-now.com', authType: 'oauth', grantType: 'password', username: 'user', clientId: 'cid', credentialRef: { password: 'password/ref' }
    })).rejects.toMatchObject({ code: 'INVALID_INSTANCE_CONFIG' });

    await expect(registry.register({
      name: 'basic-ok', url: 'https://basic-ok.service-now.com', authType: 'basic', username: 'user', credentialRef: 'password/ref'
    })).resolves.toEqual(expect.objectContaining({ name: 'basic-ok' }));
    await expect(registry.register({
      name: 'cc-ok', url: 'https://cc-ok.service-now.com', authType: 'oauth', grantType: 'client_credentials', clientId: 'cid', credentialRef: 'secret/ref'
    })).resolves.toEqual(expect.objectContaining({ name: 'cc-ok' }));
    await expect(registry.register({
      name: 'ropc-ok', url: 'https://ropc-ok.service-now.com', authType: 'oauth', grantType: 'password', username: 'user', clientId: 'cid', credentialRef: { password: 'password/ref', clientSecret: 'secret/ref' }
    })).resolves.toEqual(expect.objectContaining({ name: 'ropc-ok' }));
  });

  test('allows a public authorization-code client without a credential reference', async () => {
    const { file } = tempPaths();
    const registry = new InstanceRegistry({ readPath: file, writePath: file });

    await expect(registry.register(publicInstance('public'))).resolves.toEqual(expect.objectContaining({ name: 'public' }));
  });

  test('rejects unknown fields and secret values without echoing the submitted object', async () => {
    const { file } = tempPaths();
    const registry = new InstanceRegistry({ readPath: file, writePath: file });

    for (const field of ['password', 'clientSecret', 'unexpected']) {
      await expect(registry.register({
        ...publicInstance(`bad-${field}`),
        [field]: 'fixture-secret-value'
      })).rejects.toMatchObject({ code: 'INVALID_INSTANCE_CONFIG' });
      await expect(registry.register({
        ...publicInstance(`bad-${field}-again`),
        [field]: 'fixture-secret-value'
      })).rejects.toThrow(/^(?!.*fixture-secret-value).*$/s);
    }
  });
});

describe('InstanceRegistry persistence', () => {
  test('reads legacy plaintext JSON but refuses every mutation', async () => {
    const { file } = tempPaths();
    writeJson(file, {
      instances: [{
        name: 'legacy',
        url: 'https://legacy.service-now.com',
        username: 'legacy-user',
        password: 'legacy-password-fixture',
        default: true
      }]
    });
    const before = fs.readFileSync(file, 'utf8');
    const registry = new InstanceRegistry({ readPath: file, writePath: file });

    expect(registry.get('legacy').password).toBe('legacy-password-fixture');
    await expect(registry.update('legacy', { description: 'still legacy' }))
      .rejects.toMatchObject({ code: 'LEGACY_MIGRATION_REQUIRED' });
    await expect(registry.remove('legacy'))
      .rejects.toMatchObject({ code: 'LEGACY_MIGRATION_REQUIRED' });
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  test('preserves the prior snapshot and file when an atomic rename fails', async () => {
    const { file } = tempPaths();
    const registry = new InstanceRegistry({ readPath: file, writePath: file });
    await registry.register(publicInstance('dev'));
    const before = fs.readFileSync(file, 'utf8');
    const previous = registry.list();
    jest.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('fixture rename failure'));

    await expect(registry.register(publicInstance('prod')))
      .rejects.toMatchObject({ code: 'REGISTRY_WRITE_FAILED' });
    expect(registry.list()).toEqual(previous);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  test('serializes concurrent registrations without losing updates', async () => {
    const { file } = tempPaths();
    const registry = new InstanceRegistry({ readPath: file, writePath: file });

    await Promise.all([
      registry.register(publicInstance('one')),
      registry.register(publicInstance('two')),
      registry.register(publicInstance('three'))
    ]);

    expect(registry.list().map(instance => instance.name).sort()).toEqual(['one', 'three', 'two']);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).instances).toHaveLength(3);
  });

  test('writes a user registry without mutating a distinct legacy read path', async () => {
    const { legacyFile, userFile } = tempPaths();
    writeJson(legacyFile, { version: 1, docs: { keep: true }, instances: [publicInstance('legacy')] });
    const before = fs.readFileSync(legacyFile, 'utf8');
    const registry = new InstanceRegistry({ readPath: legacyFile, writePath: userFile });

    await registry.register(publicInstance('new'));

    expect(fs.readFileSync(legacyFile, 'utf8')).toBe(before);
    expect(JSON.parse(fs.readFileSync(userFile, 'utf8')).docs.keep).toBe(true);
    expect(JSON.parse(fs.readFileSync(userFile, 'utf8')).instances).toHaveLength(2);
  });

  test('updates and removes instances while preserving document properties', async () => {
    const { file } = tempPaths();
    writeJson(file, { version: 1, docs: { enabled: true }, instances: [publicInstance('dev')] });
    const registry = new InstanceRegistry({ readPath: file, writePath: file });

    await registry.update('dev', { description: 'Development', default: true });
    expect(registry.get('dev').description).toBe('Development');
    expect(registry.document.docs.enabled).toBe(true);
    await registry.remove('dev');
    expect(registry.list()).toEqual([]);
    expect(registry.document.docs.enabled).toBe(true);
  });
});


test('exposes typed registry errors with stable details', () => {
  const error = new InstanceRegistryError('INVALID_INSTANCE_CONFIG', 'invalid name', { field: 'name' });
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe('InstanceRegistryError');
  expect(error.code).toBe('INVALID_INSTANCE_CONFIG');
  expect(error.details).toEqual({ field: 'name' });
});
