/**
 * Tests for the authorization_code grant path in ServiceNowClient._getOAuthToken().
 *
 * Per-user sign-in with a persisted refresh token. Critically, when the stored
 * refresh token is rejected the client must fail loud and re-prompt the browser
 * sign-in — it must NEVER silently fall back to a password/client_credentials
 * grant (that would re-introduce shared-principal attribution). The auth-code
 * flow and the refresh HTTP POST are injected so the path is testable offline.
 */
import axios from 'axios';
import { jest } from '@jest/globals';
import { userInfo } from 'node:os';
import { ServiceNowClient } from '../src/servicenow-client.js';
import { InMemoryTokenStore } from '../src/token-store.js';

const DEFAULT_ACCOUNT = `${userInfo().username}@default`;

function makeClient({ store, flow, postToken } = {}) {
  return new ServiceNowClient('https://ex.service-now.com', null, null, {
    authType: 'oauth',
    grantType: 'authorization_code',
    clientId: 'cid',
    scope: 'useraccount',
    tokenStore: store,
    performAuthCodeFlow: flow,
    postToken
  });
}

function makeGrantClient({
  username = null,
  password = null,
  clientSecret,
  credentialRef,
  credentialStore,
  grantType = 'client_credentials'
} = {}) {
  return new ServiceNowClient('https://ex.service-now.com', username, password, {
    authType: 'oauth',
    grantType,
    clientId: 'cid',
    clientSecret,
    credentialRef,
    credentialStore,
    scope: 'useraccount'
  });
}

