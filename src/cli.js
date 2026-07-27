#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInstanceCli, usage, containsSecretArgument, SECRET_ARGUMENT_ERROR } from './instance-cli.js';

function write(stream, value) {
  if (stream && typeof stream.write === 'function') stream.write(`${value}\n`);
}


function realPathOrResolved(value) {
  if (!value) return null;
  try {
    return fs.realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

export function isDirectExecution(entryPath = process.argv[1]) {
  const entry = realPathOrResolved(entryPath);
  const source = realPathOrResolved(fileURLToPath(import.meta.url));
  return Boolean(entry && source && entry === source);
}

export async function dispatch(argv = process.argv.slice(2), dependencies = {}) {
  const args = Array.isArray(argv) ? argv.map(String) : [];
  const stderr = dependencies.stderr || process.stderr;
  if (containsSecretArgument(args)) {
    write(stderr, SECRET_ARGUMENT_ERROR);
    return 2;
  }
  if (args.length === 0) {
    const { main } = await import('./stdio-server.js');
    await main();
    return 0;
  }
  if (args[0] === 'instance') return runInstanceCli(args, dependencies);
  if (args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    write(dependencies.stdout || process.stdout, usage());
    return 0;
  }
  write(stderr, 'Unknown command. Use --help for usage.');
  return 2;
}

if (isDirectExecution()) {
  dispatch().then(code => {
    if (Number.isInteger(code) && code !== 0) process.exitCode = code;
  }).catch(error => {
    write(process.stderr, error?.message || 'Command failed');
    process.exitCode = 1;
  });
}
