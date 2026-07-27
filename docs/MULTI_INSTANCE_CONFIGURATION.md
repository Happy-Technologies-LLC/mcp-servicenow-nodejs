# Multi-Instance Configuration Guide

The ServiceNow MCP Server loads named instance metadata from a version 1
registry and routes operations to dev, test, or production. Credentials are
never stored in the registry created by the new CLI: only canonical
`credentialRef` values point to local OS-keychain entries.

## Configuration File

Global installs and `npx` use the user-owned registry
`<homedir>/.config/happy-platform-mcp/instances.json` on every OS, with that
OS's native path separators. There is no platform-specific resolver claim.
Set one optional `HAPPY_CONFIG_PATH` setting to point to a different metadata
registry; `~` expands to the home directory and relative paths are resolved
from the process working directory. One setting/file holds all environments.

The CLI inherits its process environment and does not auto-load `.env`.
`.env` auto-loading applies to the server/stdio process only. Export
`HAPPY_CONFIG_PATH` for CLI commands, or set it in the MCP host environment
for a server/stdio launch.

```json
{
  "version": 1,
  "docs": {
    "localIndexEnabled": false
  },
  "instances": [
    {
      "name": "dev",
      "url": "https://your-dev-instance.service-now.com",
      "authType": "basic",
      "username": "your-username",
      "credentialRef": "keychain:instance/dev/password",
      "default": true,
      "description": "Development instance"
    },
    {
      "name": "prod",
      "url": "https://your-prod-instance.service-now.com",
      "authType": "oauth",
      "grantType": "client_credentials",
      "clientId": "your-client-id",
      "credentialRef": "keychain:instance/prod/client-secret",
      "default": false,
      "description": "Production instance"
    }
  ]
}
```

Use the local CLI to create and test entries:

```bash
happy-platform-mcp instance add
happy-platform-mcp instance list
happy-platform-mcp instance update dev
happy-platform-mcp instance test dev
happy-platform-mcp instance remove dev
happy-platform-mcp instance credential set dev --type password
happy-platform-mcp instance migrate
```

Secret prompts are masked and handled locally by the OS keychain. `update`
changes metadata only; authentication changes require remove/re-add. The CLI
requires an interactive TTY for secret prompts and does not accept secrets
from non-TTY stdin or fall back to plaintext. MCP tools never accept passwords
or client secrets.

For a password-grant instance, `credentialRef` is an object with both
`password` and `clientSecret` canonical references. Basic and
`client_credentials` instances use one string reference for the respective
password or client secret. Authorization-code instances use metadata only
until the interactive browser flow stores a refresh token locally.

### Instance Configuration Fields

| Field | Required | Description |
|-------|----------|-------------|
| `version` | Yes | Registry document version; current value is `1` |
| `docs` | No | Preserved top-level docs settings such as `localIndexEnabled` |
| `name` | Yes | Unique instance identifier |
| `url` | Yes | HTTPS ServiceNow URL; loopback HTTP is allowed for local fixtures |
| `username` | Basic/password grant | Username for authentication |
| `authType` | No | `"basic"` or `"oauth"` |
| `grantType` | OAuth only | `"client_credentials"`, `"password"`, or `"authorization_code"` |
| `clientId` | OAuth only | OAuth client identifier |
| `credentialRef` | Basic/client credentials | Canonical local keychain reference |
| `scope` | No | OAuth scope |
| `authorizeUrl` | No | Authorization endpoint for `authorization_code` |
| `tokenUrl` | No | Token endpoint for `authorization_code` |
| `redirectPort` | No | Loopback callback port |
| `callbackPath` | No | Loopback callback path |
| `default` | No | Startup default marker |
| `description` | No | Human-readable description |
Legacy registries may omit `version`; readers treat an omitted value as
version `1`. Any explicit value other than numeric `1` is rejected. CLI writes
always emit numeric `"version": 1`.

