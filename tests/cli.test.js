import { jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatch, isDirectExecution } from '../src/cli.js';

function streams() {
  const out = { chunks: [], write(value) { this.chunks.push(String(value)); } };
  const err = { chunks: [], write(value) { this.chunks.push(String(value)); } };
  return { out, err };
}

test('dispatch rejects secret-shaped argv before unknown-command formatting', async () => {
  const { out, err } = streams();
  expect(await dispatch(['--client-secret=token-value'], { stdout: out, stderr: err })).toBe(2);
  expect(err.chunks.join('')).not.toContain('token-value');
  expect(out.chunks.join('')).not.toContain('token-value');
});
 
test.each([
  '--password=fixture-secret-value',
  'password=fixture-secret-value',
  '--clientSecret=fixture-secret-value',
  'client-secret=fixture-secret-value',
  'client_secret=fixture-secret-value',
  '--CLIENT_SECRET=fixture-secret-value'
])('dispatch rejects secret assignment %s before parsing', async token => {
  const { out, err } = streams();
  expect(await dispatch([token], { stdout: out, stderr: err })).toBe(2);
  expect(err.chunks.join('')).toBe('Secret flags and values are not accepted in command arguments; use a masked prompt.\n');
  expect(out.chunks.join('')).toBe('');
  expect(err.chunks.join('')).not.toContain('fixture-secret-value');
});

test('dispatch keeps unknown command output free of argv tokens', async () => {
  const { out, err } = streams();
  expect(await dispatch(['fixture-secret-value'], { stdout: out, stderr: err })).toBe(2);
  expect(err.chunks.join('')).toBe('Unknown command. Use --help for usage.\n');
  expect(err.chunks.join('')).not.toContain('fixture-secret-value');
});

test('direct execution recognizes a symlink without starting stdio for help', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'happy-cli-'));
  const target = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const link = path.join(temporary, 'happy-platform-mcp');
  fs.symlinkSync(target, link);
  try {
    expect(isDirectExecution(link)).toBe(true);
    const { out, err } = streams();
    expect(await dispatch(['--help'], { stdout: out, stderr: err })).toBe(0);
    expect(err.chunks).toHaveLength(0);
    expect(out.chunks.join('')).toContain('Usage:');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
