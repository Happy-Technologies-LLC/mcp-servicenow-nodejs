import { input as defaultInput, password as defaultPassword, select as defaultSelect, confirm as defaultConfirm } from '@inquirer/prompts';
import { InstanceRegistry } from './instance-registry.js';
import { credentialRefFor, CredentialNotFoundError, InstanceCredentialStore } from './instance-credential-store.js';
import { ServiceNowClient } from './servicenow-client.js';

const SECRET_FLAG = /^--(?:password|client[-_]secret)(?:=|$)/i;
const USAGE = `Usage:
  happy-platform-mcp instance add
  happy-platform-mcp instance list
  happy-platform-mcp instance update <name> [metadata flags]
  happy-platform-mcp instance test <name>
  happy-platform-mcp instance remove <name>
  happy-platform-mcp instance credential set <name> --type password|client-secret
  happy-platform-mcp instance migrate`;

const METADATA_FLAGS = new Map([
  ['name', 'name'],
  ['url', 'url'],
  ['auth-type', 'authType'],
  ['grant-type', 'grantType'],
  ['username', 'username'],
  ['client-id', 'clientId'],
  ['scope', 'scope'],
  ['authorize-url', 'authorizeUrl'],
  ['token-url', 'tokenUrl'],
  ['redirect-port', 'redirectPort'],
  ['callback-path', 'callbackPath'],
  ['description', 'description'],
  ['default', 'default'],
  ['no-default', 'noDefault']
]);

function output(stream, value = '') {
  if (stream && typeof stream.write === 'function') stream.write(`${value}\n`);
}

function streamFrom(dependencies, key, fallback) {
  return dependencies[key] || fallback;
}

function getPrompts(dependencies) {
  const source = dependencies.prompts || dependencies.prompt || dependencies;
  const promptContext = {
    input: dependencies.stdin || process.stdin,
    output: dependencies.stdout || process.stdout
  };
  return {
    input: source.input || (options => defaultInput(options, promptContext)),
    password: source.password || (options => defaultPassword(options, promptContext)),
    select: source.select || (options => defaultSelect(options, promptContext)),
    confirm: source.confirm || (options => defaultConfirm(options, promptContext))
  };
}

function hasInjectedPrompt(dependencies) {
  const source = dependencies.prompts || dependencies.prompt || dependencies;
  return ['input', 'password', 'select', 'confirm'].some(kind => typeof source?.[kind] === 'function');
}

function promptWouldBeRequired(args) {
  const command = args[0];
  if (command === 'add') {
    try {
      const { flags } = parseFlags(args.slice(1), new Map([...METADATA_FLAGS, ['make-default', true]]));
      if (flags['auth-type'] === 'oauth' && flags['grant-type'] === 'authorization_code') {
        return !['name', 'url', 'auth-type', 'grant-type', 'client-id', 'scope', 'authorize-url', 'token-url', 'callback-path', 'description']
          .every(flag => flags[flag] !== undefined);
      }
    } catch {
      return true;
    }
    return true;
  }
  if (command === 'remove' || command === 'migrate') return true;
  if (command === 'credential' && args[1] === 'set') return true;
  if (command === 'update') return args.length <= 2;
  return false;
}

function ensureInteractive(context, args) {
  if (
    !context.promptInjected
    && promptWouldBeRequired(args)
    && (context.stdin?.isTTY !== true || context.stdout?.isTTY !== true)
  ) {
    output(context.stderr, 'Non-interactive use requires an interactive TTY for masked prompts; rerun in a terminal or inject prompts for testing.');
    return false;
  }
  return true;
}

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function redact(value, insideCredentialRef = false) {
  if (Array.isArray(value)) return value.map(item => redact(item, insideCredentialRef));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (!insideCredentialRef && ['password', 'clientSecret', 'secret', 'token', 'refreshToken'].includes(key)) continue;
    result[key] = redact(child, key === 'credentialRef');
  }
  return result;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function messageForError(error) {
  if (!error) return 'Unknown error';
  if (typeof error.message === 'string' && error.message) return error.message;
  if (typeof error.code === 'string') return error.code;
  return 'Operation failed';
}