describe('ServiceNowClient authorization_code grant', () => {
  it('runs the interactive flow when no refresh token is stored, and persists the new refresh token', async () => {
    const store = new InMemoryTokenStore();
    let calls = 0;
    const flow = async () => { calls++; return { access_token: 'at1', refresh_token: 'rt1', expires_in: 1800 }; };
    const client = makeClient({ store, flow });

    const token = await client._getOAuthToken();

    expect(token).toBe('at1');
    expect(calls).toBe(1);
    expect(await store.getRefreshToken(DEFAULT_ACCOUNT)).toBe('rt1');
  });

  it('scopes persisted refresh tokens to the local OS user and instance name', async () => {
    const store = new InMemoryTokenStore();
    const client = makeClient({
      store,
      flow: async () => ({ access_token: 'at1', refresh_token: 'rt1', expires_in: 1800 })
    });
    client.currentInstanceName = 'dev';

    await client._getOAuthToken();

    expect(await store.getRefreshToken(`${userInfo().username}@dev`)).toBe('rt1');
    expect(await store.getRefreshToken('dev')).toBeNull();
  });

  it('does not re-run the flow while the cached access token is still valid', async () => {
    const store = new InMemoryTokenStore();
    let calls = 0;
    const flow = async () => { calls++; return { access_token: 'at1', refresh_token: 'rt1', expires_in: 1800 }; };
    const client = makeClient({ store, flow });

    await client._getOAuthToken();
    await client._getOAuthToken();

    expect(calls).toBe(1);
  });

  it('refreshes from a stored refresh token without prompting the browser', async () => {
    const store = new InMemoryTokenStore();
    await store.setRefreshToken(DEFAULT_ACCOUNT, 'rt-stored');
    let flowCalls = 0;
    const flow = async () => { flowCalls++; return { access_token: 'fromflow' }; };
    const postToken = async (_url, params) => {
      expect(params.grant_type).toBe('refresh_token');
      expect(params.refresh_token).toBe('rt-stored');
      return { access_token: 'at-refreshed', refresh_token: 'rt-new', expires_in: 1800 };
    };
    const client = makeClient({ store, flow, postToken });

    const token = await client._getOAuthToken();

    expect(token).toBe('at-refreshed');
    expect(flowCalls).toBe(0);
    expect(await store.getRefreshToken(DEFAULT_ACCOUNT)).toBe('rt-new');
  });

  it('re-runs the interactive flow (never password) when the server REJECTS the refresh token (400/invalid_grant)', async () => {
    const store = new InMemoryTokenStore();
    await store.setRefreshToken(DEFAULT_ACCOUNT, 'rt-expired');
    let flowCalls = 0;
    const flow = async () => { flowCalls++; return { access_token: 'at-reauth', refresh_token: 'rt-fresh', expires_in: 1800 }; };
    const postToken = async () => {
      const err = new Error('invalid_grant');
      err.response = { status: 400 };
      throw err;
    };
    const client = makeClient({ store, flow, postToken });

    const token = await client._getOAuthToken();

    expect(token).toBe('at-reauth');
    expect(flowCalls).toBe(1);
    expect(await store.getRefreshToken(DEFAULT_ACCOUNT)).toBe('rt-fresh');
  });

  it('does NOT discard the refresh token or re-auth on a transient error (network / 5xx)', async () => {
    const store = new InMemoryTokenStore();
    await store.setRefreshToken(DEFAULT_ACCOUNT, 'rt-good');
    let flowCalls = 0;
    const flow = async () => { flowCalls++; return { access_token: 'should-not-happen' }; };
    const postToken = async () => { throw new Error('ECONNREFUSED'); }; // no .response → transient
    const client = makeClient({ store, flow, postToken });

    await expect(client._getOAuthToken()).rejects.toThrow(/ECONNREFUSED/);
    expect(flowCalls).toBe(0);
    expect(await store.getRefreshToken(DEFAULT_ACCOUNT)).toBe('rt-good'); // token preserved
  });

  it('does not re-persist a stale refresh token when a refresh response omits refresh_token (rotation)', async () => {
    let setCalls = 0;
    const store = new InMemoryTokenStore();
    const countingStore = {
      getRefreshToken: (a) => store.getRefreshToken(a),
      setRefreshToken: (a, t) => { setCalls++; return store.setRefreshToken(a, t); },
      clearRefreshToken: (a) => store.clearRefreshToken(a)
    };
    await store.setRefreshToken(DEFAULT_ACCOUNT, 'rt-old');
    const postToken = async () => ({ access_token: 'at-refreshed', expires_in: 1800 }); // no refresh_token
    const client = makeClient({ store: countingStore, flow: async () => ({}), postToken });

    const token = await client._getOAuthToken();

    expect(token).toBe('at-refreshed');
    expect(setCalls).toBe(0); // nothing new to persist; old token left untouched
    expect(await store.getRefreshToken(DEFAULT_ACCOUNT)).toBe('rt-old');
  });

  it('does not re-persist when a refresh response echoes the SAME refresh token', async () => {
    // ServiceNow commonly returns the existing (unrotated) refresh token on every
    // refresh. Re-writing an identical value is a logical no-op, but some OS keychain
    // backends recreate the item on write (macOS resets its ACL), so an unchanged
    // token must NOT be written.
    let setCalls = 0;
    const store = new InMemoryTokenStore();
    const countingStore = {
      getRefreshToken: (a) => store.getRefreshToken(a),
      setRefreshToken: (a, t) => { setCalls++; return store.setRefreshToken(a, t); },
      clearRefreshToken: (a) => store.clearRefreshToken(a)
    };
    await store.setRefreshToken(DEFAULT_ACCOUNT, 'rt-same');
    const postToken = async () => ({ access_token: 'at-refreshed', refresh_token: 'rt-same', expires_in: 1800 });
    const client = makeClient({ store: countingStore, flow: async () => ({}), postToken });

    const token = await client._getOAuthToken();

    expect(token).toBe('at-refreshed');
    expect(setCalls).toBe(0); // identical value → no keychain rewrite
    expect(await store.getRefreshToken(DEFAULT_ACCOUNT)).toBe('rt-same');
  });

  it('DOES persist when a refresh response returns a genuinely rotated refresh token', async () => {
    let setCalls = 0;
    const store = new InMemoryTokenStore();
    const countingStore = {
      getRefreshToken: (a) => store.getRefreshToken(a),
      setRefreshToken: (a, t) => { setCalls++; return store.setRefreshToken(a, t); },
      clearRefreshToken: (a) => store.clearRefreshToken(a)
    };
    await store.setRefreshToken(DEFAULT_ACCOUNT, 'rt-old');
    const postToken = async () => ({ access_token: 'at-refreshed', refresh_token: 'rt-rotated', expires_in: 1800 });
    const client = makeClient({ store: countingStore, flow: async () => ({}), postToken });

    await client._getOAuthToken();

    expect(setCalls).toBe(1); // changed value → exactly one write
    expect(await store.getRefreshToken(DEFAULT_ACCOUNT)).toBe('rt-rotated');
  });
});
  it('rejects a stale authorization flow without populating the switched instance', async () => {
    let releaseFlow;
    const flowPending = new Promise(resolve => { releaseFlow = resolve; });
    const oldStore = new InMemoryTokenStore();
    const client = makeClient({
      store: oldStore,
      flow: () => flowPending
    });
    const oldToken = client._getOAuthToken();
    const newStore = new InMemoryTokenStore();

    client.setInstance('https://new.service-now.com', null, null, 'new', {
      authType: 'oauth',
      grantType: 'authorization_code',
      clientId: 'new-cid',
      tokenStore: newStore,
      performAuthCodeFlow: async () => ({ access_token: 'new-token' })
    });
    releaseFlow({ access_token: 'old-token', refresh_token: 'old-refresh', expires_in: 1800 });

    await expect(oldToken).rejects.toMatchObject({ code: 'INSTANCE_CHANGED' });
    expect(client.oauthToken).toBeNull();
    expect(client.oauthRefreshToken).toBeNull();
    expect(client.oauthTokenExpiry).toBeNull();
    expect(await oldStore.getRefreshToken(`${userInfo().username}@new`)).toBeNull();
    expect(await newStore.getRefreshToken(`${userInfo().username}@new`)).toBeNull();
  });

  it('rejects when a stale refresh-token read resolves after instance switch', async () => {
    let releaseRead;
    const readPending = new Promise(resolve => { releaseRead = resolve; });
    const oldStore = {
      getRefreshToken: jest.fn(() => readPending),
      setRefreshToken: jest.fn(),
      clearRefreshToken: jest.fn()
    };
    const client = makeClient({
      store: oldStore,
      flow: async () => ({ access_token: 'old-token' })
    });
    const oldToken = client._getOAuthToken();
    const newStore = new InMemoryTokenStore();

    client.setInstance('https://new.service-now.com', null, null, 'new', {
      authType: 'oauth',
      grantType: 'authorization_code',
      clientId: 'new-cid',
      tokenStore: newStore,
      performAuthCodeFlow: async () => ({ access_token: 'new-token' })
    });
    releaseRead('old-refresh');

    await expect(oldToken).rejects.toMatchObject({ code: 'INSTANCE_CHANGED' });
    expect(client.oauthToken).toBeNull();
    expect(client.oauthRefreshToken).toBeNull();
    expect(oldStore.setRefreshToken).not.toHaveBeenCalled();
    expect(await newStore.getRefreshToken(`${userInfo().username}@new`)).toBeNull();
  });

  it('rejects when a stale refresh-token write settles after instance switch', async () => {
    let releaseWrite;
    let writeStarted;
    const writeStartedPromise = new Promise(resolve => { writeStarted = resolve; });
    const writePending = new Promise(resolve => { releaseWrite = resolve; });
    const oldStore = {
      getRefreshToken: jest.fn(async () => null),
      setRefreshToken: jest.fn(async () => {
        writeStarted();
        await writePending;
      }),
      clearRefreshToken: jest.fn()
    };
    const client = makeClient({
      store: oldStore,
      flow: async () => ({ access_token: 'old-token', refresh_token: 'old-refresh', expires_in: 1800 })
    });
    const oldToken = client._getOAuthToken();
    await writeStartedPromise;
    const newStore = {
      getRefreshToken: jest.fn(async () => null),
      setRefreshToken: jest.fn(),
      clearRefreshToken: jest.fn()
    };

    client.setInstance('https://new.service-now.com', null, null, 'new', {
      authType: 'oauth',
      grantType: 'authorization_code',
      clientId: 'new-cid',
      tokenStore: newStore,
      performAuthCodeFlow: async () => ({ access_token: 'new-token' })
    });
    releaseWrite();

    await expect(oldToken).rejects.toMatchObject({ code: 'INSTANCE_CHANGED' });
    expect(client.oauthToken).toBeNull();
    expect(client.oauthRefreshToken).toBeNull();
    expect(newStore.setRefreshToken).not.toHaveBeenCalled();
  });


