import { jest } from '@jest/globals';
import { ServiceNowClient } from '../src/servicenow-client.js';

const BASIC_REF = 'keychain:instance/dev/password';
const NEXT_BASIC_REF = 'keychain:instance/prod/password';
const BASIC_SECRET = 'basic-secret-fixture';

function makeStore({ getSecret } = {}) {
  return { getSecret: getSecret || jest.fn(async () => BASIC_SECRET) };
}

describe('ServiceNowClient registered credentials', () => {
  test('resolves a basic credential once, caches it, and clears it on instance switch', async () => {
    const store = makeStore();
    const client = new ServiceNowClient('https://dev.service-now.com', 'dev-user', null, {
      credentialRef: BASIC_REF,
      credentialStore: store
    });

    await expect(client.getAuthHeader()).resolves.toBe(
      `Basic ${Buffer.from(`dev-user:${BASIC_SECRET}`).toString('base64')}`
    );
    await expect(client.getAuthHeader()).resolves.toBe(
      `Basic ${Buffer.from(`dev-user:${BASIC_SECRET}`).toString('base64')}`
    );
    expect(store.getSecret).toHaveBeenCalledTimes(1);

    client.setInstance('https://prod.service-now.com', 'prod-user', null, 'prod', {
      credentialRef: NEXT_BASIC_REF,
      credentialStore: store
    });
    store.getSecret.mockResolvedValueOnce('next-basic-secret');

    await expect(client.getAuthHeader()).resolves.toBe(
      `Basic ${Buffer.from('prod-user:next-basic-secret').toString('base64')}`
    );
    expect(store.getSecret).toHaveBeenCalledTimes(2);
  });

  test('deduplicates simultaneous basic credential lookups', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const store = makeStore({ getSecret: jest.fn(() => pending) });
    const client = new ServiceNowClient('https://dev.service-now.com', 'dev-user', null, {
      credentialRef: BASIC_REF,
      credentialStore: store
    });

    const first = client.getAuthHeader();
    const second = client.getAuthHeader();
    release(BASIC_SECRET);

    await expect(Promise.all([first, second])).resolves.toEqual([
      `Basic ${Buffer.from(`dev-user:${BASIC_SECRET}`).toString('base64')}`,
      `Basic ${Buffer.from(`dev-user:${BASIC_SECRET}`).toString('base64')}`
    ]);
    expect(store.getSecret).toHaveBeenCalledTimes(1);
  });

  test('does not let a stale in-flight lookup populate the switched instance', async () => {
    let releaseOld;
    const oldLookup = new Promise(resolve => { releaseOld = resolve; });
    const store = makeStore({
      getSecret: jest.fn(ref => ref === BASIC_REF ? oldLookup : Promise.resolve('new-secret'))
    });
    const client = new ServiceNowClient('https://dev.service-now.com', 'dev-user', null, {
      credentialRef: BASIC_REF,
      credentialStore: store
    });

    const oldHeader = client.getAuthHeader();
    client.setInstance('https://prod.service-now.com', 'prod-user', null, 'prod', {
      credentialRef: NEXT_BASIC_REF,
      credentialStore: store
    });
    releaseOld('old-secret');

    await expect(oldHeader).rejects.toThrow(/instance changed/i);
    await expect(client.getAuthHeader()).resolves.toBe(
      `Basic ${Buffer.from('prod-user:new-secret').toString('base64')}`
    );
    expect(store.getSecret).toHaveBeenCalledTimes(2);
  });
  test('retries a failed credential lookup after transient keychain recovery', async () => {
    let rejectLookup;
    const firstLookup = new Promise((resolve, reject) => {
      rejectLookup = reject;
    });
    const store = makeStore({
      getSecret: jest.fn()
        .mockReturnValueOnce(firstLookup)
        .mockResolvedValueOnce('recovered-secret')
    });
    const client = new ServiceNowClient('https://dev.service-now.com', 'dev-user', null, {
      credentialRef: BASIC_REF,
      credentialStore: store
    });

    const first = client.getAuthHeader();
    const second = client.getAuthHeader();
    rejectLookup(new Error('keychain temporarily locked'));

    await expect(Promise.all([first, second])).rejects.toMatchObject({ code: 'KEYCHAIN_OPERATION_FAILED' });
    expect(store.getSecret).toHaveBeenCalledTimes(1);

    await expect(client.getAuthHeader()).resolves.toBe(
      `Basic ${Buffer.from('dev-user:recovered-secret').toString('base64')}`
    );
    expect(store.getSecret).toHaveBeenCalledTimes(2);
  });

  test('stale lookup cleanup cannot delete a newer generation lookup', async () => {
    let rejectOldLookup;
    const oldLookup = new Promise((resolve, reject) => {
      rejectOldLookup = reject;
    });
    const store = makeStore({
      getSecret: jest.fn(ref => ref === BASIC_REF
        ? oldLookup
        : Promise.resolve('new-secret'))
    });
    const client = new ServiceNowClient('https://dev.service-now.com', 'dev-user', null, {
      credentialRef: BASIC_REF,
      credentialStore: store
    });

    const oldHeader = client.getAuthHeader();
    client.setInstance('https://prod.service-now.com', 'prod-user', null, 'prod', {
      credentialRef: NEXT_BASIC_REF,
      credentialStore: store
    });
    const newHeader = client.getAuthHeader();
    rejectOldLookup(new Error('old keychain failure'));

    await expect(oldHeader).rejects.toMatchObject({ code: 'KEYCHAIN_OPERATION_FAILED' });
    await expect(newHeader).resolves.toBe(
      `Basic ${Buffer.from('prod-user:new-secret').toString('base64')}`
    );
    expect(store.getSecret).toHaveBeenCalledTimes(2);
  });

  test('fails with a redacted CREDENTIAL_NOT_FOUND before making an outbound request', async () => {
    const store = makeStore({
      getSecret: jest.fn(async () => {
        const error = new Error(`Credential missing for ${BASIC_REF}`);
        error.code = 'CREDENTIAL_NOT_FOUND';
        error.ref = BASIC_REF;
        throw error;
      })
    });
    const client = new ServiceNowClient('https://dev.service-now.com', 'dev-user', null, {
      credentialRef: BASIC_REF,
      credentialStore: store
    });
    const adapter = jest.fn(async () => ({ status: 200, data: { result: [] }, headers: {}, config: {} }));
    client.client.defaults.adapter = adapter;

    let error;
    try {
      await client.client.get('/api/now/table/sys_user');
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });
    expect(adapter).not.toHaveBeenCalled();
    expect(error.message).not.toContain(BASIC_REF);
    expect(JSON.stringify(error)).not.toContain(BASIC_SECRET);
  });

  test('strips generated authorization headers from outbound errors', async () => {
    const store = makeStore();
    const client = new ServiceNowClient('https://dev.service-now.com', 'dev-user', null, {
      credentialRef: BASIC_REF,
      credentialStore: store
    });
    const adapter = jest.fn(async config => {
      const error = new Error('request failed');
      error.config = config;
      throw error;
    });
    client.client.defaults.adapter = adapter;

    let error;
    try {
      await client.client.get('/api/now/table/sys_user');
    } catch (caught) {
      error = caught;
    }

    expect(error.config.headers.Authorization).toBeUndefined();
    expect(error.config.headers.authorization).toBeUndefined();
  });

  test('redacts credential references and secret material from keychain errors', async () => {
    const store = makeStore({
      getSecret: jest.fn(async () => {
        const error = new Error(`keychain failed for ${BASIC_REF}: ${BASIC_SECRET}`);
        error.code = 'KEYCHAIN_OPERATION_FAILED';
        throw error;
      })
    });
    const client = new ServiceNowClient('https://dev.service-now.com', 'dev-user', null, {
      credentialRef: BASIC_REF,
      credentialStore: store
    });

    let error;
    try {
      await client.getAuthHeader();
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: 'KEYCHAIN_OPERATION_FAILED' });
    expect(error.message).not.toContain(BASIC_REF);
    expect(error.message).not.toContain(BASIC_SECRET);
    expect(JSON.stringify(error)).not.toContain(BASIC_REF);
    expect(JSON.stringify(error)).not.toContain(BASIC_SECRET);
  });

  test('does not expose credential references or secrets in current-instance results', async () => {
    const client = new ServiceNowClient('https://dev.service-now.com', 'dev-user', null, {
      credentialRef: BASIC_REF,
      credentialStore: makeStore()
    });

    const result = client.getCurrentInstance();

    expect(JSON.stringify(result)).not.toContain(BASIC_REF);
    expect(JSON.stringify(result)).not.toContain(BASIC_SECRET);
    expect(JSON.stringify(result)).not.toContain('dev-user');
  });

  test('retains legacy basic password behavior without a credential lookup', async () => {
    const store = makeStore();
    const client = new ServiceNowClient('https://dev.service-now.com', 'dev-user', 'legacy-password', {
      credentialRef: BASIC_REF,
      credentialStore: store
    });

    await expect(client.getAuthHeader()).resolves.toBe(
      `Basic ${Buffer.from('dev-user:legacy-password').toString('base64')}`
    );
    expect(store.getSecret).not.toHaveBeenCalled();
  });
  test('rejects a deferred old request when the instance switches before auth resolves', async () => {
    let releaseOld;
    const oldLookup = new Promise(resolve => { releaseOld = resolve; });
    const store = makeStore({
      getSecret: jest.fn(ref => ref === BASIC_REF ? oldLookup : Promise.resolve('new-secret'))
    });
    const client = new ServiceNowClient('https://dev.service-now.com', 'dev-user', null, {
      credentialRef: BASIC_REF,
      credentialStore: store
    });
    const oldClient = client.client;
    const adapter = jest.fn(async () => ({
      status: 200,
      data: { result: [] },
      headers: {},
      config: {}
    }));
    oldClient.defaults.adapter = adapter;
    const request = oldClient.get('/api/now/table/sys_user');

    await new Promise(resolve => setImmediate(resolve));
    client.setInstance('https://prod.service-now.com', 'prod-user', null, 'prod', {
      credentialRef: NEXT_BASIC_REF,
      credentialStore: store
    });
    releaseOld('old-secret');

    await expect(request).rejects.toMatchObject({ code: 'INSTANCE_CHANGED' });
    expect(adapter).not.toHaveBeenCalled();
    await expect(client.getAuthHeader()).resolves.toBe(
      `Basic ${Buffer.from('prod-user:new-secret').toString('base64')}`
    );
  });
});
