import path from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { resolveConfigPaths } from '../src/config-path.js';

describe('resolveConfigPaths', () => {
  const homeDir = '/Users/example';
  const legacyPath = '/global/node_modules/happy-platform-mcp/config/servicenow-instances.json';
  const userPath = path.join(homeDir, '.config/happy-platform-mcp/instances.json');

  test('uses HAPPY_CONFIG_PATH for reads and writes with home expansion', () => {
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
