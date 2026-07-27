import { credentialRefFor } from './instance-credential-store.js';

const TOOL_NAME = 'SN-Register-Instance';
const ALLOWED_FIELDS = new Set([
  'name',
  'url',
  'authType',
  'grantType',
  'username',
  'clientId',
  'scope',
  'authorizeUrl',
  'tokenUrl',
  'redirectPort',
  'callbackPath',
  'description',
  'makeDefault'
]);
const OUTPUT_FIELDS = ALLOWED_FIELDS;
const SECRET_KEY_PATTERN = /(?:password|secret|token|credential|api[_-]?key|private[_-]?key)/i;

export const instanceToolDefinitions = [
  {
    name: TOOL_NAME,
    description: 'Register non-secret ServiceNow instance metadata using credentials already stored by the local CLI.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: {
          type: 'string',
          description: 'Unique local instance name (for example, dev or prod).'
        },
        url: {
          type: 'string',
          description: 'HTTPS ServiceNow instance URL.'
        },
        authType: {
          type: 'string',
          enum: ['basic', 'oauth'],
          description: 'Authentication type. Defaults to basic.'
        },
        grantType: {
          type: 'string',
          enum: ['client_credentials', 'password', 'authorization_code'],
          description: 'OAuth grant type.'
        },
        username: {
          type: 'string',
          description: 'Basic-auth or OAuth password-grant username.'
        },
        clientId: {
          type: 'string',
          description: 'OAuth client identifier.'
        },
        scope: {
          type: 'string',
          description: 'Optional OAuth scope.'
        },
        authorizeUrl: {
          type: 'string',
          description: 'Optional OAuth authorization endpoint.'
        },
        tokenUrl: {
          type: 'string',
          description: 'Optional OAuth token endpoint.'
        },
        redirectPort: {
          type: 'integer',
          minimum: 0,
          maximum: 65535,
          description: 'Optional local authorization callback port.'
        },
        callbackPath: {
          type: 'string',
          description: 'Optional local authorization callback path.'
        },
        description: {
          type: 'string',
          description: 'Optional human-readable description.'
        },
        makeDefault: {
          type: 'boolean',
          description: 'Make this instance the default after registration.'
        }
      },
      required: ['name', 'url']
    }
  }
];

export function isInstanceSetupTool(name) {
  return name === TOOL_NAME;
}

function response(payload, isError = false) {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(payload, null, 2)
    }],
    ...(isError ? { isError: true } : {})
  };
}

function errorResponse(code, message, details = {}) {
  return response({ success: false, code, message, ...details }, true);
}

function invalid(message = 'Invalid instance metadata') {
  return errorResponse('INVALID_INSTANCE_CONFIG', message);
}

function assertPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('Instance metadata must be an object');
  }
  return null;
}

function validateInputKeys(value, depth = 0) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nestedError = validateInputKeys(item, depth + 1);
      if (nestedError) return nestedError;
    }
    return null;
  }

  for (const [key, nested] of Object.entries(value)) {
    const knownTopLevelField = depth === 0 && ALLOWED_FIELDS.has(key);
    if (!knownTopLevelField && SECRET_KEY_PATTERN.test(key)) {
      return invalid('Secret-shaped fields are not accepted by this tool; use the local credential command');
    }
    if (depth === 0 && !knownTopLevelField) {
      return invalid('Unknown instance metadata field');
    }
    if (depth > 0) {
      return invalid('Nested instance metadata is not supported');
    }
    const nestedError = validateInputKeys(nested, depth + 1);
    if (nestedError) return nestedError;
  }
  return null;
}


function canonicalMetadata(input) {
  const authType = input.authType === undefined ? 'basic' : input.authType;
  const grantType = authType === 'oauth'
    ? (input.grantType === undefined
      ? (input.username === undefined ? 'client_credentials' : 'password')
      : input.grantType)
    : undefined;
  const metadata = {
    name: input.name,
    url: input.url,
    authType,
    ...(grantType === undefined ? {} : { grantType }),
    ...(input.username === undefined ? {} : { username: input.username }),
    ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    ...(input.authorizeUrl === undefined ? {} : { authorizeUrl: input.authorizeUrl }),
    ...(input.tokenUrl === undefined ? {} : { tokenUrl: input.tokenUrl }),
    ...(input.redirectPort === undefined ? {} : { redirectPort: input.redirectPort }),
    ...(input.callbackPath === undefined ? {} : { callbackPath: input.callbackPath }),
    ...(input.description === undefined ? {} : { description: input.description })
  };

  if (authType === 'basic') {
    metadata.credentialRef = credentialRefFor(input.name, 'password');
  } else if (grantType === 'client_credentials') {
    metadata.credentialRef = credentialRefFor(input.name, 'client-secret');
  } else if (grantType === 'password') {
    metadata.credentialRef = {
      password: credentialRefFor(input.name, 'password'),
      clientSecret: credentialRefFor(input.name, 'client-secret')
    };
  }
  return { metadata, authType, grantType };
}

