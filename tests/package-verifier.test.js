import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { describe, expect, jest, test, afterEach } from '@jest/globals';
import {
  closeListener,
  createVerifierCleanupTasks,
  listenOnLoopback,
  normalizeThrownValue,
  postInitialize,
  run,
  runWithCleanup
} from '../scripts/verify-package.mjs';

afterEach(() => {
  jest.useRealTimers();
});

describe('package verifier subprocess diagnostics', () => {
  test('reports nonzero status, signal state, stdout, and stderr', () => {
    expect(() => run(
      process.execPath,
      ['-e', 'process.stdout.write("verifier-out"); process.stderr.write("verifier-err"); process.exit(7)'],
      tmpdir(),
      2_000
    )).toThrow(/failed \(status 7, signal none\)[\s\S]*verifier-out[\s\S]*verifier-err/);
  });

  test('reports timeout, kill signal, and termination status', () => {
    expect(() => run(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1_000)'],
      tmpdir(),
      25
    )).toThrow(/timed out after 25 ms and was sent SIGKILL \(status null, signal (?:SIGKILL|none)\)/);
  });
});

describe('package verifier listener lifecycle', () => {
  test('removes startup listeners after an error', async () => {
    const listener = new EventEmitter();
    listener.listen = jest.fn(() => queueMicrotask(() => listener.emit('error', new Error('bind failed'))));

    await expect(listenOnLoopback(listener, 100)).rejects.toThrow('bind failed');
    expect(listener.listenerCount('error')).toBe(0);
    expect(listener.listenerCount('listening')).toBe(0);
  });

  test('times out startup and removes both listeners', async () => {
    jest.useFakeTimers();
    const listener = new EventEmitter();
    listener.listen = jest.fn();

    const pending = expect(listenOnLoopback(listener, 25))
      .rejects.toThrow('startup timed out after 25 ms');
    await jest.advanceTimersByTimeAsync(25);
    await pending;
    expect(listener.listenerCount('error')).toBe(0);
    expect(listener.listenerCount('listening')).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('removes close error listener after callback error', async () => {
    const listener = new EventEmitter();
    listener.closeAllConnections = jest.fn();
    listener.close = jest.fn((callback) => queueMicrotask(() => callback(new Error('close failed'))));

    await expect(closeListener(listener, 100)).rejects.toThrow('close failed');
    expect(listener.listenerCount('error')).toBe(0);
  });

  test('forces connections closed on close timeout and removes error listener', async () => {
    jest.useFakeTimers();
    const listener = new EventEmitter();
    listener.closeAllConnections = jest.fn();
    listener.close = jest.fn();

    const pending = expect(closeListener(listener, 25))
      .rejects.toThrow('close timed out after 25 ms');
    await jest.advanceTimersByTimeAsync(25);
    await pending;
    expect(listener.closeAllConnections).toHaveBeenCalledTimes(2);
    expect(listener.listenerCount('error')).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('package verifier initialize request lifecycle', () => {
  function createRequestHarness(onEnd) {
    const request = new EventEmitter();
    const response = new EventEmitter();
    response.headers = { 'content-type': 'application/json' };
    response.statusCode = 200;
    response.destroy = jest.fn();
    request.destroy = jest.fn();
    request.end = jest.fn(() => onEnd(request, response));
    const requestImplementation = jest.fn((options, onResponse) => {
      request.options = options;
      request.onResponse = onResponse;
      return request;
    });
    return { request, requestImplementation, response };
  }

  test('rejects an aborted response and removes request and response listeners', async () => {
    jest.useFakeTimers();
    const harness = createRequestHarness((_request, response) => {
      harness.request.onResponse(response);
      response.emit('aborted');
    });

    await expect(postInitialize(1234, {
      requestImplementation: harness.requestImplementation,
      timeoutMs: 100
    })).rejects.toThrow('response was aborted');

    expect(harness.request.listenerCount('error')).toBe(0);
    expect(harness.response.listenerCount('data')).toBe(0);
    expect(harness.response.listenerCount('error')).toBe(0);
    expect(harness.response.listenerCount('aborted')).toBe(0);
    expect(harness.response.listenerCount('end')).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('enforces a full-response deadline, aborts I/O, and removes listeners', async () => {
    jest.useFakeTimers();
    const harness = createRequestHarness((_request, response) => {
      harness.request.onResponse(response);
      response.emit('data', Buffer.from('{"jsonrpc":"2.0"'));
    });
    harness.request.destroy.mockImplementation(() => {
      queueMicrotask(() => harness.request.emit('error', new Error('abort side effect')));
    });

    const pending = expect(postInitialize(1234, {
      requestImplementation: harness.requestImplementation,
      timeoutMs: 25
    })).rejects.toThrow('timed out after 25 ms before the complete response body was received');
    await jest.advanceTimersByTimeAsync(25);
    await pending;
    expect(harness.request.options.signal.aborted).toBe(true);
    expect(harness.request.destroy).toHaveBeenCalledTimes(1);
    expect(harness.response.destroy).toHaveBeenCalledTimes(1);
    expect(harness.request.listenerCount('error')).toBe(0);
    expect(harness.response.listenerCount('data')).toBe(0);
    expect(harness.response.listenerCount('error')).toBe(0);
    expect(harness.response.listenerCount('aborted')).toBe(0);
    expect(harness.response.listenerCount('end')).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('package verifier error normalization and cleanup orchestration', () => {
  test.each([
    [undefined, 'undefined'],
    [null, 'null'],
    [false, 'false'],
    [0, '0'],
    ['', "''"]
  ])('normalizes falsy non-Error value %p', (value, rendered) => {
    const error = normalizeThrownValue(value, 'probe');
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain(rendered);
    expect(error.cause).toBe(value);
  });

  test('returns the primary result when cleanup succeeds', async () => {
    await expect(runWithCleanup(
      async () => 'verified',
      [async () => undefined]
    )).resolves.toBe('verified');
  });

  test('throws cleanup-only failures', async () => {
    const cleanupError = new Error('cleanup only');
    const caught = await runWithCleanup(
      async () => 'verified',
      [async () => { throw cleanupError; }]
    ).catch((error) => error);

    expect(caught).toBeInstanceOf(AggregateError);
    expect(caught.errors).toEqual([cleanupError]);
  });

  test('preserves primary failure before every cleanup failure', async () => {
    const primaryError = new Error('primary');
    const firstCleanupError = new Error('first cleanup');
    const secondCleanupError = new Error('second cleanup');
    const calls = [];
    const caught = await runWithCleanup(
      async () => { throw primaryError; },
      [
        async () => { calls.push('first'); throw firstCleanupError; },
        async () => { calls.push('second'); throw secondCleanupError; }
      ]
    ).catch((error) => error);

    expect(calls).toEqual(['first', 'second']);
    expect(caught).toBeInstanceOf(AggregateError);
    expect(caught.errors).toEqual([primaryError, firstCleanupError, secondCleanupError]);
  });

  test('normalizes falsy primary and cleanup rejections in order', async () => {
    const caught = await runWithCleanup(
      async () => { throw 0; },
      [async () => { throw false; }]
    ).catch((error) => error);

    expect(caught).toBeInstanceOf(AggregateError);
    expect(caught.errors).toHaveLength(2);
    expect(caught.errors[0].message).toContain('non-Error value: 0');
    expect(caught.errors[0].cause).toBe(0);
    expect(caught.errors[1].message).toContain('non-Error value: false');
    expect(caught.errors[1].cause).toBe(false);
  });

  test('partial initialization cleans every acquired resource and aggregates workspace removal failure', async () => {
    const calls = [];
    const transportError = new Error('transport close failed');
    const workspaceError = new Error('workspace removal failed');
    const resources = {
      transport: { close: jest.fn(async () => { calls.push('transport'); throw transportError; }) },
      server: { close: jest.fn(async () => { calls.push('server'); }) },
      listener: { id: 'listener' },
      workspace: '/tmp/package-verifier-partial'
    };
    const closeListenerImplementation = jest.fn(async () => { calls.push('listener'); });
    const removeWorkspace = jest.fn(async () => { calls.push('workspace'); throw workspaceError; });
    const primaryError = new Error('initialize failed');

    const caught = await runWithCleanup(
      async () => { throw primaryError; },
      createVerifierCleanupTasks(resources, {
        closeListenerImplementation,
        removeWorkspace,
        resourceTimeoutMs: 100,
        workspaceTimeoutMs: 100
      })
    ).catch((error) => error);

    expect(calls).toEqual(['transport', 'server', 'listener', 'workspace']);
    expect(closeListenerImplementation).toHaveBeenCalledWith(resources.listener, 100);
    expect(removeWorkspace).toHaveBeenCalledWith(resources.workspace, { recursive: true, force: true });
    expect(caught).toBeInstanceOf(AggregateError);
    expect(caught.errors).toEqual([primaryError, transportError, workspaceError]);
  });
});
