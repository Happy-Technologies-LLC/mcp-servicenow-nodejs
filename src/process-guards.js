/**
 * Guards the whole process against a single unhandled rejection or
 * uncaught exception taking down every concurrent MCP session.
 *
 * - unhandledRejection: logged and swallowed. A single dropped/rejected
 *   notification (e.g. a client that vanished mid-progress-update) must
 *   never terminate sessions that are otherwise healthy.
 * - uncaughtException: logged, then the process exits as it always did.
 *   Continuing after a truly uncaught exception is unsafe in the general
 *   case; we only make sure the cause is diagnosable before it happens.
 *
 * Always logs via console.error (stderr), never stdout: stdout is the
 * MCP stdio transport, and writing to it would corrupt the protocol
 * stream.
 *
 * Registration is guarded by a module-scoped `installed` flag rather
 * than `process.listenerCount(event) === 0`. ES modules are evaluated
 * exactly once per process and cached, so this flag makes installation
 * exactly-once regardless of how many entrypoints import this module -
 * and, unlike a listener-count check, it is unaffected by listeners
 * that other parties (test runners, libraries, supervisors) may have
 * already registered for the same events.
 */
let installed = false;

export function createUnhandledRejectionHandler(label) {
  return function handleUnhandledRejection(reason) {
    console.error(`[${label}] Unhandled promise rejection (process kept alive):`, reason?.stack || reason?.message || reason);
  };
}

export function createUncaughtExceptionHandler(label) {
  return function handleUncaughtException(error) {
    console.error(`[${label}] Uncaught exception (process exiting):`, error?.stack || error?.message || error);
    process.exit(1);
  };
}

/**
 * Installs the crash guards for `label`, exactly once per process. Returns
 * the two listener functions that were registered, or `null` if a prior
 * call (from this or any other entrypoint) already installed them - this
 * doubles as the test seam: callers can assert against the returned
 * functions directly instead of enumerating `process.listeners(event)`
 * and guessing which one is "ours".
 */
export function installProcessCrashGuards(label) {
  if (installed) {
    return null;
  }
  installed = true;

  const handleUnhandledRejection = createUnhandledRejectionHandler(label);
  const handleUncaughtException = createUncaughtExceptionHandler(label);

  process.on('unhandledRejection', handleUnhandledRejection);
  process.on('uncaughtException', handleUncaughtException);

  return { handleUnhandledRejection, handleUncaughtException };
}
