# ServiceNow MCP Server v2.0 - Development Guide

This file provides guidance to Claude Code (claude.ai/code) when working with this intelligent, metadata-driven ServiceNow MCP server.

## Project Overview

**ServiceNow MCP Server v2.0** - Revolutionary Node.js implementation providing comprehensive ServiceNow integration through Model Context Protocol.

This is a **revolutionary MCP (Model Context Protocol) server v2.0** that automatically discovers ServiceNow instance schemas and generates optimized tool configurations. Built with Node.js, Express, and intelligent auto-discovery capabilities that analyze your ServiceNow instance and create adaptive integrations.

## 🏆 Revolutionary Architecture Achievements

### **Dramatic Efficiency Improvements**
- **8 JavaScript files** (vs 36 Python files) = **78% reduction**
- **20,000 lines of code** (vs equivalent Python complexity)
- **160+ ServiceNow tables** (vs 35 in Python) = **350% increase**
- **480+ auto-generated tools** (vs 66 consolidated tools)
- **Single-layer architecture** (vs 4-layer Python system)

### **Advanced Developer Coverage**
**Enhanced Tables Based on 2025 ServiceNow Ecosystem Research:**
- Core System: `sys_db_object`, `sys_dictionary`, `sys_properties`, `sys_app`, `sys_scope`
- UI/UX Development: `sys_ui_form`, `sys_ui_list`, `sys_ui_policy`, `sys_ui_action`, `sys_ui_macro`
- Service Portal: `sp_portal`, `sp_instance`, `sp_dependency`, `sp_header_footer`
- Next Experience UX: `sys_ux_event`, `sys_ux_page_element`, `sys_ux_page_registry`, `sys_ux_lib_component`
- Email & Communication: `sys_email`, `sys_email_log`, `sys_notification`, `sys_email_template`
- Security & Access: `sys_user_role`, `sys_user_has_role`, `sys_security_acl`
- Data Management: `sys_choice`, `sys_metadata`, `sys_attachment`

### **Setup Comparison**
- **Node.js:** `npm run setup:auto` → 2-3 minutes → 160+ tables ready
- **Python:** Hours of manual configuration → 35 static tables

### What is MCP?

The Model Context Protocol (MCP) is a standardized way for large language models (LLMs) to fetch data or run code on external servers without writing custom connectors each time. It solves the "N × M" problem of AI integrations by providing a single protocol that any MCP-compatible AI client can use to call your server's tools and resources.

### Key Benefits
- **Standardized Protocol**: JSON-RPC 2.0 over HTTP or SSE
- **Capability Advertisement**: Server tells clients exactly which tools, resources, and prompts are available
- **Transport Flexibility**: Supports both stdio and Streamable HTTP (SSE) transports
- **Session Management**: Maintains stateful sessions for each client connection
- **Extensible**: Add or remove tools/resources on the fly with automatic client notification

## Project Setup Commands

```bash
# Initialize the project (if not already done)
npm init -y

# Install MCP SDK and dependencies
npm install express @modelcontextprotocol/sdk axios dotenv zod

# Install development dependencies
npm install --save-dev typescript @types/node @types/express tsx nodemon jest @types/jest eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin

# Run the MCP server in development mode
npm run dev

# Build the TypeScript project
npm run build

# Run tests
npm test

# Lint the code
npm run lint

# Type checking
npm run typecheck
```

## Architecture

### Express MCP Server Structure
```
src/
├── server.js          # Main Express MCP server (Streamable HTTP)
├── mcp/              # MCP-specific implementation
│   ├── server.js     # McpServer factory and configuration
│   ├── tools/        # Tool definitions
│   │   ├── incidents.js    # Incident management tools
│   │   ├── changes.js      # Change request tools
│   │   ├── problems.js     # Problem management tools
│   │   └── cmdb.js         # CMDB tools
│   ├── resources/    # Resource definitions
│   │   └── config.js       # Configuration resources
│   └── prompts/      # Prompt templates
│       └── servicenow.js   # ServiceNow prompt templates
├── servicenow/       # ServiceNow API client
│   ├── client.js     # REST API wrapper
│   ├── auth.js      # Authentication handling
│   └── types.js     # ServiceNow type definitions
└── utils/           # Utility functions
    ├── session.js   # Session management
    └── validation.js # Input validation
```

### Core MCP Concepts