function outputMetadata(instance, input) {
  const output = {};
  for (const field of OUTPUT_FIELDS) {
    if (field === 'makeDefault') {
      if (instance?.default !== undefined) output.makeDefault = instance.default;
      else if (input?.makeDefault !== undefined) output.makeDefault = input.makeDefault;
      continue;
    }
    if (instance?.[field] !== undefined) output[field] = instance[field];
    else if (input?.[field] !== undefined) output[field] = input[field];
  }
  return output;
}

function credentialCommands(name, types) {
  return types.map(type => `happy-platform-mcp instance credential set ${name} --type ${type}`);
}

function credentialRequirements(authType, grantType, name) {
  if (authType === 'basic') return [{ ref: credentialRefFor(name, 'password'), type: 'password' }];
  if (grantType === 'client_credentials') {
    return [{ ref: credentialRefFor(name, 'client-secret'), type: 'client-secret' }];
  }
  if (grantType === 'password') {
    return [
      { ref: credentialRefFor(name, 'password'), type: 'password' },
      { ref: credentialRefFor(name, 'client-secret'), type: 'client-secret' }
    ];
  }
  return [];
}

async function existingInstance(registry, name) {
  if (typeof registry.get === 'function') {
    try {
      const found = await registry.get(name);
      if (found) return found;
    } catch (error) {
      if (error?.code !== 'INSTANCE_NOT_FOUND') throw error;
    }
  }
  if (typeof registry.list === 'function') {
    const instances = await registry.list();
    return instances.find(instance => instance?.name === name) || null;
  }
  return null;
}

function registryError(error) {
  if (error?.code === 'INSTANCE_ALREADY_EXISTS') {
    return errorResponse('INSTANCE_ALREADY_EXISTS', 'An instance with this name already exists; use the local CLI update command.', {
      commands: [`happy-platform-mcp instance update ${error.details?.name || 'the-instance'}`]
    });
  }
  if (error?.code === 'INVALID_INSTANCE_CONFIG') {
    return invalid('Instance metadata failed canonical validation');
  }
  if (error?.code === 'CREDENTIAL_NOT_FOUND' || typeof error?.code === 'string' && error.code.startsWith('KEYCHAIN_')) {
    return errorResponse(error.code, error.message || 'The local credential store could not be checked; no registration was committed.', error.details || {});
  }
  if (error?.code === 'REGISTRY_ROLLBACK_REQUIRED') {
    return errorResponse(
      'REGISTRY_ROLLBACK_REQUIRED',
      'The registration could not be rolled back safely because it changed concurrently; manual rollback is required.',
      { partial: true, rollbackRequired: true }
    );
  }
  if (error?.code === 'REGISTRY_WRITE_FAILED') {
    return errorResponse('REGISTRY_WRITE_FAILED', 'The instance registry could not be updated. No registration was committed.');
  }
  if (error?.code === 'LEGACY_MIGRATION_REQUIRED') {
    return errorResponse('LEGACY_MIGRATION_REQUIRED', 'Migrate the legacy instance registry with the local CLI before registering another instance.');
  }
  return errorResponse('INSTANCE_REGISTRATION_FAILED', 'The instance registration could not be completed.');
}

async function snapshotPriorDefault(registry) {
  if (typeof registry?.getDefault === 'function') {
    const instance = await registry.getDefault();
    return instance?.name
      ? { name: instance.name, default: instance.default }
      : undefined;
  }
  if (typeof registry?.list === 'function') {
    const instance = (await registry.list()).find(candidate => candidate?.default === true);
    return instance?.name
      ? { name: instance.name, default: instance.default }
      : undefined;
  }
  return undefined;
}

