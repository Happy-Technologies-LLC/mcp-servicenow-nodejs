# ServiceNow MCP Server v2.0 - Development Guide

**For:** Claude Code (claude.ai/code)
**Version:** 2.0
**Instance:** Multi-instance support enabled

---

## 🚨 CRITICAL: MCP-FIRST POLICY

**ALWAYS use MCP tools as the PRIMARY method for ServiceNow operations.**

### Priority Order (MANDATORY):
1. **FIRST**: Use MCP tools (SN-Create-Record, SN-Update-Record, SN-Query-Table, etc.)
2. **SECOND**: If MCP fails, use SN-Execute-Background-Script
3. **LAST RESORT**: Document as manual step only if both fail

### When to Write Background Scripts:
- **NEVER** as first choice
- **ONLY** when MCP tools have documented limitations
- **ALWAYS** try MCP batch operations first (5-10+ parallel calls)

---

## 🎯 MCP Tools (34 Total)

### Generic Tools (Work on ANY table)
**Core CRUD:**
- `SN-Query-Table` - Query records with filtering
- `SN-Create-Record` - Create records in any table
- `SN-Get-Record` - Get single record by sys_id
- `SN-Update-Record` - Update existing records
- `SN-Get-Table-Schema` - Get table structure
- `SN-Discover-Table-Schema` - Deep schema with relationships
- `SN-List-Available-Tables` - List all available tables

### Specialized Tables (Convenience)
**ITSM:**
- `SN-List-Incidents`, `SN-Create-Incident`, `SN-Get-Incident`
- `SN-List-ChangeRequests`
- `SN-List-Problems`

**Administration:**
- `SN-List-SysUsers`
- `SN-List-SysUserGroups`
- `SN-List-CmdbCis`

### Update Set Management
- `SN-Set-Update-Set` - Set current update set (AUTOMATED!)
- `SN-Get-Current-Update-Set` - Get active update set
- `SN-List-Update-Sets` - List available update sets
- `SN-Move-Records-To-Update-Set` - Fix records in wrong set
- `SN-Clone-Update-Set` - Clone entire update set
- `SN-Inspect-Update-Set` - Inspect update set contents

### Application Scope
- `SN-Set-Current-Application` - Set current application scope (AUTOMATED!)

### Script Execution
- `SN-Execute-Background-Script` - Execute server-side JavaScript (via sys_trigger)
- `SN-Create-Fix-Script` - Generate script for manual execution

### Batch Operations
- `SN-Batch-Create` - Create multiple records with relationships
- `SN-Batch-Update` - Update multiple records efficiently

### Workflow Operations
- `SN-Create-Workflow` - Create complete workflow with activities
- `SN-Create-Activity` - Add activity to workflow
- `SN-Create-Transition` - Link workflow activities
- `SN-Publish-Workflow` - Publish workflow version

### Advanced Tools
- `SN-Validate-Configuration` - Validate catalog item config
- `SN-Explain-Field` - Get field documentation

**Complete API Reference:** `docs/API_REFERENCE.md`

---

## 🌐 Multi-Instance Support

All tools support the `instance` parameter for routing to specific ServiceNow instances.

**Configuration:** `config/servicenow-instances.json`

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
      "username": "integration",
      "password": "password"
    }
  ]
}
```

**Usage:**
```javascript
// Default instance (marked with "default": true)
SN-Query-Table({ table_name: "incident", limit: 10 })

