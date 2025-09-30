# ServiceNow MCP Server v2.0 - Multi-Instance Intelligent Architecture

A revolutionary **metadata-driven ServiceNow MCP server** that supports **multiple ServiceNow instances** simultaneously with automatic schema discovery and optimized tool generation. Built with Node.js and Express.

## 🚀 Revolutionary Features

- **🌐 Multi-Instance Support**: Connect to multiple ServiceNow instances simultaneously with instance-specific tool routing
- **🧠 Intelligent Schema Discovery**: Automatically discovers table structures and relationships from your ServiceNow instances
- **📊 160+ ServiceNow Tables**: Complete coverage including ITSM, CMDB, Service Catalog, Platform Development, and Flow Designer
- **⚙️ Generic CRUD Operations**: 34 powerful MCP tools that work on **any** ServiceNow table
- **🔧 Dynamic Schema Loading**: Table metadata discovered at runtime - no hardcoded definitions
- **📱 Instance-Adaptive**: Automatically handles custom fields, modified tables, and different ServiceNow editions
- **🎯 Batch Operations**: 43+ parallel operations tested successfully

## ⚡ Quick Start (2-3 Minutes)

### Prerequisites
- Node.js 18+
- ServiceNow instance(s) with API access
- Valid ServiceNow credentials

### 🎯 Setup Instructions

1. **Clone and install:**
   ```bash
   git clone <repository-url>
   cd mcp-servicenow-nodejs
   npm install
   ```

2. **Configure your ServiceNow instance(s):**

   **Option A: Multi-Instance Setup (Recommended)**
   ```bash
   # Create config file
   cp config/servicenow-instances.example.json config/servicenow-instances.json

   # Edit with your instances
   nano config/servicenow-instances.json
   ```

   Example multi-instance config:
   ```json
   {
     "instances": [
       {
         "name": "dev",
         "url": "https://dev123456.service-now.com",
         "username": "admin",
         "password": "your-password",
         "default": true
       },
       {
         "name": "prod",
         "url": "https://prod789012.service-now.com",
         "username": "integration_user",
         "password": "your-password"
       }
     ]
   }
   ```

   **Option B: Single Instance Setup (Legacy)**
   ```bash
   # Copy environment template
   cp .env.example .env

   # Edit with your credentials
   nano .env
   ```

3. **Start the server:**
   ```bash
   npm run dev
   ```

4. **Verify connection:**
   ```bash
   # Health check
   curl http://localhost:3000/health

   # List instances
   curl http://localhost:3000/instances
   ```

5. **Connect your AI assistant:**
   - **HTTP Transport:** `http://localhost:3000/mcp`
   - **Stdio Transport:** Use `npm run stdio` (for Claude Desktop)
   - Test with MCP Inspector: `npm run inspector`

## 🌐 Multi-Instance Support

### Instance-Specific Tool Routing

All tools automatically support multi-instance operations:

```bash
# Default instance (marked with "default": true in config)
SN-List-Incidents { "limit": 10 }

# Specific instance
SN-List-Incidents { "instance": "prod", "limit": 10 }

# List all configured instances
curl http://localhost:3000/instances
```

### Tool Naming Convention

**Without Instance Parameter:**
- Uses default instance from config
- Example: `SN-Create-Incident` → creates in default instance

**With Instance Parameter:**
- Routes to specified instance
- Example: `SN-Create-Incident { "instance": "prod", ... }` → creates in prod instance

## 📊 Comprehensive ServiceNow Coverage

### 🎯 **34 MCP Tools** Supporting **160+ ServiceNow Tables**

*Generic tools work on any ServiceNow table through dynamic schema discovery*

| **Tool Category** | **Tools** | **What They Do** |
|-------------------|-----------|------------------|
| **Generic CRUD** | 7 tools | Query, Create, Get, Update on **any** table |
| **Specialized ITSM** | 8 tools | Incident, Change, Problem convenience wrappers |
| **Update Set Management** | 6 tools | Set, list, move, clone, inspect update sets |
| **Background Scripts** | 2 tools | Execute scripts, create fix scripts |
| **Workflows** | 4 tools | Create workflows, activities, transitions |
| **Batch Operations** | 2 tools | Batch create/update across tables |
| **Schema Discovery** | 3 tools | Get table schemas, field info, relationships |
| **Multi-Instance** | 2 tools | Switch instances, get current instance |

### 📋 **Supported Table Categories (160+ Total)**

