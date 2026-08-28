import { jest } from '@jest/globals';

/**
 * Issue #50: a single unhandled promise rejection anywhere in the process
 * (e.g. a dropped notification on one MCP session) must never take down
 * every other concurrent session. Node >=15 turns an unhandled rejection
 * into a fatal crash unless a process-level `unhandledRejection` listener
 * is registered, so every entrypoint must install one at process start.
 *
 * All three entrypoints share a single `installProcessCrashGuards`
 * implementation in `src/process-guards.js`. That module tracks
 * registration with a module-scoped flag (not `process.listenerCount`),
 * so every test below calls `jest.resetModules()` first to get a fresh,
 * not-yet-installed copy of `process-guards.js` - otherwise a listener
 * installed by an earlier test would make later `installProcessCrashGuards`
 * calls no-ops, and process-level listener counts would leak across tests.
 *
 * `src/http-server.js` and `src/stdio-server.js` are safe to import
 * directly in a unit test: importing them only defines functions/exports
 * and registers the process guards, it does not bind a port or spawn a
 * transport (`main()`/`app.listen()` only run when the module is executed
 * directly, not on import).
 *
 * `src/server.js` is different: it is a plain bootstrap script with no
 * "only run when invoked directly" guard, so importing it executes the
 * full HTTP server bootstrap (reads ServiceNow instance config, binds a
 * real network port). That is unsafe inside a Jest worker, and no existing
 * test in this suite imports it for that reason either. Its guard
 * registration is instead verified statically, by asserting the source
 * imports and calls the shared `installProcessCrashGuards` before it does
 * anything else observable (dotenv config aside).
 */

function removeIfPresent(event, listener) {
  if (listener) {
    process.removeListener(event, listener);
  }
}

describe('process-guards.js (unit)', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('createUnhandledRejectionHandler logs and never rethrows', async () => {
    const { createUnhandledRejectionHandler } = await import('../src/process-guards.js');
    const handler = createUnhandledRejectionHandler('test-label');

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => handler(new Error('boom'), Promise.resolve())).not.toThrow();
      expect(errorSpy).toHaveBeenCalledWith(
        '[test-label] Unhandled promise rejection (process kept alive):',
        expect.stringContaining('boom')
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('createUncaughtExceptionHandler logs and exits the process', async () => {
    const { createUncaughtExceptionHandler } = await import('../src/process-guards.js');
    const handler = createUncaughtExceptionHandler('test-label');

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    // Stub process.exit so a real exit can never fire inside the jest
    // worker, regardless of what the handler does.
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    try {
      handler(new Error('kaboom'));
      expect(errorSpy).toHaveBeenCalledWith(
        '[test-label] Uncaught exception (process exiting):',
        expect.stringContaining('kaboom')
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  test('installProcessCrashGuards registers exactly one handler per event', async () => {
    const { installProcessCrashGuards } = await import('../src/process-guards.js');

    const before = {
      rejection: process.listenerCount('unhandledRejection'),
      exception: process.listenerCount('uncaughtException')
    };

    const installed = installProcessCrashGuards('test-label');
    try {
      expect(installed).not.toBeNull();
      expect(typeof installed.handleUnhandledRejection).toBe('function');
      expect(typeof installed.handleUncaughtException).toBe('function');
      expect(process.listenerCount('unhandledRejection')).toBe(before.rejection + 1);
      expect(process.listenerCount('uncaughtException')).toBe(before.exception + 1);
      expect(process.listeners('unhandledRejection')).toContain(installed.handleUnhandledRejection);
      expect(process.listeners('uncaughtException')).toContain(installed.handleUncaughtException);
    } finally {
      removeIfPresent('unhandledRejection', installed?.handleUnhandledRejection);
      removeIfPresent('uncaughtException', installed?.handleUncaughtException);
    }
  });

  test('calling installProcessCrashGuards again does not add more listeners', async () => {
    const { installProcessCrashGuards } = await import('../src/process-guards.js');

    const first = installProcessCrashGuards('test-label');
    try {
      const countBeforeSecondCall = {
        rejection: process.listenerCount('unhandledRejection'),
        exception: process.listenerCount('uncaughtException')
      };

      const second = installProcessCrashGuards('other-label');

      expect(second).toBeNull();
      expect(process.listenerCount('unhandledRejection')).toBe(countBeforeSecondCall.rejection);
      expect(process.listenerCount('uncaughtException')).toBe(countBeforeSecondCall.exception);
    } finally {
      removeIfPresent('unhandledRejection', first?.handleUnhandledRejection);
      removeIfPresent('uncaughtException', first?.handleUncaughtException);
    }
  });
});

describe.each([
  ['../src/http-server.js'],
  ['../src/stdio-server.js']
])('process crash guards wired up by %s', (modulePath) => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('importing the module registers our unhandledRejection/uncaughtException handlers', async () => {
    const beforeRejection = new Set(process.listeners('unhandledRejection'));
    const beforeException = new Set(process.listeners('uncaughtException'));

    await import(modulePath);

    const newRejectionListeners = process.listeners('unhandledRejection').filter((fn) => !beforeRejection.has(fn));
    const newExceptionListeners = process.listeners('uncaughtException').filter((fn) => !beforeException.has(fn));

    try {
      // jest.resetModules() guarantees process-guards.js is freshly
      // evaluated (its `installed` flag starts false) for this import, so
      // any listener registered here is unambiguously ours - not a
      // pre-existing listener owned by jest or some other library.
      expect(newRejectionListeners).toHaveLength(1);
      expect(newExceptionListeners).toHaveLength(1);

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        expect(() => newRejectionListeners[0](new Error('boom'), Promise.resolve())).not.toThrow();
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    } finally {
      for (const listener of newRejectionListeners) {
        process.removeListener('unhandledRejection', listener);
      }
      for (const listener of newExceptionListeners) {
        process.removeListener('uncaughtException', listener);
      }
    }
  });
});

describe('process crash guards registered by src/server.js (static check)', () => {
  test('imports and calls the shared installer before bootstrapping the HTTP app', async () => {
    // server.js executes real side effects (reads ServiceNow instance
    // config, binds a network port) as soon as it is imported, so it is
    // verified by source inspection instead of execution - see the file
    // header comment for the full rationale.
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(new URL('../src/server.js', import.meta.url));
    const source = await readFile(path, 'utf8');

    expect(source).toMatch(/import\s*\{\s*installProcessCrashGuards\s*\}\s*from\s*['"]\.\/process-guards\.js['"]/);
    expect(source).not.toMatch(/process\.listenerCount/);

    const installCallIndex = source.indexOf("installProcessCrashGuards('server')");
    const listenIndex = source.indexOf('app.listen(');
    expect(installCallIndex).toBeGreaterThan(-1);
    expect(listenIndex).toBeGreaterThan(-1);
    expect(installCallIndex).toBeLessThan(listenIndex);
  });
});
