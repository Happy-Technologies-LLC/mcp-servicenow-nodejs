import { jest } from '@jest/globals';
import crypto from 'node:crypto';
import { createDefaultClient, createHttpApp, validateHttpTransportSecurity } from '../src/http-server.js';

describe('validateHttpTransportSecurity', () => {
  test('rejects a network-visible HTTP listener without an access token', () => {
    expect(() => validateHttpTransportSecurity({ host: '0.0.0.0' })).toThrow(
      'HAPPY_MCP_API_TOKEN is required when HAPPY_MCP_BIND_HOST is not loopback'
    );
  });
});

async function requestHealth(app, headers = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    return await fetch(`http://127.0.0.1:${port}/health`, { headers });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function requestInstances(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    return await fetch(`http://127.0.0.1:${port}/instances`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function startApp(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

class FakeSseTransport {
  constructor(path, response) {
    this.path = path;
    this.response = response;
    this.sessionId = crypto.randomUUID();
  }
}

test('creates an authorization_code client with every OAuth option', () => {
  const client = createDefaultClient({
    name: 'public-oauth',
    url: 'https://example.service-now.com',
    authType: 'oauth',
    grantType: 'authorization_code',
    clientId: 'public-client',
    authorizeUrl: 'https://example.service-now.com/oauth_auth.do',
    tokenUrl: 'https://example.service-now.com/oauth_token.do',
    redirectPort: 8455,
    callbackPath: '/callback'
  });

  expect(client.oauthConfig).toMatchObject({
    grantType: 'authorization_code',
    clientId: 'public-client',
    authorizeUrl: 'https://example.service-now.com/oauth_auth.do',
    tokenUrl: 'https://example.service-now.com/oauth_token.do',
    redirectPort: 8455,
    callbackPath: '/callback'
  });
});

describe('HTTP authorization', () => {
  test('rejects unauthenticated requests when an API token is configured', async () => {
    const app = createHttpApp({
      apiToken: 'release-secret',
      defaultInstance: { name: 'test', url: 'https://example.service-now.com' }
    });

    const response = await requestHealth(app);

    expect(response.status).toBe(401);
  });

  test('accepts a request with the configured bearer token', async () => {
    const app = createHttpApp({
      apiToken: 'release-secret',
      defaultInstance: { name: 'test', url: 'https://example.service-now.com' }
    });

    const response = await requestHealth(app, {
      Authorization: 'Bearer release-secret'
    });

    expect(response.status).toBe(200);
  });

  test('lists every configured instance', async () => {
    const instances = [
      { name: 'dev', url: 'https://dev.example.service-now.com', default: true },
      { name: 'prod', url: 'https://prod.example.service-now.com', default: false }
    ];
    const app = createHttpApp({
      defaultInstance: instances[0],
      listInstances: () => instances
    });

    const response = await requestInstances(app);

    expect(await response.json()).toEqual({ instances });
  });

  test('creates an isolated ServiceNow client for every MCP session', async () => {
    const createServiceNowClient = jest.fn(() => ({}));
    const createMcpServer = jest.fn(async () => ({
      connect: async (transport) => transport.response.write('data: connected\n\n')
    }));
    const app = createHttpApp({
      defaultInstance: { name: 'test', url: 'https://example.service-now.com' },
      createServiceNowClient,
      createMcpServer,
      SSEServerTransport: FakeSseTransport
    });
    const server = await startApp(app);

    try {
      const first = await fetch(`${server.url}/mcp`);
      await first.body.cancel();
      const second = await fetch(`${server.url}/mcp`);
      await second.body.cancel();
    } finally {
      await server.close();
    }

    expect(createServiceNowClient).toHaveBeenCalledTimes(2);
    expect(createMcpServer.mock.calls[0][0]).not.toBe(createMcpServer.mock.calls[1][0]);
  });
});
