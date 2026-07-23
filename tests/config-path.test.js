import path from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { expandHome, resolveConfigPaths } from '../src/config-path.js';

const rootDir = path.parse(process.cwd()).root;
const homeDir = path.join(rootDir, 'example-home');
const legacyPath = path.join(rootDir, 'global', 'node_modules', 'happy-platform-mcp', 'config', 'servicenow-instances.json');
const userPath = path.join(homeDir, '.config', 'happy-platform-mcp', 'instances.json');

describe('expandHome', () => {
  test('expands a Windows home prefix independently of the host separator', () => {
    const input = `~${'\\'}docs${'\\'}instances.json`;

    expect(expandHome(input, homeDir)).toBe(path.join(homeDir, `docs${'\\'}instances.json`));
  });
});

describe('resolveConfigPaths', () => {

  test('uses HAPPY_CONFIG_PATH for reads and writes with home expansion', () => {
    const paths = resolveConfigPaths({
      env: { HAPPY_CONFIG_PATH: '~/happy/instances.json' },
      homeDir,
      legacyPath,
      existsSync: () => false
    });

    const expectedPath = path.join(homeDir, 'happy', 'instances.json');
    expect(paths).toEqual({
      readPath: expectedPath,
      writePath: expectedPath,
      source: 'explicit'
    });
  });
  test('resolves a relative HAPPY_CONFIG_PATH against process.cwd()', () => {
    const relativePath = 'config/instances.json';
    const paths = resolveConfigPaths({
      env: { HAPPY_CONFIG_PATH: relativePath },
      homeDir,
      legacyPath,
      existsSync: () => false
    });

    expect(paths.readPath).toBe(path.resolve(relativePath));
    expect(paths.writePath).toBe(path.resolve(relativePath));
  });

  test('uses the user registry when it exists', () => {
    const paths = resolveConfigPaths({
      env: {},
      homeDir,
      legacyPath,
      existsSync: (candidate) => candidate === userPath
    });

    expect(paths).toEqual({
      readPath: userPath,
      writePath: userPath,
      source: 'user'
    });
  });

  test('reads legacy config but writes only to the user registry', () => {
    const paths = resolveConfigPaths({
      env: {},
      homeDir,
      legacyPath,
      existsSync: (candidate) => candidate === legacyPath
    });

    expect(paths).toEqual({
      readPath: legacyPath,
      writePath: userPath,
      source: 'legacy'
    });
  });

  test('uses the user registry when no config file exists', () => {
    const paths = resolveConfigPaths({
      env: {},
      homeDir,
      legacyPath,
      existsSync: () => false
    });

    expect(paths).toEqual({
      readPath: userPath,
      writePath: userPath,
      source: 'user'
    });
  });
});
