<p align="center">
  <img src="https://happy-tech.biz/images/logo.svg" alt="Happy MCP Server" width="120" height="120">
</p>

<h1 align="center">Happy MCP Server</h1>

<p align="center">
  <strong>Model Context Protocol Server for the ServiceNow&reg; Platform</strong></p>

<p align="center">
  A metadata-driven MCP server that auto-generates 480+ tools across 160+ tables, with multi-instance support, natural language search, and local script development.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/happy-platform-mcp"><img src="https://img.shields.io/npm/v/happy-platform-mcp.svg?style=flat-square" alt="npm version"></a>
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=flat-square" alt="License: Apache 2.0"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg?style=flat-square" alt="Node.js Version"></a>
</p>

<p align="center">
  <a href="https://happy-tech.biz">Website</a> |
  <a href="https://github.com/Happy-Technologies-LLC/happy-platform-mcp">GitHub</a> |
  <a href="https://www.npmjs.com/package/happy-platform-mcp">npm</a> |
  <a href="#tool-overview">Tools</a> |
  <a href="CONTRIBUTING.md">Contributing</a> |
  <a href="#support">Support</a>
</p>

---

> **Migrating from `servicenow-mcp-server`?** The npm package has been renamed to `happy-platform-mcp` and the Docker image to `nczitzer/happy-platform-mcp`. The old names are deprecated but will continue to work temporarily. Update your dependencies:
> ```bash
> # npm
> npm uninstall servicenow-mcp-server && npm install happy-platform-mcp
>
> # Docker
> docker pull nczitzer/happy-platform-mcp:latest
> ```

## Support

If you find this project useful, consider supporting its development. Contributions support Happy Technologies LLC.

