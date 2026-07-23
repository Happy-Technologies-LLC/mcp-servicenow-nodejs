import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SDK_NAME = '@modelcontextprotocol/sdk';
const SDK_VERSION = '1.29.0';
const HONO_NAME = '@hono/node-server';
const SDK_HONO_RANGE = '^1.19.9';
const BUNDLED_HONO_VERSION = '2.0.11';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestTempPrefix = '.happy-platform-mcp-sdk-manifest-';
const defaultFs = { lstat, open, readFile, realpath, rename, rm };

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

function assertContained(boundaryPath, dependencyPath, label) {
  const relativePath = relative(boundaryPath, dependencyPath);
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw refuse(`${label} resolves outside root node_modules: ${dependencyPath}`);
  }
}

async function inspectNode(path, label, expectedType, boundaryPath, fs) {
  let metadata;
  try {
    metadata = await fs.lstat(path);
  } catch (error) {
    throw refuse(`cannot inspect ${label} at ${path}`, { cause: error });
  }

  if (metadata.isSymbolicLink()) {
    throw refuse(`${label} must not be a symbolic link: ${path}`);
  }
  if (
    (expectedType === 'directory' && !metadata.isDirectory()) ||
    (expectedType === 'regular file' && !metadata.isFile())
  ) {
    throw refuse(`${label} must be a ${expectedType}: ${path}`);
  }

  let realPath;
  try {
    realPath = await fs.realpath(path);
  } catch (error) {
    throw refuse(`cannot resolve ${label} at ${path}`, { cause: error });
  }
  if (boundaryPath) {
    assertContained(boundaryPath, realPath, label);
  }

  return { metadata, path, realPath };
}

async function inspectInstalledDependencies(paths, fs) {
  const nodeModules = await inspectNode(
    paths.rootNodeModulesPath,
    'root node_modules',
    'directory',
    undefined,
    fs,
  );
  const sdkDir = await inspectNode(
    paths.sdkDirPath,
    'installed SDK directory',
    'directory',
    nodeModules.realPath,
    fs,
  );
  const sdkManifest = await inspectNode(
    paths.sdkManifestPath,
    'installed SDK manifest',
    'regular file',
    nodeModules.realPath,
    fs,
  );
  assertContained(sdkDir.realPath, sdkManifest.realPath, 'installed SDK manifest');

  const sdkRequire = createRequire(paths.sdkManifestPath);
  const searchPaths = sdkRequire.resolve.paths(HONO_NAME);
  if (!Array.isArray(searchPaths)) {
    throw refuse(`cannot resolve installed ${HONO_NAME} from ${SDK_NAME}`);
  }

  let honoDir;
  for (const searchPath of searchPaths) {
    const candidatePath = join(searchPath, ...HONO_NAME.split('/'));
    try {
      await fs.lstat(candidatePath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        continue;
      }
      throw refuse(`cannot inspect resolved Hono directory at ${candidatePath}`, {
        cause: error,
      });
    }

    honoDir = await inspectNode(
      candidatePath,
      'resolved Hono directory',
      'directory',
      nodeModules.realPath,
      fs,
    );
    break;
  }
  if (!honoDir) {
    throw refuse(`cannot resolve installed ${HONO_NAME} from ${SDK_NAME}`);
  }

  const honoManifest = await inspectNode(
    join(honoDir.path, 'package.json'),
    'resolved Hono manifest',
    'regular file',
    nodeModules.realPath,
    fs,
  );
  assertContained(honoDir.realPath, honoManifest.realPath, 'resolved Hono manifest');

  let honoEntryPath;
  try {
    honoEntryPath = sdkRequire.resolve(HONO_NAME);
  } catch (error) {
    throw refuse(`cannot resolve installed ${HONO_NAME} entry point from ${SDK_NAME}`, {
      cause: error,
    });
  }
  const honoEntry = await inspectNode(
    honoEntryPath,
    'resolved Hono entry point',
    'regular file',
    nodeModules.realPath,
    fs,
  );
  assertContained(honoDir.realPath, honoEntry.realPath, 'resolved Hono entry point');

  return { nodeModules, sdkDir, sdkManifest, honoDir, honoManifest, honoEntry };
}

