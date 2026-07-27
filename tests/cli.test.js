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
