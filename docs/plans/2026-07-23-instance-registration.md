# ServiceNow Instance Registration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add user-owned multi-instance configuration, local keychain-backed credentials, an interactive management CLI, and a safe `SN-Register-Instance` MCP tool that never receives secrets.

**Architecture:** A new `InstanceRegistry` is the single persistence boundary for the CLI, `ConfigManager`, docs settings, and MCP registration. Instance metadata is stored in a versioned user config file; basic-auth passwords and OAuth client secrets are stored by a separate OS-keychain adapter and resolved lazily by `ServiceNowClient`. The MCP tool registers only non-secret metadata and is callable in docs-only mode.

**Tech Stack:** Node.js ES modules, Model Context Protocol SDK, Axios, `@napi-rs/keyring`, `@inquirer/prompts`, Jest 30.

---

## Execution Notes

- Use a dedicated worktree.
- The existing per-call instance-routing plan also modifies `src/mcp-server-consolidated.js`; land or rebase that work before Task 6 rather than resolving overlapping handlers blindly.
- Use `@test-driven-development` for every task and `@verification-before-completion` before the final commit.
- Never place a real password, client secret, or refresh token in tests, fixtures, logs, command arguments, or documentation.

### Task 1: Centralize registry path resolution

**Files:**
- Create: `src/config-path.js`
- Create: `tests/config-path.test.js`
- Modify: `src/docs/config.js:1-20`

**Step 1: Write failing path-precedence tests**

Create `tests/config-path.test.js`:

```js
import path from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { resolveConfigPaths } from '../src/config-path.js';

describe('resolveConfigPaths', () => {
  const homeDir = '/Users/example';
  const legacyPath = '/global/node_modules/happy-platform-mcp/config/servicenow-instances.json';

  test('uses HAPPY_CONFIG_PATH for reads and writes', () => {
    const paths = resolveConfigPaths({
      env: { HAPPY_CONFIG_PATH: '~/happy/instances.json' },
      homeDir,
      legacyPath,
      existsSync: () => false
    });

    expect(paths).toEqual({
      readPath: '/Users/example/happy/instances.json',
      writePath: '/Users/example/happy/instances.json',
      source: 'explicit'
    });
  });

  test('uses the user registry when it exists', () => {
    const userPath = path.join(homeDir, '.config/happy-platform-mcp/instances.json');
    const paths = resolveConfigPaths({
      env: {}, homeDir, legacyPath,
      existsSync: (candidate) => candidate === userPath
    });

    expect(paths.readPath).toBe(userPath);
    expect(paths.writePath).toBe(userPath);
    expect(paths.source).toBe('user');
  });

  test('reads legacy config but writes only to the user registry', () => {
    const paths = resolveConfigPaths({
      env: {}, homeDir, legacyPath,
      existsSync: (candidate) => candidate === legacyPath
    });

    expect(paths.readPath).toBe(legacyPath);
    expect(paths.writePath).toBe(
      path.join(homeDir, '.config/happy-platform-mcp/instances.json')
    );
    expect(paths.source).toBe('legacy');
  });
});
```

**Step 2: Run the test and verify the missing module failure**

Run:

```bash
npm test -- tests/config-path.test.js --runInBand
```

Expected: FAIL because `src/config-path.js` does not exist.

**Step 3: Implement the shared resolver**

Create `src/config-path.js` with these exports:

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const USER_CONFIG_RELATIVE_PATH = path.join(
  '.config', 'happy-platform-mcp', 'instances.json'
);

export function expandHome(input, homeDir = os.homedir()) {
  if (input === '~') return homeDir;
  if (input.startsWith(`~${path.sep}`)) {
    return path.join(homeDir, input.slice(2));
  }
  return input;
}

