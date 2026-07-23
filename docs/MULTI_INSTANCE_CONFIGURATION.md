# Multi-Instance Configuration Guide

## Overview

The ServiceNow MCP Server can load multiple named instances from JSON and route individual operations to dev, test, or production. Startup configuration and a session's current implicit target are separate concepts.

## Configuration File

Create `config/servicenow-instances.json` with your instance credentials:

```json
{
  "instances": [
    {
      "name": "dev",
      "url": "https://dev276360.service-now.com",
      "username": "admin",
      "password": "your_password",
      "default": true,
      "description": "Development instance"
    },
    {
      "name": "prod",
      "url": "https://yourinstance.service-now.com",
      "authType": "oauth",
      "grantType": "client_credentials",
      "clientId": "your_oauth_client_id",
      "clientSecret": "your_oauth_client_secret",
      "default": false,
      "description": "Production instance (OAuth)"
    }
  ]
}
```

### Instance Configuration Fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | Yes | — | Unique instance identifier |
| `url` | Yes | — | ServiceNow instance URL |
| `username` | Basic or OAuth password grant | — | Username for authentication |
| `password` | Basic or OAuth password grant | — | Password for authentication |
| `authType` | No | `"basic"` | `"basic"` or `"oauth"` |
| `grantType` | No | auto | `"client_credentials"`, `"password"`, or `"authorization_code"` |
| `clientId` | OAuth only | — | OAuth Client ID from Application Registry |
| `clientSecret` | OAuth except public authorization-code clients | — | OAuth Client Secret |
| `scope` | No | — | OAuth scope (optional) |
| `authorizeUrl` | No | derived from instance URL | Authorization endpoint for `authorization_code` |
| `tokenUrl` | No | derived from instance URL | Token endpoint for `authorization_code` |
| `redirectPort` | No | ephemeral OS-assigned port (`0`) | Loopback port for `authorization_code`; set a fixed port when the registered redirect URL requires one |
| `callbackPath` | No | `"/callback"` | Loopback callback path for `authorization_code` |
| `default` | No | `false` | Mark the startup default when no named override is selected |
| `description` | No | — | Human-readable description |

**Important:** The `config/servicenow-instances.json` file is gitignored to prevent committing credentials.

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

If `config/servicenow-instances.json` is missing, ServiceNow environment credentials provide one fallback instance named `default`:

```env
SERVICENOW_INSTANCE_URL=https://your-instance.service-now.com
SERVICENOW_USERNAME=your_username
SERVICENOW_PASSWORD=your_password
```

## API Endpoints

### List Available Instances
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

## Migration from .env

1. Create `config/servicenow-instances.json` using the example template
2. Copy your credentials from `.env` to the JSON file
3. Test with `npm start`; it should load the JSON configuration
4. Optionally remove ServiceNow credentials from `.env` while keeping unrelated variables

## OAuth Authentication

Each instance can independently use basic auth or OAuth 2.0. Three OAuth grant types are supported:

- **Client Credentials** (recommended for services) — service-to-service, no user credentials needed.
- **Resource Owner Password Credentials** — requires username/password.
- **Authorization Code with PKCE** — signs in an individual developer through a browser and uses a loopback callback. Public clients require no client secret.

### ServiceNow Setup

1. Navigate to **System OAuth > Application Registry**.
2. For Client Credentials or password grants, create an OAuth API endpoint for external clients and configure its client ID and secret.
3. For Authorization Code with PKCE, create a public client and register `http://127.0.0.1:<redirectPort><callbackPath>` as its redirect URL.
4. Add the matching values to your instance config with `"authType": "oauth"`.

### Token Lifecycle

- Client Credentials and password-grant tokens are cached in memory and refreshed before expiry.
- Authorization Code with PKCE opens a browser on the first use, then stores the refresh token in the operating system keychain under the current OS user and instance name.
- On a 401 response, the token is refreshed and the request retried once.
- A rejected authorization-code refresh token starts browser sign-in again; it never falls back to shared credentials.

### Mixing Auth Types

You can freely mix basic auth, client credentials, and password grant instances:

```json
{
  "instances": [
    {
      "name": "dev",
      "url": "https://dev123.service-now.com",
      "username": "admin",
      "password": "password",
      "default": true
    },
    {
      "name": "prod",
      "url": "https://prod456.service-now.com",
      "authType": "oauth",
      "grantType": "client_credentials",
      "clientId": "abc...",
      "clientSecret": "xyz..."
    },
    {
      "name": "staging",
      "url": "https://staging789.service-now.com",
      "authType": "oauth",
      "grantType": "password",
      "clientId": "abc...",
      "clientSecret": "xyz...",
      "username": "integration_user",
      "password": "password"
    },
    {
      "name": "developer",
      "url": "https://dev.service-now.com",
      "authType": "oauth",
      "grantType": "authorization_code",
      "clientId": "public-client-id",
      "redirectPort": 8202
    }
  ]
}
```

If `grantType` is omitted, it defaults to `client_credentials` when no username is provided, or `password` when username is present.

When `SN-Set-Instance` selects a configured instance, the current session client uses that instance's authentication method. The configuration itself is unchanged.

## Security Notes

- **Never commit** `config/servicenow-instances.json` (already gitignored)
- Keep the `.example` file without real credentials for documentation
- Use environment-specific passwords
- Consider using secrets management tools for production

## Troubleshooting

### "Instance not found" error
```
Instance 'staging' not found. Available instances: dev, prod, test
```
**Solution:** Check instance name spelling or add the instance to config file.

### Falls back to .env
```
⚠️  servicenow-instances.json not found, falling back to .env
```
**Solution:** Create `config/servicenow-instances.json` from the example file.

### Missing credentials
```
Missing ServiceNow credentials. Create config/servicenow-instances.json...
```
**Solution:** Either create JSON config or set env vars in `.env`.