function errorStatus(error) {
  return error?.response?.status ?? error?.status ?? error?.statusCode;
}

function parseFlags(tokens, allowed) {
  const flags = {};
  const positionals = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const equals = token.indexOf('=');
    const rawName = equals >= 0 ? token.slice(2, equals) : token.slice(2);
    const name = rawName.toLowerCase();
    if (SECRET_FLAG.test(token)) throw usageError('Secret flags are not accepted; enter secrets at the masked prompt.');
    if (!allowed.has(name)) throw usageError(`Unknown option --${rawName}.`);
    if (allowed.get(name) === true) {
      flags[name] = true;
      continue;
    }
    if ((name === 'no-default' || name === 'default') && equals < 0 && (index + 1 >= tokens.length || tokens[index + 1].startsWith('--'))) {
      flags[name] = true;
      continue;
    }
    if (equals >= 0) {
      flags[name] = token.slice(equals + 1);
      continue;
    }
    if (index + 1 >= tokens.length || tokens[index + 1].startsWith('--')) {
      throw usageError(`Option --${rawName} requires a value.`);
    }
    flags[name] = tokens[++index];
  }
  return { flags, positionals };
}

function usageError(message) {
  const error = new Error(message);
  error.code = 'USAGE';
  return error;
}

function rejectSecretArguments(argv) {
  return argv.some(token => SECRET_FLAG.test(String(token)) || /^(?:password|clientSecret)=/i.test(String(token)));
}

async function ask(prompts, kind, options) {
  const answer = await prompts[kind](options);
  return answer === undefined || answer === null ? options.default : answer;
}

function parseBoolean(value, field) {
  if (typeof value === 'boolean') return value;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw usageError(`Option --${field} must be true or false.`);
}

function instanceCredentialRefs(instance) {
  const ref = instance?.credentialRef;
  if (typeof ref === 'string') return [ref];
  if (ref && typeof ref === 'object') {
    return Object.values(ref).filter(value => typeof value === 'string');
  }
  return [];
}

function expectedCredentialType(instance, requested) {
  if (instance.authType === 'basic') return requested === 'password' ? requested : null;
  if (instance.authType !== 'oauth') return null;
  if (instance.grantType === 'authorization_code') return null;
  if (instance.grantType === 'password') return requested === 'password' || requested === 'client-secret' ? requested : null;
  return requested === 'client-secret' ? requested : null;
}

function credentialRefPatch(instance, type, ref) {
  if (instance.authType === 'oauth' && instance.grantType === 'password') {
    const current = instance.credentialRef && typeof instance.credentialRef === 'object'
      ? { ...instance.credentialRef }
      : {};
    if (type === 'password') current.password = ref;
    else current.clientSecret = ref;
    return { credentialRef: current };
  }
  return { credentialRef: ref };
}

async function hasSecret(store, ref) {
  try {
    if (typeof store.hasSecret === 'function') return await store.hasSecret(ref);
    if (typeof store.getSecret === 'function') {
      await store.getSecret(ref);
      return true;
    }
    return false;
  } catch (error) {
    if (error?.code === 'CREDENTIAL_NOT_FOUND' || error instanceof CredentialNotFoundError) return false;
    throw error;
  }
}

async function snapshotSecret(store, ref) {
  const existed = await hasSecret(store, ref);
  if (!existed) return { ref, existed: false, value: undefined };
  if (typeof store.getSecret !== 'function') {
    throw new Error('Credential store cannot snapshot an existing deterministic credential.');
  }
  return { ref, existed: true, value: await store.getSecret(ref) };
}

async function setWithSnapshot(store, ref, value, snapshots) {
  if (!snapshots.some(snapshot => snapshot.ref === ref)) {
    snapshots.push(await snapshotSecret(store, ref));
  }
  await store.setSecret(ref, value);
}