export function resolveConfigPaths({
  env = process.env,
  homeDir = os.homedir(),
  legacyPath,
  existsSync = fs.existsSync
}) {
  const explicit = env.HAPPY_CONFIG_PATH?.trim();
  if (explicit) {
    const resolved = path.resolve(expandHome(explicit, homeDir));
    return { readPath: resolved, writePath: resolved, source: 'explicit' };
  }

  const userPath = path.join(homeDir, USER_CONFIG_RELATIVE_PATH);
  if (existsSync(userPath)) {
    return { readPath: userPath, writePath: userPath, source: 'user' };
  }
  if (legacyPath && existsSync(legacyPath)) {
    return { readPath: legacyPath, writePath: userPath, source: 'legacy' };
  }
  return { readPath: userPath, writePath: userPath, source: 'user' };
}
```

Update `src/docs/config.js` to call `resolveConfigPaths` rather than maintaining a second `HAPPY_CONFIG_PATH` implementation. Pass its current package-relative config as `legacyPath`.

**Step 4: Run focused path and docs tests**

Run:

```bash
npm test -- tests/config-path.test.js tests/docs-config.test.js --runInBand
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/config-path.js src/docs/config.js tests/config-path.test.js tests/docs-config.test.js
git commit -m "feat(config): resolve user registry path"
```

### Task 2: Add the versioned instance registry

**Files:**
- Create: `src/instance-registry.js`
- Create: `tests/instance-registry.test.js`
- Modify: `src/config-manager.js:8-229`
- Modify: `tests/config-manager.test.js`

**Step 1: Write failing registry read and validation tests**

Create `tests/instance-registry.test.js` using a temporary directory. Cover:

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from '@jest/globals';
import { InstanceRegistry } from '../src/instance-registry.js';

const tempDirs = [];
function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'happy-instance-registry-'));
  tempDirs.push(dir);
  return path.join(dir, 'instances.json');
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test('loads versioned instances and preserves docs properties', () => {
  const file = tempFile();
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    docs: { localIndexEnabled: true },
    instances: [{
      name: 'dev',
      url: 'https://dev.service-now.com',
      authType: 'oauth',
      grantType: 'authorization_code',
      clientId: 'public-client',
      default: true
    }]
  }));

  const registry = new InstanceRegistry({ readPath: file, writePath: file });
  expect(registry.list()).toHaveLength(1);
  expect(registry.document.docs.localIndexEnabled).toBe(true);
});

test('rejects duplicate names and invalid non-HTTPS URLs', async () => {
  const file = tempFile();
  const registry = new InstanceRegistry({ readPath: file, writePath: file });
  await registry.register({
    name: 'dev',
    url: 'https://dev.service-now.com',
    authType: 'oauth',
    grantType: 'authorization_code',
    clientId: 'public-client'
  });

  await expect(registry.register({
    name: 'dev',
    url: 'https://other.service-now.com',
    authType: 'oauth',
    grantType: 'authorization_code',
    clientId: 'public-client'
  })).rejects.toMatchObject({ code: 'INSTANCE_ALREADY_EXISTS' });

  await expect(registry.register({
    name: 'bad',
    url: 'http://remote.service-now.com',
    authType: 'basic',
    username: 'user',
    credentialRef: 'keychain:instance/bad/password'
  })).rejects.toMatchObject({ code: 'INVALID_INSTANCE_CONFIG' });
});
```

Add tests for:

- First registration becoming default.
- `makeDefault` clearing the previous default.
- Basic auth requiring username and `credentialRef` for new registrations.
- OAuth client credentials requiring `clientId` and `credentialRef`.
- Public Authorization Code allowing no credential reference.
- Unknown fields, including `password` and `clientSecret`, being rejected.
- A legacy plaintext document being readable but mutation failing with `LEGACY_MIGRATION_REQUIRED`.

**Step 2: Run the test and verify it fails**

```bash
npm test -- tests/instance-registry.test.js --runInBand
```

Expected: FAIL because `InstanceRegistry` does not exist.

**Step 3: Implement errors, schema validation, and read behavior**

Create `src/instance-registry.js` with:

```js
export class InstanceRegistryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'InstanceRegistryError';
    this.code = code;
    this.details = details;
  }
}

const ALLOWED_FIELDS = new Set([
  'name', 'url', 'authType', 'grantType', 'username', 'clientId',
  'credentialRef', 'scope', 'authorizeUrl', 'tokenUrl', 'redirectPort',
  'callbackPath', 'default', 'description'
]);
```

Implement `validateNewInstance(instance)` with the approved invariants. Permit `http://127.0.0.1`, `http://localhost`, and `http://[::1]` only for loopback fixtures. Never include the whole submitted object in an error.

`InstanceRegistry` must expose:

```js
load()
reload()
list()
get(name)
getDefault()
register(instance, { makeDefault = false } = {})
update(name, patch)
remove(name)
```

Preserve unrelated top-level properties such as `docs` during every mutation.

**Step 4: Implement serialized atomic writes**

Queue mutations on one promise chain. For each write:

