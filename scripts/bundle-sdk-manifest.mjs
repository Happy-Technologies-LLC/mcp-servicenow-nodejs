import { randomUUID } from 'node:crypto';
import { open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SDK_NAME = '@modelcontextprotocol/sdk';
const SDK_VERSION = '1.29.0';
const HONO_NAME = '@hono/node-server';
const SDK_HONO_RANGE = '^1.19.9';
const BUNDLED_HONO_VERSION = '2.0.11';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdkManifestPath = join(root, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json');
const honoManifestPath = join(root, 'node_modules', '@hono', 'node-server', 'package.json');
const manifestTempPrefix = '.happy-platform-mcp-sdk-manifest-';

function refuse(message, options) {
  return new Error(`Refusing to pack: ${message}`, options);
}

function parseManifest(bytes, path) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw refuse(`cannot parse installed manifest at ${path}`, { cause: error });
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function writeAtomically(path, bytes) {
  const tempPath = join(dirname(path), `${manifestTempPrefix}${process.pid}-${randomUUID()}.tmp`);
  let handle;

  try {
    const { mode } = await stat(path);
    handle = await open(tempPath, 'wx', mode & 0o777);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tempPath, path);
  } finally {
    try {
      if (handle) {
        await handle.close();
      }
    } finally {
      await rm(tempPath, { force: true });
    }
  }
}

async function normalize() {
  const original = await readFile(sdkManifestPath);
  const sdkManifest = parseManifest(original, sdkManifestPath);
  if (sdkManifest.name !== SDK_NAME || sdkManifest.version !== SDK_VERSION) {
    throw refuse(
      `installed SDK is ${sdkManifest.name ?? 'unknown'}@${sdkManifest.version ?? 'unknown'}, expected ${SDK_NAME}@${SDK_VERSION}`,
    );
  }

  const declaredHonoVersion = sdkManifest.dependencies?.[HONO_NAME];
  if (declaredHonoVersion !== SDK_HONO_RANGE && declaredHonoVersion !== BUNDLED_HONO_VERSION) {
    throw refuse(
      `${SDK_NAME} requires ${HONO_NAME} ${declaredHonoVersion ?? 'missing'}, expected ${SDK_HONO_RANGE} or ${BUNDLED_HONO_VERSION}`,
    );
  }

  const honoBytes = await readFile(honoManifestPath);
  const honoManifest = parseManifest(honoBytes, honoManifestPath);
  if (honoManifest.name !== HONO_NAME || honoManifest.version !== BUNDLED_HONO_VERSION) {
    throw refuse(
      `installed Hono is ${honoManifest.name ?? 'unknown'}@${honoManifest.version ?? 'unknown'}, expected ${HONO_NAME}@${BUNDLED_HONO_VERSION}`,
    );
  }

  const source = original.toString('utf8');
  const escapedHonoName = escapeRegex(HONO_NAME);
  const keyPattern = new RegExp(`"${escapedHonoName}"\\s*:`, 'g');
  if ([...source.matchAll(keyPattern)].length !== 1) {
    throw refuse(`expected exactly one ${HONO_NAME} dependency entry`);
  }

  if (declaredHonoVersion === BUNDLED_HONO_VERSION) {
    return;
  }

  const declarationPattern = new RegExp(
    `("${escapedHonoName}"\\s*:\\s*)"${escapeRegex(SDK_HONO_RANGE)}"`,
    'g',
  );
  const normalizedSource = source.replace(
    declarationPattern,
    (_, prefix) => `${prefix}"${BUNDLED_HONO_VERSION}"`,
  );
  if (normalizedSource === source) {
    throw refuse(`could not locate the declared ${HONO_NAME} ${SDK_HONO_RANGE} dependency entry`);
  }

  const normalized = parseManifest(Buffer.from(normalizedSource), sdkManifestPath);
  if (
    normalized.name !== SDK_NAME ||
    normalized.version !== SDK_VERSION ||
    normalized.dependencies?.[HONO_NAME] !== BUNDLED_HONO_VERSION
  ) {
    throw refuse(`normalized SDK manifest failed validation`);
  }

  const normalizedBytes = Buffer.from(normalizedSource);
  await writeAtomically(sdkManifestPath, normalizedBytes);
  const persisted = await readFile(sdkManifestPath);
  if (!persisted.equals(normalizedBytes)) {
    throw refuse(`normalized SDK manifest did not persist byte-exactly`);
  }
}

if (process.argv.length !== 2) {
  throw new Error('Usage: node scripts/bundle-sdk-manifest.mjs');
}

await normalize();
