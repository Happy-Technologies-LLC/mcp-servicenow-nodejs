# ServiceNow MCP Server Setup Guide

## Two Server Modes

This MCP server can run in two different modes:

### 1. HTTP/SSE Mode (Port 3000) - For Claude Code & Testing
- **File**: `src/server.js`
- **Port**: 3000 (configurable via PORT env var)
- **Usage**: Claude Code integration, API testing, web-based access
- **Start Command**: `npm start:http` or `npm run dev`
- **Endpoint**: http://localhost:3000/mcp

### 2. STDIO Mode - For Claude Desktop App
- **File**: `src/stdio-server.js`
- **Usage**: Claude Desktop app integration
- **Start Command**: `npm start:stdio`
- **No port required** (uses standard input/output)

## Configuration for Claude Desktop

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "servicenow": {
      "command": "node",
      "args": ["/Users/nczitzer/WebstormProjects/mcp-servicenow-nodejs/src/stdio-server.js"],
      "env": {
        "SERVICENOW_INSTANCE_URL": "https://dev276360.service-now.com",
        "SERVICENOW_USERNAME": "admin",
        "SERVICENOW_PASSWORD": "$h4fG+9nAGeU"
      }
    }
  }
}
```

## Configuration for Claude Code

The HTTP server runs automatically on port 3000 when you use:
```bash
npm start
# or
npm run dev
```

## Running Both Simultaneously

You can run both servers at the same time:

1. **Terminal 1** - HTTP Server for Claude Code:
```bash
npm start:http
```

2. **Claude Desktop** - Will automatically start stdio server when needed

## Testing the Servers

### Test HTTP Server:
```bash
# Health check
curl http://localhost:3000/health

# Test MCP endpoint
curl -X GET http://localhost:3000/mcp
```

### Test STDIO Server:
```bash
# Run directly to see output
node src/stdio-server.js
# Press Ctrl+C to exit
```

## Common Issues

1. **Port 3000 already in use**: Kill existing process:
```bash
pkill -f "node src/server.js"
```

2. **Claude Desktop not connecting**:
- Restart Claude Desktop after updating config
- Check the path in config matches your actual path
- Ensure credentials in config are correct

3. **Both trying to use same port**:
- HTTP server uses port 3000
- STDIO server doesn't use any port
- They can run simultaneously without conflict

## Environment Variables

Make sure your `.env` file contains:
```
SERVICENOW_INSTANCE_URL=https://your-instance.service-now.com
SERVICENOW_USERNAME=admin
SERVICENOW_PASSWORD=your-password
PORT=3000
DEBUG=true
```

HTTP/SSE binds to `127.0.0.1` by default. For a non-loopback `HAPPY_MCP_BIND_HOST`, set `HAPPY_MCP_API_TOKEN` and require clients to send it as a bearer token:
```
HAPPY_MCP_BIND_HOST=0.0.0.0
HAPPY_MCP_API_TOKEN=replace-with-a-high-entropy-secret
```

### OAuth Environment Variables (Optional)

For OAuth authentication via `.env` (single-instance fallback), add:
```
SERVICENOW_AUTH_TYPE=oauth
SERVICENOW_CLIENT_ID=your-oauth-client-id
SERVICENOW_CLIENT_SECRET=your-oauth-client-secret
```

For per-user Authorization Code with PKCE, configure a ServiceNow public client and add:
```
SERVICENOW_AUTH_TYPE=oauth
SERVICENOW_OAUTH_GRANT_TYPE=authorization_code
SERVICENOW_CLIENT_ID=your-public-client-id
SERVICENOW_OAUTH_AUTHORIZE_URL=https://your-instance.service-now.com/oauth_auth.do
SERVICENOW_OAUTH_TOKEN_URL=https://your-instance.service-now.com/oauth_token.do
SERVICENOW_OAUTH_REDIRECT_PORT=8202
SERVICENOW_OAUTH_CALLBACK_PATH=/callback
```

Register `http://127.0.0.1:8202/callback` as the public client's redirect URL. Do not set `SERVICENOW_CLIENT_SECRET` for a public client.

For multi-instance setups, configure OAuth per-instance in `config/servicenow-instances.json` instead. See [Multi-Instance Configuration](MULTI_INSTANCE_CONFIGURATION.md#oauth-authentication).