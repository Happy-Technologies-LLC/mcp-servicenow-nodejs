# Instance Switching Guide

## Overview

Choose an instance per call or change the current session client's implicit target without restarting the MCP server. Explicit routing is recommended and is required when overlapping work may target different instances or race with `SN-Set-Instance`. Session switching remains useful for sequential workflows.

## Quick Start

### Parallel Workstreams: Route Each Call

Every live ServiceNow operation accepts an optional `instance` parameter except `SN-Set-Instance`, `SN-Get-Current-Instance`, and `SN-Docs-*`. Omitting it uses the current session client's implicit target.

```javascript
await Promise.all([
  client.callTool({
    name: 'SN-Query-Table',
    arguments: { table_name: 'incident', instance: 'dev', limit: 10 }
  }),
  client.callTool({
    name: 'SN-Query-Table',
    arguments: { table_name: 'incident', instance: 'prod', limit: 10 }
  })
]);
```

Explicit calls are cached by instance name, so calls to the same named instance share that client. Concurrent calls against one stable implicit target do not require explicit routing. Do not call `SN-Set-Instance` to isolate overlapping operations.

### Sequential Workflows: Switch the Session Target

List available instances:

```text
SN-Set-Instance
{}
```

Change the current instance:

```text
SN-Set-Instance
{ "instance_name": "prod" }
```

Check the current instance:

```text
SN-Get-Current-Instance
{}
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
   - Resolves a client cached under the named instance
   - Calls with the same name share that named client
   - Does not mutate the session client's implicit target

2. **`SN-Set-Instance`:**
   - Reconfigures only the current session client for subsequent calls that omit `instance`
   - Does not edit JSON or environment configuration
   - Is intended for sequential workflows

3. **Session scope:**
   - Each MCP session maintains its own current implicit target
   - A switch affects only that session
   - A new MCP session or server starts from startup selection again

4. **No server restart required:**
   - Selection changes happen in memory
   - Configured credentials are loaded at startup

### Configuration File

New CLI registrations use the user registry at
`<homedir>/.config/happy-platform-mcp/instances.json` on every OS, with native
path separators. The legacy package-relative
`config/servicenow-instances.json` is a read-only migration input. New
registries contain metadata and `credentialRef` values, never plaintext
credentials.

```json
{
  "version": 1,
  "instances": [
    {
      "name": "dev",
      "url": "https://dev276360.service-now.com",
      "authType": "basic",
      "username": "admin",
      "credentialRef": "keychain:instance/dev/password",
      "default": true,
      "description": "Development instance"
    }
  ]
}
```

### Startup Default and Current Target

- For stdio, startup first honors the named `SERVICENOW_INSTANCE` override, then `"default": true`, then the first configured entry
- HTTP sessions start with the configured default, or the first entry if none is marked
- If the JSON file is missing, ServiceNow environment credentials can provide the single fallback instance
- After startup, calls that omit `instance` use the session client's current implicit target
- `SN-Set-Instance` changes that session target in memory only; it does not change the configured startup default

## Natural Language Examples

Claude Code understands natural requests for instance switching:

✅ **Works:**
- "Switch to prod"
- "Use the test instance"
- "Set target instance to dev"
- "Connect to production"
- "What instances are available?"
- "Which instance am I using?"

**Outside the MCP tool surface:**
- Happy MCP exposes no tool for creating instance configuration entries
- Happy MCP exposes no tool for editing credentials; manage local JSON, environment variables, and secret stores outside the MCP tool surface

## Best Practices

1. **Route explicitly when overlapping work may use different targets:**
   ```text
   SN-Query-Table
   { "table_name": "incident", "instance": "dev" }
   SN-Query-Table
   { "table_name": "incident", "instance": "prod" }
   ```

2. **Use session switching only for sequential work:**
   ```
   "Switch to dev instance"
   [Do all dev work]
   "Switch to prod instance"
   [Do all prod work]
   ```
   `SN-Set-Instance` changes the current session target; it is not a parallel isolation mechanism.

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

If no registry is available, the server/stdio process may use the singular
`SERVICENOW_*` environment fallback for one backward-compatible instance.
The CLI does not auto-load `.env`; export `HAPPY_CONFIG_PATH` when selecting a
CLI registry. To create a new registry, use interactive
`happy-platform-mcp instance add`, then set credentials with
`happy-platform-mcp instance credential set <name> --type password|client-secret`.

### Authentication Failure
If you switch to an instance with invalid credentials:
```
Error: Request failed with status code 401
```
**Solution:** Verify credentials in config file for that instance.

## Security Notes

- Happy MCP exposes no credential-edit tool, and instance listings omit credential fields
- `SN-Set-Instance` affects only the current session client; explicit routes do not mutate it
- All operations still require proper ServiceNow permissions
- Switching to prod doesn't bypass any access controls