async function restoreSnapshots(store, snapshots, stderr, context = 'credential rollback') {
  const failures = [];
  for (const snapshot of [...snapshots].reverse()) {
    try {
      if (snapshot.existed) {
        await store.setSecret(snapshot.ref, snapshot.value);
      } else {
        const result = await store.deleteSecret(snapshot.ref);
        if (result?.deleted === false) failures.push(snapshot.ref);
      }
    } catch {
      failures.push(snapshot.ref);
    }
  }
  if (failures.length) {
    output(stderr, `${context} failed for ${[...new Set(failures)].join(', ')}. Verify registry metadata and keychain entries before retrying.`);
  }
  return failures;
}

async function promptMetadata(prompts, initial = {}, { includeName = true } = {}) {
  const result = {};
  if (includeName) result.name = initial.name ?? await ask(prompts, 'input', { name: 'name', message: 'Instance name:' });
  result.url = initial.url ?? await ask(prompts, 'input', { name: 'url', message: 'ServiceNow URL:' });
  result.authType = initial.authType ?? await ask(prompts, 'select', {
    name: 'authType', message: 'Authentication type:', default: 'basic', choices: [
      { name: 'Basic authentication', value: 'basic' }, { name: 'OAuth', value: 'oauth' }
    ]
  });
  if (result.authType === 'basic') {
    result.username = initial.username ?? await ask(prompts, 'input', { name: 'username', message: 'Username:' });
  } else {
    result.grantType = initial.grantType ?? await ask(prompts, 'select', {
      name: 'grantType', message: 'OAuth grant type:', default: 'client_credentials', choices: [
        { name: 'Client credentials', value: 'client_credentials' },
        { name: 'Password grant', value: 'password' },
        { name: 'Authorization code', value: 'authorization_code' }
      ]
    });
    result.clientId = initial.clientId ?? await ask(prompts, 'input', { name: 'clientId', message: 'Client ID:' });
    if (result.grantType === 'password') result.username = initial.username ?? await ask(prompts, 'input', { name: 'username', message: 'Username:' });
  }
  for (const [name, message] of [['scope', 'OAuth scope:'], ['authorizeUrl', 'Authorization URL:'], ['tokenUrl', 'Token URL:'], ['callbackPath', 'Callback path:'], ['description', 'Description:']]) {
    if (initial[name] !== undefined) result[name] = initial[name];
    else if (result.authType === 'oauth' || name === 'description') {
      const value = await ask(prompts, 'input', { name, message, default: '' });
      if (value) result[name] = value;
    }
  }
  if (initial.redirectPort !== undefined) result.redirectPort = initial.redirectPort;
  if (initial.default !== undefined) result.default = initial.default;
  return result;
}

async function promptSecret(prompts, name, message) {
  return ask(prompts, 'password', { name, message, mask: '*', validate: value => value ? true : 'A value is required.' });
}

