import { ServiceNowClient } from '../src/servicenow-client.js';

function captureAdapter(captured) {
  return async config => {
    captured.push(config);
    return { data: { result: [] }, status: 200, statusText: 'OK', headers: {}, config };
  };
}

describe('getRecords pagination parameters', () => {
  test('forwards sysparm_offset and sysparm_order_by to the Table API', async () => {
    const client = new ServiceNowClient('https://dev.service-now.com', 'user', 'password');
    const captured = [];
    client.client.defaults.adapter = captureAdapter(captured);

    await client.getRecords('incident', {
      sysparm_query: 'active=true',
      sysparm_limit: 5,
      sysparm_fields: 'sys_id,short_description',
      sysparm_offset: 10,
      sysparm_order_by: 'sys_created_on'
    });

    expect(captured).toHaveLength(1);
    const url = new URL(captured[0].url, 'https://dev.service-now.com');
    expect(url.pathname).toBe('/api/now/table/incident');
    expect(url.searchParams.get('sysparm_query')).toBe('active=true');
    expect(url.searchParams.get('sysparm_limit')).toBe('5');
    expect(url.searchParams.get('sysparm_fields')).toBe('sys_id,short_description');
    expect(url.searchParams.get('sysparm_offset')).toBe('10');
    expect(url.searchParams.get('sysparm_order_by')).toBe('sys_created_on');
  });

  test('supports descending order_by as documented by SN-Query-Table', async () => {
    const client = new ServiceNowClient('https://dev.service-now.com', 'user', 'password');
    const captured = [];
    client.client.defaults.adapter = captureAdapter(captured);

    await client.getRecords('change_request', {
      sysparm_limit: 1,
      sysparm_order_by: '-sys_created_on'
    });

    const url = new URL(captured[0].url, 'https://dev.service-now.com');
    expect(url.searchParams.get('sysparm_order_by')).toBe('-sys_created_on');
  });

  test('omits pagination params when they are not provided', async () => {
    const client = new ServiceNowClient('https://dev.service-now.com', 'user', 'password');
    const captured = [];
    client.client.defaults.adapter = captureAdapter(captured);

    await client.getRecords('incident', { sysparm_limit: 25 });

    const url = new URL(captured[0].url, 'https://dev.service-now.com');
    expect(url.searchParams.has('sysparm_offset')).toBe(false);
    expect(url.searchParams.has('sysparm_order_by')).toBe(false);
  });
});
