#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parsePackageVersion(contents, source = 'package.json') {
  let packageJson;
  try {
    packageJson = JSON.parse(contents);
  } catch (error) {
    throw new Error(`${source}: invalid JSON (${error.message})`, { cause: error });
  }

  if (packageJson === null || typeof packageJson !== 'object' || Array.isArray(packageJson)) {
    throw new Error(`${source}: expected a JSON object`);
  }
  if (!Object.hasOwn(packageJson, 'version')) {
    throw new Error(`${source}: missing required "version"`);
  }
  if (typeof packageJson.version !== 'string' || packageJson.version.trim() === '') {
    throw new Error(`${source}: "version" must be a non-empty string`);
  }

  return packageJson.version;
}

export function packageVersionChanged(previousContents, currentContents) {
  const previousVersion = parsePackageVersion(
    previousContents,
    'previous package.json from stdin'
  );
  const currentVersion = parsePackageVersion(currentContents, 'current package.json');
  return previousVersion !== currentVersion;
}

function readCurrentPackage(packagePath) {
  try {
    return readFileSync(packagePath, 'utf8');
  } catch (error) {
    throw new Error(`current package.json at ${packagePath}: unable to read (${error.message})`, {
      cause: error
    });
  }
}

function runCli(args) {
  if (args.length === 2 && args[0] === '--print-version') {
    const packagePath = args[1];
    process.stdout.write(`${parsePackageVersion(
      readCurrentPackage(packagePath),
      `current package.json at ${packagePath}`
    )}\n`);
    return;
  }

  if (args.length !== 1 || args[0].startsWith('-')) {
    throw new Error(
      'usage: package-version-changed.mjs <current-package-path> (previous package JSON on stdin)\n' +
      '   or: package-version-changed.mjs --print-version <current-package-path>'
    );
  }

  const currentContents = readCurrentPackage(args[0]);
  const previousContents = readFileSync(0, 'utf8');
  process.stdout.write(`${packageVersionChanged(previousContents, currentContents)}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`package-version-changed: ${message}\n`);
    process.exitCode = 1;
  }
}
