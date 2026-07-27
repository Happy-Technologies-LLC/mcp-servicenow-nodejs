import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const USER_CONFIG_RELATIVE_PATH = path.join(
  '.config', 'happy-platform-mcp', 'instances.json'
);

export function expandHome(input, homeDir = os.homedir()) {
  if (input === '~') return homeDir;
  if (input.startsWith(`~${path.sep}`) || input.startsWith('~/') || input.startsWith('~\\')) {
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