1. Build and validate the next complete document in memory.
2. Create the parent directory with mode `0o700` where supported.
3. Open a unique sibling temporary file with mode `0o600` and exclusive create.
4. Write the final JSON plus a trailing newline.
5. Close and rename the temporary file over `writePath`.
6. Update the in-memory snapshot only after rename succeeds.
7. Delete the temporary file on failure and retain the previous snapshot.

Do not mutate the legacy source file. If `readPath !== writePath`, the first successful write creates the user registry.

**Step 5: Adapt ConfigManager to the registry without changing its public read API**

Inject an `InstanceRegistry` into `ConfigManager`. Keep `getInstance`, `getDefaultInstance`, `getInstanceOrDefault`, and `listInstances` synchronous. Add `reload()` and delegate validation to the registry.

Keep `loadFromEnv()` as the final backward-compatible fallback only when no registry file exists. Do not convert singular environment credentials into a persistent registration automatically.

**Step 6: Run focused tests**

```bash
npm test -- tests/instance-registry.test.js tests/config-manager.test.js tests/docs-config.test.js --runInBand
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/instance-registry.js src/config-manager.js tests/instance-registry.test.js tests/config-manager.test.js
git commit -m "feat(config): add persistent instance registry"
```

### Task 3: Store instance secrets in the OS keychain

**Files:**
- Create: `src/instance-credential-store.js`
- Create: `tests/instance-credential-store.test.js`
- Keep unchanged: `src/token-store.js`

**Step 1: Write failing credential-store tests**

Use an injected keyring entry factory:

```js
import { describe, expect, jest, test } from '@jest/globals';
import {
  CredentialNotFoundError,
  InstanceCredentialStore,
  credentialRefFor
} from '../src/instance-credential-store.js';

function createHarness() {
  const values = new Map();
  const createEntry = jest.fn((_service, account) => ({
    getPassword: () => values.get(account) ?? null,
    setPassword: (value) => values.set(account, value),
    deletePassword: () => values.delete(account)
  }));
  return { values, store: new InstanceCredentialStore({ createEntry }) };
}

test('uses deterministic credential references', () => {
  expect(credentialRefFor('dev', 'password'))
    .toBe('keychain:instance/dev/password');
  expect(credentialRefFor('prod', 'client-secret'))
    .toBe('keychain:instance/prod/client-secret');
});

test('stores and retrieves a secret without returning it from set', async () => {
  const { store } = createHarness();
  const ref = credentialRefFor('dev', 'password');
  await expect(store.setSecret(ref, 'fixture-secret')).resolves.toEqual({ stored: true });
  await expect(store.getSecret(ref)).resolves.toBe('fixture-secret');
});

test('distinguishes a missing credential from keychain failure', async () => {
  const { store } = createHarness();
  await expect(store.getSecret(credentialRefFor('dev', 'password')))
    .rejects.toBeInstanceOf(CredentialNotFoundError);
});
```

Add tests that reject malformed references, delete entries, implement `hasSecret`, and rethrow locked-keychain errors without returning a false missing result.

**Step 2: Run the test and verify it fails**

```bash
npm test -- tests/instance-credential-store.test.js --runInBand
```

Expected: FAIL because the module does not exist.

**Step 3: Implement the credential store**

Mirror the lazy keyring loading pattern in `token-store.js`, but keep a distinct interface:

```js
getSecret(ref)
setSecret(ref, value)
hasSecret(ref)
deleteSecret(ref)
```

Use service name `happy-platform-mcp` and the validated reference as the keyring account. `setSecret` returns only `{ stored: true }`. Error messages may identify the reference but never the value.

Keep refresh-token storage in `token-store.js`; do not overload its account-key contract.

**Step 4: Run focused keychain tests**

```bash
npm test -- tests/instance-credential-store.test.js tests/token-store.test.js --runInBand
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/instance-credential-store.js tests/instance-credential-store.test.js
git commit -m "feat(auth): store instance secrets in keychain"
```

### Task 4: Resolve credential references at request time

**Files:**
- Modify: `src/config-manager.js:15-34`
- Modify: `src/servicenow-client.js:41-229,336-348`
- Modify: `tests/config-manager.test.js`
- Modify: `tests/servicenow-client-oauth.test.js`
- Create: `tests/servicenow-client-credentials.test.js`

**Step 1: Write failing basic-auth credential-reference tests**

Create a client with `password` omitted, `credentialRef` set, and an injected store. Invoke the Axios request interceptor or a mocked request path and assert:

- The first request loads the secret and sends the expected Basic header.
- A second request reuses the in-memory resolved credential.
- `setInstance` clears the cached credential.
- Missing credentials fail with `CREDENTIAL_NOT_FOUND` before an outbound request.
- `getCurrentInstance()` never returns `credentialRef` or secret material.

Use fixture values only and never log the generated header.

**Step 2: Write failing OAuth client-secret reference tests**

Extend `tests/servicenow-client-oauth.test.js` to construct client-credentials OAuth with `clientSecret` omitted and `credentialRef` set. Assert that the token endpoint receives the resolved client secret once and that public Authorization Code without a reference remains unchanged.

**Step 3: Run the failing tests**

```bash
npm test -- tests/servicenow-client-credentials.test.js tests/servicenow-client-oauth.test.js --runInBand
```

Expected: FAIL because `ServiceNowClient` ignores `credentialRef`.

**Step 4: Propagate credential options**

Extend `instanceToClientOptions(instance, options = {})` to include:

```js
credentialRef: instance.credentialRef,
credentialStore: options.credentialStore
```

Keep legacy `password` and `clientSecret` propagation for read compatibility.

**Step 5: Add lazy credential resolution to ServiceNowClient**

Store `credentialRef` and the injected/default `InstanceCredentialStore` in `setInstance`. Clear all resolved-secret state when switching instances.

Change the request interceptor to use the single async header seam:

```js
this.client.interceptors.request.use(async (config) => {
  config.headers.Authorization = await this.getAuthHeader();
  return config;
});
```

For basic auth, `getAuthHeader()` resolves the password once when no legacy password was supplied, caches only inside the client process, and returns the Basic header.

Before client-credentials or password-grant token construction, resolve `clientSecret` or password from the credential store when the legacy value is absent. Authorization Code public clients must not attempt a keychain lookup.

A keychain error must abort the request. Never fall back to another instance, empty credentials, or a different OAuth grant.

**Step 6: Run client and config tests**

```bash
npm test -- tests/config-manager.test.js tests/servicenow-client-credentials.test.js tests/servicenow-client-oauth.test.js tests/servicenow-client-errors.test.js --runInBand
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/config-manager.js src/servicenow-client.js tests/config-manager.test.js tests/servicenow-client-credentials.test.js tests/servicenow-client-oauth.test.js
git commit -m "feat(auth): resolve registered credentials"
```

### Task 5: Add the interactive instance-management CLI

