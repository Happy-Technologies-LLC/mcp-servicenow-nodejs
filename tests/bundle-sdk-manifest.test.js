import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { spawn } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeSdkManifest } from '../scripts/bundle-sdk-manifest.mjs';

const SDK_NAME = '@modelcontextprotocol/sdk';
const SDK_VERSION = '1.29.0';
const HONO_NAME = '@hono/node-server';
const SDK_HONO_RANGE = '^1.19.9';
const BUNDLED_HONO_VERSION = '2.0.11';
const TEMP_PREFIX = '.happy-platform-mcp-sdk-manifest-';
const scriptPath = fileURLToPath(new URL('../scripts/bundle-sdk-manifest.mjs', import.meta.url));
const fixtureRoots = new Set();

jest.setTimeout(20_000);

const realFs = { lstat, open, readFile, realpath, rename, rm };

function manifestBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function createFixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bundle-sdk-manifest-'));
  fixtureRoots.add(root);

  const sdkDir = join(root, 'node_modules', '@modelcontextprotocol', 'sdk');
  const sdkManifest = join(sdkDir, 'package.json');
  const honoDir = join(sdkDir, 'node_modules', '@hono', 'node-server');
  const honoManifest = join(honoDir, 'package.json');
  const honoEntry = join(honoDir, 'index.js');
  await mkdir(honoDir, { recursive: true });

  const sdkBytes = options.sdkBytes ?? manifestBytes({
    name: options.sdkName ?? SDK_NAME,
    version: options.sdkVersion ?? SDK_VERSION,
    dependencies: {
      [HONO_NAME]: options.sdkHonoVersion ?? SDK_HONO_RANGE,
    },
  });
  const honoBytes = manifestBytes({
    name: options.honoName ?? HONO_NAME,
    version: options.honoVersion ?? BUNDLED_HONO_VERSION,
    type: 'module',
    main: './index.js',
  });

  await Promise.all([
    writeFile(sdkManifest, sdkBytes),
    writeFile(honoManifest, honoBytes),
    writeFile(honoEntry, 'export {};\n'),
  ]);

  return {
    root,
    sdkDir,
    sdkManifest,
    sdkBytes,
    honoDir,
    honoManifest,
    honoEntry,
  };
}

async function assertNoTempResidue(fixture) {
  const names = await readdir(fixture.sdkDir);
  expect(names.filter((name) => name.startsWith(TEMP_PREFIX))).toEqual([]);
}

async function captureRejection(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to reject');
}

