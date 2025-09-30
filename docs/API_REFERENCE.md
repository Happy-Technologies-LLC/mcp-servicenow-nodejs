# ServiceNow MCP Server - API Reference

**Version:** 2.0
**Last Updated:** 2025-09-30

Complete reference for all MCP tools available in the ServiceNow server.

---

## Table of Contents

1. [Tool Categories](#tool-categories)
2. [Generic CRUD Operations](#generic-crud-operations)
3. [Specialized Tools](#specialized-tools)
4. [Update Set Management](#update-set-management)
5. [Workflow Operations](#workflow-operations)
6. [Schema & Discovery](#schema--discovery)
7. [Batch Operations](#batch-operations)
8. [Multi-Instance Support](#multi-instance-support)

---

## Tool Categories

### 📊 **Generic CRUD Operations**
Work on **any** ServiceNow table (160+ supported)

### 🎯 **Specialized Tools**
Table-specific operations for core ITSM tables

### 🔄 **Update Set Management**
Advanced update set operations

### 🌊 **Workflow Operations**
Create and manage workflows programmatically

### 🔍 **Schema & Discovery**
Table introspection and metadata

### ⚡ **Batch Operations**
Efficient multi-record operations

---

## Generic CRUD Operations

These tools work on **any** ServiceNow table.

### SN-Query-Table

Query records from any table with advanced filtering.

**Parameters:**
```javascript
{
  "table_name": "incident",        // Required: ServiceNow table name
  "query": "state=1^priority=1",   // Optional: Encoded query string
  "fields": "number,short_description", // Optional: Comma-separated fields
  "limit": 25,                     // Optional: Max records (default: 25)
  "offset": 0,                     // Optional: Skip records for pagination
  "order_by": "sys_created_on",    // Optional: Sort field (prefix with - for desc)
  "instance": "prod"               // Optional: Target instance (uses default if omitted)
}
```

**Example:**
```javascript
SN-Query-Table({
  "table_name": "incident",
  "query": "active=true^state=1",
  "fields": "number,short_description,priority",
  "limit": 10
})
```

---

### SN-Create-Record

Create a record in any table.

**Parameters:**
```javascript
{
  "table_name": "incident",
  "data": {
    "short_description": "Email server down",
    "urgency": 1,
    "impact": 2
  },
  "instance": "dev"
}
```

**Returns:** Created record with sys_id

---

### SN-Get-Record

Get a single record by sys_id.

**Parameters:**
```javascript
{
  "table_name": "incident",
  "sys_id": "abc123...",
  "fields": "number,state,priority",  // Optional
  "instance": "prod"
}
```

---

### SN-Update-Record

Update an existing record.

**Parameters:**
```javascript
{
  "table_name": "incident",
  "sys_id": "abc123...",
  "data": {
    "state": 6,
    "resolution_notes": "Issue resolved"
  },
  "instance": "prod"
}
```

---

## Specialized Tools

### Core ITSM Tables

Each major table has specialized tools:

- **Incidents:** `SN-List-Incidents`, `SN-Create-Incident`, `SN-Get-Incident`
- **Changes:** `SN-List-ChangeRequests`, `SN-Create-ChangeRequest`
- **Problems:** `SN-List-Problems`
- **Users:** `SN-List-SysUsers`
- **Groups:** `SN-List-SysUserGroups`
- **CMDB:** `SN-List-CmdbCis`

**Example:**
```javascript
SN-List-Incidents({
  "query": "state=1^priority=1",
  "limit": 10,
  "instance": "prod"
})
```

---

## Update Set Management

### SN-Get-Current-Update-Set

Get the currently active update set.

**Parameters:**
```javascript
{
  "instance": "dev"
}
```

**Returns:**
```json
{
  "sys_id": "abc123...",
  "name": "My Update Set",
  "state": "in progress"
}
```

---

### SN-Set-Update-Set

Set the current update set programmatically.

**Parameters:**
```javascript
{
  "update_set_sys_id": "abc123...",
  "instance": "dev"
}
```

**Implementation:** Uses automated background script execution via `sys_trigger`

---

### SN-List-Update-Sets

List available update sets with filtering.

**Parameters:**
```javascript
{
  "query": "state=in progress",
  "limit": 25,
  "order_by": "-sys_created_on",
  "instance": "dev"
}
```

---

### SN-Move-Records-To-Update-Set

Move sys_update_xml records between update sets.

**Parameters:**
```javascript
{
  "update_set_id": "target_sys_id",
  "source_update_set": "Default",  // Optional: filter by source
  "record_sys_ids": ["id1", "id2"], // Optional: specific records
  "time_range": {                   // Optional: time filter
    "start": "2025-09-29 20:00:00",
    "end": "2025-09-29 20:03:31"
  },
  "instance": "dev"
}
```

**Use Case:** Fix records that went to wrong update set

---

### SN-Clone-Update-Set

Clone an entire update set with all records.

**Parameters:**
```javascript
{
  "source_update_set_id": "abc123...",
  "new_name": "Clone of Original",
  "instance": "dev"
}
```

---

### SN-Inspect-Update-Set

Inspect update set contents and dependencies.

**Parameters:**
```javascript
{
  "update_set": "abc123...",
  "show_components": true,
  "show_dependencies": false,
  "instance": "dev"
}
```

---

## Workflow Operations

### SN-Create-Workflow

Create a complete workflow with activities and transitions.

**Parameters:**
```javascript
{
  "name": "Auto-Approve Change",
  "table": "change_request",
  "description": "Automatically approve low-risk changes",
  "activities": [
    {
      "name": "Check Risk",
      "script": "if (current.risk == '4') { answer = 'yes'; }"
    },
    {
      "name": "Auto Approve",
      "script": "current.approval = 'approved'; current.update();"
    }
  ],
  "transitions": [
    {
      "from": "Check Risk",
      "to": "Auto Approve",
      "condition_script": "answer == 'yes'"
    }
  ],
  "publish": false,
  "instance": "dev"
}
```

---

### SN-Create-Activity

Create a single workflow activity.

**Parameters:**
```javascript
{
  "workflow_version_sys_id": "abc123...",
  "name": "Send Notification",
  "script": "gs.eventQueue('incident.resolved', current);",
  "x": 100,  // Canvas position
  "y": 100,
  "instance": "dev"
}
```

---

### SN-Publish-Workflow

Publish a workflow version.

**Parameters:**
```javascript
{
  "version_sys_id": "abc123...",
  "start_activity_sys_id": "def456...",
  "instance": "dev"
}
```

---

## Schema & Discovery

### SN-Get-Table-Schema

Get basic table schema information.

**Parameters:**
```javascript
{
  "table_name": "incident",
  "instance": "prod"
}
```

**Returns:** Field names, types, labels

---

### SN-Discover-Table-Schema

Get comprehensive table metadata with relationships.

**Parameters:**
```javascript
{
  "table_name": "sys_hub_flow",
  "include_relationships": true,
  "include_field_constraints": true,
  "include_type_codes": true,
  "include_choice_tables": true,
  "include_ui_policies": false,
  "include_business_rules": false,
  "instance": "dev"
}
```

**Returns:** Complete schema with:
- Field definitions
- Reference relationships
- Choice tables
- Field constraints
- Type codes

---

### SN-List-Available-Tables

List all available ServiceNow tables.

**Parameters:**
```javascript
{
  "category": "core_itsm",  // Optional: filter by category
  "instance": "prod"
}
```

**Categories:** `core_itsm`, `platform`, `service_catalog`, `cmdb`, `all`

---

### SN-Explain-Field

Get detailed explanation of a specific field.

**Parameters:**
```javascript
{
  "table": "catalog_ui_policy_action",
  "field": "catalog_variable",
  "include_examples": true,
  "instance": "dev"
}
```

---

## Batch Operations

### SN-Batch-Create

Create multiple records in a single operation.

**Parameters:**
```javascript
{
  "operations": [
    {
      "table": "incident",
      "data": { "short_description": "Issue 1" },
      "save_as": "incident1"
    },
    {
      "table": "incident_task",
      "data": {
        "parent": "${incident1}",  // Reference previous record
        "short_description": "Task 1"
      }
    }
  ],
  "transaction": true,  // All-or-nothing
  "instance": "dev"
}
```

---

### SN-Batch-Update

Update multiple records efficiently.

**Parameters:**
```javascript
{
  "updates": [
    {
      "table": "incident",
      "sys_id": "abc123...",
      "data": { "state": 6 }
    },
    {
      "table": "incident",
      "sys_id": "def456...",
      "data": { "state": 6 }
    }
  ],
  "stop_on_error": false,
  "instance": "dev"
}
```

---

## Background Script Execution

### SN-Execute-Background-Script

Execute JavaScript server-side with automated sys_trigger execution.

**Parameters:**
```javascript
{
  "script": "gs.info('Hello from script');",
  "description": "Test script execution",
  "execution_method": "trigger",  // trigger (default), ui, or auto
  "instance": "dev"
}
```

**Execution Methods:**
- `trigger` (recommended): Uses sys_trigger, runs in ~1 second, auto-deletes
- `ui`: Attempts direct UI endpoint execution
- `auto`: Tries trigger, then ui, then creates fix script

**Returns:** Success status and trigger details

---

### SN-Create-Fix-Script

Generate a script file for manual execution (fallback).

**Parameters:**
```javascript
{
  "script_name": "link_ui_policy_actions",
  "script_content": "var gr = new GlideRecord('...'); gr.update();",
  "description": "Link UI policy actions to policies",
  "auto_delete": true,  // Delete script file after execution
  "instance": "dev"
}
```

**Use Case:** When automated execution is not available

---

## Multi-Instance Support

All tools support the `instance` parameter to route requests to specific ServiceNow instances.

### Configuration

Set up multiple instances in `config/servicenow-instances.json`:

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

### Usage

**Default Instance:**
```javascript
SN-List-Incidents({ "limit": 10 })
```

**Specific Instance:**
```javascript
SN-List-Incidents({ "limit": 10, "instance": "prod" })
```

### List Instances

```bash
curl http://localhost:3000/instances
```

---

## Error Handling

All tools return errors in this format:

```json
{
  "error": "Error message",
  "details": "Detailed explanation",
  "instance": "dev",
  "table": "incident"
}
```

**Common Errors:**
- `400` - Invalid parameters
- `401` - Authentication failed
- `403` - Permission denied
- `404` - Record/table not found
- `500` - ServiceNow API error

---

## Rate Limiting

ServiceNow enforces rate limits on API calls:
- **Standard:** 1000 requests per hour per user
- **Batch operations** count as multiple requests
- Use pagination with `limit` and `offset` for large datasets

---

## Best Practices

1. **Use Generic Tools** (`SN-Query-Table`) for flexibility
2. **Batch Operations** for multiple record operations
3. **Field Selection** to reduce payload size (`fields` parameter)
4. **Pagination** for large result sets (`limit`, `offset`)
5. **Update Sets** to track configuration changes
6. **Instance Parameter** to target correct environment
7. **Background Scripts** for complex operations requiring server-side logic

---

## Additional Documentation

- **Setup Guide:** `docs/SETUP_GUIDE.md`
- **Multi-Instance Config:** `docs/MULTI_INSTANCE_CONFIGURATION.md`
- **Instance Switching:** `docs/INSTANCE_SWITCHING_GUIDE.md`
- **Troubleshooting:** `docs/403_TROUBLESHOOTING.md`
- **Research & Breakthroughs:** `docs/research/`