1. **McpServer**: Central object that manages capabilities, registry, and protocol compliance
   ```javascript
   const server = new McpServer({
     name: 'servicenow-server',
     version: '1.0.0',
     capabilities: {
       tools: { listChanged: true },
       resources: { listChanged: true },
       prompts: { listChanged: true }
     }
   });
   ```

2. **Tools**: Functions that AI can call to perform ServiceNow operations
   - Name and description
   - Zod schema for argument validation
   - Async handler function

3. **Resources**: Data sources that AI can read (similar to GET endpoints)
   - Static resources (e.g., `config://app`)
   - Dynamic resources with templates (e.g., `incidents://{incident_id}`)

4. **Prompts**: Reusable message templates for LLM interactions

### Transport Architecture

**Streamable HTTP with Express**:
- POST `/mcp` - Handle JSON-RPC requests and initialization
- GET `/mcp` - Server-sent events for notifications
- DELETE `/mcp` - Session termination
- Session management with `mcp-session-id` headers

### Session Management

Each client connection maintains:
```javascript
sessions[sessionId] = {
  server: McpServer,        // Server instance for this session
  transport: Transport,     // StreamableHTTPServerTransport
  initialHeaders: Object,   // Headers captured at initialization
  latestHeaders: Object     // Most recent headers
}
```

### Key Design Patterns

1. **Capability Declaration**: Server advertises available tools/resources/prompts during initialization
2. **Stateful Sessions**: Each client maintains separate server instance with registered tools
3. **Header Capture**: Authentication headers captured at initialization for use in tool handlers
4. **Error Handling**: Proper JSON-RPC 2.0 error responses with meaningful messages

## ServiceNow API Integration

### Environment Variables
```env
SERVICENOW_INSTANCE=your-instance.service-now.com
SERVICENOW_USERNAME=your-username
SERVICENOW_PASSWORD=your-password
# Or for OAuth
SERVICENOW_CLIENT_ID=your-client-id
SERVICENOW_CLIENT_SECRET=your-client-secret
```

### Common ServiceNow Endpoints
- Incidents: `/api/now/table/incident`
- Changes: `/api/now/table/change_request`
- Problems: `/api/now/table/problem`
- CMDB: `/api/now/table/cmdb_ci`
- Users: `/api/now/table/sys_user`

## MCP Implementation Examples

### Tool Registration Pattern
```javascript
server.tool(
  'servicenow-create-incident',
  {
    short_description: z.string(),
    description: z.string(),
    urgency: z.number().min(1).max(3).optional(),
    impact: z.number().min(1).max(3).optional(),
    assignment_group: z.string().optional()
  },
  async ({ short_description, description, urgency, impact, assignment_group }) => {
    // Access captured authentication headers
    const authHeader = initialHeaders['authorization'];

    // ServiceNow API call
    const incident = await createIncident({
      short_description,
      description,
      urgency: urgency || 3,
      impact: impact || 3,
      assignment_group
    }, authHeader);

    return {
      content: [{
        type: 'text',
        text: `Created incident ${incident.number}: ${incident.short_description}`
      }]
    };
  }
);
```

### Resource Registration Pattern
```javascript
// Static resource
server.resource(
  'servicenow-config',
  'config://servicenow',
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: JSON.stringify({
        instance: process.env.SERVICENOW_INSTANCE,
        api_version: 'v2',
        supported_tables: ['incident', 'change_request', 'problem']
      })
    }]
  })
);

// Dynamic resource with template
server.resource(
  'servicenow-incident',
  new ResourceTemplate('incident://{incident_id}', { list: undefined }),
  async (uri, { incident_id }) => {
    const incident = await getIncident(incident_id);
    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify(incident)
      }]
    };
  }
);
```

### Prompt Registration Pattern
```javascript
server.prompt(
  'servicenow-incident-analysis',
  { incident_data: z.string() },
  ({ incident_data }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Analyze this ServiceNow incident and provide recommendations:\n\n${incident_data}`
      }
    }]
  })
);
```

## Development Workflow

### Adding New ServiceNow Operations
1. Create tool handler in `src/mcp/tools/`
2. Add ServiceNow API client methods in `src/servicenow/client.js`
3. Register tool in main server factory
4. Add validation schema using Zod
5. Add tests for both tool and API client

### Development Commands
```bash
# Start server in development mode
npm run dev

# Test server with cURL
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{"interactive":true}}}'

