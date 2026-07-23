import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
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
const cacheDir = join(root, 'node_modules', '.cache');
const backupPath = join(cacheDir, 'happy-platform-mcp-sdk-1.29.0-package.json.backup');

function refuse(message, options) {
  return new Error(`Refusing to pack: ${message}`, options);
}

async function assertNoStaleBackup() {
  try {
    await readFile(backupPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }
    throw refuse(`cannot inspect manifest backup at ${backupPath}`, { cause: error });
  }

  throw refuse(`manifest backup already exists at ${backupPath}`);
}

async function restore() {
  const original = await readFile(backupPath);
  await writeFile(sdkManifestPath, original);

  const restored = await readFile(sdkManifestPath);
  if (!restored.equals(original)) {
    throw new Error('Failed to restore the byte-exact @modelcontextprotocol/sdk manifest');
  }

  await rm(backupPath);
  try {
    await rmdir(cacheDir);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') {
      throw error;
    }
  }
}

async function prepack() {
  await assertNoStaleBackup();

  const original = await readFile(sdkManifestPath);
  const sdkManifest = JSON.parse(original.toString('utf8'));
  if (sdkManifest.name !== SDK_NAME || sdkManifest.version !== SDK_VERSION) {
    throw refuse(
      `installed SDK is ${sdkManifest.name ?? 'unknown'}@${sdkManifest.version ?? 'unknown'}, expected ${SDK_NAME}@${SDK_VERSION}`,
    );
  }

  const declaredHonoRange = sdkManifest.dependencies?.[HONO_NAME];
  if (declaredHonoRange !== SDK_HONO_RANGE) {
    throw refuse(
      `${SDK_NAME} requires ${HONO_NAME} ${declaredHonoRange ?? 'missing'}, expected literal range ${SDK_HONO_RANGE}`,
    );
  }

  const honoManifest = JSON.parse(await readFile(honoManifestPath, 'utf8'));
  if (honoManifest.name !== HONO_NAME || honoManifest.version !== BUNDLED_HONO_VERSION) {
    throw refuse(
      `installed Hono is ${honoManifest.name ?? 'unknown'}@${honoManifest.version ?? 'unknown'}, expected ${HONO_NAME}@${BUNDLED_HONO_VERSION}`,
    );
  }

  const needle = `"${HONO_NAME}": "${SDK_HONO_RANGE}"`;
  const replacement = `"${HONO_NAME}": "${BUNDLED_HONO_VERSION}"`;
  const source = original.toString('utf8');
  const firstMatch = source.indexOf(needle);
  if (firstMatch === -1 || source.indexOf(needle, firstMatch + needle.length) !== -1) {
    throw refuse(`expected exactly one patchable ${HONO_NAME} dependency entry`);
  }

  await mkdir(cacheDir, { recursive: true });
  try {
    await writeFile(backupPath, original, { flag: 'wx' });
  } catch (error) {
    throw refuse(`manifest backup already exists or cannot be created at ${backupPath}`, { cause: error });
  }

  try {
    await writeFile(sdkManifestPath, source.replace(needle, replacement), 'utf8');
  } catch (error) {
    await restore();
    throw error;
  }
}

const action = process.argv[2];
if (action === 'prepack') {
  await prepack();
} else if (action === 'postpack') {
  await restore();
} else {
  throw new Error('Usage: node scripts/bundle-sdk-manifest.mjs <prepack|postpack>');
}
