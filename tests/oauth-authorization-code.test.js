/**
 * Tests for the authorization_code + PKCE OAuth flow.
 *
 * This module adds a per-user authorization_code grant (with PKCE and a
 * loopback redirect) to the ServiceNow OAuth options. It is deliberately
 * generic — no instance-specific hardcoding — so it can be contributed
 * upstream alongside the SERVICENOW_OAUTH_GRANT_TYPE seam.
 */

import { jest } from '@jest/globals';
import crypto from 'node:crypto';
import {
  generatePkcePair,
  buildAuthorizationUrl,
  createCallbackServer,
  exchangeAuthorizationCode,
  performAuthorizationCodeFlow
} from '../src/oauth-authorization-code.js';

describe('generatePkcePair()', () => {
  it('returns an S256 challenge that is the base64url SHA-256 of the verifier', () => {
    const { codeVerifier, codeChallenge, codeChallengeMethod } = generatePkcePair();
    expect(codeChallengeMethod).toBe('S256');
    const expected = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    expect(codeChallenge).toBe(expected);
  });

  it('produces a verifier within RFC 7636 length bounds using only unreserved characters', () => {
    const { codeVerifier } = generatePkcePair();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeVerifier.length).toBeLessThanOrEqual(128);
    expect(codeVerifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('generates a unique verifier on each call', () => {
    expect(generatePkcePair().codeVerifier).not.toBe(generatePkcePair().codeVerifier);
  });
});

describe('buildAuthorizationUrl()', () => {
  const base = {
    authorizeUrl: 'https://example.service-now.com/oauth_auth.do',
    clientId: 'cli-client-id',
    redirectUri: 'http://127.0.0.1:8455/callback',
    codeChallenge: 'abc123challenge',
    state: 'xyz-state'
  };

  it('preserves the authorize endpoint and encodes the PKCE authorization-request params', () => {
    const url = new URL(buildAuthorizationUrl(base));
    expect(`${url.origin}${url.pathname}`).toBe('https://example.service-now.com/oauth_auth.do');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('cli-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8455/callback');
    expect(url.searchParams.get('code_challenge')).toBe('abc123challenge');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('xyz-state');
  });

  it('includes scope only when provided', () => {
    expect(new URL(buildAuthorizationUrl(base)).searchParams.has('scope')).toBe(false);
    const withScope = new URL(buildAuthorizationUrl({ ...base, scope: 'useraccount' }));
    expect(withScope.searchParams.get('scope')).toBe('useraccount');
  });
});

describe('createCallbackServer()', () => {
  let server;
  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
  });

  it('resolves with the code when the loopback redirect is hit with the matching state', async () => {
    server = await createCallbackServer({ port: 0, expectedState: 'good-state' });
    const codePromise = server.waitForCode();
    const res = await fetch(`http://127.0.0.1:${server.port}/callback?code=THE_CODE&state=good-state`);
    expect(res.status).toBe(200);
    await expect(codePromise).resolves.toEqual({ code: 'THE_CODE' });
  });

  it('rejects when the returned state does not match (CSRF guard)', async () => {
    server = await createCallbackServer({ port: 0, expectedState: 'good-state' });
    const assertion = expect(server.waitForCode()).rejects.toThrow(/state/i);
    await fetch(`http://127.0.0.1:${server.port}/callback?code=THE_CODE&state=tampered`);
    await assertion;
  });

  it('rejects when the provider returns an error instead of a code', async () => {
    server = await createCallbackServer({ port: 0, expectedState: 'good-state' });
    const assertion = expect(server.waitForCode()).rejects.toThrow(/access_denied/);
    await fetch(`http://127.0.0.1:${server.port}/callback?error=access_denied&state=good-state`);
    await assertion;
  });
});

