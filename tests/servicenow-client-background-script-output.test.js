import { jest } from '@jest/globals';
import { ServiceNowClient, buildBackgroundScriptWrapper } from '../src/servicenow-client.js';

function jsonResponse(result, config, status = 200, statusText = 'OK') {
  return { data: { result }, status, statusText, headers: {}, config };
}

// Pulls the correlation end-marker out of the wrapped script body that was
// PUT back onto the sys_trigger record (that's where the marker literal
// lives for the default autoDelete=true path). The end marker is whatever
// literal directly precedes `+ JSON.stringify({ ok:` — currently
// `<marker>:END`, but this regex doesn't hardcode the suffix so it tracks
// buildBackgroundScriptWrapper's actual format.
function extractEndMarker(captured) {
  const putCall = captured.find(c => c.method === 'put');
  const body = JSON.parse(putCall.data);
  const match = body.script.match(/gs\.info\('([^']+)'\s*\+\s*JSON\.stringify\(\{ ok:/);
  if (!match) {
    throw new Error(`Could not find completion marker in wrapped script:\n${body.script}`);
  }
  return match[1];
}

function queryFor(config) {
  return new URL(config.url, 'https://dev.service-now.com').searchParams.get('sysparm_query');
}

// True for the log-collection query (has both a lower AND an upper
// sys_created_on bound); false for the outcome-poll query (lower bound
// only). See _collectBackgroundScriptLogs / _pollBackgroundScriptOutcome.
function isLogCollectionQuery(config) {
  const query = queryFor(config) || '';
  return query.includes('sys_created_on<=');
}

// Builds the syslog rows a real instance would produce for one execution:
// a start marker line, the script's own log lines (in order), and the end
// marker line carrying the outcome JSON.
function markerRecords(endMarker, outcome, scriptLogs = []) {
  const startMarker = endMarker.replace(/:END$/, ':START');
  return [
    { message: startMarker, sys_created_on: '2026-01-01 00:00:00', source: '*** Script' },
    ...scriptLogs.map((message, index) => ({
      message,
      sys_created_on: `2026-01-01 00:00:0${index + 1}`,
      source: '*** Script'
    })),
    {
      message: `${endMarker}${JSON.stringify(outcome)}`,
      sys_created_on: '2026-01-01 00:00:09',
      source: '*** Script'
    }
  ];
}

// scenario(endMarker, config) -> syslog `result` array for a GET /syslog
// request. Called for BOTH the outcome-poll query and the log-collection
// query; use `isLogCollectionQuery(config)` to tell them apart.
function makeAdapter(captured, scenario) {
  return async config => {
    captured.push(config);
    if (config.method === 'post') {
      return jsonResponse({ sys_id: 'trigger123', name: 'MCP_Script_1704110400000' }, config, 201, 'Created');
    }
    if (config.method === 'put') {
      return jsonResponse({ sys_id: 'trigger123' }, config);
    }
    const endMarker = extractEndMarker(captured);
    return jsonResponse(scenario(endMarker, config), config);
  };
}

function makeClient(captured, scenario) {
  const client = new ServiceNowClient('https://dev.service-now.com', 'user', 'password');
  client.client.defaults.adapter = makeAdapter(captured, scenario);
  return client;
}