The registry file is metadata only and should remain private. Do not add
plaintext credential fields to new configuration.

## Registry path precedence and environment timing

At startup and for CLI reads/writes, resolution is exact:

1. `HAPPY_CONFIG_PATH`, when set. It is the single explicit metadata registry
   path.
2. The user registry (`<homedir>/.config/happy-platform-mcp/instances.json`)
   when it exists.
3. The legacy package-relative `config/servicenow-instances.json` when it
   exists.
4. The singular `SERVICENOW_*` environment fallback only when no registry file
   is available.

Migration reads only the legacy registry JSON source, never `SERVICENOW_*`
environment variables. It writes the resolved target: the explicit
`HAPPY_CONFIG_PATH` path when set, otherwise the default user registry path.
The legacy source remains untouched. Environment-only credentials must be
manually re-registered with `instance add` and `instance credential set`.

Set `HAPPY_CONFIG_PATH` before launch; do not expect changing it through a
running MCP call to retarget the process.

## Instance Selection

### 1. Per-Call Routing (Recommended)

Add the optional `instance` parameter to any live ServiceNow operation except `SN-Set-Instance`, `SN-Get-Current-Instance`, and `SN-Docs-*`. If omitted, the call uses the current session client's implicit target.

Explicit routes use clients cached by instance name. Use them when overlapping work may target different instances or race with `SN-Set-Instance`; concurrent calls against one stable implicit target do not require explicit routing. Explicit calls to the same instance share that named cached client. `SN-Set-Instance` changes only the current session client's implicit target in memory. It never edits JSON or environment configuration, and a new MCP session or server starts from startup selection again.

### 2. Startup Selection

For the stdio server, startup selects instances in this order:

1. The named JSON entry in `SERVICENOW_INSTANCE`, when set
2. The entry marked `"default": true`
3. The first configured entry

```bash
SERVICENOW_INSTANCE=prod node src/stdio-server.js
# Selects the configured "prod" entry
```

In your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "servicenow": {
      "command": "node",
      "args": ["src/stdio-server.js"],
      "cwd": "/path/to/mcp-servicenow-nodejs",
      "env": {
        "SERVICENOW_INSTANCE": "dev"
      }
    }
  }
}
```

The HTTP server does not use the stdio named override; it starts with the `"default": true` entry, or the first configured entry if none is marked.

The `default` flag only controls startup selection. After startup, calls that omit `instance` use the session client's current implicit target.

### 3. Environment Credential Fallback

If no registry file is available, the legacy singular environment variables
provide one fallback instance named `default`. They are backward-compatible
only and should not be used for new multi-instance setup:

```env
# Set locally; never commit secret values.
SERVICENOW_INSTANCE_URL=
SERVICENOW_USERNAME=
SERVICENOW_PASSWORD=
```

## API Endpoints
```bash
curl http://localhost:3000/instances
```

Response:
```json
{
  "instances": [
    {
      "name": "dev",
      "url": "https://dev276360.service-now.com",
      "default": true,
      "description": "Development instance"
    },
    {
      "name": "prod",
      "url": "https://yourinstance.service-now.com",
      "default": false,
      "description": "Production instance"
    }
  ]
}
```

### Health Check
```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "healthy",
  "servicenow_instance": "https://dev276360.service-now.com",
  "instance_name": "dev",
  "timestamp": "2025-09-30T12:46:25.330Z"
}
```

## Configuration Manager API

The `ConfigManager` class (src/config-manager.js) provides:

### Methods

- `loadInstances()` - Load all instances from JSON or .env
- `getInstance(name)` - Get specific instance by name
- `getDefaultInstance()` - Get the default instance
- `getInstanceOrDefault(name)` - Get instance by name or default
- `listInstances()` - List all instances (without passwords)
- `validateInstance(instance)` - Validate instance configuration

### Example Usage

```javascript
import { configManager } from './config-manager.js';

