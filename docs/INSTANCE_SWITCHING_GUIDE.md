# Instance Switching Guide

## Overview

You can now switch between ServiceNow instances **during your Claude Code session** without restarting the MCP server. This is useful for working across dev, test, and production environments.

## Quick Start

### 1. List Available Instances

Simply ask Claude Code:
```
"What ServiceNow instances are available?"
```

Or call the tool directly:
```
SN-Set-Instance (with no instance_name)
```

### 2. Switch to a Different Instance

At the start of your session (or anytime):
```
"Switch to the prod ServiceNow instance"
"Use the test instance"
"Set target instance to dev"
```

Claude Code will automatically call:
```
SN-Set-Instance { instance_name: "prod" }
```

### 3. Check Current Instance

To see which instance you're currently using:
```
"Which ServiceNow instance am I connected to?"
```

Or call:
```
SN-Get-Current-Instance
```

## Example Workflow

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

1. **ServiceNowClient** has a `setInstance()` method that reconfigures:
   - Base URL
   - Authentication credentials
   - Axios client instance

2. **Instance switching is session-scoped:**
   - Each MCP session maintains its own ServiceNowClient instance
   - Switching instances affects only your current Claude Code session
   - Other sessions/users are unaffected

3. **No server restart required:**
   - Instance switching happens in-memory
   - Credentials loaded from `config/servicenow-instances.json`
   - Instant switchover (< 1ms)

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

- When you start a new Claude Code session, it connects to the **default** instance
- Default is marked with `"default": true` in the config
- You can switch away from default at any time

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

1. **Start each session by verifying instance:**
   ```
   "Which ServiceNow instance am I connected to?"
   ```

2. **Switch before bulk operations:**
   ```
   "Switch to dev instance"
   [Do all dev work]
   "Switch to prod instance"
   [Do all prod work]
   ```

3. **Be explicit when working with production:**
   ```
   "Make sure I'm on the dev instance before I create these test records"
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
- Instance switching only affects your session
- All operations still require proper ServiceNow permissions
- Switching to prod doesn't bypass any access controls