# MCP Resources Architecture

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      MCP Client                              │
│                  (Claude Code / CLI)                         │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    │ ListResources / ReadResource
                    │
┌───────────────────▼─────────────────────────────────────────┐
│                   MCP Server                                 │
│            (mcp-server-consolidated.js)                      │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Resource Request Handlers                     │  │
│  │                                                       │  │
│  │  ListResourcesRequestSchema  ──────┐                │  │
│  │  ReadResourceRequestSchema   ──────┤                │  │
│  └────────────────────────────────────┼────────────────┘  │
│                                       │                     │
│  ┌────────────────────────────────────▼────────────────┐  │
│  │            resources.js                             │  │
│  │                                                      │  │
│  │  createResourceHandlers(                            │  │
│  │    serviceNowClient,                                │  │
│  │    configManager,                                   │  │
│  │    tableMetadata                                    │  │
│  │  )                                                   │  │
│  │                                                      │  │
│  │  ┌────────────────────────────────────────────┐    │  │
│  │  │  listResources()                           │    │  │
│  │  │  - Build resource list                     │    │  │
│  │  │  - Include all instances                   │    │  │
│  │  │  - Add metadata resources                  │    │  │
│  │  └────────────────────────────────────────────┘    │  │
│  │                                                      │  │
│  │  ┌────────────────────────────────────────────┐    │  │
│  │  │  readResource(uri)                         │    │  │
│  │  │  1. Parse URI                              │    │  │
│  │  │  2. Route to handler                       │    │  │
│  │  │  3. Switch instance if needed              │    │  │
│  │  │  4. Fetch data                             │    │  │
│  │  │  5. Format with metadata                   │    │  │
│  │  │  6. Restore original instance              │    │  │
│  │  └────────────────────────────────────────────┘    │  │
│  └──────────────────────────────────────────────────────┘  │
└───────────────────┬─────────────────────────────────────────┘
                    │
        ┌───────────┼───────────┬────────────────┐
        │           │           │                │
        ▼           ▼           ▼                ▼
┌──────────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────┐
│ServiceNow    │ │Config    │ │Table         │ │Instance  │
│Client        │ │Manager   │ │Metadata      │ │Switching │
│              │ │          │ │              │ │          │
│- getRecords  │ │- list    │ │- schemas     │ │- save    │
│- getRecord   │ │- get     │ │- fields      │ │- switch  │
│- setInstance │ │- switch  │ │- types       │ │- restore │
└──────────────┘ └──────────┘ └──────────────┘ └──────────┘
        │                                             │
        └─────────────────────────────────────────────┘
                              │
                              ▼
              ┌────────────────────────────┐
              │   ServiceNow REST API       │
              │   (Multiple Instances)      │
              │                             │
              │   - dev.service-now.com     │
              │   - test.service-now.com    │
              │   - prod.service-now.com    │
              └─────────────────────────────┘
```

## Resource URI Routing

```
servicenow://instances
    │
    └──> configManager.listInstances()
         Return all configured instances


servicenow://tables
    │
    └──> tableMetadata
         Return all table definitions


servicenow://{instance}/info
    │
    ├──> configManager.getInstance(instance)
    ├──> serviceNowClient.getCurrentInstance()
    └──> Format server info + capabilities


servicenow://{instance}/incidents
    │
    ├──> Switch to instance (if needed)
    ├──> serviceNowClient.getRecords('incident', {...})
    ├──> Format with metadata
    └──> Restore original instance


servicenow://{instance}/incidents/{number}
    │
    ├──> Switch to instance (if needed)
    ├──> serviceNowClient.getRecords('incident', {query: 'number=...'})
    ├──> Format single record with metadata
    └──> Restore original instance


servicenow://{instance}/update-sets/{sys_id}
    │
    ├──> Switch to instance (if needed)
    ├──> serviceNowClient.getRecord('sys_update_set', sys_id)
    ├──> serviceNowClient.getRecords('sys_update_xml', {query: 'update_set=...'})
    ├──> Group by type, aggregate counts
    ├──> Format detailed breakdown
    └──> Restore original instance
```

## Data Flow

### List Resources Request

```
Client Request
    │
    ▼
MCP Server: ListResourcesRequestSchema
    │
    ▼
resources.js: listResources()
    │
    ├──> Get current instance
    ├──> Get all instances
    ├──> Build resource list
    │    ├── Global resources (instances, tables)
    │    ├── Current instance resources
    │    └── Other instance resources
    │
    ▼
Return: { resources: [...] }
```

### Read Resource Request

```
Client Request: servicenow://dev/incidents
    │
    ▼
MCP Server: ReadResourceRequestSchema
    │
    ▼
