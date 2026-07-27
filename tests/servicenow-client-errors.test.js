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

    expect(enriched).not.toBe(error);
    expect(enriched.message).toBe(
      '403 Table access was denied. The table is not available through web services.'
    );
    expect(enriched.response.data).toEqual(error.response.data);
    expect(enriched.response.data).not.toBe(error.response.data);
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
  expect(thrown.config.headers).toBeUndefined();
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
  expect(thrown.config.headers).toBeUndefined();
  expect(thrown.message).not.toContain(token);
  expect(thrown.stack).not.toContain(token);
  expect(JSON.stringify(thrown)).not.toContain(token);
});
test('returns a safe cycle-free copy for frozen nested Axios-like errors', () => {
  const password = 'frozen-password-secret';
  const auth = `Basic ${Buffer.from(`user:${password}`).toString('base64')}`;
  const config = {
    baseURL: 'https://dev.service-now.com',
    headers: { Authorization: auth, 'X-Diagnostic': 'keep' }
  };
  config.self = config;
  const responseData = {
    error: {
      message: `Authorization ${auth}`,
      password,
      detail: 'retain this diagnostic'
    }
  };
  const response = { status: 502, data: responseData, config };
  response.repeated = responseData;
  const error = new Error(`request failed with ${password}`);
  error.code = 'ERR_BAD_RESPONSE';
  error.config = config;
  error.response = response;
  error.toJSON = () => ({ message: error.message, config, response, payload: responseData });
  Object.freeze(config.headers);
  Object.freeze(config);
  Object.freeze(responseData.error);
  Object.freeze(responseData);
  Object.freeze(response);
  Object.freeze(error);
  const beforeMessage = error.message;
  const beforeConfig = error.config;

  const safe = enrichServiceNowError(error, {
    username: 'user',
    password
  });

  expect(safe).not.toBe(error);
  expect(safe).toBeInstanceOf(Error);
  expect(safe.code).toBe('ERR_BAD_RESPONSE');
  expect(safe.response.status).toBe(502);
  expect(safe.response.data.error.password).toBeUndefined();
  expect(safe.response.data.error.detail).toBe('retain this diagnostic');
  expect(safe.config.headers).toBeUndefined();
  expect(error.message).toBe(beforeMessage);
  expect(error.config).toBe(beforeConfig);
  expect(() => JSON.stringify(safe)).not.toThrow();
  const serialized = JSON.stringify(safe);
  expect(serialized).not.toContain(password);
  expect(serialized).not.toContain(auth);
  expect(serialized).toContain('[Circular]');
});
