import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdkManifestPath = join(root, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, npm_config_ignore_scripts: 'false' },
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}${output ? `\n${output}` : ''}`);
  }

  return result.stdout.trim();
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

const originalSdkManifest = await readFile(sdkManifestPath);
const workspace = await mkdtemp(join(tmpdir(), 'happy-platform-mcp-package-'));
let summary;

try {
  const packDir = join(workspace, 'pack');
  const inspectDir = join(workspace, 'inspect');
  const consumerDir = join(workspace, 'consumer');
  await Promise.all([
    mkdir(packDir),
    mkdir(inspectDir),
    mkdir(consumerDir),
  ]);

  const packOutput = run(npm, ['pack', '--json', '--pack-destination', packDir]);
  const restoredSdkManifest = await readFile(sdkManifestPath);
  assert(
    restoredSdkManifest.equals(originalSdkManifest),
    'npm pack did not restore the byte-exact installed SDK manifest',
  );

  const [pack] = JSON.parse(packOutput);
  assert(pack?.filename, 'npm pack did not report a tarball filename');
  const tarballPath = join(packDir, pack.filename);
  const packedPaths = new Set(pack.files.map(({ path }) => path));
  for (const requiredPath of [
    'package.json',
    'scripts/bundle-sdk-manifest.mjs',
    'scripts/release.sh',
    'scripts/verify-package.mjs',
    'node_modules/@modelcontextprotocol/sdk/package.json',
    'node_modules/@hono/node-server/package.json',
  ]) {
    assert(packedPaths.has(requiredPath), `packed tarball is missing ${requiredPath}`);
  }
  assert(
    !pack.files.some(({ path }) => path.includes('node_modules/.cache') || path.includes('.backup')),
    'packed tarball contains lifecycle backup/cache residue',
  );

  run('tar', ['-xzf', tarballPath, '-C', inspectDir]);
  const packedRoot = JSON.parse(await readFile(join(inspectDir, 'package', 'package.json'), 'utf8'));
  const packedSdk = JSON.parse(
    await readFile(join(inspectDir, 'package', 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json'), 'utf8'),
  );
  const packedHono = JSON.parse(
    await readFile(join(inspectDir, 'package', 'node_modules', '@hono', 'node-server', 'package.json'), 'utf8'),
  );

  assert(packedRoot.dependencies?.['@modelcontextprotocol/sdk'] === '1.29.0', 'packed root SDK dependency is not 1.29.0');
  assert(packedRoot.dependencies?.axios === '1.18.1', 'packed root Axios dependency is not 1.18.1');
  assert(packedRoot.engines?.node === '>=20', 'packed root Node engine is not >=20');
  assert(
    packedRoot.bundleDependencies?.length === 1 && packedRoot.bundleDependencies[0] === '@modelcontextprotocol/sdk',
    'packed root bundleDependencies is not the audited SDK-only list',
  );
  assert(
    packedRoot.scripts?.prepack === 'node scripts/bundle-sdk-manifest.mjs prepack' &&
      packedRoot.scripts?.postpack === 'node scripts/bundle-sdk-manifest.mjs postpack' &&
      packedRoot.scripts?.['test:package'] === 'node scripts/verify-package.mjs',
    'packed lifecycle/verifier scripts do not point to the included helpers',
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

  run(npm, ['install', '--ignore-scripts=false', '--audit=false', '--fund=false'], consumerDir);
  const treeOutput = run(
    npm,
    ['ls', '@modelcontextprotocol/sdk', '@hono/node-server', 'axios'],
    consumerDir,
  );
  const tree = JSON.parse(
    run(
      npm,
      ['ls', '@modelcontextprotocol/sdk', '@hono/node-server', 'axios', '--json'],
      consumerDir,
    ),
  );
  requireOnlyVersion(tree, '@modelcontextprotocol/sdk', '1.29.0');
  requireOnlyVersion(tree, '@hono/node-server', '2.0.11');
  requireOnlyVersion(tree, 'axios', '1.18.1');

  const auditOutput = run(npm, ['audit', '--audit-level=low'], consumerDir);

  const consumerRequire = createRequire(join(consumerDir, 'package.json'));
  const installedPackageManifest = consumerRequire.resolve('happy-platform-mcp/package.json');
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
  const transport = new transportModule.StreamableHTTPServerTransport({
    sessionIdGenerator: () => 'package-verifier-session',
  });
  await transport.start();
  await transport.close();

  summary = {
    filename: pack.filename,
    size: pack.size,
    unpackedSize: pack.unpackedSize,
    fileCount: pack.entryCount ?? pack.files.length,
    sdkManifestSha256: sha256(originalSdkManifest),
    treeOutput,
    auditOutput,
  };
} finally {
  await rm(workspace, { recursive: true, force: true });
}

console.log(`PASS package tarball ${summary.filename}: ${summary.size} bytes compressed, ${summary.unpackedSize} bytes unpacked, ${summary.fileCount} files`);
console.log(`PASS byte-exact SDK manifest restore: sha256 ${summary.sdkManifestSha256}`);
console.log(summary.treeOutput);
console.log(summary.auditOutput);
console.log('PASS production SDK imports and StreamableHTTP instantiate/start/close');
console.log('PASS temporary package, inspection, and consumer directories cleaned; no repository tarball created');