| **Category** | **Example Tables** |
|--------------|-------------------|
| **🏆 Core ITSM** | incident, change_request, problem, sc_request, sc_req_item |
| **📦 Service Catalog** | sc_cat_item, catalog_ui_policy, item_option_new |
| **👥 User Management** | sys_user, sys_user_group, sys_user_role |
| **🔧 CMDB & Assets** | cmdb_ci, alm_asset, cmdb_rel_ci |
| **⚙️ Platform Development** | sys_script, sys_ui_policy, sys_update_set, sys_update_xml |
| **🔄 Flow Designer** | sys_hub_flow, sys_hub_flow_logic, sys_hub_flow_variable |
| **🌊 Workflows** | wf_workflow, wf_activity, wf_transition |
| **🔗 Integration** | sys_rest_message, sys_ws_definition, sys_import_set |

### 🧠 **Tool Examples**

**Standard CRUD Operations (Every Table):**
```javascript
// List records with filtering
SN-List-Incidents({ "query": "state=1^priority=1", "limit": 10 })

// Create new record
SN-Create-Incident({ "short_description": "Email down", "urgency": 1 })

// Get single record
SN-Get-Incident({ "sys_id": "abc123..." })

// Update record
SN-Update-Record({ "table_name": "incident", "sys_id": "abc123...", "data": {...} })

// Query with complex filters
SN-Query-Table({ "table_name": "incident", "query": "active=true", "fields": "number,short_description" })
```

**Specialized Tools:**
```javascript
// Background script execution (automated via sys_trigger)
SN-Execute-Background-Script({ "script": "gs.info('Hello');" })

// Update set management
SN-Get-Current-Update-Set()
SN-Set-Update-Set({ "update_set_sys_id": "abc123..." })
SN-Move-Records-To-Update-Set({ "update_set_id": "xyz789...", "source_update_set": "Default" })

// Table schema introspection
SN-Get-Table-Schema({ "table_name": "incident" })
SN-Discover-Table-Schema({ "table_name": "sys_hub_flow", "include_relationships": true })

// Batch operations
SN-Batch-Create({ "operations": [...] })
SN-Batch-Update({ "updates": [...] })

// Workflow creation
SN-Create-Workflow({ "name": "Auto-Approve", "table": "change_request", "activities": [...] })
```

### 📋 **Complete Table Coverage**

**Core Service Management:**
`incident` • `change_request` • `change_task` • `problem` • `problem_task` • `sc_request` • `sc_req_item` • `sysapproval_approver`

**Service Catalog:**
`sc_cat_item` • `sc_category` • `item_option_new` • `catalog_ui_policy` • `catalog_ui_policy_action`

**CMDB & Assets:**
`cmdb_ci` • `cmdb_ci_*` (all CI types) • `cmdb_rel_ci` • `alm_asset` • `ast_contract`

**Platform Development:**
`sys_script` • `sys_script_client` • `sys_script_include` • `sys_ui_script` • `sys_ui_policy` • `sys_update_set` • `sys_update_xml`

**Flow Designer (NEW!):**
`sys_hub_flow` • `sys_hub_flow_base` • `sys_hub_flow_logic` • `sys_hub_flow_variable` • `sys_hub_flow_stage`

**Workflows:**
`wf_workflow` • `wf_activity` • `wf_transition` • `wf_version`

**Integration & APIs:**
`sys_rest_message` • `sys_ws_definition` • `sys_import_set` • `sys_transform_map`

**160+ total tables** including UI/UX development, user management, knowledge bases, and more!

## Testing with MCP Inspector

1. **Start the MCP server:**
   ```bash
   npm run dev
   ```

2. **Launch MCP Inspector in a new terminal:**
   ```bash
   npm run inspector
   ```

3. **Configure connection:**
   - Transport Type: **Streamable HTTP (SSE)**
   - URL: `http://localhost:3000/mcp`
   - Click **Connect**

4. **Test tools:**
   - Browse available tools in the Tools tab
   - Execute tool calls with parameters
   - View responses and errors