// Specific instance
SN-Query-Table({ table_name: "incident", limit: 10, instance: "prod" })
```

---

## 🎉 BREAKTHROUGH: Automated Background Script Execution

**As of 2025-09-29**, discovered automated background script execution via `sys_trigger` table:

### SN-Execute-Background-Script (FULLY AUTOMATED!)
```javascript
SN-Execute-Background-Script({
  script: "gs.info('Hello from automated script');",
  description: "Test automated execution",
  execution_method: "trigger"  // Default, most reliable
});
```

**How it works:**
1. Creates scheduled job in `sys_trigger` table
2. Executes in ~1 second
3. Auto-deletes trigger after execution
4. No manual copy-paste required!

**Fallback methods:**
- `ui`: Direct UI endpoint execution
- `auto`: Try trigger → ui → create fix script

### SN-Set-Update-Set (FULLY AUTOMATED!)
```javascript
// Set current update set programmatically
SN-Set-Update-Set({ update_set_sys_id: "abc123..." });
```

Uses automated background script execution - takes ~2 seconds, fully scriptable!

### SN-Set-Current-Application (FULLY AUTOMATED!)
```javascript
// Set application scope for scoped app development
SN-Set-Current-Application({ app_sys_id: "def456..." });
```

Enables **fully automated scoped application development** with zero manual steps!

---

## 📋 Standard Development Workflow

### 1. Set Application Context
```javascript
// For scoped app development
SN-Set-Current-Application({ app_sys_id: "your_app_id", instance: "dev" });
```

### 2. Set Update Set
```javascript
// Set current update set BEFORE any config changes
SN-Set-Update-Set({ update_set_sys_id: "your_update_set_id", instance: "dev" });
```

### 3. Create Configuration
```javascript
// All operations automatically captured in update set
SN-Create-Record({
  table_name: "sys_properties",
  data: {
    name: "x_custom.setting",
    value: "enabled"
  },
  instance: "dev"
});
```

### 4. Verify Capture
```javascript
// Verify records captured in correct update set
SN-Query-Table({
  table_name: "sys_update_xml",
  query: "update_set=<your_update_set_sys_id>",
  fields: "sys_id,type,name,sys_created_on",
  instance: "dev"
});
```

---

## ⚡ Best Practices

### MCP Operations
1. **MCP FIRST**: Always attempt MCP tools before background scripts
2. **Batch Operations**: Use parallel MCP calls (5-10+ in one message)
   - Example: 43 records moved in parallel successfully
3. **Field Selection**: Specify `fields` parameter to reduce payload
4. **Pagination**: Use `limit` and `offset` for large result sets
5. **Verification**: Always query results after operations

### Update Set Management
```javascript
// WRONG: Background script to move records
SN-Execute-Background-Script({ script: "..." }); // Can fail silently

// RIGHT: Direct REST API call
SN-Update-Record({
  table_name: "sys_update_xml",
  sys_id: "record_id",
  data: { update_set: "target_set_id" }
});

// BEST: Batch operation for multiple records
SN-Batch-Update({
  updates: [
    { table: "sys_update_xml", sys_id: "id1", data: { update_set: "target" }},
    { table: "sys_update_xml", sys_id: "id2", data: { update_set: "target" }}
  ]
});
```

### Discovery Flow
```javascript
// 1. List available tables
SN-List-Available-Tables({ category: "core_itsm" });

// 2. Get table schema
SN-Get-Table-Schema({ table_name: "change_request" });

// 3. Query records with filters
SN-Query-Table({
  table_name: "change_request",
  query: "state=1^priority=1",
  fields: "number,short_description,state",
  limit: 10
});
```

---

## 🏗️ Architecture

### Current Structure
```
src/
├── server.js                      # Express HTTP server (SSE transport)
├── stdio-server.js                # Stdio transport (Claude Desktop)
├── mcp-server-consolidated.js    # MCP tool registration (480+ tools)
├── servicenow-client.js           # ServiceNow REST API client
└── config-manager.js              # Multi-instance configuration

config/
└── servicenow-instances.json      # Multi-instance configuration

docs/
├── API_REFERENCE.md               # Complete API documentation
├── SETUP_GUIDE.md                 # Setup instructions
├── MULTI_INSTANCE_CONFIGURATION.md
├── INSTANCE_SWITCHING_GUIDE.md
├── 403_TROUBLESHOOTING.md
└── research/                      # Technical research & discoveries
```

### Key Features
- **Multi-Instance Support**: Single server manages multiple ServiceNow instances
- **34 Powerful MCP Tools**: Generic tools work on 160+ ServiceNow tables
- **Metadata-Driven**: Table schemas discovered dynamically
- **Session Management**: Separate MCP sessions per client
- **Background Script Automation**: Automated execution via sys_trigger

---

## 🎯 Complete Automation Example

```javascript
// FULLY AUTOMATED SCOPED APP DEVELOPMENT (Zero Manual Steps!)

// 1. Create scoped application
const app = SN-Create-Record({
  table_name: "sys_app",
  data: { name: "My Custom App", scope: "x_custom" },
  instance: "dev"
});

// 2. Set as current application
SN-Set-Current-Application({ app_sys_id: app.sys_id, instance: "dev" });

// 3. Create update set
const updateSet = SN-Create-Record({
  table_name: "sys_update_set",
  data: { name: "Feature Development", application: app.sys_id },
  instance: "dev"
});

// 4. Set as current update set
SN-Set-Update-Set({ update_set_sys_id: updateSet.sys_id, instance: "dev" });

// 5. Create configurations (batch operation)
// All automatically scoped to x_custom and captured in update set!
SN-Batch-Create({
  operations: [
    { table: "sys_properties", data: { name: "x_custom.setting1", value: "value1" }},
    { table: "sys_script", data: { name: "My Script", script: "..." }},
    { table: "sys_ui_page", data: { name: "My Page", html: "..." }}
  ],
  instance: "dev"
});

