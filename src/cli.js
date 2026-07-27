#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { runInstanceCli, usage } from './instance-cli.js';

function write(stream, value) {
  if (stream && typeof stream.write === 'function') stream.write(`${value}\n`);
}

export async function dispatch(argv = process.argv.slice(2), dependencies = {}) {
  const args = Array.isArray(argv) ? argv.map(String) : [];
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
  write(dependencies.stderr || process.stderr, `Unknown command '${args[0]}'.\n${usage()}`);
  return 2;
}

const directPath = process.argv[1] && pathToFileURL(process.argv[1]).href;
if (directPath && import.meta.url === directPath) {
  dispatch().then(code => {
    if (Number.isInteger(code) && code !== 0) process.exitCode = code;
  }).catch(error => {
    write(process.stderr, error?.message || 'Command failed');
    process.exitCode = 1;
  });
}