describe('buildBackgroundScriptWrapper', () => {
  test('generates syntactically valid JS with matched try/catch/finally, start marker before end marker', () => {
    const generated = buildBackgroundScriptWrapper({
      script: "gs.info('hi');",
      marker: 'MCP_123_abc',
      autoDelete: true,
      triggerSysId: 'trigger123'
    });

    // Pure syntax check: never invoked, so ServiceNow-only globals
    // (GlideRecord, gs) being undefined at call time is irrelevant.
    expect(() => new Function(generated)).not.toThrow();

    expect(generated).toMatch(/\btry\s*{/);
    expect(generated).toMatch(/\bcatch\s*\(e\)\s*{/);
    expect(generated).toMatch(/\bfinally\s*{/);
    expect(generated).toContain("gs.info('MCP_123_abc:START');");
    expect(generated).toContain("gs.info('MCP_123_abc:END' + JSON.stringify({ ok: true }));");
    expect(generated).toContain('e.message');

    const startIndex = generated.indexOf("gs.info('MCP_123_abc:START')");
    const endIndex = generated.indexOf("gs.info('MCP_123_abc:END'");
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(startIndex);
  });

  test('also produces valid JS when autoDelete is false (empty finally)', () => {
    const generated = buildBackgroundScriptWrapper({
      script: "gs.info('hi');",
      marker: 'MCP_123_abc',
      autoDelete: false
    });

    expect(() => new Function(generated)).not.toThrow();
    expect(generated).not.toContain('deleteRecord');
  });
});

describe('executeScriptViaTrigger output capture (wait: true, default)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('completed: exposes the captured output and reports success', async () => {
    const captured = [];
    const client = makeClient(captured, (endMarker, config) => {
      if (isLogCollectionQuery(config)) {
        return markerRecords(endMarker, { ok: true, note: 'it worked' });
      }
      return [{ message: `${endMarker}${JSON.stringify({ ok: true, note: 'it worked' })}`, sys_created_on: '2026-01-01 00:00:01' }];
    });

    const result = await client.executeScriptViaTrigger("gs.info('hi');", 'desc', true);

    expect(result.status).toBe('completed');
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ note: 'it worked' });
    expect(result.trigger_sys_id).toBe('trigger123');
    expect(result.trigger_name).toBe('MCP_Script_1704110400000');
  });

  test('failed: reports failure (not success) and carries the error message', async () => {
    const captured = [];
    const outcome = { ok: false, error: 'Boom', stack: 'Error: Boom\n at somewhere' };
    const client = makeClient(captured, (endMarker, config) => {
      if (isLogCollectionQuery(config)) {
        return markerRecords(endMarker, outcome);
      }
      return [{ message: `${endMarker}${JSON.stringify(outcome)}`, sys_created_on: '2026-01-01 00:00:01' }];
    });

    const result = await client.executeScriptViaTrigger("throw new Error('Boom');", 'desc', true);

    expect(result.status).toBe('failed');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Boom');
    expect(result.stack).toContain('Boom');
    expect(result.trigger_sys_id).toBe('trigger123');
  });

  test('timeout: reports timeout, includes the trigger sys_id, never claims success, and has no logs', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const captured = [];
    const client = makeClient(captured, () => []); // marker never appears

    const resultPromise = client.executeScriptViaTrigger("gs.info('hi');", 'desc', true, {
      timeoutMs: 3000,
      intervalMs: 500
    });

    // Fast-forward past the timeout budget without a real wait.
    await jest.advanceTimersByTimeAsync(5000);

    const result = await resultPromise;

    expect(result.status).toBe('timeout');
    expect(result.success).toBe(false);
    expect(result.trigger_sys_id).toBe('trigger123');
    expect(result.logs).toBeUndefined();
    // No end marker ever appeared, so there is no window to query at all —
    // only the (repeatedly polled) outcome query should have fired.
    expect(captured.some(c => c.method === 'get' && isLogCollectionQuery(c))).toBe(false);
  });

  test('syslog poll query carries a sys_created_on lower bound', async () => {
    const captured = [];
    const client = makeClient(captured, (endMarker, config) => {
      if (isLogCollectionQuery(config)) return markerRecords(endMarker, { ok: true });
      return [{ message: `${endMarker}${JSON.stringify({ ok: true })}`, sys_created_on: '2026-01-01 00:00:01' }];
    });

    await client.executeScriptViaTrigger("gs.info('hi');", 'desc', true);

    const pollCall = captured.find(c => c.method === 'get' && !isLogCollectionQuery(c));
    expect(pollCall).toBeDefined();
    const query = queryFor(pollCall);
    expect(query).toMatch(/sys_created_on>=\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });
});

describe('executeScriptViaTrigger wait: false', () => {
  test('returns immediately without polling syslog', async () => {
    const captured = [];
    const client = makeClient(captured, () => {
      throw new Error('syslog should never be queried when wait is false');
    });

    const result = await client.executeScriptViaTrigger("gs.info('hi');", 'desc', true, { wait: false });

    expect(result.status).toBe('scheduled');
    expect(result.success).toBe(true);
    expect(result.trigger_sys_id).toBe('trigger123');
    expect(result.logs).toBeUndefined();
    expect(captured.some(c => c.method === 'get')).toBe(false);
  });
});