async function checkCredentials(store, requirements, name) {
  if (requirements.length === 0) return null;
  if (!store || typeof store.hasSecret !== 'function') {
    return errorResponse('KEYCHAIN_UNAVAILABLE', 'The local credential store is unavailable; no registration was committed.');
  }

  const missing = [];
  for (const requirement of requirements) {
    try {
      const present = await store.hasSecret(requirement.ref);
      if (!present) missing.push(requirement.type);
    } catch (error) {
      if (error?.code === 'CREDENTIAL_NOT_FOUND') missing.push(requirement.type);
      else {
        const code = typeof error?.code === 'string' && error.code.startsWith('KEYCHAIN_')
          ? error.code
          : 'KEYCHAIN_UNAVAILABLE';
        return errorResponse(code, 'The local credential store could not be checked; no registration was committed.');
      }
    }
  }

  if (missing.length > 0) {
    return errorResponse('CREDENTIAL_NOT_FOUND', 'Store the required credential(s) locally, then retry registration.', {
      commands: credentialCommands(name, [...new Set(missing)])
    });
  }
  return null;
}
function credentialResponseError(result) {
  const payload = JSON.parse(result.content[0].text);
  const error = new Error(payload.message);
  error.code = payload.code;
  const { success: _success, code: _code, message: _message, ...details } = payload;
  error.details = details;
  return error;
}

export async function handleInstanceSetupTool(name, args = {}, dependencies = {}) {
  if (!isInstanceSetupTool(name)) {
    return errorResponse('UNKNOWN_TOOL', 'Unknown instance setup tool');
  }

  const shapeError = assertPlainObject(args) || validateInputKeys(args);
  if (shapeError) return shapeError;

  if (Object.prototype.hasOwnProperty.call(args, 'makeDefault') && typeof args.makeDefault !== 'boolean') {
    return invalid('makeDefault must be a boolean');
  }
  if ((args.authType === undefined || args.authType === 'basic') && args.grantType !== undefined) {
    return invalid('Basic authentication must not specify grantType');
  }

  let canonical;
  try {
    canonical = canonicalMetadata(args);
  } catch {
    return invalid('Instance metadata failed canonical validation');
  }

  const registry = dependencies.instanceRegistry || dependencies.registry;
  if (!registry || typeof registry.register !== 'function') {
    return errorResponse('REGISTRY_UNAVAILABLE', 'The instance registry is unavailable; no registration was committed.');
  }

  try {
    if (typeof registry.validate === 'function') {
      await registry.validate(canonical.metadata);
    }
  } catch (error) {
    return registryError(error);
  }

  try {
    if (await existingInstance(registry, args.name)) {
      return errorResponse('INSTANCE_ALREADY_EXISTS', 'An instance with this name already exists; use the local CLI update command.', {
        commands: [`happy-platform-mcp instance update ${args.name}`]
      });
    }
  } catch (error) {
    return registryError(error);
  }
  const requirements = credentialRequirements(canonical.authType, canonical.grantType, args.name);
  const credentialError = await checkCredentials(dependencies.credentialStore, requirements, args.name);
  if (credentialError) return credentialError;
  let priorDefault;
  try {
    priorDefault = await snapshotPriorDefault(registry);
  } catch (error) {
    return registryError(error);
  }

  const configManager = dependencies.configManager;
  if (!configManager || typeof configManager.reload !== 'function') {
    return errorResponse('CONFIG_MANAGER_UNAVAILABLE', 'Configuration reload is unavailable; no registration was committed.');
  }

  let registered;
  try {
    registered = await registry.register(canonical.metadata, {
      makeDefault: args.makeDefault === undefined ? false : args.makeDefault,
      precommit: async () => {
        const finalCredentialError = await checkCredentials(dependencies.credentialStore, requirements, args.name);
        if (finalCredentialError) throw credentialResponseError(finalCredentialError);
      }
    });
  } catch (error) {
    return registryError(error);
  }

  const postCommitCredentialError = await checkCredentials(
    dependencies.credentialStore,
    requirements,
    args.name
  );
  if (postCommitCredentialError) {
    try {
      await registry.compensateRegistration(args.name, {
        expected: registered,
        priorDefault
      });
    } catch (error) {
      return registryError(error);
    }
    return postCommitCredentialError;
  }

  let reloadResult;
  try {
    reloadResult = await configManager.reload();
    if (typeof dependencies.onConfigReload === 'function') {
      dependencies.onConfigReload();
    }
  } catch {
    return response({
      success: true,
      code: 'REGISTRY_RELOAD_FAILED',
      restartRequired: true,
      partial: true,
      message: 'Instance registered, but configuration reload failed. Restart the MCP server to load the persisted instance.',
      metadata: outputMetadata(registered, args)
    });
  }

  const restartRequired = dependencies.docsOnly === true || reloadResult === false;
  return response({
    success: true,
    restartRequired,
    ...(restartRequired
      ? {
        ...(reloadResult === false ? { partial: true } : {}),
        message: dependencies.docsOnly === true
          ? 'Instance registered. Restart the MCP server to enable live ServiceNow tools.'
          : 'Instance registered, but configuration reload did not complete. Restart the MCP server to load the persisted instance.'
      }
      : {}),
    metadata: outputMetadata(registered, args)
  });
}

export const handler = handleInstanceSetupTool;
