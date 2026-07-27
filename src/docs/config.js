import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveConfigPaths } from '../config-path.js';

const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.happy-platform-mcp', 'docs', 'servicenow');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../../config/servicenow-instances.json');

function readSystemDocsProperties(env) {
  const configPath = resolveConfigPaths({ env, legacyPath: DEFAULT_CONFIG_PATH }).readPath;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config.docs || {};
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) {
      return {};
    }
    throw new Error(`Failed to load docs system properties: ${error.message}`);
  }
}

function booleanProperty(value, defaultValue = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.toLowerCase());
  return defaultValue;
}

function envHas(env, name) {
  return Object.prototype.hasOwnProperty.call(env, name);
}

export function getDocsConfig(env = process.env, systemProperties = readSystemDocsProperties(env)) {
  return {
    cacheDir: env.HAPPY_DOCS_CACHE_DIR || systemProperties.cacheDir || DEFAULT_CACHE_DIR,
    localIndexEnabled: envHas(env, 'HAPPY_DOCS_ENABLE_LOCAL_INDEX')
      ? booleanProperty(env.HAPPY_DOCS_ENABLE_LOCAL_INDEX)
      : booleanProperty(systemProperties.localIndexEnabled, false),
    enableVector: envHas(env, 'HAPPY_DOCS_ENABLE_VECTOR')
      ? booleanProperty(env.HAPPY_DOCS_ENABLE_VECTOR)
      : booleanProperty(systemProperties.enableVector, false),
    embeddingProvider: env.HAPPY_DOCS_EMBEDDING_PROVIDER || systemProperties.embeddingProvider || 'none',
    githubToken: env.GITHUB_TOKEN || systemProperties.githubToken || ''
  };
}

export function normalizeSafeRelativePath(relativePath) {
  if (!relativePath || typeof relativePath !== 'string') {
    throw new Error('Unsafe docs path: path is required');
  }

  const normalized = path.posix.normalize(relativePath.replaceAll('\\', '/'));
  if (normalized.startsWith('../') || normalized === '..' || path.isAbsolute(relativePath)) {
    throw new Error(`Unsafe docs path: ${relativePath}`);
  }

  return normalized;
}

export function resolveDocsCachePath(cacheDir, relativePath) {
  const safePath = normalizeSafeRelativePath(relativePath);
  const resolved = path.resolve(cacheDir, safePath);
  const root = path.resolve(cacheDir);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Unsafe docs path: ${relativePath}`);
  }

  return resolved;
}