describe('executeScriptViaTrigger log capture', () => {
  test('completed: logs contain the script\'s own lines, in order, excluding both marker lines', async () => {
    const captured = [];
    const scriptLogs = ["Loading account 'demo'", 'Processed 3 records'];
    const client = makeClient(captured, (endMarker, config) => {
      if (isLogCollectionQuery(config)) {
        return markerRecords(endMarker, { ok: true }, scriptLogs);
      }
      return [{ message: `${endMarker}${JSON.stringify({ ok: true })}`, sys_created_on: '2026-01-01 00:00:09' }];
    });

    const result = await client.executeScriptViaTrigger("gs.info('...');", 'desc', true);

    expect(result.status).toBe('completed');
    expect(result.logs).toEqual(scriptLogs);
    expect(result.logsTruncated).toBeUndefined();
  });

  test('failed: logs still contain whatever the script emitted before it threw', async () => {
    const captured = [];
    const scriptLogs = ['about to divide by zero'];
    const outcome = { ok: false, error: 'Division failed' };
    const client = makeClient(captured, (endMarker, config) => {
      if (isLogCollectionQuery(config)) {
        return markerRecords(endMarker, outcome, scriptLogs);
      }
      return [{ message: `${endMarker}${JSON.stringify(outcome)}`, sys_created_on: '2026-01-01 00:00:09' }];
    });

    const result = await client.executeScriptViaTrigger('throw new Error(...);', 'desc', true);

    expect(result.status).toBe('failed');
    expect(result.logs).toEqual(scriptLogs);
  });

  test('log-collection query carries both a lower and an upper sys_created_on bound', async () => {
    const captured = [];
    const client = makeClient(captured, (endMarker, config) => {
      if (isLogCollectionQuery(config)) return markerRecords(endMarker, { ok: true });
      return [{ message: `${endMarker}${JSON.stringify({ ok: true })}`, sys_created_on: '2026-01-01 00:00:09' }];
    });

    await client.executeScriptViaTrigger("gs.info('hi');", 'desc', true);

    const logCall = captured.find(c => c.method === 'get' && isLogCollectionQuery(c));
    expect(logCall).toBeDefined();
    const query = queryFor(logCall);
    expect(query).toMatch(/sys_created_on>=\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    expect(query).toMatch(/sys_created_on<=\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });

  test('excludes marker lines from ANY execution, not just this run\'s own (observed live: same-second timestamp ties do not guarantee execution order)', async () => {
    // A live run against a real instance showed sys_created_on ties are
    // not guaranteed to come back in real execution order, so slicing
    // between "this run's own" marker positions is unsafe. The fix
    // excludes marker-SHAPED lines generically (any MCP_<ts>_<hex>:START
    // or :END), regardless of which execution produced them, so a
    // different, unrelated MCP call's marker landing in this run's query
    // window can never leak its bookkeeping text into `logs` — even if
    // it sorts in between this run's own start and end lines.
    const captured = [];
    const otherExecutionMarker = 'MCP_1700000000000_deadbeef1:END';
    const thisRunLogs = ['this run line A', 'this run line B'];

    const client = makeClient(captured, (endMarker, config) => {
      if (isLogCollectionQuery(config)) {
        return [
          { message: 'MCP_1700000000000_deadbeef1:START', sys_created_on: '2026-01-01 00:00:00' },
          { message: `${otherExecutionMarker}${JSON.stringify({ ok: true })}`, sys_created_on: '2026-01-01 00:00:09' },
          ...markerRecords(endMarker, { ok: true }, thisRunLogs)
        ];
      }
      return [{ message: `${endMarker}${JSON.stringify({ ok: true })}`, sys_created_on: '2026-01-01 00:00:09' }];
    });

    const result = await client.executeScriptViaTrigger("gs.info('hi');", 'desc', true);

    expect(result.status).toBe('completed');
    // The unrelated execution's marker text never appears...
    expect(result.logs.join(' ')).not.toContain('deadbeef1');
    expect(result.logs.join(' ')).not.toMatch(/MCP_\d+_[0-9a-f]+:(START|END)/);
    // ...but this run's own real content still comes through untouched.
    expect(result.logs).toEqual(expect.arrayContaining(thisRunLogs));
  });

  test('the log-collection lower bound is the trigger\'s own next_action, not a generic lookback buffer', async () => {
    // A generic multi-second lookback (used for the outcome-poll query,
    // which is fine since messageLIKE<unique marker> already scopes it)
    // is too loose for the log-collection query: it let an EARLIER,
    // already-finished MCP call's own log lines bleed into this run's
    // window (observed live). The script cannot have logged anything
    // before its trigger's own next_action fires, so that is the correct,
    // tight lower bound.
    const captured = [];
    const client = makeClient(captured, (endMarker, config) => {
      if (isLogCollectionQuery(config)) return markerRecords(endMarker, { ok: true });
      return [{ message: `${endMarker}${JSON.stringify({ ok: true })}`, sys_created_on: '2026-01-01 00:00:09' }];
    });

    await client.executeScriptViaTrigger("gs.info('hi');", 'desc', true);

    const postCall = captured.find(c => c.method === 'post');
    const nextAction = JSON.parse(postCall.data).next_action;

    const logCall = captured.find(c => c.method === 'get' && isLogCollectionQuery(c));
    const query = queryFor(logCall);
    expect(query).toContain(`sys_created_on>=${nextAction}`);
  });


  test('truncates past the line cap and flags it, without dropping the marker exclusion', async () => {
    const captured = [];
    const manyLines = Array.from({ length: 150 }, (_, i) => `line ${i}`);
    const client = makeClient(captured, (endMarker, config) => {
      if (isLogCollectionQuery(config)) return markerRecords(endMarker, { ok: true }, manyLines);
      return [{ message: `${endMarker}${JSON.stringify({ ok: true })}`, sys_created_on: '2026-01-01 00:00:09' }];
    });

    const result = await client.executeScriptViaTrigger("gs.info('hi');", 'desc', true);

    expect(result.status).toBe('completed');
    expect(result.logs).toHaveLength(100);
    expect(result.logs[0]).toBe('line 0');
    expect(result.logsTruncated).toBe(true);
  });

  test('flags logsWindowUnverified instead of silently returning empty logs when the window misses this run\'s own end marker (e.g. host/instance clock skew)', async () => {
    // sinceDateTime (this run's own next_action) is computed from the
    // MCP host's clock with no skew buffer. If the host clock runs ahead
    // of the instance, the range query can miss this run's own rows
    // entirely -- including its own end marker, which the outcome poll
    // (a separate, looser query) just found moments ago. An empty `logs`
    // in that case must not look identical to a script that genuinely
    // printed nothing.
    const captured = [];
    const client = makeClient(captured, (endMarker, config) => {
      if (isLogCollectionQuery(config)) {
        // The range query comes back empty: the window missed the real
        // timestamps entirely.
        return [];
      }
      return [{ message: `${endMarker}${JSON.stringify({ ok: true })}`, sys_created_on: '2026-01-01 00:00:09' }];
    });

    const result = await client.executeScriptViaTrigger("gs.info('hi');", 'desc', true);

    expect(result.status).toBe('completed');
    expect(result.logsWindowUnverified).toBe(true);
    expect(result.logs).toEqual([]);
  });

  test('does not flag logsWindowUnverified when this run\'s own end marker is present in the window', async () => {
    const captured = [];
    const client = makeClient(captured, (endMarker, config) => {
      if (isLogCollectionQuery(config)) return markerRecords(endMarker, { ok: true }, ['real line']);
      return [{ message: `${endMarker}${JSON.stringify({ ok: true })}`, sys_created_on: '2026-01-01 00:00:09' }];
    });

    const result = await client.executeScriptViaTrigger("gs.info('hi');", 'desc', true);

    expect(result.status).toBe('completed');
    expect(result.logsWindowUnverified).toBeUndefined();
    expect(result.logs).toEqual(['real line']);
  });
});