// Get the configured startup default, or the first entry
const defaultInstance = configManager.getDefaultInstance();

// Get a specific instance
const prodInstance = configManager.getInstance('prod');

// Apply named override, configured default, then first-entry precedence
const selectedInstance = configManager.getInstanceOrDefault(process.env.SERVICENOW_INSTANCE);

// List all instances
const instances = configManager.listInstances();
```

## OAuth Authentication

Each instance can independently use basic auth or OAuth 2.0. The following
sequences use interactive `instance add`, then local credential setup and
`instance test`; do not put secrets in JSON or command arguments.

### Basic authentication

```bash
happy-platform-mcp instance add
# Select Basic authentication and enter the URL, name, and username.
happy-platform-mcp instance credential set dev --type password
happy-platform-mcp instance test dev
```

### OAuth client credentials

```bash
happy-platform-mcp instance add
# Select OAuth -> Client credentials and enter URL and client ID.
happy-platform-mcp instance credential set prod --type client-secret
happy-platform-mcp instance test prod
```

### OAuth password grant

```bash
happy-platform-mcp instance add
# Select OAuth -> Password grant and enter URL, client ID, and username.
happy-platform-mcp instance credential set password-prod --type password
happy-platform-mcp instance credential set password-prod --type client-secret
happy-platform-mcp instance test password-prod
```

Password grant requires both credential references:

```json
"credentialRef": {
  "password": "keychain:instance/password-prod/password",
  "clientSecret": "keychain:instance/password-prod/client-secret"
}
```

### Public authorization code with PKCE

```bash
happy-platform-mcp instance add
# Select OAuth -> Authorization code, choose a public client, and enter:
# URL, client ID, authorize URL, token URL, redirect port, callback path.
happy-platform-mcp instance test public-dev
```

Authorization-code metadata does not require `credentialRef` or a client
secret. The first test/API call opens the browser authorization flow; the
resulting refresh token is stored in the OS keychain.

For OAuth setup, create the appropriate endpoint under **System OAuth >
Application Registry**, then store only the client identifier and canonical
credential references in the registry. Authorization Code instances use
`authorizeUrl`, `tokenUrl`, `redirectPort`, and `callbackPath` metadata.

Client Credentials and password-grant tokens are cached in memory and refreshed
before expiry. Authorization Code refresh tokens are stored in the OS keychain.
After a rejected refresh token, browser sign-in starts again; there is no
shared credential or plaintext fallback.

When `SN-Set-Instance` selects a configured instance, the current sequential
session client uses that instance's authentication method. The configuration
itself is unchanged.

## Security and rollback behavior

- Registry files contain metadata only; canonical `credentialRef` values point
  to the OS keychain. There is no plaintext fallback.
- Secret prompts are local and masked. MCP registration rejects
  password/client-secret-shaped fields and never accepts secrets.
- If a credential is missing, `SN-Register-Instance` returns
  `CREDENTIAL_NOT_FOUND` plus the exact local credential-set command(s).
- If the keychain is unavailable, registration and migration abort without a
  registry write.
- Registration uses atomic registry writes. A failed write reports
  `REGISTRY_WRITE_FAILED`; an unsafe compensation reports
  `REGISTRY_ROLLBACK_REQUIRED` and requires manual rollback review.
After docs-only registration, restart the MCP server. Normal live registration
reloads configuration without a restart; restart is required only when reload
fails.

## Troubleshooting

### Instance not found

Check the name with `happy-platform-mcp instance list`, then use
`happy-platform-mcp instance add` or the metadata-only `instance update`
command. Authentication changes require remove/re-add.

### Missing credential

Run the exact `happy-platform-mcp instance credential set <name> --type
password|client-secret` command returned by the MCP registration response, in
an interactive local TTY, then retry.

### Legacy migration required

Run `happy-platform-mcp instance migrate`. The old package-relative file is
left untouched, and unsupported or incomplete entries are not partially
migrated.