# Test with MCP Inspector
npx @modelcontextprotocol/inspector
```

### Testing with MCP Inspector
1. Install and run: `npx @modelcontextprotocol/inspector`
2. Configure transport type: **Streamable HTTP**
3. Set URL: `http://localhost:3000/mcp`
4. Add authorization headers if needed
5. Click **Connect** to initialize session
6. Use Tools/Resources/Prompts tabs to test functionality

### Testing with Claude Desktop
Configure in Claude Desktop settings:
```json
{
  "mcpServers": {
    "servicenow": {
      "command": "node",
      "args": ["dist/server.js"],
      "env": {
        "SERVICENOW_INSTANCE": "your-instance.service-now.com",
        "SERVICENOW_USERNAME": "username",
        "SERVICENOW_PASSWORD": "password"
      }
    }
  }
}
```

## ServiceNow Best Practices

1. **Rate Limiting**: Implement rate limiting to avoid overwhelming the ServiceNow instance
2. **Pagination**: Use sysparm_limit and sysparm_offset for large result sets
3. **Field Selection**: Use sysparm_fields to limit returned data
4. **Error Handling**: Handle ServiceNow-specific errors (401, 403, 404, 429)
5. **Logging**: Log all ServiceNow API calls for debugging

## TypeScript Configuration

The project uses strict TypeScript settings. Key configurations:
- `strict: true` for type safety
- `esModuleInterop: true` for module compatibility
- Target: `ES2022` for modern JavaScript features
- Module: `commonjs` for Node.js compatibility

## Common Issues and Troubleshooting

### "Method not found" Errors
**Cause**: Tools not properly registered or capabilities not declared
**Fix**: Ensure tools are registered before `server.connect()` and capabilities include `tools: { listChanged: true }`

### Session ID Issues
**Cause**: Missing or invalid `mcp-session-id` header
**Fix**: Always include the exact session ID returned from initialization response

### Authentication Problems
**Cause**: Headers not properly captured or passed to ServiceNow client
**Fix**: Verify headers are captured at initialization and accessible in tool handlers

### Transport Connection Issues
**Cause**: Incorrect URL or transport configuration
**Fix**: Use `http://localhost:3000/mcp` for Streamable HTTP transport

## Package Scripts

```json
{
  "scripts": {
    "dev": "nodemon src/server.js",
    "start": "node src/server.js",
    "build": "echo 'No build step needed for JavaScript'",
    "test": "jest",
    "lint": "eslint . --ext .js",
    "inspector": "npx @modelcontextprotocol/inspector"
  }
}
```

## ServiceNow API Limitations & Workarounds

### System Table Permissions (sys_dictionary, sys_db_object)

**Issue:** 403 Forbidden errors when creating/updating system tables like `sys_dictionary`

**Root Cause:**
- System tables require special ACL permissions beyond basic API access
- Standard roles (admin, rest_api_explorer) may not include CREATE permissions on system tables
- Dictionary operations may have changed permissions in recent ServiceNow versions

**Required Roles/Permissions:**
1. **For READ operations:**
   - `sys_dictionary` (read)
   - `sys_dictionary.*` (read)
   - `sys_db_object` (read)
   - `sys_db_object.*` (read)
   - `sys_glide_object` (read) - needed for internal_type field

2. **For CREATE operations:**
   - Custom ACL with "create" operation on `sys_dictionary` table
   - Role: `personalize_dictionary` OR custom role with create permissions
   - Must elevate to `security_admin` role to create/modify ACLs

**Solutions:**

**Option 1: Grant personalize_dictionary Role (Simplest)**
```
Navigate to: User Administration → Users → [Your API User]
Add Role: personalize_dictionary
WARNING: This grants both read AND write access to dictionary
```

**Option 2: Create Custom Role (Recommended)**
```javascript
// 1. Elevate to security_admin role
// 2. Navigate to: System Security → Access Control (ACL)
// 3. Click "New"
// 4. Set:
//    - Type: record
//    - Operation: create
//    - Name: sys_dictionary
//    - Roles: [your_custom_role]
// 5. Assign custom role to API user
```

**Option 3: Use Fix Script (If Permissions Cannot Be Granted)**
```javascript
// If your user doesn't have permission, use SN-Create-Fix-Script:
await SN-Create-Fix-Script({
  script_name: "create_dictionary_entries",
  script_content: `
var gr = new GlideRecord('sys_dictionary');
gr.initialize();
gr.name = 'your_table';
gr.element = 'your_field';
gr.column_label = 'Your Field Label';
gr.internal_type = 'string';
gr.max_length = 40;
gr.insert();
gs.info('Created dictionary entry: ' + gr.sys_id);
  `
});
```

