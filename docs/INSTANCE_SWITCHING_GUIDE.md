# Instance Switching Guide

## Overview

Choose an instance per call or change the session's current/default instance without restarting the MCP server. Per-call routing is recommended and is required when work across dev, test, or production can overlap. Session switching remains useful for sequential workflows.

## Quick Start

### Parallel Workstreams: Route Each Call

Every live ServiceNow operation accepts an optional `instance` parameter except `SN-Set-Instance`, `SN-Get-Current-Instance`, and `SN-Docs-*`. Omitting it retains current/default behavior.

```javascript
await Promise.all([
  SN-Query-Table({ "table_name": "incident", "instance": "dev", "limit": 10 }),
  SN-Query-Table({ "table_name": "incident", "instance": "prod", "limit": 10 })
])
```

Explicit routes use isolated cached clients. Do not call `SN-Set-Instance` to isolate overlapping operations.

### Sequential/Default Workflows: Switch the Session

List available instances:

```
SN-Set-Instance (with no instance_name)
```

Change the current instance:

```
SN-Set-Instance { instance_name: "prod" }
```

Check the current instance:

```
SN-Get-Current-Instance
```

## Sequential Example Workflow

```
You: "Switch to prod instance"
Claude: [Calls SN-Set-Instance with "prod"]
        ✅ Switched to ServiceNow instance: prod (https://yourinstance.service-now.com)

You: "List all incidents"
Claude: [Calls SN-List-Incidents]
        [Returns incidents from PROD instance]

You: "Now switch to dev"
Claude: [Calls SN-Set-Instance with "dev"]
        ✅ Switched to ServiceNow instance: dev (https://dev276360.service-now.com)

You: "Create a test incident"
Claude: [Calls SN-Create-Incident]
        [Creates incident in DEV instance]
```

## Available MCP Tools

### SN-Set-Instance
**Description:** Switch to a different ServiceNow instance

**Parameters:**
- `instance_name` (string, optional) - Name of instance (e.g., "dev", "prod", "test")
  - If omitted, lists all available instances

**Example Response:**
```json
{
  "success": true,
  "message": "Switched to ServiceNow instance: prod",
  "instance": {
    "name": "prod",
    "url": "https://yourinstance.service-now.com",
    "description": "Production instance"
  }
}
```

### SN-Get-Current-Instance
**Description:** Get information about currently active instance

**Parameters:** None

**Example Response:**
```json
{
  "current_instance": {
    "name": "dev",
    "url": "https://dev276360.service-now.com"
  },
  "message": "Currently connected to: dev (https://dev276360.service-now.com)"
}
```

## Technical Details

### How It Works

1. **Explicit per-call routing:**
   - Resolves an isolated cached client for the named instance
   - Does not mutate the session's current/default instance

2. **`SN-Set-Instance`:**
   - Reconfigures the session client for subsequent calls that omit `instance`
   - Is intended for sequential/default workflows

3. **Session scope:**
   - Each MCP session maintains its own current/default ServiceNow client
   - Switching affects only the current session

4. **No server restart required:**
   - Instance selection happens in memory
   - Credentials are loaded from `config/servicenow-instances.json`

### Configuration File

Instances are defined in `config/servicenow-instances.json`:

```json
{
  "instances": [
    {
      "name": "dev",
      "url": "https://dev276360.service-now.com",
      "username": "admin",
      "password": "dev_password",
      "default": true,
      "description": "Development instance"
    },
    {
      "name": "prod",
      "url": "https://prod.service-now.com",
      "username": "api_user",
      "password": "prod_password",
      "default": false,
      "description": "Production instance"
    }
  ]
}
```

### Default Instance

- A new Claude Code session connects to the instance marked `"default": true`
- Calls that omit `instance` use the session's current/default instance
- `SN-Set-Instance` can change that default for subsequent sequential calls

## Natural Language Examples

Claude Code understands natural requests for instance switching:

✅ **Works:**
- "Switch to prod"
- "Use the test instance"
- "Set target instance to dev"
- "Connect to production"
- "What instances are available?"
- "Which instance am I using?"

❌ **Doesn't Work:**
- You cannot create new instances via Claude Code (must edit config file)
- You cannot modify instance credentials via Claude Code (security)

## Best Practices

1. **Route every overlapping operation explicitly:**
   ```
   SN-Query-Table({ "table_name": "incident", "instance": "dev" })
   SN-Query-Table({ "table_name": "incident", "instance": "prod" })
   ```

2. **Use session switching only for sequential work:**
   ```
   "Switch to dev instance"
   [Do all dev work]
   "Switch to prod instance"
   [Do all prod work]
   ```
   `SN-Set-Instance` changes a default; it is not a parallel isolation mechanism.

3. **Be explicit when working with production:**
   ```
   "Query production incidents using instance prod"
   ```

## Error Handling

### Instance Not Found
```
Error: Instance 'staging' not found. Available instances: dev, prod, test
```
**Solution:** Check instance name spelling or add instance to config file.

### Missing Config File
```
⚠️  servicenow-instances.json not found, falling back to .env
```
**Solution:** Create `config/servicenow-instances.json` from example.

### Authentication Failure
If you switch to an instance with invalid credentials:
```
Error: Request failed with status code 401
```
**Solution:** Verify credentials in config file for that instance.

## Security Notes

- Credentials are never exposed via MCP tools
- `SN-Set-Instance` affects only your session; explicit routes do not mutate it
- All operations still require proper ServiceNow permissions
- Switching to prod doesn't bypass any access controls