**Files:**
- Create: `src/cli.js`
- Create: `src/instance-cli.js`
- Create: `tests/instance-cli.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Step 1: Add the prompt dependency**

Run:

```bash
npm install @inquirer/prompts
```

Expected: `package.json` and `package-lock.json` add the dependency.

**Step 2: Write failing CLI dispatch tests**

Inject registry, credential store, prompt functions, client factory, stdin, and output streams. Cover:

- No arguments delegates to the existing stdio `main()`.
- `instance list` prints redacted metadata only.
- `instance credential set dev --type password` prompts with masked input and writes the deterministic reference.
- `instance add` stores the credential first, then registers metadata; a registry failure deletes the newly-created credential.
- `instance update` never accepts password or client-secret flags.
- `instance remove` confirms, removes metadata, and deletes the referenced secret.
- `instance test` constructs a client from the resolved registration and reports success, 401 authentication failure, and 403 authorization failure distinctly.
- Unknown commands return exit code 2 and concise usage.

**Step 3: Run the failing CLI test**

```bash
npm test -- tests/instance-cli.test.js --runInBand
```

Expected: FAIL because the CLI modules do not exist.

**Step 4: Implement command routing without breaking stdio startup**

Change package bins to `src/cli.js`:

```json
"bin": {
  "happy-platform-mcp": "src/cli.js",
  "servicenow-mcp-server": "src/cli.js"
}
```

`src/cli.js` must retain the node shebang. With no arguments, dynamically import `main` from `stdio-server.js` and run it. With `instance` as the first argument, delegate to `runInstanceCli`.

Do not import and start stdio transport while executing a management command.

**Step 5: Implement safe prompts and commands**

Use `@inquirer/prompts` `password()` for secrets and `input`, `select`, and `confirm` for metadata. Do not accept `--password`, `--client-secret`, or secret values in any argument.

Implement these commands:

```text
instance add
instance list
instance update <name>
instance test <name>
instance remove <name>
instance credential set <name> --type password|client-secret
instance migrate
```

`instance migrate` reads the legacy file, prompts for confirmation, places each plaintext password/client secret in the keychain, writes credential references to the user registry, preserves `docs`, and leaves the legacy file untouched.

For testability, `runInstanceCli(argv, dependencies)` returns an exit code rather than calling `process.exit` internally.

**Step 6: Run CLI and stdio compatibility tests**

```bash
npm test -- tests/instance-cli.test.js tests/stdio-docs-only.test.js --runInBand
```

Expected: PASS.

Smoke commands:

```bash
node src/cli.js instance list
node src/cli.js --help
```

Expected: redacted instance list or an empty-registry message, then usage text. Neither command starts the stdio transport.

**Step 7: Commit**

```bash
git add package.json package-lock.json src/cli.js src/instance-cli.js tests/instance-cli.test.js
git commit -m "feat(cli): manage registered instances"
```

### Task 6: Add safe MCP instance registration

**Files:**
- Create: `src/instance-tools.js`
- Create: `tests/mcp-instance-registration.test.js`
- Modify: `src/mcp-server-consolidated.js:8-20,69-100,1375-1428`
- Modify: `src/stdio-server.js:50-96`

**Step 1: Write failing tool-schema tests**

Build an MCP handler harness with injected `InstanceRegistry` and `InstanceCredentialStore`. Assert that:

- `SN-Register-Instance` appears in normal and docs-only tool lists.
- Its schema has `additionalProperties: false`.
- The schema contains metadata fields but no `password` or `clientSecret`.
- The tool is dispatched before the docs-only rejection guard.

**Step 2: Write failing registration behavior tests**

Cover:

```js
test('registers public authorization-code metadata without a credential', async () => {
  const result = await callTool({
    method: 'tools/call',
    params: {
      name: 'SN-Register-Instance',
      arguments: {
        name: 'dev',
        url: 'https://dev.service-now.com',
        authType: 'oauth',
        grantType: 'authorization_code',
        clientId: 'public-client',
        makeDefault: true
      }
    }
  }, {});

  expect(registry.register).toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toMatch(/password|clientSecret|fixture-secret/);
});
```

Also assert:

- Basic auth with a missing credential does not mutate the registry and returns `happy-platform-mcp instance credential set dev --type password`.
- Client credentials returns the corresponding `--type client-secret` command.
- Existing credential references permit registration.
- Duplicate names return `INSTANCE_ALREADY_EXISTS` without replacement.
- Secret keys are rejected even if a client bypasses schema validation.
- Successful registration calls `configManager.reload()`.

**Step 3: Run the failing MCP test**

```bash
npm test -- tests/mcp-instance-registration.test.js --runInBand
```

Expected: FAIL because `SN-Register-Instance` is absent.

**Step 4: Define the tool and handler outside the consolidated switch**

Create `src/instance-tools.js` exporting:

```js
instanceToolDefinitions
isInstanceSetupTool(name)
handleInstanceSetupTool(name, args, dependencies)
```

Keep secret-key rejection in the handler as defense in depth. Return stable error codes and redacted metadata.

In `createMcpServer`, inject `configManager`, `instanceRegistry`, and `credentialStore` through `options`, defaulting to production singletons. This avoids hidden global state in tests.

Normal tool lists include instance setup tools once. Docs-only lists include instance setup tools plus docs tools. Dispatch instance setup tools before:

```js
if (docsOnly) {
  throw new Error(`Tool ${name} is unavailable in docs-only mode`);
}
```

**Step 5: Define post-registration startup behavior**

A docs-only process cannot construct the full ServiceNow client and replace its already-advertised live tool set safely in this change. After the first registration, return:

```json
{
  "success": true,
  "restartRequired": true,
  "message": "Instance registered. Restart the MCP server to enable live ServiceNow tools."
}
```

In a normal process, reload configuration and return `restartRequired: false`; the new registration is available to `SN-Set-Instance` and per-call routing.

**Step 6: Run MCP and stdio tests**

```bash
npm test -- tests/mcp-instance-registration.test.js tests/stdio-docs-only.test.js tests/config-manager.test.js --runInBand
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/instance-tools.js src/mcp-server-consolidated.js src/stdio-server.js tests/mcp-instance-registration.test.js tests/stdio-docs-only.test.js
git commit -m "feat(mcp): register instance metadata safely"
```

### Task 7: Document setup, migration, and security boundaries

**Files:**
- Modify: `README.md:61-130,259-306,441-445`
- Modify: `docs/MULTI_INSTANCE_CONFIGURATION.md:1-100,175-180,252-277`
- Modify: `config/servicenow-instances.json.example`
- Modify: `.env.example`

**Step 1: Update the global-install quick start**

Document the user-owned registry and one-time override:

```json
{
  "env": {
    "HAPPY_CONFIG_PATH": "/Users/me/.config/happy-platform-mcp/instances.json"
  }
}
```

State that the override points to metadata, not plaintext secrets created by the new CLI.

**Step 2: Document CLI-first credential setup**

Add examples for `instance add`, `list`, `test`, and `migrate`. Explain that secret prompts occur locally and that MCP tools never accept passwords or client secrets.

Update the example registry to `version: 1` and credential references. Do not put realistic-looking secret values in the example.

**Step 3: Document runtime selection separately from registration**

Clarify:

- Registration persists an available instance.
- `SERVICENOW_INSTANCE` chooses startup default only.
- `SN-Set-Instance` changes the sequential runtime target.
- Per-call `instance` selects an isolated request target when that feature is present.

**Step 4: Document migration and precedence**

List precedence: `HAPPY_CONFIG_PATH`, user registry, legacy package file, singular environment fallback. State that migration never deletes the old file automatically.

**Step 5: Verify examples contain no raw credential fields**

Use the repository search tool to inspect changed documentation for `"password":` and `"clientSecret":`. Legacy migration explanations may name the fields, but new configuration examples must not contain them.

**Step 6: Commit**

```bash
git add README.md docs/MULTI_INSTANCE_CONFIGURATION.md config/servicenow-instances.json.example .env.example
git commit -m "docs(config): explain instance registration"
```

### Task 8: Run end-to-end registration verification

**Files:**
- Create: `tests/instance-registration.integration.test.js`
- Modify only if failures reveal a real contract defect: files from Tasks 1-7

**Step 1: Write the integration test**

Using a temporary registry and in-memory keyring adapter:

1. Start with no registry and no ServiceNow environment variables.
2. Verify docs-only tool listing includes `SN-Register-Instance`.
3. Store deterministic dev and prod credential profiles through the credential-store interface.
4. Register dev basic auth and prod client-credentials OAuth through the MCP handler.
5. Reconstruct `ConfigManager` from disk.
6. Assert both instances list without secret fields.
7. Construct clients for each and verify injected HTTP adapters receive the matching resolved credential.
8. Assert registry JSON contains no fixture secret values.

**Step 2: Run the integration test**

```bash
npm test -- tests/instance-registration.integration.test.js --runInBand
```

Expected: PASS.

**Step 3: Run all affected suites once**

```bash
npm test -- --runInBand \
  tests/config-path.test.js \
  tests/docs-config.test.js \
  tests/instance-registry.test.js \
  tests/config-manager.test.js \
  tests/instance-credential-store.test.js \
  tests/token-store.test.js \
  tests/servicenow-client-credentials.test.js \
  tests/servicenow-client-oauth.test.js \
  tests/instance-cli.test.js \
  tests/mcp-instance-registration.test.js \
  tests/stdio-docs-only.test.js \
  tests/instance-registration.integration.test.js