async function addCommand(args, context) {
  const { registry, credentialStore: store, prompts, stdout, stderr } = context;
  const { flags, positionals } = parseFlags(args, new Map([...METADATA_FLAGS, ['make-default', true]]));
  if (positionals.length) throw usageError('instance add does not accept positional arguments.');
  const initial = {};
  for (const [flag, field] of METADATA_FLAGS) {
    if (flags[flag] !== undefined && field !== 'noDefault') initial[field] = flags[flag];
  }
  if (flags.default !== undefined) initial.default = parseBoolean(flags.default, 'default');
  if (flags['no-default']) initial.default = false;
  const instance = await promptMetadata(prompts, initial);
  const refs = {};
  if (instance.authType === 'basic') refs.password = credentialRefFor(instance.name, 'password');
  else if (instance.grantType === 'client_credentials') refs.clientSecret = credentialRefFor(instance.name, 'client-secret');
  else if (instance.grantType === 'password') {
    refs.password = credentialRefFor(instance.name, 'password');
    refs.clientSecret = credentialRefFor(instance.name, 'client-secret');
  }
  const candidate = {
    ...instance,
    ...(instance.authType === 'oauth' && instance.grantType === 'password'
      ? { credentialRef: { password: refs.password, clientSecret: refs.clientSecret } }
      : refs.password ? { credentialRef: refs.password } : refs.clientSecret ? { credentialRef: refs.clientSecret } : {})
  };
  if (typeof registry.list === 'function') {
    const existing = await registry.list();
    if (existing.some(item => item?.name === instance.name)) {
      throw Object.assign(new Error(`Instance '${instance.name}' already exists`), { code: 'INSTANCE_ALREADY_EXISTS' });
    }
  } else if (typeof registry.get === 'function') {
    try {
      await registry.get(instance.name);
      throw Object.assign(new Error(`Instance '${instance.name}' already exists`), { code: 'INSTANCE_ALREADY_EXISTS' });
    } catch (error) {
      if (error?.code !== 'INSTANCE_NOT_FOUND') throw error;
    }
  }
  if (typeof registry.validate === 'function') await registry.validate(candidate);
  const snapshots = [];
  try {
    if (instance.authType === 'basic') {
      const secret = await promptSecret(prompts, 'password', 'Password:');
      await setWithSnapshot(store, refs.password, secret, snapshots);
      instance.credentialRef = refs.password;
    } else if (instance.grantType === 'client_credentials') {
      const secret = await promptSecret(prompts, 'clientSecret', 'Client secret:');
      await setWithSnapshot(store, refs.clientSecret, secret, snapshots);
      instance.credentialRef = refs.clientSecret;
    } else if (instance.grantType === 'password') {
      const passwordValue = await promptSecret(prompts, 'password', 'Password:');
      const clientSecretValue = await promptSecret(prompts, 'clientSecret', 'Client secret:');
      await setWithSnapshot(store, refs.password, passwordValue, snapshots);
      await setWithSnapshot(store, refs.clientSecret, clientSecretValue, snapshots);
      instance.credentialRef = { password: refs.password, clientSecret: refs.clientSecret };
    }
    const registered = await registry.register(instance, { makeDefault: flags['make-default'] === true || instance.default === true });
    output(stdout, `Added instance '${instance.name}'.`);
    output(stdout, JSON.stringify(stable(redact(registered)), null, 2));
    return 0;
  } catch (error) {
    await restoreSnapshots(store, snapshots, stderr, 'Credential rollback');
    throw error;
  }
}

async function listCommand(context) {
  const instances = (await context.registry.list()).map(redact).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (!instances.length) {
    output(context.stdout, 'No registered instances.');
    return 0;
  }
  output(context.stdout, JSON.stringify(stable(instances), null, 2));
  return 0;
}

async function updateCommand(name, args, context) {
  if (!name) throw usageError('instance update requires an instance name.');
  const { flags, positionals } = parseFlags(args, METADATA_FLAGS);
  if (positionals.length) throw usageError('instance update accepts metadata options only.');
  const existing = await context.registry.get(name);
  const patch = {};
  const fields = ['url', 'authType', 'grantType', 'username', 'clientId', 'scope', 'authorizeUrl', 'tokenUrl', 'redirectPort', 'callbackPath', 'description'];
  const seenMetadataFlag = fields.some(field => [...METADATA_FLAGS.entries()].some(([flag, value]) => value === field && flags[flag] !== undefined));
  if (flags.default !== undefined) patch.default = parseBoolean(flags.default, 'default');
  if (flags['no-default']) patch.default = false;
  for (const field of fields) {
    const flag = [...METADATA_FLAGS.entries()].find(([, value]) => value === field)?.[0];
    if (flags[flag] !== undefined) patch[field] = field === 'redirectPort' ? Number(flags[flag]) : flags[flag];
  }
  if (!seenMetadataFlag && flags.default === undefined && !flags['no-default']) {
    patch.url = await ask(context.prompts, 'input', { name: 'url', message: 'ServiceNow URL:', default: existing.url });
    if (existing.authType === 'basic') {
      patch.username = await ask(context.prompts, 'input', { name: 'username', message: 'Username:', default: existing.username });
    } else {
      patch.clientId = await ask(context.prompts, 'input', { name: 'clientId', message: 'Client ID:', default: existing.clientId });
      patch.scope = await ask(context.prompts, 'input', { name: 'scope', message: 'OAuth scope:', default: existing.scope || '' });
    }
    patch.description = await ask(context.prompts, 'input', { name: 'description', message: 'Description:', default: existing.description || '' });
  }
  const updated = await context.registry.update(name, patch);
  output(context.stdout, `Updated instance '${name}'.`);
  output(context.stdout, JSON.stringify(stable(redact(updated)), null, 2));
  return 0;
}

