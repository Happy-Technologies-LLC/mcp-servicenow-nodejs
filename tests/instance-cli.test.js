import { describe, expect, jest, test } from '@jest/globals';
import { runInstanceCli } from '../src/instance-cli.js';

function streams() {
  const out = { chunks: [], write(value) { this.chunks.push(String(value)); } };
  const err = { chunks: [], write(value) { this.chunks.push(String(value)); } };
  return { out, err };
}

function prompts(values = {}) {
  return {
    input: jest.fn(async ({ name, default: fallback }) => values[name] ?? fallback ?? ''),
    password: jest.fn(async ({ name }) => values[name] ?? 'fixture-secret-value'),
    select: jest.fn(async ({ name, default: fallback, choices }) => values[name] ?? fallback ?? choices?.[0]?.value),
    confirm: jest.fn(async ({ name, default: fallback }) => values[name] ?? fallback ?? true)
  };
}

function registryWith(instances = []) {
  const state = instances.map(instance => ({ ...instance }));
  return {
    list: jest.fn(() => state.map(instance => ({ ...instance }))),
    get: jest.fn(name => {
      const instance = state.find(candidate => candidate.name === name);
      if (!instance) throw Object.assign(new Error(`Instance '${name}' not found`), { code: 'INSTANCE_NOT_FOUND' });
      return { ...instance };
    }),
    register: jest.fn(async instance => {
      state.push({ ...instance });
      return { ...instance };
    }),
    update: jest.fn(async (name, patch) => {
      const index = state.findIndex(instance => instance.name === name);
      if (index < 0) throw Object.assign(new Error('missing'), { code: 'INSTANCE_NOT_FOUND' });
      state[index] = { ...state[index], ...patch };
      return { ...state[index] };
    }),
    remove: jest.fn(async name => {
      const index = state.findIndex(instance => instance.name === name);
      if (index < 0) throw Object.assign(new Error('missing'), { code: 'INSTANCE_NOT_FOUND' });
      state.splice(index, 1);
    }),
    validate: jest.fn(() => true),
    _state: state
  };
}

function credentialStore() {
  const values = new Map();
  return {
    values,
    hasSecret: jest.fn(async ref => values.has(ref)),
    setSecret: jest.fn(async (ref, value) => { values.set(ref, value); return { stored: true }; }),
    getSecret: jest.fn(async ref => {
      if (!values.has(ref)) throw Object.assign(new Error('missing'), { code: 'CREDENTIAL_NOT_FOUND' });
      return values.get(ref);
    }),
    deleteSecret: jest.fn(async ref => { values.delete(ref); return { deleted: true }; })
  };
}

const basic = {
  name: 'dev', url: 'https://dev.service-now.com', authType: 'basic', username: 'developer',
  credentialRef: 'keychain:instance/dev/password', default: true
};

describe('runInstanceCli', () => {
  test('lists redacted metadata and prints an empty-registry message', async () => {
    const { out, err } = streams();
    const registry = registryWith([{ ...basic, password: 'must-not-appear' }]);
    const code = await runInstanceCli(['instance', 'list'], { registry, stdout: out, stderr: err });
    expect(code).toBe(0);
    expect(out.chunks.join('')).toContain('dev');
    expect(out.chunks.join('')).not.toContain('must-not-appear');

    const emptyOut = streams();
    const empty = registryWith([]);
    expect(await runInstanceCli(['instance', 'list'], { registry: empty, stdout: emptyOut.out, stderr: emptyOut.err })).toBe(0);
    expect(emptyOut.out.chunks.join('')).toContain('No registered instances');
  });

  test('credential set uses a masked prompt and deterministic reference', async () => {
    const { out, err } = streams();
    const registry = registryWith([{ ...basic, credentialRef: undefined }]);
    const store = credentialStore();
    const prompt = prompts({ secret: 'fixture-secret-value' });
    const code = await runInstanceCli(['instance', 'credential', 'set', 'dev', '--type', 'password'], {
      registry, credentialStore: store, prompts: prompt, stdout: out, stderr: err
    });
    expect(code).toBe(0);
    expect(prompt.password).toHaveBeenCalledWith(expect.objectContaining({ mask: expect.any(String) }));
    expect(store.setSecret).toHaveBeenCalledWith('keychain:instance/dev/password', 'fixture-secret-value');
    expect(registry.update).toHaveBeenCalledWith('dev', expect.objectContaining({ credentialRef: 'keychain:instance/dev/password' }));
    expect(out.chunks.join('')).not.toContain('fixture-secret-value');
  });

  test('add stores credential before metadata and rolls back a newly-created secret on registry failure', async () => {
    const { out, err } = streams();
    const registry = registryWith([]);
    registry.register.mockRejectedValueOnce(Object.assign(new Error('registry unavailable'), { code: 'REGISTRY_WRITE_FAILED' }));
    const store = credentialStore();
    const prompt = prompts({ name: 'dev', url: 'https://dev.service-now.com', authType: 'basic', username: 'developer' });
    const code = await runInstanceCli(['instance', 'add'], { registry, credentialStore: store, prompts: prompt, stdout: out, stderr: err });
    expect(code).toBe(1);
    expect(store.setSecret.mock.invocationCallOrder[0]).toBeLessThan(registry.register.mock.invocationCallOrder[0]);
    expect(store.deleteSecret).toHaveBeenCalledWith('keychain:instance/dev/password');
    expect(err.chunks.join('')).toContain('registry unavailable');
  });

  test('rejects secret flags before prompts or output', async () => {
    const { out, err } = streams();
    const prompt = prompts();
    const code = await runInstanceCli(['instance', 'update', 'dev', '--password', 'fixture-secret-value'], {
      registry: registryWith([basic]), prompts: prompt, stdout: out, stderr: err
    });
    expect(code).toBe(2);
    expect(prompt.input).not.toHaveBeenCalled();
    expect(prompt.password).not.toHaveBeenCalled();
    expect(out.chunks.join('')).not.toContain('fixture-secret-value');
    expect(err.chunks.join('')).not.toContain('fixture-secret-value');
  });

  test('remove confirms before metadata and referenced secret deletion', async () => {
    const { out, err } = streams();
    const registry = registryWith([basic]);
    const store = credentialStore();
    const prompt = prompts({ confirm: false });
    expect(await runInstanceCli(['instance', 'remove', 'dev'], { registry, credentialStore: store, prompts: prompt, stdout: out, stderr: err })).toBe(0);
    expect(registry.remove).not.toHaveBeenCalled();
    expect(store.deleteSecret).not.toHaveBeenCalled();
  });

  test('test reports success, authentication, and authorization failures distinctly', async () => {
    const registry = registryWith([basic]);
    const store = credentialStore();
    const out1 = streams();
    const successClient = { getRecords: jest.fn(async () => []) };
    expect(await runInstanceCli(['instance', 'test', 'dev'], {
      registry, credentialStore: store, clientFactory: jest.fn(() => successClient), stdout: out1.out, stderr: out1.err
    })).toBe(0);
    expect(out1.out.chunks.join('')).toContain('succeeded');

    for (const [status, label] of [[401, 'Authentication'], [403, 'Authorization']]) {
      const result = streams();
      const clientFactory = jest.fn(() => ({ getRecords: jest.fn(async () => { throw Object.assign(new Error('request failed'), { response: { status } }); }) }));
      expect(await runInstanceCli(['instance', 'test', 'dev'], {
        registry, credentialStore: store, clientFactory, stdout: result.out, stderr: result.err
      })).toBe(1);
      expect(result.err.chunks.join('')).toContain(label);
    }
  });

  test('updates only allowed metadata flags without prompting for secrets', async () => {
    const { out, err } = streams();
    const registry = registryWith([basic]);
    const prompt = prompts();
    expect(await runInstanceCli(['instance', 'update', 'dev', '--description', 'Updated'], {
      registry, prompts: prompt, stdout: out, stderr: err
    })).toBe(0);
    expect(registry.update).toHaveBeenCalledWith('dev', { description: 'Updated' });
    expect(prompt.password).not.toHaveBeenCalled();
  });

  test('unknown commands return usage code 2', async () => {
    const { out, err } = streams();
    expect(await runInstanceCli(['instance', 'wat'], { stdout: out, stderr: err })).toBe(2);
    expect(err.chunks.join('')).toContain('Usage:');
  });
});