## Claude Desktop Integration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "servicenow-nodejs": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/WebstormProjects/mcp-servicenow-nodejs/src/stdio-server.js"],
      "cwd": "/Users/YOUR_USERNAME/WebstormProjects/mcp-servicenow-nodejs",
      "env": {
        "SERVICENOW_INSTANCE_URL": "https://your-instance.service-now.com",
        "SERVICENOW_USERNAME": "your-username",
        "SERVICENOW_PASSWORD": "your-password",
        "SERVICENOW_AUTH_TYPE": "basic"
      }
    }
  }
}
```

**Important:** Replace `YOUR_USERNAME` with your actual username and update credentials.

Then restart Claude Desktop (⌘Q and reopen) to see ServiceNow tools appear.

**Detailed setup guide:** `docs/CLAUDE_DESKTOP_SETUP.md`

## Architecture

```
src/
├── server.js                      # Express HTTP server with SSE transport
├── stdio-server.js                # Stdio transport for Claude Desktop
├── mcp-server-consolidated.js    # MCP tool registration & routing
├── servicenow-client.js           # ServiceNow REST API client
└── config-manager.js              # Multi-instance configuration manager

config/
└── servicenow-instances.json      # Multi-instance configuration

docs/
├── FLOW_DESIGNER_MCP_FEASIBILITY.md  # Flow Designer feasibility analysis
└── MCP_Tool_Limitations.md           # API limitation documentation
```

**Key Features:**
- **Multi-Instance Routing:** Single server connects to multiple ServiceNow instances
- **Dynamic Tool Generation:** Tools auto-generate from table metadata
- **Metadata-Driven:** No hardcoded table definitions
- **Instance Fallback:** Supports `.env` for single-instance backward compatibility
- **Session Management:** Separate MCP sessions per client connection
- **Error Handling:** Comprehensive error reporting with context

## Key Features & Improvements

### ✅ **Multi-Instance Support**
- Connect to multiple ServiceNow instances simultaneously
- Instance-specific tool routing with `instance` parameter
- Centralized configuration in `config/servicenow-instances.json`
- Fallback to `.env` for single-instance backward compatibility

### ✅ **Background Script Execution**
- **Automated execution** via `sys_trigger` table (runs in ~1 second)
- No manual copy-paste required for most scripts
- Automatic trigger cleanup after execution
- Fallback to fix script generation if execution fails

### ✅ **Advanced Update Set Management**
- Set current update set programmatically
- Move records between update sets (including from "Default")
- Clone entire update sets with all records
- Inspect update set contents and dependencies

### ✅ **Comprehensive Table Operations**
- 480+ auto-generated tools across 160+ tables
- Generic CRUD operations work on **any** ServiceNow table
- Schema introspection with relationships and constraints
- Batch create/update operations for efficiency

### ✅ **Workflow & Flow Designer Support**
- Create workflows with activities and transitions
- Read Flow Designer flows (sys_hub_flow tables)
- Create flow variables, stages, and components
- See `docs/FLOW_DESIGNER_MCP_FEASIBILITY.md` for details

## Known Limitations

See `docs/MCP_Tool_Limitations.md` for comprehensive documentation. Key limitations:

**Cannot Be Done via REST API:**
- ❌ Flow Designer logic block creation (use UI or templates)
- ❌ Flow compilation/validation (flows compile in UI)
- ⚠️ UI Policy Actions linking (requires background script with setValue())

**Workarounds Available:**
- ✅ Background scripts execute automatically via `sys_trigger`
- ✅ Update set operations fully automated
- ✅ Generic table operations work on custom tables
- ✅ Workflow creation fully supported

## Troubleshooting

### Connection Issues

```bash
# Test ServiceNow connectivity
curl -u username:password https://your-instance.service-now.com/api/now/table/incident?sysparm_limit=1

# Check server health
curl http://localhost:3000/health

# List configured instances
curl http://localhost:3000/instances
```

### Configuration Issues

**Multi-instance not working:**
- Verify `config/servicenow-instances.json` exists and is valid JSON
- Check that at least one instance has `"default": true`
- Restart server after config changes

**Tools not appearing:**
- Verify MCP connection in Inspector
- Check server logs for registration errors
- Ensure ServiceNow credentials are correct

**Authentication failures:**
- Verify username/password in config file
- Check ServiceNow user has required roles
- Test credentials in browser first

### Debug Mode

```bash
# Enable verbose logging
DEBUG=true npm run dev

# Check background script execution logs
# ServiceNow: System Logs → System Log → All
# Filter by source: "Script execution"
```

## Performance

- **Cold start:** ~1-2 seconds
- **Tool execution:** ~200-500ms average (depends on ServiceNow instance)
- **Memory usage:** ~50MB baseline per instance
- **Concurrent sessions:** 100+ supported
- **Background scripts:** Execute in ~1 second via sys_trigger