describe('ServiceNowClient OAuth registered credentials', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('resolves a client-credentials secret once and deduplicates simultaneous token/auth requests', async () => {
    let releaseSecret;
    const secretPending = new Promise(resolve => { releaseSecret = resolve; });
    const credentialStore = {
      getSecret: jest.fn(() => secretPending)
    };
    const tokenPost = jest.spyOn(axios, 'post').mockResolvedValue({
      data: { access_token: 'cc-token', expires_in: 1800 }
    });
    const client = makeGrantClient({
      credentialRef: 'keychain:instance/prod/client-secret',
      credentialStore
    });

    const token = client._getOAuthToken();
    const header = client.getAuthHeader();
    releaseSecret('client-secret-fixture');

    await expect(Promise.all([token, header])).resolves.toEqual([
      'cc-token',
      'Bearer cc-token'
    ]);
    expect(credentialStore.getSecret).toHaveBeenCalledTimes(1);
    expect(tokenPost).toHaveBeenCalledTimes(1);
    const params = Object.fromEntries(new URLSearchParams(tokenPost.mock.calls[0][1]));
    expect(params).toMatchObject({
      grant_type: 'client_credentials',
      client_id: 'cid',
      client_secret: 'client-secret-fixture'
    });
  });

  test('resolves password-grant password and client secret references before one token request', async () => {
    const values = new Map([
      ['keychain:instance/dev/password', 'password-fixture'],
      ['keychain:instance/dev/client-secret', 'client-secret-fixture']
    ]);
    const credentialStore = {
      getSecret: jest.fn(async ref => values.get(ref))
    };
    const tokenPost = jest.spyOn(axios, 'post').mockResolvedValue({
      data: { access_token: 'password-token', expires_in: 1800 }
    });
    const client = makeGrantClient({
      username: 'dev-user',
      credentialRef: {
        password: 'keychain:instance/dev/password',
        clientSecret: 'keychain:instance/dev/client-secret'
      },
      credentialStore,
      grantType: 'password'
    });

    const [token, header] = await Promise.all([
      client._getOAuthToken(),
      client.getAuthHeader()
    ]);

    expect(token).toBe('password-token');
    expect(header).toBe('Bearer password-token');
    expect(credentialStore.getSecret).toHaveBeenCalledTimes(2);
    expect(credentialStore.getSecret).toHaveBeenCalledWith('keychain:instance/dev/password');
    expect(credentialStore.getSecret).toHaveBeenCalledWith('keychain:instance/dev/client-secret');
    expect(tokenPost).toHaveBeenCalledTimes(1);
    const params = Object.fromEntries(new URLSearchParams(tokenPost.mock.calls[0][1]));
    expect(params).toMatchObject({
      grant_type: 'password',
      client_id: 'cid',
      client_secret: 'client-secret-fixture',
      username: 'dev-user',
      password: 'password-fixture'
    });
  });

  test('does not look up a credential for a public authorization-code client', async () => {
    const credentialStore = { getSecret: jest.fn() };
    const client = new ServiceNowClient('https://ex.service-now.com', null, null, {
      authType: 'oauth',
      grantType: 'authorization_code',
      clientId: 'public-client',
      credentialStore,
      tokenStore: new InMemoryTokenStore(),
      performAuthCodeFlow: async () => ({ access_token: 'public-token', expires_in: 1800 })
    });

    await expect(client.getAuthHeader()).resolves.toBe('Bearer public-token');
    expect(credentialStore.getSecret).not.toHaveBeenCalled();
  });

  test('preserves legacy OAuth secrets without consulting the credential store', async () => {
    const credentialStore = { getSecret: jest.fn() };
    const tokenPost = jest.spyOn(axios, 'post').mockResolvedValue({
      data: { access_token: 'legacy-token', expires_in: 1800 }
    });
    const client = makeGrantClient({
      clientSecret: 'legacy-client-secret',
      credentialRef: 'keychain:instance/prod/client-secret',
      credentialStore
    });

    await expect(client.getAuthHeader()).resolves.toBe('Bearer legacy-token');
    expect(credentialStore.getSecret).not.toHaveBeenCalled();
    const params = Object.fromEntries(new URLSearchParams(tokenPost.mock.calls[0][1]));
    expect(params.client_secret).toBe('legacy-client-secret');
  });
});