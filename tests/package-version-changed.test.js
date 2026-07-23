import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from '@jest/globals';
import {
  packageVersionChanged,
  parsePackageVersion
} from '../scripts/package-version-changed.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const scriptPath = join(repositoryRoot, 'scripts', 'package-version-changed.mjs');
const workflowPath = join(repositoryRoot, '.github', 'workflows', 'publish.yml');
const temporaryDirectories = [];

function packageJson(version, overrides = {}) {
  return JSON.stringify({
    name: 'release-gate-fixture',
    version,
    description: 'before',
    dependencies: { example: '1.0.0' },
    ...overrides
  });
}

function createCurrentPackage(contents) {
  const directory = mkdtempSync(join(tmpdir(), 'package-version-changed-'));
  temporaryDirectories.push(directory);
  const packagePath = join(directory, 'package.json');
  writeFileSync(packagePath, contents);
  return packagePath;
}

function jobBlock(workflow, jobName) {
  const marker = `  ${jobName}:\n`;
  const start = workflow.indexOf(marker);
  if (start === -1) {
    throw new Error(`Missing workflow job: ${jobName}`);
  }
  const remainder = workflow.slice(start + marker.length);
  const nextJob = remainder.search(/^  [a-zA-Z0-9_-]+:\s*$/m);
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
}

function inlineNeeds(block) {
  const match = block.match(/^    needs:\s*\[([^\]]+)\]\s*$/m);
  if (!match) {
    throw new Error('Expected an inline needs list');
  }
  return match[1].split(',').map((dependency) => dependency.trim());
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('package version comparison', () => {
  test('returns false when only description and dependencies change', () => {
    const previous = packageJson('1.2.3');
    const current = packageJson('1.2.3', {
      description: 'after',
      dependencies: { example: '2.0.0' }
    });

    expect(packageVersionChanged(previous, current)).toBe(false);
  });

  test('returns true for an actual version change', () => {
    expect(packageVersionChanged(
      packageJson('1.2.3'),
      packageJson('1.2.4')
    )).toBe(true);
  });

  test.each([
    ['malformed JSON', '{', /invalid JSON/],
    ['a missing version', JSON.stringify({ name: 'fixture' }), /missing required "version"/],
    ['a non-string version', JSON.stringify({ version: 123 }), /"version" must be a non-empty string/]
  ])('rejects %s', (_caseName, contents, expectedMessage) => {
    expect(() => parsePackageVersion(contents, 'fixture package.json'))
      .toThrow(expectedMessage);
  });
});

describe('package version CLI', () => {
  test('reads the previous package from stdin and the current package from a path', () => {
    const currentPath = createCurrentPackage(packageJson('1.2.3', { description: 'after' }));
    const result = spawnSync(process.execPath, [scriptPath, currentPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      input: packageJson('1.2.3')
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('false\n');
    expect(result.stderr).toBe('');
  });

  test('prints the validated current version for workflow outputs', () => {
    const currentPath = createCurrentPackage(packageJson('2.0.0'));
    const result = spawnSync(process.execPath, [scriptPath, '--print-version', currentPath], {
      cwd: repositoryRoot,
      encoding: 'utf8'
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('2.0.0\n');
    expect(result.stderr).toBe('');
  });

  test('fails closed with an actionable stdin error', () => {
    const currentPath = createCurrentPackage(packageJson('1.2.3'));
    const result = spawnSync(process.execPath, [scriptPath, currentPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      input: '{'
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/previous package\.json from stdin: invalid JSON/);
  });
});

describe('publish workflow release graph', () => {
  test('makes Docker publication depend on successful npm publication', () => {
    const workflow = readFileSync(workflowPath, 'utf8');
    const docker = jobBlock(workflow, 'publish-docker');

    expect(inlineNeeds(docker)).toEqual(['check-version', 'test', 'publish-npm']);
    expect(docker).toContain("if: needs.check-version.outputs.should-publish == 'true'");
  });

  test('keeps manual publication explicit and removes grep-based detection', () => {
    const workflow = readFileSync(workflowPath, 'utf8');
    const checkVersion = jobBlock(workflow, 'check-version');

    expect(workflow).toMatch(/^  workflow_dispatch:\s*$/m);
    expect(checkVersion).toContain('if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then');
    expect(checkVersion).toContain('echo "should-publish=true" >> "$GITHUB_OUTPUT"');
    expect(workflow).not.toMatch(/\bgrep\b/);
  });

  test('compares against the full push before revision', () => {
    const workflow = readFileSync(workflowPath, 'utf8');
    const checkVersion = jobBlock(workflow, 'check-version');

    expect(checkVersion).toContain('fetch-depth: 0');
    expect(checkVersion).toContain(
      'git show "${{ github.event.before }}:package.json" | node scripts/package-version-changed.mjs package.json'
    );
    expect(checkVersion).not.toContain('HEAD^:package.json');
  });

  test('serializes publication runs without canceling an active release', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toMatch(
      /^concurrency:\n  group: publish-\$\{\{ github\.repository \}\}\n  cancel-in-progress: false$/m
    );
  });
});