**Troubleshooting:**
- Check if permissions changed after ServiceNow upgrade
- Verify user has both web_service_admin AND table-specific permissions
- Test with admin user first to isolate permission vs. API issues
- Check System Logs → REST for detailed ACL failure messages

### Operations That Cannot Be Done via REST API

1. **Background Script Execution** ✅ NOW WORKING!
   - **Status:** AUTOMATED EXECUTION NOW AVAILABLE (as of 2025-09-29)
   - **Discovery:** Found UI endpoint `/sys.scripts.do` that accepts POST requests with form-encoded script content
   - **Myth Busted:** REST API endpoints `/api/now/script/background` and `/api/now/ui/script` DO NOT EXIST, but UI endpoint works!
   - **Solution:** `SN-Execute-Background-Script` now EXECUTES scripts directly via `/sys.scripts.do`
   - **Fallback:** If direct execution fails (auth issues), tool automatically creates fix script for manual execution
   - **Limitation:** Output capture from UI endpoint is limited - full output visible in ServiceNow UI only
   - **Alternative:** Use `SN-Create-Fix-Script` for manual execution with guaranteed output visibility
   - **How It Works:**
     1. Tool establishes session with ServiceNow UI
     2. POSTs script to `/sys.scripts.do` with form data (script, sys_scope, record_for_rollback, quota_managed_transaction)
     3. Script executes server-side
     4. Returns success status (output parsing limited by HTML response format)

2. **Setting Current Update Set** ✅ NOW AUTOMATED!
   - **Status:** Can now be set via background script execution
   - **Solution:** `SN-Set-Update-Set` generates GlideUpdateSet script and executes it via `/sys.scripts.do`
   - **API:** Uses `var gus = new GlideUpdateSet(); gus.set('sys_id');`
   - **Fallback:** Creates fix script if automated execution fails
   - **Alternative:** Set manually via UI: System Update Sets → Local Update Sets → Make Current

3. **UI Policy Actions Linking**
   - **Issue:** Fields `ui_policy` and `catalog_variable` in `catalog_ui_policy_action` table cannot be set via REST API
   - **Solution:** Create records via API, then use `SN-Create-Fix-Script` to generate linkage script with setValue()
   - **Format:** `catalog_variable = 'IO:<variable_sys_id>'`

4. **Table Creation**
   - **Issue:** Complex workflow requires dictionary entries, choice values, metadata
   - **Solution:** Create tables manually in UI, then add fields/configurations via API

5. **Flow Designer Workflows**
   - **Issue:** No REST API exists for creating/modifying flows programmatically
   - **Root Cause:** Flow definitions stored as complex JSON across 15+ interconnected tables with undocumented structure
   - **What Works:** FlowAPI.executeFlow() for triggering existing flows, REST-triggered flows
   - **Solution:** Create flows manually in UI, export as XML via update sets, use FlowAPI to execute programmatically
   - **See:** `/docs/FLOW_DESIGNER_LIMITATIONS.md` for comprehensive guide

### Fix Script Workflow

```javascript
// Example: Use SN-Create-Fix-Script for UI Policy Actions
await SN-Create-Fix-Script({
  script_name: "link_ui_policy_actions",
  description: "Link UI policy actions to policies and variables",
  script_content: `
var actions = ['sys_id_1', 'sys_id_2', 'sys_id_3'];
actions.forEach(function(actionId) {
  var gr = new GlideRecord('catalog_ui_policy_action');
  if (gr.get(actionId)) {
    gr.setValue('ui_policy', 'policy_sys_id');
    gr.setValue('catalog_variable', 'IO:variable_sys_id');
    gr.update();
    gs.info('✅ Linked action: ' + actionId);
  }
});
  `,
  auto_delete: true
});
```

## Additional Resources

- **MCP Specification**: https://spec.modelcontextprotocol.io/
- **MCP SDK Documentation**: https://www.npmjs.com/package/@modelcontextprotocol/sdk
- **ServiceNow REST API**: https://docs.servicenow.com/bundle/utah-api-reference/page/integrate/inbound-rest/concept/c_RESTAPI.html
- **MCP Inspector**: https://www.npmjs.com/package/@modelcontextprotocol/inspector
- **Limitations Doc**: See MCP_Tool_Limitations.md for detailed API limitation documentation