// 6. Verify everything captured correctly
SN-Query-Table({
  table_name: "sys_update_xml",
  query: "update_set=" + updateSet.sys_id,
  fields: "sys_id,type,name",
  instance: "dev"
});

// ALL DONE! Zero manual UI interaction required! 🎉
```

---

## ⚠️ Known Limitations

### Cannot Be Done via REST API
- ❌ **Flow Designer logic blocks**: Create flows in UI or use templates
- ❌ **Flow compilation**: Flows must be compiled in UI
- ⚠️ **UI Policy Actions linking**: Requires background script with setValue()

### Workarounds Available
- ✅ **Background scripts**: Fully automated via sys_trigger
- ✅ **Update set operations**: Fully automated API calls
- ✅ **Generic table operations**: Work on any custom table
- ✅ **Workflow creation**: Fully automated programmatic creation

**Complete Documentation:** `docs/research/FLOW_DESIGNER_LIMITATIONS.md`

---

## 🔍 Troubleshooting

### Permission Errors (403)
See `docs/403_TROUBLESHOOTING.md` for detailed solutions:
- System table permissions (sys_dictionary, sys_db_object)
- Required roles (personalize_dictionary, security_admin)
- ACL configuration

### Instance Connection Issues
```bash
# Verify instance configuration
curl http://localhost:3000/instances

# Test ServiceNow connectivity
curl -u username:password https://your-instance.service-now.com/api/now/table/incident?sysparm_limit=1
```

### Background Script Debugging
```javascript
// Scripts log to ServiceNow System Logs
// Navigate to: System Logs → System Log → All
// Filter by: Source = "Script execution"
```

---

## 📚 Documentation

### Essential Guides
- **[API Reference](docs/API_REFERENCE.md)** - Complete tool reference
- **[Setup Guide](docs/SETUP_GUIDE.md)** - Installation & configuration
- **[Multi-Instance Config](docs/MULTI_INSTANCE_CONFIGURATION.md)** - Multiple instances
- **[Instance Switching](docs/INSTANCE_SWITCHING_GUIDE.md)** - Routing requests

### Research & Discoveries
- **[Flow Designer Feasibility](docs/research/FLOW_DESIGNER_MCP_FEASIBILITY.md)** - Flow automation analysis
- **[Background Script Breakthrough](docs/research/UI_API_BREAKTHROUGH.md)** - Automated execution discovery
- **[Workflow Creation](docs/research/WORKFLOW_CREATION.md)** - Programmatic workflows

---

## 🚀 Quick Reference

### Most Common Operations
```javascript
// Set scope and update set (start of every session!)
SN-Set-Current-Application({ app_sys_id: "...", instance: "dev" });
SN-Set-Update-Set({ update_set_sys_id: "...", instance: "dev" });

// Query records
SN-Query-Table({ table_name: "incident", query: "active=true", limit: 10 });

// Create record
SN-Create-Record({ table_name: "sys_properties", data: {...} });

// Update record
SN-Update-Record({ table_name: "incident", sys_id: "...", data: {...} });

// Execute script (when needed)
SN-Execute-Background-Script({ script: "...", description: "..." });
```

### Tips for Success
1. **Always set application scope and update set FIRST**
2. **Use batch operations** - make 5-10+ MCP calls in one message
3. **Verify results** - query sys_update_xml after config changes
4. **Check schema** - SN-Get-Table-Schema before unfamiliar tables
5. **Monitor logs** - ServiceNow System Logs for background scripts

---

## 📊 Statistics

- **MCP Tools:** 34 powerful tools
- **Tables Supported:** 160+ ServiceNow tables (via generic tools)
- **Batch Operations:** 43+ parallel calls tested successfully
- **Script Execution:** ~1 second automated via sys_trigger
- **Instance Support:** Unlimited instances via config file
- **Generic CRUD:** Works on **any** ServiceNow table dynamically

---

## 🎓 Additional Resources

- **MCP Specification:** https://spec.modelcontextprotocol.io/
- **MCP SDK Docs:** https://www.npmjs.com/package/@modelcontextprotocol/sdk
- **ServiceNow REST API:** https://docs.servicenow.com/bundle/utah-api-reference/page/integrate/inbound-rest/concept/c_RESTAPI.html
- **MCP Inspector:** https://www.npmjs.com/package/@modelcontextprotocol/inspector
- **Project README:** `README.md`
- **Research Docs:** `docs/research/`