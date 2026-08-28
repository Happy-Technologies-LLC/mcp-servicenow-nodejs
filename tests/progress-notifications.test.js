/**
 * Regression tests for MCP progress notifications.
 *
 * Covers:
 * - #58: notifications/progress payloads must be spec-compliant
 *   (progressToken echoed, numeric progress, human text in `message`),
 *   and must never be sent for a request that supplied no progressToken.
 * - #50: server.notification() rejections must be handled, never left
 *   as an unhandled promise rejection that could crash the process.
 * - Concurrency fix (post #58/#50): the progressToken and the monotonic
 *   `progress` counter live in a per-request AsyncLocalStorage store, not
 *   on the (memoized, cross-request-shared) ServiceNow client instance.
 *   Two concurrent tool calls sharing one client must not cross-talk:
 *   neither request's token, progress counter, nor a dropped-notification
 *   suppression may leak into the other.
 */

import { describe, expect, jest, test } from '@jest/globals';
import { createMcpServer } from '../src/mcp-server-consolidated.js';

/**
 * A minimal stand-in for ServiceNowClient's progress plumbing:
 * setProgressCallback/notifyProgress, matching the real class's shapes
 * closely enough for configureProgressNotifications to wire up against it.
 * There is deliberately no client-instance progressToken state -- the
 * production client no longer has any, and the per-request token now
 * lives entirely in the server's AsyncLocalStorage store, reachable only
 * by going through the real `tools/call` request handler.
 */
function createFakeClient() {
  const client = {};
  client.progressCallback = null;
  client.setProgressCallback = (callback) => {
    client.progressCallback = callback;
  };
  client.notifyProgress = (message, current, total) => {
    if (client.progressCallback) {
      client.progressCallback(message, current, total);
    }
  };
  // Overridden per-test to emit progress at controlled points.
  client.getRecords = async () => [];
  return client;
}

async function createHarness() {
  const client = createFakeClient();
  const server = await createMcpServer(client);
  server.notification = jest.fn();
  const callToolHandler = server._requestHandlers.get('tools/call');

  // Drives a request through the *real* CallToolRequestSchema handler, so
  // the per-request AsyncLocalStorage store configureProgressNotifications
  // reads from is actually populated the way production traffic populates it.
  const callTool = (name, args, progressToken) => callToolHandler({
    method: 'tools/call',
    params: {
      name,
      arguments: args,
      ...(progressToken !== undefined ? { _meta: { progressToken } } : {})
    }
  }, {});

  return { client, server, callTool };
}

function createDeferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('progress notifications', () => {
  test('sends nothing when the request supplied no progressToken', async () => {
    const { client, server, callTool } = await createHarness();
    client.getRecords = async () => {
      client.notifyProgress('Doing work', 1, 3);
      return [];
    };

    // No progressToken argument -- the store's token resolves to null.
    await callTool('SN-Query-Table', { table_name: 'incident' });

    expect(server.notification).not.toHaveBeenCalled();
  });

  test('sends a spec-correct payload once a progressToken is present', async () => {
    const { client, server, callTool } = await createHarness();
    server.notification.mockReturnValue(Promise.resolve());
    client.getRecords = async () => {
      client.notifyProgress('Creating record 1/3', 1, 3);
      return [];
    };

    await callTool('SN-Query-Table', { table_name: 'incident' }, 'token-123');

    expect(server.notification).toHaveBeenCalledTimes(1);
    const [{ method, params }] = server.notification.mock.calls[0];

    expect(method).toBe('notifications/progress');
    expect(params.progressToken).toBe('token-123');
    expect(typeof params.progress).toBe('number');
    expect(params.progress).toBe(1);
    expect(params.total).toBe(3);
    expect(params.message).toBe('Creating record 1/3');
  });

  test('produces strictly increasing progress across successive callbacks', async () => {
    const { client, server, callTool } = await createHarness();
    server.notification.mockReturnValue(Promise.resolve());
    client.getRecords = async () => {
      client.notifyProgress('step 1', 1, 5);
      client.notifyProgress('step 1 again', 1, 5); // non-increasing current must still be bumped
      client.notifyProgress('step 3', 3, 5);
      return [];
    };

    await callTool('SN-Query-Table', { table_name: 'incident' }, 'token-abc');

    const progressValues = server.notification.mock.calls.map(([{ params }]) => params.progress);

    expect(progressValues).toHaveLength(3);
    for (let i = 1; i < progressValues.length; i++) {
      expect(progressValues[i]).toBeGreaterThan(progressValues[i - 1]);
    }
  });

  test('regression #50: a rejected notification() does not become an unhandled rejection', async () => {
    const { client, server, callTool } = await createHarness();
    server.notification.mockReturnValue(Promise.reject(new Error('Not connected')));
    client.getRecords = async () => {
      client.notifyProgress('will fail', 1, 2);
      return [];
    };

    const unhandledRejections = [];
    const onUnhandledRejection = (reason) => unhandledRejections.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      await expect(callTool('SN-Query-Table', { table_name: 'incident' }, 'token-xyz')).resolves.toBeDefined();

      // Flush the microtask queue so the rejection handler has a chance to run.
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandledRejections).toHaveLength(0);
    } finally {
      process.removeListener('unhandledRejection', onUnhandledRejection);
    }
  });

  test('a dropped notification suppresses only its own request, never the shared callback', async () => {
    const { client, server, callTool } = await createHarness();
    server.notification.mockReturnValueOnce(Promise.reject(new Error('Not connected')));
    server.notification.mockReturnValue(Promise.resolve());

    client.getRecords = async () => {
      client.notifyProgress('will fail', 1, 2);
      // Give the rejection handler a chance to mark this request's store as failed.
      await new Promise((resolve) => setImmediate(resolve));
      client.notifyProgress('should not send', 2, 2);
      return [];
    };

    await callTool('SN-Query-Table', { table_name: 'incident' }, 'token-drop');

    // Only the first (subsequently-rejected) notification was ever sent.
    expect(server.notification).toHaveBeenCalledTimes(1);
    // The shared callback itself is still installed -- unlike the old design,
    // a dropped notification never calls setProgressCallback(null).
    expect(typeof client.progressCallback).toBe('function');

    server.notification.mockClear();
    server.notification.mockReturnValue(Promise.resolve());

    // A brand-new request gets its own fresh store and is unaffected by the
    // previous request's failure.
    client.getRecords = async () => {
      client.notifyProgress('fresh request works', 1, 1);
      return [];
    };
    await callTool('SN-Query-Table', { table_name: 'incident' }, 'token-fresh');

    expect(server.notification).toHaveBeenCalledTimes(1);
  });

  test('interleaved concurrent requests keep independent per-request progress state (regression for shared client-instance token/counter)', async () => {
    const { client, server, callTool } = await createHarness();

    // Deterministically interleave two concurrent requests' progress
    // emissions via hand-off gates instead of real timers/sleeps:
    //   A emits #1 -> B emits #1 -> A emits #2 (rejected) -> A emits #3
    //   (suppressed) -> A's request resolves -> B emits #2 -> B's request
    //   resolves.
    const bMayEmit1 = createDeferred();
    const aMayEmit2 = createDeferred();
    const bMayEmit2AfterARequestSettled = createDeferred();

    // Reject exactly request A's second notification (progressToken 'A',
    // progress 2) to simulate a single dropped transport write; everything
    // else succeeds.
    server.notification.mockImplementation(({ params }) => {
      if (params.progressToken === 'A' && params.progress === 2) {
        return Promise.reject(new Error('transport dropped'));
      }
      return Promise.resolve();
    });

    client.getRecords = async (tableName) => {
      if (tableName === 'requestA') {
        client.notifyProgress('a1', 1, 10);
        bMayEmit1.resolve();

        await aMayEmit2.promise;
        client.notifyProgress('a2', 2, 10); // rejected

        // Let the rejection's .catch handler mark this request's store failed
        // before attempting another emission on the same request.
        await new Promise((resolve) => setImmediate(resolve));
        client.notifyProgress('a3', 3, 10); // must be suppressed

        return [];
      }

      if (tableName === 'requestB') {
        await bMayEmit1.promise;
        client.notifyProgress('b1', 1, 10);
        aMayEmit2.resolve();

        // Only proceed once request A has fully resolved (its store has
        // gone out of scope) -- proves A finishing can't silence B.
        await bMayEmit2AfterARequestSettled.promise;
        client.notifyProgress('b2', 2, 10);

        return [];
      }

      throw new Error(`unexpected table ${tableName}`);
    };

    const requestA = callTool('SN-Query-Table', { table_name: 'requestA' }, 'A');
    const requestB = callTool('SN-Query-Table', { table_name: 'requestB' }, 'B');

    await requestA;
    bMayEmit2AfterARequestSettled.resolve();
    await requestB;

    const calls = server.notification.mock.calls.map(([{ params }]) => params);

    // 1. Every notification carries the token of the request that actually
    //    emitted it -- no notification from A's work carries token 'B' (or
    //    vice versa), and 'a3' never sent at all.
    expect(calls.map((p) => [p.progressToken, p.progress])).toEqual([
      ['A', 1],
      ['B', 1],
      ['A', 2],
      ['B', 2]
    ]);
    expect(calls.some((p) => p.progressToken === 'A' && p.progress === 3)).toBe(false);
    expect(server.notification).toHaveBeenCalledTimes(4);

    // 2. progress is strictly increasing WITHIN each token's own stream.
    for (const token of ['A', 'B']) {
      const stream = calls.filter((p) => p.progressToken === token).map((p) => p.progress);
      expect(stream.length).toBeGreaterThan(0);
      for (let i = 1; i < stream.length; i++) {
        expect(stream[i]).toBeGreaterThan(stream[i - 1]);
      }
    }

    // 3. Request A completing (and its store going out of scope) does not
    //    silence request B's subsequent notification: b2 was emitted, and
    //    sent, strictly after `requestA` had already resolved.
    expect(calls.filter((p) => p.progressToken === 'B')).toHaveLength(2);

    // 4. A rejected notification during request A sets only A's suppression:
    //    request B's later notification still sends.
    expect(calls.filter((p) => p.progressToken === 'A')).toHaveLength(2); // a1, a2 only (a3 suppressed)
    expect(calls[calls.length - 1]).toEqual({ progressToken: 'B', progress: 2, message: 'b2', total: 10 });
  });
});