describe('exchangeAuthorizationCode()', () => {
  const args = {
    tokenUrl: 'https://example.service-now.com/oauth_token.do',
    clientId: 'cli-client-id',
    code: 'AUTH_CODE',
    codeVerifier: 'the-verifier',
    redirectUri: 'http://127.0.0.1:8455/callback'
  };
  const tokenResponse = { access_token: 'at', refresh_token: 'rt', expires_in: 1800 };

  it('posts the authorization_code + PKCE params to the token endpoint and returns the token body', async () => {
    let captured;
    const post = async (url, params) => {
      captured = { url, params };
      return tokenResponse;
    };
    const result = await exchangeAuthorizationCode(args, { post });
    expect(captured.url).toBe(args.tokenUrl);
    expect(captured.params).toMatchObject({
      grant_type: 'authorization_code',
      client_id: 'cli-client-id',
      code: 'AUTH_CODE',
      code_verifier: 'the-verifier',
      redirect_uri: 'http://127.0.0.1:8455/callback'
    });
    expect(result).toBe(tokenResponse);
  });

  it('omits client_secret for a public PKCE client but includes it when configured (confidential)', async () => {
    let captured;
    const post = async (_url, params) => { captured = params; return tokenResponse; };
    await exchangeAuthorizationCode(args, { post });
    expect('client_secret' in captured).toBe(false);
    await exchangeAuthorizationCode({ ...args, clientSecret: 'shh' }, { post });
    expect(captured.client_secret).toBe('shh');
  });
});

describe('performAuthorizationCodeFlow()', () => {
  const config = {
    authorizeUrl: 'https://example.service-now.com/oauth_auth.do',
    tokenUrl: 'https://example.service-now.com/oauth_token.do',
    clientId: 'cli-client-id',
    scope: 'useraccount'
  };

  it('runs the full PKCE flow end-to-end and returns the exchanged tokens', async () => {
    let exchanged;
    // Simulate the user completing sign-in: the browser hits the loopback redirect.
    const openBrowser = async (authUrl) => {
      const url = new URL(authUrl);
      const redirectUri = new URL(url.searchParams.get('redirect_uri'));
      const state = url.searchParams.get('state');
      redirectUri.searchParams.set('code', 'AUTH_CODE');
      redirectUri.searchParams.set('state', state);
      await fetch(redirectUri.toString());
    };
    const post = async (_url, params) => {
      exchanged = params;
      return { access_token: 'at', refresh_token: 'rt', expires_in: 1800 };
    };

    const tokens = await performAuthorizationCodeFlow(config, { openBrowser, post });

    expect(tokens.access_token).toBe('at');
    expect(exchanged.grant_type).toBe('authorization_code');
    expect(exchanged.code).toBe('AUTH_CODE');
    // The verifier the server generated must be the one exchanged, and the
    // redirect_uri must point at the loopback callback the browser hit.
    expect(exchanged.code_verifier).toBeTruthy();
    expect(exchanged.redirect_uri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  });
});

describe('createCallbackServer() — hardening', () => {
  let server;
  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
  });

  it('rejects when the redirect has a valid state but no authorization code', async () => {
    server = await createCallbackServer({ port: 0, expectedState: 'good-state' });
    const assertion = expect(server.waitForCode()).rejects.toThrow(/code/i);
    await fetch(`http://127.0.0.1:${server.port}/callback?state=good-state`);
    await assertion;
  });

  it('HTML-escapes the provider error in the response body (no reflected XSS)', async () => {
    server = await createCallbackServer({ port: 0, expectedState: 'good-state' });
    const assertion = expect(server.waitForCode()).rejects.toThrow();
    const res = await fetch(`http://127.0.0.1:${server.port}/callback?error=${encodeURIComponent('<script>alert(1)</script>')}&state=good-state`);
    const body = await res.text();
    expect(body).not.toContain('<script>alert(1)</script>');
    expect(body).toContain('&lt;script&gt;');
    await assertion;
  });

  it('treats timeoutMs: 0 as an immediate timeout, not "no timeout"', async () => {
    server = await createCallbackServer({ port: 0, expectedState: 'good-state' });
    await expect(server.waitForCode({ timeoutMs: 0 })).rejects.toThrow(/timed out/i);
  });
});