function assertSameDependencyState(before, after, { replacedSdkManifest = false } = {}) {
  for (const name of [
    'nodeModules',
    'sdkDir',
    'sdkManifest',
    'honoDir',
    'honoManifest',
    'honoEntry',
  ]) {
    const pathChanged = before[name].realPath !== after[name].realPath;
    const identityChanged =
      before[name].metadata.dev !== after[name].metadata.dev ||
      before[name].metadata.ino !== after[name].metadata.ino;
    if (pathChanged || (identityChanged && !(replacedSdkManifest && name === 'sdkManifest'))) {
      throw refuse(`${name} changed while preparing the SDK manifest`);
    }
  }
}

function throwCollectedErrors(primaryError, cleanupErrors, message) {
  if (primaryError) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError([primaryError, ...cleanupErrors], message);
    }
    throw primaryError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, message);
  }
}

async function writeAtomically(path, bytes, mode, fs) {
  const tempPath = join(dirname(path), `${manifestTempPrefix}${process.pid}-${randomUUID()}.tmp`);
  const cleanupErrors = [];
  let handle;
  let primaryError;

  try {
    handle = await fs.open(tempPath, 'wx', mode & 0o777);
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    primaryError = error;
  }

  if (handle) {
    try {
      await handle.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    handle = undefined;
  }
  if (!primaryError) {
    try {
      await fs.rename(tempPath, path);
    } catch (error) {
      primaryError = error;
    }
  }
  try {
    await fs.rm(tempPath, { force: true });
  } catch (error) {
    cleanupErrors.push(error);
  }

  throwCollectedErrors(
    primaryError,
    cleanupErrors,
    `could not atomically write ${path} and clean up its temporary file`,
  );
}

export async function normalizeSdkManifest({ root, fs: fsOverrides = {} }) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new TypeError('normalizeSdkManifest requires an explicit repository root');
  }
  const fs = { ...defaultFs, ...fsOverrides };
  const resolvedRoot = resolve(root);
  const rootNodeModulesPath = join(resolvedRoot, 'node_modules');
  const sdkDirPath = join(rootNodeModulesPath, '@modelcontextprotocol', 'sdk');
  const paths = {
    rootNodeModulesPath,
    sdkDirPath,
    sdkManifestPath: join(sdkDirPath, 'package.json'),
  };

  const dependencyState = await inspectInstalledDependencies(paths, fs);
  const [original, honoBytes] = await Promise.all([
    fs.readFile(dependencyState.sdkManifest.path),
    fs.readFile(dependencyState.honoManifest.path),
  ]);

  const sdkManifest = parseManifest(original, dependencyState.sdkManifest.path);
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

  const honoManifest = parseManifest(honoBytes, dependencyState.honoManifest.path);
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

  const normalized = parseManifest(Buffer.from(normalizedSource), dependencyState.sdkManifest.path);
  if (
    normalized.name !== SDK_NAME ||
    normalized.version !== SDK_VERSION ||
    normalized.dependencies?.[HONO_NAME] !== BUNDLED_HONO_VERSION
  ) {
    throw refuse(`normalized SDK manifest failed validation`);
  }

  const writeState = await inspectInstalledDependencies(paths, fs);
  assertSameDependencyState(dependencyState, writeState);
  const normalizedBytes = Buffer.from(normalizedSource);
  await writeAtomically(
    writeState.sdkManifest.path,
    normalizedBytes,
    writeState.sdkManifest.metadata.mode,
    fs,
  );

  const persistedState = await inspectInstalledDependencies(paths, fs);
  assertSameDependencyState(dependencyState, persistedState, { replacedSdkManifest: true });
  const persisted = await fs.readFile(persistedState.sdkManifest.path);
  if (!persisted.equals(normalizedBytes)) {
    throw refuse(`normalized SDK manifest did not persist byte-exactly`);
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectExecution) {
  if (process.argv.length !== 2) {
    throw new Error('Usage: node scripts/bundle-sdk-manifest.mjs');
  }
  await normalizeSdkManifest({ root: repositoryRoot });
}