async function credentialSetCommand(name, args, context) {
  if (!name) throw usageError('instance credential set requires an instance name.');
  const { flags, positionals } = parseFlags(args, new Map([['type', 'type']]));
  if (positionals.length) throw usageError('instance credential set accepts --type only.');
  const instance = await context.registry.get(name);
  const requested = flags.type || await ask(context.prompts, 'select', {
    name: 'type', message: 'Credential type:', choices: [
      ...(instance.authType === 'basic' ? [{ name: 'Password', value: 'password' }] : []),
      ...(instance.authType === 'oauth' && instance.grantType === 'password' ? [{ name: 'Password', value: 'password' }] : []),
      ...(instance.authType === 'oauth' && instance.grantType !== 'authorization_code' ? [{ name: 'Client secret', value: 'client-secret' }] : [])
    ]
  });
  const type = expectedCredentialType(instance, requested);
  if (!type) throw usageError(`Credential type '${requested}' is not compatible with instance '${name}'.`);
  const ref = credentialRefFor(name, type);
  const patch = credentialRefPatch(instance, type, ref);
  const candidate = { ...instance, ...patch };
  if (typeof context.registry.validate === 'function') context.registry.validate(candidate);
  const snapshots = [await snapshotSecret(context.credentialStore, ref)];
  const secret = await promptSecret(context.prompts, 'secret', `${type === 'password' ? 'Password' : 'Client secret'}:`);
  try {
    await context.credentialStore.setSecret(ref, secret);
    await context.registry.update(name, patch);
  } catch (error) {
    await restoreSnapshots(context.credentialStore, snapshots, context.stderr, 'Credential rollback');
    throw error;
  }
  output(context.stdout, `Credential '${type}' updated for instance '${name}'.`);
  return 0;
}

async function removeCommand(name, context) {
  if (!name) throw usageError('instance remove requires an instance name.');
  const instance = await context.registry.get(name);
  const confirmed = await ask(context.prompts, 'confirm', { name: 'confirm', message: `Remove instance '${name}'?`, default: false });
  if (!confirmed) {
    output(context.stdout, 'Cancelled.');
    return 0;
  }
  const snapshots = [];
  for (const ref of [...new Set(instanceCredentialRefs(instance))]) {
    snapshots.push(await snapshotSecret(context.credentialStore, ref));
  }
  const deleted = [];
  try {
    for (const snapshot of snapshots) {
      if (snapshot.existed) deleted.push(snapshot);
      const result = await context.credentialStore.deleteSecret(snapshot.ref);
      if (result?.deleted === false && snapshot.existed) {
        throw new Error(`Credential deletion failed for ${snapshot.ref}`);
      }
    }
    await context.registry.remove(name);
  } catch (error) {
    const rollbackFailures = await restoreSnapshots(context.credentialStore, deleted.length ? deleted : snapshots, context.stderr, 'Credential rollback');
    if (!rollbackFailures.length) {
      output(context.stderr, `Removal rollback completed; instance metadata remains registered. Original cause: ${messageForError(error)}`);
    }
    throw error;
  }
  output(context.stdout, `Removed instance '${name}'.`);
  return 0;
}

