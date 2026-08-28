import { jest } from '@jest/globals';
import { ServiceNowClient } from '../src/servicenow-client.js';

function captureAdapter(captured) {
  return async config => {
    captured.push(config);
    if (config.method === 'post') {
      // Creating the sys_trigger record
      return {
        data: { result: { sys_id: 'trigger123', name: 'MCP_Script_1704110400000' } },
        status: 201,
        statusText: 'Created',
        headers: {},
        config
      };
    }
    // Updating the sys_trigger record with the auto-delete wrapper
    return {
      data: { result: { sys_id: 'trigger123' } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config
    };
  };
}

describe('executeScriptViaTrigger next_action formatting', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('formats next_action as UTC, not local time', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-28T12:00:00Z'));

    const client = new ServiceNowClient('https://dev.service-now.com', 'user', 'password');
    const captured = [];
    client.client.defaults.adapter = captureAdapter(captured);

    const result = await client.executeScriptViaTrigger("gs.info('hi');", 'Test script', true);

    expect(result.next_action).toBe('2026-08-28 12:00:01');
    expect(result.message).toContain('2026-08-28 12:00:01');

    // Confirm the exact same UTC-formatted string was POSTed to the Table API
    // as the raw glide_date_time value (the API interprets it as UTC).
    const createCall = captured.find(c => c.method === 'post');
    const body = JSON.parse(createCall.data);
    expect(body.next_action).toBe('2026-08-28 12:00:01');
  });
});