- [GitHub Sponsors](https://github.com/sponsors/Happy-Technologies-LLC)
- [Buy Me a Coffee](https://buymeacoffee.com/nickzitzer)
## Features

- **Multi-Instance Support** — Connect to multiple ServiceNow&reg; instances simultaneously with per-request routing
- **OAuth 2.0 & Basic Auth** — Per-instance Client Credentials, Resource Owner Password Credentials, and per-user Authorization Code with PKCE
- **Intelligent Schema Discovery** — Automatically discovers table structures and relationships at runtime
- **160+ Tables** — Complete coverage including ITSM, CMDB, Service Catalog, Platform Development, and Flow Designer
- **55 MCP Tools** — Generic CRUD operations that work on any table, plus specialized convenience tools
- **Batch Operations** — 43+ parallel operations tested successfully
- **Local Script Development** — Sync scripts with Git, watch mode for continuous development
- **Natural Language Search** — Query using plain English instead of encoded queries
- **MCP Resources** — 8 read-only resource URIs for quick lookups and documentation
- **Background Script Execution** — Automated server-side script execution via `sys_trigger`
- **Service Catalog AI-Submission** — Browse, inspect, and submit Service Catalog forms programmatically
- **ServiceNow Docs Search** — Optional GitHub-backed docs retrieval and local SQLite FTS search over official ServiceNowDocs markdown

## Quick Start

### Prerequisites

- Node.js 20+
- One or more ServiceNow&reg; instances with REST API access
- Valid credentials for each instance

### Install from npm

```bash
npx happy-platform-mcp
```

Or install globally:

```bash
npm install -g happy-platform-mcp
```

### Install from Source

```bash
git clone https://github.com/Happy-Technologies-LLC/happy-platform-mcp.git
cd happy-platform-mcp
npm install
```

### Configure Instances

**Recommended: register metadata with the local CLI**

The global install and `npx` use the user-owned metadata registry at
`~/.config/happy-platform-mcp/instances.json` (on Windows, use the user config
directory returned by the platform resolver). Credentials are prompted locally,
masked, and stored in the operating system keychain. The registry contains only
instance metadata and canonical `credentialRef` values.

```bash
happy-platform-mcp instance add
happy-platform-mcp instance list
happy-platform-mcp instance test dev
happy-platform-mcp instance update dev
happy-platform-mcp instance remove dev
happy-platform-mcp instance credential set dev --type password
happy-platform-mcp instance migrate
```

`instance update` changes metadata only. Authentication changes require
`instance remove` followed by `instance add`. `credential set` accepts
`password` or `client-secret`; secret prompts never put values in command
arguments, logs, or MCP messages. These prompts require an interactive local
TTY. In non-TTY automation, use a pre-provisioned OS keychain entry and run
metadata-only commands; the CLI will not read secrets from stdin or silently
fall back to plaintext.

To select a different metadata registry, set one `HAPPY_CONFIG_PATH` setting in
the MCP host configuration. It supports `~` and relative paths resolved from
the process working directory, and the same file holds all environments:

```json
{
  "env": {
    "HAPPY_CONFIG_PATH": "~/.config/happy-platform-mcp/instances.json"
  }
}
```

This path points to metadata, not plaintext secrets created by the new CLI.
After `SN-Register-Instance` changes the registry, restart the MCP server so
the new configuration is loaded.

**Legacy compatibility:** `config/servicenow-instances.json` and the singular
`SERVICENOW_*` environment variables remain migration/fallback inputs. The
package-relative file is not the long-term writable location. To migrate an
existing legacy file, run `happy-platform-mcp instance migrate`; migration
preserves unrelated top-level properties such as `docs`, moves supported
passwords and client secrets into the OS keychain, writes version 1 metadata,
and leaves the legacy file untouched. Unsupported or incomplete entries abort
without a partial migration.

**Option B: Single Instance (legacy environment fallback)**

```bash
cp .env.example .env
# Set the legacy SERVICENOW_* variables only when no registry file exists.
```

### Start the Server

```bash
# HTTP/SSE transport
npm run dev

# Stdio transport (for Claude Desktop)
npm run stdio
```

HTTP/SSE listens on `127.0.0.1` by default. To expose it through a reverse proxy or network interface, set both `HAPPY_MCP_BIND_HOST` and a high-entropy `HAPPY_MCP_API_TOKEN`; clients must send `Authorization: Bearer <token>`.

### Verify

```bash
curl http://localhost:3000/health
curl http://localhost:3000/instances

# Required when HAPPY_MCP_API_TOKEN is set
curl -H "Authorization: Bearer $HAPPY_MCP_API_TOKEN" http://localhost:3000/health
```

## Multi-Instance Routing

Every live ServiceNow operation accepts an optional `instance` parameter, except `SN-Set-Instance`, `SN-Get-Current-Instance`, and `SN-Docs-*`. Omitting it uses the current session client's implicit target. Explicit routing is required when overlapping work may target different instances or race with `SN-Set-Instance`; concurrent calls against one stable implicit target do not require it. Explicit calls are cached by instance name, so calls to the same named instance share that client.

At stdio startup, `SERVICENOW_INSTANCE` selects a named JSON entry when set; otherwise startup uses the entry marked `"default": true`, or the first configured entry if none is marked. HTTP sessions use the configured default or first entry. If the JSON file is missing, ServiceNow environment credentials can provide the single fallback instance. The `"default": true` flag is startup configuration. `SN-Set-Instance` changes only the current session client in memory; it never edits configuration, and a new MCP session or server starts from startup selection again.

```javascript
// Uses this session client's current implicit target
await client.callTool({
  name: 'SN-Query-Table',
  arguments: { table_name: 'incident', limit: 10 }
});

// Safely query dev and prod concurrently
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

## Tool Overview

| Category | Tools | Description |
|----------|-------|-------------|
| **Generic CRUD** | 7 | Query, Create, Get, Update on any table |
| **Specialized ITSM** | 8 | Incident, Change, Problem convenience wrappers |
| **Convenience** | 10 | Add-Comment, Add-Work-Notes, Assign, Resolve, Close |
| **Natural Language** | 1 | Query using plain English |
| **Update Sets** | 6 | Set, list, move, clone, inspect update sets |
| **Scripts** | 2 | Execute background scripts, create fix scripts |
| **Script Sync** | 3 | Sync scripts with local files, watch mode |
| **Workflows** | 4 | Create workflows, activities, transitions |
| **Batch** | 2 | Batch create/update across tables |
| **Schema** | 3 | Table schemas, field info, relationships |
| **Service Catalog** | 4 | Browse, inspect, and submit catalog forms |
| **ServiceNow Docs** | 5 | Discover, sync, search, and retrieve official ServiceNowDocs markdown |
| **Resources** | 8 | Read-only URIs for table lists, field info |

### Examples

The following transport-neutral examples show an MCP tool name followed by its arguments:

```text
SN-Query-Table
{ "table_name": "incident", "query": "active=true^priority=1", "limit": 10 }

SN-Create-Incident
{ "short_description": "Email service down", "urgency": 1 }

SN-NL-Search
{ "table_name": "incident", "query": "high priority incidents assigned to me" }

SN-Execute-Background-Script
{ "script": "gs.info('Hello');" }

SN-Set-Update-Set
{ "update_set_sys_id": "abc123..." }

SN-Batch-Update
{ "updates": [{ "table": "incident", "sys_id": "id1", "data": { "state": 2 } }] }

SN-Catalog-Search-Items
{ "keyword": "VPN access" }
SN-Catalog-Get-Item
{ "sys_id": "<catalog_item_sys_id>" }
SN-Catalog-Submit
{ "sys_id": "<catalog_item_sys_id>", "variables": { "requested_for": "jsmith", "justification": "Project X" } }

SN-Docs-Families
{}
SN-Docs-Sync
{ "family": "australia" }
SN-Docs-Search
{ "query": "create a Flow Designer action", "family": "australia" }
```

### Local Script Development

Develop scripts locally with version control and automatic sync:

```text
SN-Sync-Script-To-Local
{
  "script_sys_id": "abc123...",
  "local_path": "/scripts/business_rules/validate_incident.js"
}

SN-Watch-Script
{
  "local_path": "/scripts/business_rules/validate_incident.js",
  "script_sys_id": "abc123..."
}
```

### Natural Language Search

```text
SN-NL-Search
{
  "table_name": "incident",
  "query": "active high priority incidents that are unassigned"
}
```

Supports 15+ patterns including field comparisons, text searches, date ranges, logical operators, and ordering.

### ServiceNow Docs Search

Happy MCP can retrieve official ServiceNowDocs markdown directly from GitHub and optionally localize a docs family into a SQLite FTS5 index for fast local search. Local indexing is disabled by default; enable it with `docs.localIndexEnabled=true` in the version 1 registry or `HAPPY_DOCS_ENABLE_LOCAL_INDEX=true`.

```text
SN-Register-Instance
{ "name": "dev", "url": "https://your-instance.service-now.com", "username": "your-username" }

SN-Docs-Families
{}
SN-Docs-Status
{}
SN-Docs-Sync
{ "family": "australia" }
SN-Docs-Search
{ "query": "update set best practices", "family": "australia", "limit": 5 }
SN-Docs-Get
{ "family": "australia", "path": "platform/example.md" }
```

`SN-Register-Instance` accepts metadata only. It never accepts passwords,
client secrets, or other secret fields. If a required local credential is
missing, its response gives the exact `happy-platform-mcp instance credential
set ...` command to run locally. Registration persists metadata, but a
docs-only server must be restarted before live ServiceNow tools are enabled.

SQLite local indexing is optional and disabled by default. Vector search is also optional; enable local indexing, set `HAPPY_DOCS_ENABLE_VECTOR=true`, and use `HAPPY_DOCS_EMBEDDING_PROVIDER=local` to build a sqlite-vec index with deterministic local embeddings. See [ServiceNow Docs Search](docs/SERVICENOW_DOCS_SEARCH.md).

For docs-only deployments without ServiceNow credentials, set `HAPPY_MCP_DOCS_ONLY=true`. If no config file or ServiceNow environment credentials are present, the stdio server falls back to docs-only mode automatically.

### Runtime instance selection

Registration and runtime selection are separate:

- Registration persists an available named instance in the registry.
- `SERVICENOW_INSTANCE` chooses the stdio startup default only.
- `SN-Set-Instance` changes the sequential session's shared implicit target in memory; it does not edit the registry.
- The optional per-call `instance` argument selects an isolated request target, so concurrent calls can route to different instances without racing the sequential target.

## Claude Desktop Integration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "happy-mcp-server": {
      "command": "npx",
      "args": ["-y", "happy-platform-mcp"],
      "env": {
        "HAPPY_CONFIG_PATH": "~/.config/happy-platform-mcp/instances.json"
      }
    }
  }
}
```

The registry setting points to metadata; credentials remain in the local OS
keychain. `HAPPY_CONFIG_PATH` is optional when using the default user path and
must be set before the server starts. If you use the legacy singular
`SERVICENOW_*` environment fallback instead, keep those values out of source
control and treat them as backward-compatible compatibility settings only.

Or if installed from source, use `"command": "node"` with `"args": ["/path/to/happy-platform-mcp/src/stdio-server.js"]` and `"cwd": "/path/to/happy-platform-mcp"`.

Restart Claude Desktop after editing the config or after registration.

## Authentication

Happy MCP Server supports two authentication methods per instance. Both can coexist — instance A can use basic auth while instance B uses OAuth.

### Basic Auth (Default)

Use `happy-platform-mcp instance credential set dev --type password` to
provide the secret locally. The registry stores only:

```json
{
  "name": "dev",
  "url": "https://your-dev-instance.service-now.com",
  "authType": "basic",
  "username": "your-username",
  "credentialRef": "keychain:instance/dev/password",
  "default": true
}
```

### OAuth 2.0

Supports **Client Credentials**, **Resource Owner Password Credentials**, and
per-user **Authorization Code with PKCE**. Tokens are requested, cached, and
refreshed by the client. For client credentials, store the local secret with
`happy-platform-mcp instance credential set prod --type client-secret`:

```json
{
  "name": "prod",
  "url": "https://your-prod-instance.service-now.com",
  "authType": "oauth",
  "grantType": "client_credentials",
  "clientId": "your-client-id",
  "credentialRef": "keychain:instance/prod/client-secret"
}
```

Resource Owner Password Credentials require both local credential types; use
the CLI prompts rather than adding secret fields to JSON. Authorization Code
with PKCE uses a public client and can omit a client secret:

```json
{
  "name": "developer",
  "url": "https://your-dev-instance.service-now.com",
  "authType": "oauth",
  "grantType": "authorization_code",
  "clientId": "your-public-client-id",
  "authorizeUrl": "https://your-dev-instance.service-now.com/oauth_auth.do",
  "tokenUrl": "https://your-dev-instance.service-now.com/oauth_token.do",
  "redirectPort": 8202,
  "callbackPath": "/callback"
}
```

On first use, the server opens the authorization URL and receives the callback
on `127.0.0.1`. Refresh tokens are stored in the operating system keychain
under the current OS user and instance name.

If `grantType` is omitted, it defaults to `client_credentials` when no
username is provided, or `password` when username is present.

**ServiceNow setup:**

1. Navigate to **System OAuth > Application Registry**.
2. For Client Credentials or password grants, create an OAuth API endpoint for external clients and configure its client ID and secret.
3. For Authorization Code with PKCE, create a public client and register `http://127.0.0.1:<redirectPort><callbackPath>` as its redirect URL.
4. Add the matching values to your instance configuration.

**How it works:**

- On first API call, requests an access token from `/oauth_token.do`
- Caches the token and automatically refreshes it before expiry (30-second buffer)
- On 401 responses, transparently refreshes the token and retries the request once
- Falls back to a fresh token grant if the refresh token is expired

The `scope` field is optional and defaults to ServiceNow's standard scope.

## Architecture

```
src/
├── server.js                     # Express HTTP server (SSE transport)
├── stdio-server.js               # Stdio transport (Claude Desktop)
├── mcp-server-consolidated.js    # MCP tool registration & routing
├── servicenow-client.js          # REST API client
└── config-manager.js             # Multi-instance configuration

config/
└── servicenow-instances.json     # Instance configuration

docs/
├── API_REFERENCE.md              # Complete tool reference
├── SETUP_GUIDE.md                # Detailed setup instructions
└── research/                     # Technical research & discoveries
```

## Testing

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage

# MCP Inspector
npm run inspector
```

## Troubleshooting

### Connection Issues

```bash
# Test connectivity to your ServiceNow instance
curl -u username:password https://your-instance.service-now.com/api/now/table/incident?sysparm_limit=1

# Check server health
curl http://localhost:3000/health
```

### Common Problems

- **Multi-instance not working:** Verify `config/servicenow-instances.json` is valid JSON with one `"default": true` instance. Restart after changes.
- **Tools not appearing:** Check MCP Inspector connection and server logs.
- **Auth failures:** Test credentials in browser first. Ensure the user has required roles.
- **SSE disconnects in Docker:** Enable keepalive (default 15s). See `docs/SSE_SETUP_GUIDE.md`.

### Debug Mode

```bash
DEBUG=true npm run dev
```

## Known Limitations

- Flow Designer logic blocks cannot be created via REST API (use the UI)
- Flow compilation/validation must be done in the UI
- UI Policy Actions linking requires a background script workaround

See `docs/MCP_Tool_Limitations.md` for details.

## Acknowledgments

This project was inspired by the [Echelon AI Labs ServiceNow MCP Server](https://github.com/echelon-ai-labs/servicenow-mcp). We are grateful for their pioneering work in bringing MCP capabilities to the ServiceNow&reg; platform.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. All contributors must sign a CLA.

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md). Do not open public issues for security concerns.

## License

Licensed under the [Apache License 2.0](LICENSE).

Copyright 2025 Happy Technologies LLC

---

## Trademark Notice

ServiceNow&reg; is a registered trademark of ServiceNow, Inc. "Now" is a registered trademark of ServiceNow, Inc. All ServiceNow&reg; product names, logos, and brands are property of ServiceNow, Inc.

Model Context Protocol (MCP) is an open standard created by Anthropic, PBC. "Claude" is a trademark of Anthropic, PBC.

**Happy MCP Server is an independent, community-driven project.** It is not affiliated with, endorsed by, or sponsored by ServiceNow, Inc. or Anthropic, PBC. This project provides tooling that connects to ServiceNow&reg; instances via their published REST APIs, and implements the open MCP specification. It is not a competitor to any ServiceNow&reg; product or service.

All other trademarks are the property of their respective owners. See [NOTICE](NOTICE) for full attribution.
