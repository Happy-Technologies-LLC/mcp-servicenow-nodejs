import { createHash } from 'node:crypto';
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdkManifestPath = join(root, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json');
const sdkManifestTempPrefix = '.happy-platform-mcp-sdk-manifest-';
const initializeSessionId = 'package-verifier-session';
const initializeProtocolVersion = '2025-06-18';
const initializeClientInfo = {
  name: 'happy-platform-mcp-package-verifier',
  version: '1.0.0',
};
const initializeServerInfo = {
  name: 'happy-platform-mcp-package-smoke',
  version: '1.0.0',
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function validatedNpmCliPath() {
  const configuredPath = process.env.npm_execpath;
  assert(
    typeof configuredPath === 'string' && configuredPath.length > 0,
    'npm_execpath is unavailable; run this verifier through npm run test:package',
  );

  const cliPath = resolve(configuredPath);
  let metadata;
  try {
    metadata = await lstat(cliPath);
  } catch (error) {
    throw new Error(`npm_execpath does not identify a readable npm CLI file: ${cliPath}`, {
      cause: error,
    });
  }
  assert(
    metadata.isFile() && !metadata.isSymbolicLink(),
    `npm_execpath must identify a regular npm CLI JavaScript file: ${cliPath}`,
  );
  return cliPath;
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, npm_config_ignore_scripts: 'false' },
  });

  if (result.error) {
    throw new Error(`${command} ${args.join(' ')} could not be started`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}${output ? `\n${output}` : ''}`);
  }

  return result.stdout.trim();
}

function runNpm(npmCliPath, args, cwd = root) {
  return run(process.execPath, [npmCliPath, ...args], cwd);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function versionsFor(tree, packageName, versions = []) {
  for (const [name, dependency] of Object.entries(tree.dependencies ?? {})) {
    if (name === packageName) {
      versions.push(dependency.version);
    }
    versionsFor(dependency, packageName, versions);
  }
  return versions;
}

function requireOnlyVersion(tree, packageName, expectedVersion) {
  const versions = versionsFor(tree, packageName);
  assert(versions.length > 0, `${packageName} is missing from the consumer tree`);
  assert(
    versions.every((version) => version === expectedVersion),
    `${packageName} resolved unexpected versions: ${versions.join(', ')}`,
  );
}

function listenOnLoopback(listener) {
  return new Promise((resolvePromise, reject) => {
    const onError = (error) => {
      listener.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      listener.off('error', onError);
      const address = listener.address();
      assert(address && typeof address === 'object', 'package verifier listener has no TCP address');
      resolvePromise(address.port);
    };
    listener.once('error', onError);
    listener.once('listening', onListening);
    listener.listen(0, '127.0.0.1');
  });
}

function closeListener(listener) {
  if (!listener.listening) {
    return Promise.resolve();
  }
  return new Promise((resolvePromise, reject) => {
    listener.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolvePromise();
      }
    });
  });
}

function postInitialize(port) {
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id: 'package-verifier-initialize',
    method: 'initialize',
    params: {
      protocolVersion: initializeProtocolVersion,
      capabilities: {},
      clientInfo: initializeClientInfo,
    },
  });

  return new Promise((resolvePromise, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-length': Buffer.byteLength(payload),
          'content-type': 'application/json',
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          resolvePromise({
            body: Buffer.concat(chunks).toString('utf8'),
            headers: response.headers,
            statusCode: response.statusCode,
          });
        });
      },
    );
    request.on('error', reject);
    request.end(payload);
  });
}

const npmCliPath = await validatedNpmCliPath();
const workspace = await mkdtemp(join(tmpdir(), 'happy-platform-mcp-package-'));
let summary;

try {
  const packDir = join(workspace, 'pack');
  const consumerDir = join(workspace, 'consumer');
  await Promise.all([
    mkdir(packDir),
    mkdir(consumerDir),
  ]);

  const packOutput = runNpm(npmCliPath, ['pack', '--json', '--pack-destination', packDir]);
  const normalizedSdkManifest = await readFile(sdkManifestPath);
  const sourceSdk = JSON.parse(normalizedSdkManifest.toString('utf8'));
  assert(
    sourceSdk.name === '@modelcontextprotocol/sdk' && sourceSdk.version === '1.29.0',
    'source installed SDK manifest is not @modelcontextprotocol/sdk@1.29.0 after pack',
  );
  assert(
    sourceSdk.dependencies?.['@hono/node-server'] === '2.0.11',
    'source installed SDK manifest does not declare exact @hono/node-server 2.0.11 after pack',
  );
  assert(
    !(await readdir(dirname(sdkManifestPath))).some((name) => name.startsWith(sdkManifestTempPrefix)),
    'SDK manifest normalization left a temporary file behind',
  );

  const [pack] = JSON.parse(packOutput);
  assert(pack?.filename, 'npm pack did not report a tarball filename');
  const tarballPath = join(packDir, pack.filename);
  const packedPaths = new Set(pack.files.map(({ path }) => path));
  for (const requiredPath of [
    'package.json',
    'scripts/bundle-sdk-manifest.mjs',
    'scripts/verify-package.mjs',
    'node_modules/@modelcontextprotocol/sdk/package.json',
    'node_modules/@hono/node-server/package.json',
  ]) {
    assert(packedPaths.has(requiredPath), `packed tarball is missing ${requiredPath}`);
  }
  const packedScriptPaths = pack.files
    .map(({ path }) => path)
    .filter((path) => path.startsWith('scripts/'))
    .sort();
  assert(
    JSON.stringify(packedScriptPaths) ===
      JSON.stringify(['scripts/bundle-sdk-manifest.mjs', 'scripts/verify-package.mjs']),
    `packed tarball exposes unexpected scripts: ${packedScriptPaths.join(', ')}`,
  );
  assert(
    !pack.files.some(
      ({ path }) =>
        path.includes('node_modules/.cache') ||
        path.includes('.backup') ||
        path.includes(sdkManifestTempPrefix),
    ),
    'packed tarball contains lifecycle backup/cache/temp residue',
  );

  const consumerManifest = {
    name: 'happy-platform-mcp-package-consumer',
    version: '1.0.0',
    private: true,
    type: 'module',
    dependencies: {
      'happy-platform-mcp': `file:${tarballPath}`,
    },
  };
  assert(!Object.hasOwn(consumerManifest, 'overrides'), 'consumer manifest unexpectedly contains overrides');
  await writeFile(join(consumerDir, 'package.json'), `${JSON.stringify(consumerManifest, null, 2)}\n`);

  runNpm(
    npmCliPath,
    ['install', '--ignore-scripts=false', '--audit=false', '--fund=false'],
    consumerDir,
  );

  const consumerRequire = createRequire(join(consumerDir, 'package.json'));
  const installedPackageManifest = consumerRequire.resolve('happy-platform-mcp/package.json');
  const installedPackageRoot = dirname(installedPackageManifest);
  const packedRoot = JSON.parse(await readFile(installedPackageManifest, 'utf8'));
  const packedSdk = JSON.parse(
    await readFile(
      join(installedPackageRoot, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json'),
      'utf8',
    ),
  );
  const packedHono = JSON.parse(
    await readFile(
      join(installedPackageRoot, 'node_modules', '@hono', 'node-server', 'package.json'),
      'utf8',
    ),
  );

  assert(packedRoot.dependencies?.['@modelcontextprotocol/sdk'] === '1.29.0', 'packed root SDK dependency is not 1.29.0');
  assert(packedRoot.dependencies?.axios === '1.18.1', 'packed root Axios dependency is not 1.18.1');
  assert(packedRoot.engines?.node === '>=20', 'packed root Node engine is not >=20');
  assert(
    packedRoot.bundleDependencies?.length === 1 && packedRoot.bundleDependencies[0] === '@modelcontextprotocol/sdk',
    'packed root bundleDependencies is not the audited SDK-only list',
  );
  assert(
    packedRoot.scripts?.prepack === 'node scripts/bundle-sdk-manifest.mjs' &&
      !Object.hasOwn(packedRoot.scripts, 'postpack') &&
      !Object.hasOwn(packedRoot.scripts, 'postinstall') &&
      packedRoot.scripts?.['extract-metadata'] === 'node scripts/extract-table-metadata.js' &&
      packedRoot.scripts?.['test:package'] === 'node scripts/verify-package.mjs',
    'packed lifecycle, metadata, or verifier scripts violate the package contract',
  );
  assert(
    packedRoot.overrides?.['@modelcontextprotocol/sdk']?.['@hono/node-server'] === '2.0.11',
    'packed root scoped SDK Hono override is not exact 2.0.11',
  );
  assert(
    packedSdk.name === '@modelcontextprotocol/sdk' && packedSdk.version === '1.29.0',
    'packed SDK manifest is not @modelcontextprotocol/sdk@1.29.0',
  );
  assert(
    packedSdk.dependencies?.['@hono/node-server'] === '2.0.11',
    'packed SDK manifest does not declare exact @hono/node-server 2.0.11',
  );
  assert(
    packedHono.name === '@hono/node-server' && packedHono.version === '2.0.11',
    'packed Hono is not @hono/node-server@2.0.11',
  );

  const treeOutput = runNpm(
    npmCliPath,
    ['ls', '@modelcontextprotocol/sdk', '@hono/node-server', 'axios', '--all'],
    consumerDir,
  );
  const tree = JSON.parse(
    runNpm(
      npmCliPath,
      ['ls', '@modelcontextprotocol/sdk', '@hono/node-server', 'axios', '--all', '--json'],
      consumerDir,
    ),
  );
  requireOnlyVersion(tree, '@modelcontextprotocol/sdk', '1.29.0');
  requireOnlyVersion(tree, '@hono/node-server', '2.0.11');
  requireOnlyVersion(tree, 'axios', '1.18.1');

  const auditOutput = runNpm(npmCliPath, ['audit', '--audit-level=low'], consumerDir);

  const packageRequire = createRequire(installedPackageManifest);
  const serverModule = await import(
    pathToFileURL(packageRequire.resolve('@modelcontextprotocol/sdk/server/index.js')).href
  );
  const transportModule = await import(
    pathToFileURL(packageRequire.resolve('@modelcontextprotocol/sdk/server/streamableHttp.js')).href
  );
  assert(typeof serverModule.Server === 'function', 'production SDK Server import is not callable');
  assert(
    typeof transportModule.StreamableHTTPServerTransport === 'function',
    'production StreamableHTTPServerTransport import is not callable',
  );

  const server = new serverModule.Server(initializeServerInfo, {
    capabilities: {},
  });
  const transport = new transportModule.StreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: () => initializeSessionId,
  });
  const listener = createServer((request, response) => {
    transport.handleRequest(request, response).catch((error) => {
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: error.message }));
      } else {
        response.destroy(error);
      }
    });
  });

  let initializeResponse;
  const cleanupErrors = [];
  try {
    await server.connect(transport);
    const port = await listenOnLoopback(listener);
    initializeResponse = await postInitialize(port);

    assert(initializeResponse.statusCode === 200, `initialize returned HTTP ${initializeResponse.statusCode}`);
    assert(
      initializeResponse.headers['mcp-session-id'] === initializeSessionId,
      'initialize response has an unexpected MCP session header',
    );
    const contentType = initializeResponse.headers['content-type'];
    assert(
      typeof contentType === 'string' && /^application\/json(?:;|$)/i.test(contentType),
      `initialize response is not JSON: ${contentType ?? 'missing content-type'}`,
    );

    let initializeBody;
    try {
      initializeBody = JSON.parse(initializeResponse.body);
    } catch (error) {
      throw new Error(`initialize response body is not valid JSON: ${initializeResponse.body}`, {
        cause: error,
      });
    }
    assert(!Array.isArray(initializeBody), 'initialize response unexpectedly returned a JSON-RPC batch');
    assert(initializeBody.jsonrpc === '2.0', 'initialize response has an unexpected JSON-RPC version');
    assert(
      initializeBody.id === 'package-verifier-initialize',
      'initialize response has an unexpected JSON-RPC id',
    );
    assert(
      initializeBody.result?.protocolVersion === initializeProtocolVersion,
      'initialize response negotiated an unexpected MCP protocol version',
    );
    assert(
      initializeBody.result?.serverInfo?.name === initializeServerInfo.name &&
        initializeBody.result?.serverInfo?.version === initializeServerInfo.version,
      'initialize response has unexpected server identity semantics',
    );
    assert(
      initializeBody.result?.capabilities &&
        typeof initializeBody.result.capabilities === 'object',
      'initialize response is missing server capabilities',
    );
    assert(
      JSON.stringify(server.getClientVersion()) === JSON.stringify(initializeClientInfo),
      'server did not retain initialize client identity semantics',
    );
    assert(
      JSON.stringify(server.getClientCapabilities()) === '{}',
      'server did not retain initialize client capability semantics',
    );

    summary = {
      auditOutput,
      fileCount: pack.entryCount ?? pack.files.length,
      filename: pack.filename,
      initialize: {
        clientName: server.getClientVersion().name,
        contentType,
        protocolVersion: initializeBody.result.protocolVersion,
        serverName: initializeBody.result.serverInfo.name,
        sessionId: initializeResponse.headers['mcp-session-id'],
        statusCode: initializeResponse.statusCode,
      },
      sdkManifestSha256: sha256(normalizedSdkManifest),
      size: pack.size,
      treeOutput,
      unpackedSize: pack.unpackedSize,
    };
  } finally {
    for (const close of [
      () => transport.close(),
      () => server.close(),
      () => closeListener(listener),
    ]) {
      try {
        await close();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'package verifier could not close initialize resources');
    }
  }
} finally {
  await rm(workspace, { recursive: true, force: true });
}

console.log(`PASS package tarball ${summary.filename}: ${summary.size} bytes compressed, ${summary.unpackedSize} bytes unpacked, ${summary.fileCount} files`);
console.log(`PASS installed SDK manifest normalized in place: sha256 ${summary.sdkManifestSha256}`);
console.log('PASS packed scripts limited to bundle-sdk-manifest.mjs and verify-package.mjs');
console.log(summary.treeOutput);
console.log(summary.auditOutput);
console.log(
  `PASS real initialize HTTP ${summary.initialize.statusCode}, ${summary.initialize.contentType}, session ${summary.initialize.sessionId}, protocol ${summary.initialize.protocolVersion}, server ${summary.initialize.serverName}, client ${summary.initialize.clientName}`,
);
console.log('PASS temporary package and consumer directories cleaned; no repository tarball created');