async function testCommand(name, context) {
  if (!name) throw usageError('instance test requires an instance name.');
  const instance = await context.registry.get(name);
  const safeInstance = redact(instance);
  try {
    const client = await context.clientFactory(safeInstance, {
      credentialStore: context.credentialStore,
      authType: safeInstance.authType,
      grantType: safeInstance.grantType,
      credentialRef: safeInstance.credentialRef,
      instanceName: safeInstance.name
    });
    if (typeof client.getRecords === 'function') await client.getRecords('sys_user', { sysparm_limit: 1 });
    else if (typeof client.get === 'function') await client.get('/api/now/table/sys_user?sysparm_limit=1');
    else if (typeof client.getRecord === 'function') await client.getRecord('sys_user', '');
    else throw new Error('Client does not provide an authenticated read operation.');
  } catch (error) {
    const status = errorStatus(error);
    if (status === 401) {
      output(context.stderr, `Authentication failed for '${name}'. Check the credential with instance credential set.`);
      return 1;
    }
    if (status === 403) {
      output(context.stderr, `Authorization failed for '${name}'. The credentials are valid but lack permission for the test read.`);
      return 1;
    }
    output(context.stderr, `Network/configuration failure testing '${name}': ${messageForError(error)}`);
    return 1;
  }
  output(context.stdout, `Instance test succeeded for '${name}'.`);
  return 0;
}
function rawLegacyDocument(registry) {
  if (typeof registry.readLegacy === 'function') return registry.readLegacy();
  if (typeof registry.readLegacyDocument === 'function') return registry.readLegacyDocument();
  if (typeof registry.getLegacyDocument === 'function') return registry.getLegacyDocument();
  if (typeof registry._readLegacyDocument === 'function') return registry._readLegacyDocument();
  if (typeof registry._rawDocument === 'function') return registry._rawDocument();
  if (registry.legacyDocument) return registry.legacyDocument;
  return registry.load?.();
}

function legacySecretEntries(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document) || !Array.isArray(document.instances)) {
    throw new Error('Legacy instance registry is malformed; no changes were made.');
  }
  if (document.version !== undefined && document.version !== 1) {
    throw new Error('Legacy instance registry version is unsupported; no changes were made.');
  }
  const entries = [];
  const walk = (value, path, instanceIndex = -1) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, path === 'instances' ? index : instanceIndex));
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (key === 'credentialRef') continue;
      if (['password', 'clientSecret', 'token', 'refreshToken', 'accessToken', 'apiKey', 'secret'].includes(key)) {
        const allowed = instanceIndex >= 0 && (key === 'password' || key === 'clientSecret') && path === `instances[${instanceIndex}]`;
        if (!allowed) throw new Error(`Legacy secret placement '${path}.${key}' is unsupported; no changes were made.`);
        if (typeof nested !== 'string' || !nested) throw new Error(`Legacy credential '${path}.${key}' is incomplete; no changes were made.`);
        entries.push({ index: instanceIndex, type: key, value: nested });
        continue;
      }
      const childPath = path ? `${path}.${key}` : key;
      walk(nested, childPath, instanceIndex);
    }
  };
  walk(document, '', -1);
  return entries;
}

