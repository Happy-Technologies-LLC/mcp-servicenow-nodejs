import { enrichServiceNowError } from '../src/servicenow-client.js';

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