test('migrate stores plaintext credentials as refs, preserves document properties, and is idempotent', async () => {
  const legacy = {
    version: 1,
    docs: { localIndexEnabled: true },
    custom: { keep: true },
    instances: [
      { name: 'dev', url: 'https://dev.service-now.com', username: 'developer', password: 'fixture-password' },
      { name: 'oauth', url: 'https://oauth.service-now.com', authType: 'oauth', grantType: 'password', clientId: 'client', username: 'developer', password: 'fixture-password-2', clientSecret: 'fixture-client-secret' }
    ]
  };
  const registry = {
    source: 'legacy',
    writePath: '/tmp/happy-user-registry.json',
    _rawDocument: jest.fn(() => legacy),
    _writeAtomic: jest.fn(async document => { registry.written = document; }),
    written: null
  };
  const store = credentialStore();
  const result = streams();
  const prompt = prompts({ confirm: true });
  expect(await runInstanceCli(['instance', 'migrate'], { registry, credentialStore: store, prompts: prompt, stdout: result.out, stderr: result.err })).toBe(0);
  expect(registry.written.docs).toEqual({ localIndexEnabled: true });
  expect(registry.written.custom).toEqual({ keep: true });
  expect(registry.written.instances[0]).toEqual(expect.objectContaining({ credentialRef: 'keychain:instance/dev/password' }));
  expect(registry.written.instances[0]).not.toHaveProperty('password');
  expect(registry.written.instances[1].credentialRef).toEqual({
    password: 'keychain:instance/oauth/password',
    clientSecret: 'keychain:instance/oauth/client-secret'
  });
  expect(store.values.size).toBe(3);
  expect(result.out.chunks.join('')).not.toContain('fixture-password');
  expect(result.out.chunks.join('')).not.toContain('fixture-client-secret');
});

test('migrate rolls back only newly-created secrets when registry write fails', async () => {
  const registry = {
    _rawDocument: () => ({ instances: [{ name: 'dev', url: 'https://dev.service-now.com', username: 'developer', password: 'fixture-password' }] }),
    _writeAtomic: jest.fn(async () => { throw new Error('write failed'); })
  };
  const store = credentialStore();
  const result = streams();
  expect(await runInstanceCli(['instance', 'migrate'], {
    registry, credentialStore: store, prompts: prompts({ confirm: true }), stdout: result.out, stderr: result.err
  })).toBe(1);
  expect(store.values.size).toBe(0);
  expect(result.err.chunks.join('')).toContain('write failed');
});
 
test('CLI dispatch delegates no arguments to stdio main without starting it for help', async () => {
  const main = jest.fn(async () => {});
  jest.unstable_mockModule('../src/stdio-server.js', () => ({ main }));
  const { dispatch } = await import('../src/cli.js');
  const outputStreams = streams();
  expect(await dispatch([], { stdout: outputStreams.out, stderr: outputStreams.err })).toBe(0);
  expect(main).toHaveBeenCalledTimes(1);
  main.mockClear();
  expect(await dispatch(['--help'], { stdout: outputStreams.out, stderr: outputStreams.err })).toBe(0);
  expect(main).not.toHaveBeenCalled();
});