function buildMigratedDocument(document, registry) {
  const entries = legacySecretEntries(document);
  const transformed = [];
  for (let index = 0; index < document.instances.length; index += 1) {
    const instance = document.instances[index];
    if (!instance || typeof instance !== 'object' || Array.isArray(instance)) {
      throw new Error(`Legacy instance ${index + 1} is malformed; no changes were made.`);
    }
    const authType = instance.authType || 'basic';
    const grantType = instance.grantType || (instance.username ? 'password' : 'client_credentials');
    const password = entries.find(entry => entry.index === index && entry.type === 'password');
    if (!['basic', 'oauth'].includes(authType)) {
      throw new Error(`Legacy instance '${instance.name || index + 1}' has an unsupported authType; no changes were made.`);
    }
    if (authType === 'basic' && instance.grantType !== undefined) {
      throw new Error(`Basic instance '${instance.name || index + 1}' has an unsupported grantType; no changes were made.`);
    }
    if (authType === 'oauth' && !['client_credentials', 'password', 'authorization_code'].includes(grantType)) {
      throw new Error(`OAuth instance '${instance.name || index + 1}' has an unsupported grantType; no changes were made.`);
    }
    if (typeof instance.name !== 'string' || typeof instance.url !== 'string') {
      throw new Error(`Legacy instance ${index + 1} is malformed; no changes were made.`);
    }
    if (authType === 'basic' && (typeof instance.username !== 'string' || !instance.username.trim())) {
      throw new Error(`Basic instance '${instance.name}' is malformed; no changes were made.`);
    }
    if (authType === 'oauth' && (typeof instance.clientId !== 'string' || !instance.clientId.trim())) {
      throw new Error(`OAuth instance '${instance.name}' is malformed; no changes were made.`);
    }
    if (authType === 'oauth' && grantType === 'password' && (typeof instance.username !== 'string' || !instance.username.trim())) {
      throw new Error(`OAuth password instance '${instance.name}' is malformed; no changes were made.`);
    }
    const clientSecret = entries.find(entry => entry.index === index && entry.type === 'clientSecret');
    if (authType === 'basic' && clientSecret) {
      throw new Error(`Basic instance '${instance.name}' has an unsupported clientSecret; no changes were made.`);
    }
    if (authType === 'oauth' && grantType === 'authorization_code' && (password || clientSecret)) {
      throw new Error(`Confidential authorization-code instance '${instance.name}' cannot be migrated safely; no changes were made.`);
    }
    if (authType === 'oauth' && grantType === 'client_credentials' && password) {
      throw new Error(`OAuth client-credentials instance '${instance.name}' has an unsupported password; no changes were made.`);
    }
    if (authType === 'oauth' && grantType === 'password' && Boolean(password) !== Boolean(clientSecret)) {
      throw new Error(`OAuth password instance '${instance.name}' has incomplete plaintext credentials; no changes were made.`);
    }
    const candidate = { ...clone(instance) };
    delete candidate.password;
    delete candidate.clientSecret;
    if (authType === 'oauth' && grantType === 'password' && !password && !clientSecret && candidate.credentialRef && typeof candidate.credentialRef === 'object') {
      const prior = candidate.credentialRef;
      candidate.credentialRef = {
        password: prior.password ?? prior.passwordRef,
        clientSecret: prior.clientSecret ?? prior.clientSecretRef
      };
    }
    const writes = [];
    if (authType === 'basic' && password) {
      candidate.credentialRef = credentialRefFor(instance.name, 'password');
      writes.push({ ref: candidate.credentialRef, value: password.value });
    } else if (authType === 'oauth' && grantType === 'client_credentials' && clientSecret) {
      candidate.credentialRef = credentialRefFor(instance.name, 'client-secret');
      writes.push({ ref: candidate.credentialRef, value: clientSecret.value });
    } else if (authType === 'oauth' && grantType === 'password' && password && clientSecret) {
      candidate.credentialRef = {
        password: credentialRefFor(instance.name, 'password'),
        clientSecret: credentialRefFor(instance.name, 'client-secret')
      };
      writes.push(
        { ref: candidate.credentialRef.password, value: password.value },
        { ref: candidate.credentialRef.clientSecret, value: clientSecret.value }
      );
    }
    if (typeof registry.validate === 'function') registry.validate(candidate);
    transformed.push({ candidate, writes });
  }
  const migrated = { ...clone(document), version: 1, instances: transformed.map(item => item.candidate) };
  if (typeof registry.validateDocument === 'function') registry.validateDocument(migrated);
  return {
    migrated,
    writes: transformed.flatMap(item => item.writes)
  };
}

async function writeMigratedDocument(registry, document) {
  if (typeof registry.migrateLegacy === 'function') return registry.migrateLegacy(document);
  if (typeof registry.migrate === 'function') return registry.migrate(document);
  if (typeof registry.writeMigratedDocument === 'function') return registry.writeMigratedDocument(document);
  if (typeof registry._writeAtomic !== 'function') throw new Error('Registry does not support safe migration writes.');
  await registry._writeAtomic(document);
  registry._document = clone(document);
  registry._loaded = true;
  registry._legacyPlaintext = false;
  if (registry.writePath) registry.readPath = registry.writePath;
  registry.source = 'user';
  return document;
}

