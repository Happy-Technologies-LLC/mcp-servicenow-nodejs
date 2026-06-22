/**
 * Tests for the error-surfacing and background-script-output helpers in
 * servicenow-client.js:
 *  - enrichServiceNowError: surface the ServiceNow REST error body (issue: opaque errors)
 *  - buildOutputCaptureScript: wrap a background script to capture its output (issue: no output)
 */

import {
  enrichServiceNowError,
  buildOutputCaptureScript,
} from '../src/servicenow-client.js';

describe('enrichServiceNowError', () => {
  it('surfaces ServiceNow error.message and error.detail from the response body', () => {
    const err = new Error('Request failed with status code 403');
    err.response = {
      status: 403,
      data: {
        error: {
          message: "Operation against file 'sn_audit_engagement' was denied due to table security.",
          detail: 'Field(s) present in the query do not have permission to be read.',
        },
        status: 'failure',
      },
    };

    const result = enrichServiceNowError(err);

    expect(result).toBe(err); // same object, mutated
    expect(result.message).toContain('403');
    expect(result.message).toContain('table security');
    expect(result.message).toContain('do not have permission');
    expect(result.response).toBeDefined(); // structured data preserved
  });

  it('uses a string body when there is no structured error', () => {
    const err = new Error('Request failed with status code 500');
    err.response = { status: 500, data: 'Transaction cancelled: maximum execution time exceeded' };

    expect(enrichServiceNowError(err).message).toBe(
      '500: Transaction cancelled: maximum execution time exceeded'
    );
  });

  it('falls back to the original message when there is no body', () => {
    const err = new Error('Network Error');
    expect(enrichServiceNowError(err).message).toBe('Network Error');
  });
});

describe('buildOutputCaptureScript', () => {
  it('embeds the marker, the user script, and a JSON result emit', () => {
    const wrapped = buildOutputCaptureScript('gs.info("hi"); return 42;', 'MCPOUT_test');

    expect(wrapped).toContain('MCPOUT_test');
    expect(wrapped).toContain('gs.info("hi"); return 42;');
    expect(wrapped).toContain('new JSON().encode(__mcpPayload)');
    expect(wrapped).toContain('__mcpError'); // captures thrown errors
  });
});
