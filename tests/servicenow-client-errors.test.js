import { enrichServiceNowError } from '../src/servicenow-client.js';
import { ServiceNowClient } from '../src/servicenow-client.js';

async function requestFailure(client, adapter) {
  client.client.defaults.adapter = adapter;
  return client.client.get('/api/now/table/sys_user');
}

function echoedError(config, data) {
  const error = new Error('request failed');
  error.config = config;
  error.response = { status: 500, data, config };
  return error;
}

describe('enrichServiceNowError', () => {
  test('surfaces the ServiceNow message and detail while preserving response data', () => {
    const error = new Error('Request failed with status code 403');
    error.response = {
      status: 403,
      data: {
        status: 'failure',
        error: {
          message: 'Table access was denied.',
          detail: 'The table is not available through web services.'
        }
      }
    };

    const enriched = enrichServiceNowError(error);

    expect(enriched).toBe(error);
    expect(enriched.message).toBe(
      '403 Table access was denied. The table is not available through web services.'
    );
    expect(enriched.response.data).toBe(error.response.data);
  });
});

test('sanitizes Basic credentials echoed in API error bodies and headers', async () => {
  const password = 'basic-api-secret';
  const auth = `Basic ${Buffer.from(`user:${password}`).toString('base64')}`;
  const client = new ServiceNowClient('https://dev.service-now.com', 'user', password);

  let thrown;
  try {
    await requestFailure(client, async config => {
      throw echoedError(config, {
        status: 'failure',
        error: {
          message: `Authorization ${auth}`,
          authorization: auth,
          password,
          detail: 'keep this diagnostic'
        }
      });
    });
  } catch (error) {
    thrown = error;
  }
  expect(thrown.response.status).toBe(500);
  expect(thrown.response.data.error.authorization).toBeUndefined();
  expect(thrown.response.data.error.password).toBeUndefined();
  expect(thrown.response.data.error.detail).toBe('keep this diagnostic');
  expect(thrown.config.headers.Authorization).toBeUndefined();
  expect(thrown.message).not.toContain(password);
  expect(thrown.stack).not.toContain(password);
  expect(JSON.stringify(thrown)).not.toContain(password);
  expect(JSON.stringify(thrown)).not.toContain(auth);
});

test('sanitizes Bearer credentials echoed in API error bodies and headers', async () => {
  const token = 'bearer-api-secret';
  const client = new ServiceNowClient('https://dev.service-now.com', null, null, {
    authType: 'oauth',
    grantType: 'client_credentials',
    clientId: 'cid',
    clientSecret: 'client-secret'
  });
  client.oauthToken = token;
  client.oauthTokenExpiry = Date.now() + 300000;

  let thrown;
  try {
    await requestFailure(client, async config => {
      throw echoedError(config, {
        status: 'failure',
        error: {
          message: `Bearer ${token}`,
          authorization: `Bearer ${token}`,
          access_token: token,
          detail: 'keep this diagnostic'
        }
      });
    });
  } catch (error) {
    thrown = error;
  }
  expect(thrown.response.status).toBe(500);
  expect(thrown.response.data.error.authorization).toBeUndefined();
  expect(thrown.response.data.error.access_token).toBeUndefined();
  expect(thrown.response.data.error.detail).toBe('keep this diagnostic');
  expect(thrown.config.headers.Authorization).toBeUndefined();
  expect(thrown.message).not.toContain(token);
  expect(thrown.stack).not.toContain(token);
  expect(JSON.stringify(thrown)).not.toContain(token);
});