```

Expected: all affected suites PASS. If Jest discovers duplicate package roots under `.worktrees`, run from the dedicated implementation worktree and exclude sibling worktrees rather than accepting duplicated suites.

**Step 4: Smoke-test the actual executable path**

Run:

```bash
node src/cli.js instance list
node src/cli.js instance credential set smoke --type password
```

For the second command, enter a disposable fixture value into the masked prompt, verify the result contains no secret, then delete the `smoke` keychain entry through the CLI or injected test adapter. Do not leave fixture credentials behind.

Run the MCP Inspector or direct handler harness in docs-only mode, invoke `SN-Register-Instance` for a public Authorization Code fixture, and verify the response requests restart without exposing any credential fields. Remove the fixture registration afterward.

**Step 5: Run the full suite**

```bash
npm test -- --runInBand
```

Expected: PASS with no new failures. Resolve the existing Jest haste-map worktree collision in the execution environment if it prevents a single-root run; do not change feature code to suppress it.

**Step 6: Review security-sensitive changes**

Invoke `@silent-failure-hunter`, `@code-reviewer`, and `@type-design-analyzer` against the final diff. Blocking findings include silent keychain fallback, secret-bearing logs/errors, non-atomic registry writes, ambiguous duplicate replacement, or docs-only registration being unreachable.

**Step 7: Commit integration verification**

```bash
git add tests/instance-registration.integration.test.js
git commit -m "test(config): verify instance registration flow"
```
