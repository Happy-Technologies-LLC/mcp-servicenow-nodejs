import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('repository credential hygiene', () => {
  test('does not retain environment backup files', () => {
    const ignoreRules = readFileSync(path.join(repositoryRoot, '.gitignore'), 'utf8');

    expect(existsSync(path.join(repositoryRoot, '.env.backup'))).toBe(false);
    expect(ignoreRules).toMatch(/^\.env\.backup$/m);
  });

  test('startup script requires caller-provided credentials', () => {
    const script = readFileSync(path.join(repositoryRoot, 'start-mcp.sh'), 'utf8');

    expect(script).toContain('${SERVICENOW_PASSWORD:?');
    expect(script).not.toMatch(/^export SERVICENOW_PASSWORD=.+$/m);
    expect(script).not.toMatch(/dev\d+\.service-now\.com/);
  });

  test('setup guide uses non-secret placeholders', () => {
    const guide = readFileSync(path.join(repositoryRoot, 'docs/SETUP_GUIDE.md'), 'utf8');

    expect(guide).toContain('https://your-instance.service-now.com');
    expect(guide).toContain('"SERVICENOW_PASSWORD": "your-password"');
    expect(guide).not.toMatch(/dev\d+\.service-now\.com/);
  });
});