async function migrateCommand(context) {
  const registry = context.registry;
  const document = await rawLegacyDocument(registry);
  const { migrated, writes } = buildMigratedDocument(document, registry);
  if (!writes.length) {
    output(context.stdout, 'No legacy plaintext credentials require migration.');
    return 0;
  }
  const confirmed = await ask(context.prompts, 'confirm', { name: 'confirm', message: 'Migrate legacy credentials into the OS keychain?', default: false });
  if (!confirmed) {
    output(context.stdout, 'Cancelled.');
    return 0;
  }
  const snapshots = [];
  try {
    for (const write of writes) await setWithSnapshot(context.credentialStore, write.ref, write.value, snapshots);
    await writeMigratedDocument(registry, migrated);
  } catch (error) {
    await restoreSnapshots(context.credentialStore, snapshots, context.stderr, 'Migration rollback');
    throw error;
  }
  output(context.stdout, `Migrated ${migrated.instances.length} instance${migrated.instances.length === 1 ? '' : 's'}; the legacy file was left untouched.`);
  return 0;
}

function createDefaultClient(instance, options) {
  const authType = instance.authType || 'basic';
  const username = instance.username;
  const client = new ServiceNowClient(instance.url, username, undefined, {
    ...instance,
    ...options,
    authType,
    credentialRef: instance.credentialRef
  });
  client.currentInstanceName = instance.name;
  return client;
}

export function usage() {
  return USAGE;
}

export async function runInstanceCli(argv = [], dependencies = {}) {
  const stdout = streamFrom(dependencies, 'stdout', process.stdout);
  const stderr = streamFrom(dependencies, 'stderr', process.stderr);
  const registry = dependencies.registry || dependencies.instanceRegistry || new InstanceRegistry(dependencies.registryOptions);
  const credentialStore = dependencies.credentialStore || dependencies.credentials || dependencies.store || new InstanceCredentialStore();
  const context = {
    ...dependencies,
    registry,
    credentialStore,
    prompts: getPrompts(dependencies),
    promptInjected: hasInjectedPrompt(dependencies),
    stdin: dependencies.stdin || process.stdin,
    clientFactory: dependencies.clientFactory || dependencies.createClient || createDefaultClient,
    stdout,
    stderr
  };
  const rawArgs = Array.isArray(argv) ? argv.map(String) : [];
  if (rejectSecretArguments(rawArgs)) {
    output(stderr, 'Secret flags and values are not accepted in command arguments; use a masked prompt.');
    return 2;
  }
  const args = rawArgs[0] === 'instance' ? rawArgs.slice(1) : rawArgs;
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    output(stdout, USAGE);
    return 0;
  }
  if (!ensureInteractive(context, args)) return 2;
  try {
    switch (args[0]) {
      case 'list':
        if (args.length !== 1) throw usageError('instance list does not accept options.');
        return await listCommand(context);
      case 'add':
        return await addCommand(args.slice(1), context);
      case 'update':
        return await updateCommand(args[1], args.slice(2), context);
      case 'test':
        if (args.length !== 2) throw usageError('instance test requires exactly one instance name.');
        return await testCommand(args[1], context);
      case 'remove':
        if (args.length !== 2) throw usageError('instance remove requires exactly one instance name.');
        return await removeCommand(args[1], context);
      case 'credential':
        if (args[1] !== 'set' || args.length < 3) throw usageError('instance credential set requires an instance name.');
        return await credentialSetCommand(args[2], args.slice(3), context);
      case 'migrate':
        if (args.length !== 1) throw usageError('instance migrate does not accept options.');
        return await migrateCommand(context);
      default:
        throw usageError(`Unknown instance command '${args[0]}'.`);
    }
  } catch (error) {
    if (error?.code === 'USAGE') {
      output(stderr, `${error.message}\n${USAGE}`);
      return 2;
    }
    output(stderr, messageForError(error));
    return 1;
  }
}