resources.js: readResource(uri)
    │
    ├──> Parse URI
    │    ├── Extract instance: "dev"
    │    └── Extract resource: "incidents"
    │
    ├──> Save current instance
    │
    ├──> Switch to requested instance
    │    └──> serviceNowClient.setInstance(dev)
    │
    ├──> Fetch data
    │    └──> serviceNowClient.getRecords('incident', {
    │         sysparm_query: 'active=true',
    │         sysparm_limit: 25,
    │         sysparm_fields: 'number,short_description,...'
    │       })
    │
    ├──> Format response
    │    └──> {
    │         metadata: {timestamp, instance, description, count},
    │         data: [...]
    │       }
    │
    ├──> Restore original instance
    │    └──> serviceNowClient.setInstance(original)
    │
    ▼
Return: { contents: [{uri, mimeType, text}] }
```

## Instance Switching Flow

```
Request: servicenow://prod/incidents
(Current instance: dev)

1. Save current state
   ┌──────────────────────┐
   │ originalInstance =   │
   │   name: 'dev'        │
   │   url: 'dev.sn.com'  │
   └──────────────────────┘

2. Switch to requested instance
   ┌──────────────────────┐
   │ configManager.get    │
   │   Instance('prod')   │
   │                      │
   │ serviceNowClient.    │
   │   setInstance(...)   │
   └──────────────────────┘

3. Execute request
   ┌──────────────────────┐
   │ GET /api/now/table/  │
   │   incident           │
   │                      │
   │ Host: prod.sn.com    │
   │ Auth: prod creds     │
   └──────────────────────┘

4. Restore original instance
   ┌──────────────────────┐
   │ serviceNowClient.    │
   │   setInstance(       │
   │     originalInstance │
   │   )                  │
   └──────────────────────┘
```

## Error Handling Flow

```
Invalid URI: servicenow://invalid-format
    │
    ▼
Parse URI (regex match fails)
    │
    ▼
throw Error('Invalid resource URI format...')
    │
    ▼
MCP Server catches error
    │
    ▼
Return error response to client


Resource not found: servicenow://dev/unknown
    │
    ▼
Parse URI successfully
    │
    ▼
No matching resource handler
    │
    ▼
throw Error('Unknown resource path: unknown. Available: ...')
    │
    ▼
MCP Server catches error
    │
    ▼
Return error response with suggestions


Instance not found: servicenow://nonexistent/incidents
    │
    ▼
configManager.getInstance('nonexistent')
    │
    ▼
throw Error('Instance "nonexistent" not found. Available: ...')
    │
    ▼
MCP Server catches error
    │
    ▼
Return error response with instance list
```

## Resource Response Format

All resources return a consistent format:

```javascript
{
  contents: [
    {
      uri: "servicenow://dev/incidents",
      mimeType: "application/json",
      text: JSON.stringify({
        metadata: {
          timestamp: "2025-10-06T12:00:00.000Z",
          instance: "dev",
          description: "Active incidents from dev",
          record_count: 15
        },
        data: [
          { /* incident 1 */ },
          { /* incident 2 */ },
          // ...
        ]
      }, null, 2)
    }
  ]
}
```

## Performance Optimization

```
Resource Request: servicenow://dev/incidents
    │
    ├──> Field Selection
    │    └──> sysparm_fields: 'number,short_description,state,...'
    │        (Only essential fields, not all 100+ fields)
    │
    ├──> Limit Records
    │    └──> sysparm_limit: 25
    │        (Default limit prevents large payloads)
    │
    ├──> Query Filter
    │    └──> sysparm_query: 'active=true'
    │        (Server-side filtering)
    │
    └──> Caching Metadata
         └──> Include timestamp for client caching decisions
```

## Extension Points

Future resource types can be easily added:

```javascript
// In resources.js readResource()

// Resource: servicenow://[instance]/problems
if (resource === 'problems') {
  const problems = await serviceNowClient.getRecords('problem', {
    sysparm_query: 'active=true',
    sysparm_limit: 25,
    sysparm_fields: 'number,short_description,state,...'
  });
  return formatResource(problems, `Active problems from ${instanceName}`);
}

// Resource: servicenow://[instance]/catalog-items
if (resource === 'catalog-items') {
  const items = await serviceNowClient.getRecords('sc_cat_item', {
    sysparm_query: 'active=true',
    sysparm_limit: 50,
    sysparm_fields: 'name,short_description,category,...'
  });
  return formatResource(items, `Catalog items from ${instanceName}`);
}
```

## Integration with Tools

Resources and Tools work together:

```
┌──────────────────────────────────────────────────────┐
│                    MCP Client                         │
└──────────────────┬───────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
┌──────────────┐      ┌─────────────┐
│  Resources   │      │    Tools    │
│ (Read-Only)  │      │ (Read/Write)│
└──────┬───────┘      └──────┬──────┘
       │                     │
       │ GET data            │ Modify data
       │                     │
       ▼                     ▼
┌─────────────────────────────────────┐
│     ServiceNow REST API             │
└─────────────────────────────────────┘

Example workflow:
1. Resource: Read servicenow://dev/incidents
   → Get list of incidents

2. Tool: SN-Update-Record
   → Update specific incident

3. Resource: Read servicenow://dev/incidents/{number}
   → Verify update
```

This architecture provides a clean separation between read-only resources (cacheable, fast) and write tools (modify state, slower).