function spawnNode(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({
      code,
      signal,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

async function probeSymlinkCapability() {
  const root = await mkdtemp(join(tmpdir(), 'bundle-sdk-symlink-probe-'));
  try {
    const fileTarget = join(root, 'file-target');
    const directoryTarget = join(root, 'directory-target');
    await writeFile(fileTarget, 'probe');
    await mkdir(directoryTarget);
    await symlink(fileTarget, join(root, 'file-link'), 'file');
    await symlink(
      directoryTarget,
      join(root, 'directory-link'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    return { supported: true };
  } catch (error) {
    if (['EACCES', 'EPERM', 'ENOTSUP'].includes(error?.code)) {
      return { supported: false, reason: `${error.code}: ${error.message}` };
    }
    throw error;
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

const symlinkCapability = await probeSymlinkCapability();
const symlinkTest = symlinkCapability.supported ? test : test.skip;
if (!symlinkCapability.supported) {
  console.warn(
    `Skipping SDK bundle symlink cases because the OS denied symlink creation (${symlinkCapability.reason})`,
  );
}

afterEach(async () => {
  await Promise.all([...fixtureRoots].map((root) => rm(root, { force: true, recursive: true })));
  fixtureRoots.clear();
});

describe('normalizeSdkManifest', () => {
  test('normalizes the SDK Hono range and preserves every other manifest byte', async () => {
    const sdkBytes = Buffer.from(
      '{\n  "name": "@modelcontextprotocol/sdk",\n  "version": "1.29.0",\n  "dependencies": {\n    "@hono/node-server" :  "^1.19.9",\n    "zod": "^3.25.0"\n  },\n  "custom": "unchanged"\n}\n',
    );
    const fixture = await createFixture({ sdkBytes });

    await normalizeSdkManifest({ root: fixture.root });

    const actual = await readFile(fixture.sdkManifest);
    const expected = Buffer.from(
      sdkBytes.toString('utf8').replace('"^1.19.9"', '"2.0.11"'),
    );
    expect(actual.equals(expected)).toBe(true);
    await assertNoTempResidue(fixture);
  });

  test('leaves an exact 2.0.11 manifest byte-identical without opening a temp file', async () => {
    const fixture = await createFixture({ sdkHonoVersion: BUNDLED_HONO_VERSION });
    const before = await readFile(fixture.sdkManifest);
    const fs = {
      ...realFs,
      open: async () => {
        throw new Error('open must not be called for an idempotent manifest');
      },
    };

    await normalizeSdkManifest({ root: fixture.root, fs });

    expect((await readFile(fixture.sdkManifest)).equals(before)).toBe(true);
    await assertNoTempResidue(fixture);
  });

  test.each([
    ['identity', { sdkName: '@example/not-the-sdk' }, /installed SDK is @example\/not-the-sdk@1\.29\.0/],
    ['version', { sdkVersion: '1.28.0' }, /installed SDK is @modelcontextprotocol\/sdk@1\.28\.0/],
  ])('rejects the wrong SDK %s', async (_case, options, expectedError) => {
    const fixture = await createFixture(options);

    await expect(normalizeSdkManifest({ root: fixture.root })).rejects.toThrow(expectedError);

    expect((await readFile(fixture.sdkManifest)).equals(fixture.sdkBytes)).toBe(true);
    await assertNoTempResidue(fixture);
  });

  test.each([
    ['identity', { honoName: '@example/not-hono' }, /installed Hono is @example\/not-hono@2\.0\.11/],
    ['version', { honoVersion: '2.0.10' }, /installed Hono is @hono\/node-server@2\.0\.10/],
  ])('rejects the wrong Hono %s', async (_case, options, expectedError) => {
    const fixture = await createFixture(options);

    await expect(normalizeSdkManifest({ root: fixture.root })).rejects.toThrow(expectedError);

    expect((await readFile(fixture.sdkManifest)).equals(fixture.sdkBytes)).toBe(true);
    await assertNoTempResidue(fixture);
  });

  test('rejects duplicate Hono dependency declarations', async () => {
    const sdkBytes = Buffer.from(
      '{"name":"@modelcontextprotocol/sdk","version":"1.29.0","dependencies":{"@hono/node-server":"^1.19.9","@hono/node-server":"2.0.11"}}\n',
    );
    const fixture = await createFixture({ sdkBytes });

    await expect(normalizeSdkManifest({ root: fixture.root })).rejects.toThrow(
      'expected exactly one @hono/node-server dependency entry',
    );

    expect((await readFile(fixture.sdkManifest)).equals(sdkBytes)).toBe(true);
    await assertNoTempResidue(fixture);
  });

  symlinkTest('rejects an SDK directory symlink outside node_modules', async () => {
    const fixture = await createFixture();
    const outside = join(fixture.root, 'outside-sdk');
    await rename(fixture.sdkDir, outside);
    await symlink(outside, fixture.sdkDir, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(normalizeSdkManifest({ root: fixture.root })).rejects.toThrow(
      /installed SDK directory must not be a symbolic link/,
    );

    expect((await readFile(join(outside, 'package.json'))).equals(fixture.sdkBytes)).toBe(true);
  });

  symlinkTest('rejects an SDK manifest symlink outside node_modules', async () => {
    const fixture = await createFixture();
    const outside = join(fixture.root, 'outside-sdk-package.json');
    await rename(fixture.sdkManifest, outside);
    await symlink(outside, fixture.sdkManifest, 'file');

    await expect(normalizeSdkManifest({ root: fixture.root })).rejects.toThrow(
      /installed SDK manifest must not be a symbolic link/,
    );

    expect((await readFile(outside)).equals(fixture.sdkBytes)).toBe(true);
    await assertNoTempResidue(fixture);
  });

  symlinkTest('rejects a Hono directory symlink outside node_modules', async () => {
    const fixture = await createFixture();
    const outside = join(fixture.root, 'outside-hono');
    await rename(fixture.honoDir, outside);
    await symlink(outside, fixture.honoDir, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(normalizeSdkManifest({ root: fixture.root })).rejects.toThrow(
      /resolved Hono directory must not be a symbolic link/,
    );

    expect((await readFile(fixture.sdkManifest)).equals(fixture.sdkBytes)).toBe(true);
    await assertNoTempResidue(fixture);
  });

  symlinkTest('rejects a Hono manifest symlink outside node_modules', async () => {
    const fixture = await createFixture();
    const outside = join(fixture.root, 'outside-hono-package.json');
    await rename(fixture.honoManifest, outside);
    await symlink(outside, fixture.honoManifest, 'file');

    await expect(normalizeSdkManifest({ root: fixture.root })).rejects.toThrow(
      /resolved Hono manifest must not be a symbolic link/,
    );

    expect((await readFile(fixture.sdkManifest)).equals(fixture.sdkBytes)).toBe(true);
    await assertNoTempResidue(fixture);
  });

  symlinkTest('rejects a Hono entrypoint symlink outside node_modules', async () => {
    const fixture = await createFixture();
    const outside = join(fixture.root, 'outside-hono-entry.js');
    await rename(fixture.honoEntry, outside);
    await symlink(outside, fixture.honoEntry, 'file');

    await expect(normalizeSdkManifest({ root: fixture.root })).rejects.toThrow(
      /resolved Hono entry point (?:must not be a symbolic link|resolves outside root node_modules)/,
    );

    expect((await readFile(fixture.sdkManifest)).equals(fixture.sdkBytes)).toBe(true);
    await assertNoTempResidue(fixture);
  });

  test('rejects a dependency whose realpath resolves outside root node_modules', async () => {
    const fixture = await createFixture();
    const fs = {
      ...realFs,
      realpath: async (path) => path === fixture.sdkDir
        ? join(fixture.root, 'outside-node-modules', 'sdk')
        : realpath(path),
    };

    await expect(normalizeSdkManifest({ root: fixture.root, fs })).rejects.toThrow(
      /installed SDK directory resolves outside root node_modules/,
    );

    expect((await readFile(fixture.sdkManifest)).equals(fixture.sdkBytes)).toBe(true);
    await assertNoTempResidue(fixture);
  });

  test('detects a regular-file path replacement between initial and pre-write inspections', async () => {
    const fixture = await createFixture();
    const replacement = manifestBytes({
      name: SDK_NAME,
      version: SDK_VERSION,
      dependencies: { [HONO_NAME]: SDK_HONO_RANGE },
      attacker: true,
    });
    const displaced = join(fixture.sdkDir, 'displaced-package.json');
    let sdkManifestInspections = 0;
    let renameCalls = 0;
    const fs = {
      ...realFs,
      lstat: async (path) => {
        if (path === fixture.sdkManifest && ++sdkManifestInspections === 2) {
          await rename(fixture.sdkManifest, displaced);
          await writeFile(fixture.sdkManifest, replacement);
        }
        return lstat(path);
      },
      rename: async (...args) => {
        renameCalls += 1;
        return rename(...args);
      },
    };

    await expect(normalizeSdkManifest({ root: fixture.root, fs })).rejects.toThrow(
      /sdkManifest changed while preparing the SDK manifest/,
    );

    expect(renameCalls).toBe(0);
    expect((await readFile(fixture.sdkManifest)).equals(replacement)).toBe(true);
    await assertNoTempResidue(fixture);
  });

  test.each([
    ['open', 'open'],
    ['write', 'writeFile'],
    ['fsync', 'sync'],
    ['rename', 'rename'],
  ])('preserves original bytes and removes temp files after an injected %s failure', async (_case, failurePoint) => {
    const fixture = await createFixture();
    const before = await readFile(fixture.sdkManifest);
    let renameSucceeded = false;
    const fs = {
      ...realFs,
      open: async (...args) => {
        if (failurePoint === 'open') {
          throw new Error('injected open failure');
        }
        const handle = await open(...args);
        return new Proxy(handle, {
          get(target, property) {
            if (property === 'writeFile' && failurePoint === 'writeFile') {
              return async () => { throw new Error('injected write failure'); };
            }
            if (property === 'sync' && failurePoint === 'sync') {
              return async () => { throw new Error('injected fsync failure'); };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      },
      rename: async (...args) => {
        if (failurePoint === 'rename') {
          throw new Error('injected rename failure');
        }
        await rename(...args);
        renameSucceeded = true;
      },
    };

    await expect(normalizeSdkManifest({ root: fixture.root, fs })).rejects.toThrow(
      new RegExp(`injected ${failurePoint === 'writeFile' ? 'write' : failurePoint === 'sync' ? 'fsync' : failurePoint} failure`),
    );

    expect(renameSucceeded).toBe(false);
    expect((await readFile(fixture.sdkManifest)).equals(before)).toBe(true);
    await assertNoTempResidue(fixture);
  });

  test('aggregates primary, close, and cleanup failures without leaving temp residue', async () => {
    const fixture = await createFixture();
    const before = await readFile(fixture.sdkManifest);
    const fs = {
      ...realFs,
      open: async (...args) => {
        const handle = await open(...args);
        return new Proxy(handle, {
          get(target, property) {
            if (property === 'writeFile') {
              return async () => { throw new Error('primary write failure'); };
            }
            if (property === 'close') {
              return async () => {
                await target.close();
                throw new Error('close cleanup failure');
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      },
      rm: async (...args) => {
        await rm(...args);
        throw new Error('remove cleanup failure');
      },
    };

    const error = await captureRejection(() => normalizeSdkManifest({ root: fixture.root, fs }));

    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors.map((item) => item.message)).toEqual([
      'primary write failure',
      'close cleanup failure',
      'remove cleanup failure',
    ]);
    expect((await readFile(fixture.sdkManifest)).equals(before)).toBe(true);
    await assertNoTempResidue(fixture);
  });
});

describe('CLI boundary', () => {
  test('can be imported in a subprocess without running the CLI', async () => {
    const fixture = await createFixture();
    const expression = `await import(${JSON.stringify(pathToFileURL(scriptPath).href)}); process.stdout.write('imported');`;

    const result = await spawnNode(['--input-type=module', '--eval', expression], {
      cwd: fixture.root,
    });

    expect(result).toEqual(expect.objectContaining({
      code: 0,
      signal: null,
      stdout: 'imported',
      stderr: '',
    }));
  });

  test('direct execution rejects unexpected arguments before repository inspection', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'bundle-sdk-cli-'));
    fixtureRoots.add(emptyRoot);

    const result = await spawnNode([scriptPath, 'unexpected'], { cwd: emptyRoot });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('Usage: node scripts/bundle-sdk-manifest.mjs');
    expect(result.stderr).not.toContain('cannot inspect root node_modules');
  });
});
