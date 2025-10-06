# MCP Resources Implementation

## Overview

This document describes the MCP Resources implementation for the ServiceNow MCP server. Resources provide read-only, cacheable access to ServiceNow data through a URI-based interface.

## Implementation

**File:** `/src/resources.js`

The resources module exports factory functions that create resource handlers for the MCP server.

### Integration

To integrate with the MCP server (`src/mcp-server-consolidated.js`):

```javascript
import { createResourceHandlers } from './resources.js';

// Inside createMcpServer function, after loading tableMetadata:
const { listResources, readResource } = createResourceHandlers(
  serviceNowClient,
  configManager,
  tableMetadata
);

// Register resource handlers
server.setRequestHandler(ListResourcesRequestSchema, listResources);
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  return await readResource(uri);
});
```

## Resource URI Format

All resources follow the pattern: `servicenow://[instance]/[resource]/[id]`

### Global Resources

Resources that don't require instance selection:

- `servicenow://instances` - List all configured ServiceNow instances
- `servicenow://tables` - List all available ServiceNow tables with metadata

### Instance-Specific Resources

Resources that query data from a specific instance:

- `servicenow://{instance}/info` - Instance information and capabilities
- `servicenow://{instance}/incidents` - List active incidents
- `servicenow://{instance}/incidents/{number}` - Specific incident (e.g., INC0012345)
- `servicenow://{instance}/users` - List active users
- `servicenow://{instance}/update-sets` - List update sets in progress
- `servicenow://{instance}/update-sets/{sys_id}` - Specific update set with contents
- `servicenow://{instance}/groups` - List active user groups
- `servicenow://{instance}/change-requests` - List active change requests

## Features

### 1. Multi-Instance Support

Resources automatically route to the correct ServiceNow instance:

```javascript
// Access default instance
servicenow://dev/incidents

// Access prod instance
servicenow://prod/incidents
```

The implementation handles instance switching and restoration automatically.

### 2. Metadata Enrichment

All resources return data wrapped with metadata:

```json
{
  "metadata": {
    "timestamp": "2025-10-06T12:00:00.000Z",
    "instance": "dev",
    "description": "Active incidents from dev",
    "record_count": 15
  },
  "data": [...]
}
```

### 3. Cacheability

Resources are read-only and include timestamps, making them suitable for client-side caching.

### 4. Update Set Inspection

The update set resources provide detailed breakdowns:

```javascript
servicenow://dev/update-sets/abc123
// Returns:
{
  "update_set": {
    "sys_id": "abc123",
    "name": "My Feature",
    "state": "in progress",
    ...
  },
  "total_records": 43,
  "components": [
    {
      "type": "Business Rule",
      "count": 5,
      "items": ["Rule 1", "Rule 2", ...]
    },
    {
      "type": "UI Policy",
      "count": 3,
      "items": [...]
    }
  ]
}
```

## Example Usage

### List All Resources

```javascript
// MCP Client
const resources = await client.listResources();
console.log(resources);
// Shows all available resource URIs with descriptions
```

### Read Incidents from Dev Instance

```javascript
// MCP Client
const incidents = await client.readResource({
  uri: 'servicenow://dev/incidents'
});

console.log(incidents.contents[0].text);
// {
//   "metadata": {
//     "timestamp": "2025-10-06T12:00:00.000Z",
//     "instance": "dev",
//     "description": "Active incidents from dev",
//     "record_count": 15
//   },
//   "data": [
//     {
//       "number": "INC0012345",
//       "short_description": "Server down",
//       "state": "1",
//       "priority": "1",
//       ...
//     }
//   ]
// }
```

### Read Specific Incident

```javascript
// MCP Client
const incident = await client.readResource({
  uri: 'servicenow://dev/incidents/INC0012345'
});
```

### Inspect Update Set

```javascript
// MCP Client
const updateSet = await client.readResource({
  uri: 'servicenow://dev/update-sets/abc123def456'
});

// Returns detailed breakdown of update set contents grouped by type
```

## Error Handling

The implementation provides clear error messages:

- **Invalid URI format** - Returns format help
- **Resource not found** - Specific error with available resources
- **Instance not found** - Lists available instances
- **ServiceNow API errors** - Forwarded with context

## Performance Considerations

### Default Limits

- Incidents: 25 records
- Users: 50 records
- Update sets: 25 records
- Groups: 50 records
- Change requests: 25 records
- Update set contents: 1000 records (with first 10 per type displayed)

### Field Selection

Resources request only essential fields to minimize payload size:

```javascript
sysparm_fields: 'number,short_description,state,priority,assigned_to,sys_created_on'
```

### Instance Switching

The implementation saves and restores the current instance, ensuring thread safety in multi-client scenarios.

## Future Enhancements

Potential additions to the resources implementation:

1. **Pagination Support** - Add offset/limit to resource URIs
2. **Filtering** - Support query parameters in URIs
3. **Additional Resources**:
   - `servicenow://{instance}/problems` - List problems
   - `servicenow://{instance}/catalog-items` - List service catalog items
   - `servicenow://{instance}/workflows` - List workflows
   - `servicenow://{instance}/business-rules` - List business rules

4. **Resource Templates** - Dynamic resource generation based on table metadata

5. **Aggregations** - Summary resources:
   - `servicenow://{instance}/dashboard` - High-level metrics
   - `servicenow://{instance}/stats/incidents` - Incident statistics

## Testing

Example manual test flow:

```bash
# Using MCP Inspector
npx @modelcontextprotocol/inspector node src/stdio-server.js

# List all resources
> resources/list

# Read instance info
> resources/read servicenow://dev/info

# Read incidents
> resources/read servicenow://dev/incidents

# Read specific incident
> resources/read servicenow://dev/incidents/INC0012345

# Read update set
> resources/read servicenow://dev/update-sets/abc123
```

## Documentation

- **API Reference**: See `docs/API_REFERENCE.md` for complete tool documentation
- **Setup Guide**: See `docs/SETUP_GUIDE.md` for configuration
- **Multi-Instance**: See `docs/MULTI_INSTANCE_CONFIGURATION.md` for instance setup

## Summary

The MCP Resources implementation provides:

- **9+ resource types** for common ServiceNow data
- **Multi-instance routing** with automatic switching
- **Metadata enrichment** with timestamps and record counts
- **Cacheable responses** suitable for client-side caching
- **Error handling** with helpful messages
- **Performance optimized** with field selection and limits
- **Extensible design** for easy addition of new resources

Resources complement the MCP tools by providing read-only access to frequently needed data without requiring explicit tool calls.
