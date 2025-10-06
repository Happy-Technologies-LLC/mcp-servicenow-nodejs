# Evaluation: michaelbuckner/servicenow-mcp

**Repository:** https://github.com/michaelbuckner/servicenow-mcp
**Language:** Python
**License:** MIT
**Stars:** 25 | **Forks:** 13
**Last Updated:** 2025-10-06

---

## Executive Summary

The michaelbuckner/servicenow-mcp server is a **Python-based MCP implementation** that focuses on **natural language interactions** with ServiceNow. While our Node.js implementation is more comprehensive in terms of raw tool count (34 tools), this repository offers valuable insights into **natural language processing**, **flexible input handling**, and **developer experience patterns**.

---

## 📋 Features Comparison

### Their Features (Python Implementation)

#### MCP Resources (Read-Only)
- `incident://list` - List incidents
- `incident://[number]` - Get specific incident
- `user://list` - List users
- `kb://list` - List knowledge articles
- `table://[name]` - Query table records
- `schema://[table]` - Get table schema

#### MCP Tools (Operations)

**Standard Operations:**
1. `create_incident` - Create new incident
2. `update_incident` - Update incident by number
3. `search_records` - Search across tables
4. `get_record` - Get record by sys_id
5. `perform_query` - Query with encoded query string
6. `add_comment` - Add customer-visible comment
7. `add_work_notes` - Add internal work notes

**Natural Language Operations (🌟 UNIQUE):**
8. `natural_language_search` - Search using plain English
   - Example: "find all P1 incidents about SAP"
9. `natural_language_update` - Update using plain English
   - Example: "Update incident INC0010001 saying I'm working on it"
10. `update_script` - Update ServiceNow scripts from files

### Our Features (Node.js Implementation)

**✅ We Have (Superior Coverage):**
- 34 MCP tools vs their 10
- Generic CRUD operations on **any** table (not just incidents)
- Advanced batch operations (SN-Batch-Create, SN-Batch-Update)
- Update set management (create, clone, move, inspect)
- Application scope management
- **Automated background script execution** via sys_trigger
- Workflow creation (workflows, activities, transitions)
- Multi-instance support with routing
- Deep schema discovery with relationships
- Table validation and field explanation
- Choice table discovery

**❌ We Don't Have (Opportunities):**
1. **Natural Language Interface** - No NLP layer for conversational interactions
2. **MCP Resources** - We only have tools, no read-only resource URIs
3. **Incident-Specific Tools** - No dedicated add_comment/add_work_notes convenience methods
4. **Knowledge Base Integration** - No KB article tools
5. **Script File Sync** - No update_script functionality for script includes/business rules

---

## 🌟 Unique Features Worth Implementing

### 1. Natural Language Interface (HIGH VALUE)

**Their Implementation:**
```python
@server.call_tool()
async def natural_language_search(
    query: str,
    table: str = "incident",
    limit: int = 10,
    ctx: dict = None
) -> str:
    """Search for records using natural language.

    Example:
        "find all high priority incidents about SAP"
        "show me recent problems assigned to John Smith"
    """
```

**Why It's Valuable:**
- Makes ServiceNow accessible to non-technical users
- Reduces need to learn encoded query syntax
- Enables conversational AI agents to interact naturally
- Abstracts complexity of field names and query operators

**Implementation Approach for Us:**
```javascript
// Option 1: LLM-Powered (using Claude/GPT to parse)
async function naturalLanguageQuery(nlQuery, table = 'incident') {
  // Parse NL → encoded query using LLM
  const encodedQuery = await parseNaturalLanguage(nlQuery);
  return SN_Query_Table({ table_name: table, query: encodedQuery });
}

// Option 2: Rule-Based (simpler, faster)
function simpleNLQuery(nlQuery, table = 'incident') {
  // Pattern matching for common queries
  const patterns = {
    'high priority': 'priority=1',
    'assigned to me': 'assigned_to=javascript:gs.getUserID()',
    'recent': 'sys_created_on>javascript:gs.daysAgo(7)'
  };
  // Build query from patterns
}
```

**Recommendation:** Add as **SN-Natural-Language-Search** tool with optional LLM parsing.

---

### 2. MCP Resources (MEDIUM VALUE)

**Their Implementation:**
```python
@server.list_resources()
async def list_resources() -> list[types.Resource]:
    """List available resources."""
    return [
        types.Resource(
            uri="incident://list",
            name="Incidents",
            mimeType="application/json",
            description="List of incidents"
        ),
        types.Resource(
            uri="user://list",
            name="Users",
            mimeType="application/json"
        )
    ]

@server.read_resource()
async def read_resource(uri: str) -> str:
    """Read a specific resource."""
    if uri == "incident://list":
        incidents = await client.get_incidents()
        return json.dumps(incidents)
```

**Why It's Valuable:**
- Provides **read-only access patterns** separate from tools
- Enables **caching and resource discovery**
- Follows MCP spec more completely
- Better separation of concerns (read vs write)

**Implementation for Us:**
```javascript
// Add to mcp-server-consolidated.js
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "servicenow://incidents",
        name: "ServiceNow Incidents",
        mimeType: "application/json",
        description: "List of active incidents"
      },
      {
        uri: "servicenow://users",
        name: "ServiceNow Users",
        mimeType: "application/json"
      }
    ]
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  if (uri === "servicenow://incidents") {
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: JSON.stringify(await queryTable('incident', { limit: 100 }))
      }]
    };
  }
});
```

**Recommendation:** Add resources for: incidents, users, tables, update_sets, knowledge_base.

---

### 3. Incident Convenience Tools (LOW-MEDIUM VALUE)

**Their Implementation:**
```python
@server.call_tool()
async def add_comment(number: str, comment: str) -> str:
    """Add a customer-visible comment to an incident."""

@server.call_tool()
async def add_work_notes(number: str, work_notes: str) -> str:
    """Add internal work notes to an incident."""
```

**Why It's Valuable:**
- **Better UX** for common operations
- Clearer intent (comment vs work notes)
- Hides technical details (field names, update syntax)

**Current Approach (Ours):**
```javascript
// Generic but less intuitive
SN_Update_Record({
  table_name: "incident",
  sys_id: "abc123",
  data: { comments: "Customer comment here" }
});
```

**Improved Approach:**
```javascript
// New convenience tools
SN_Add_Comment({
  incident_number: "INC0010001",
  comment: "Customer comment"
});

SN_Add_Work_Notes({
  incident_number: "INC0010001",
  work_notes: "Internal notes"
});
```

**Recommendation:** Add convenience tools for **high-frequency operations** on incident, change_request, problem tables.

---

### 4. Script File Synchronization (HIGH VALUE)

**Their Implementation:**
```python
@server.call_tool()
async def update_script(
    script_name: str,
    script_type: str,  # 'script_include', 'business_rule', etc.
    file_path: str
) -> str:
    """Update a ServiceNow script from a local file."""
    with open(file_path, 'r') as f:
        script_content = f.read()

    # Find script record
    scripts = await client.query_table(
        script_type,
        f"name={script_name}"
    )

    # Update script field
    await client.update_record(
        script_type,
        scripts[0]['sys_id'],
        {'script': script_content}
    )
```

**Why It's Valuable:**
- **Local development workflow** for ServiceNow scripts
- **Version control** for scripts (Git integration)
- **IDE support** (syntax highlighting, linting)
- **Bidirectional sync** potential

**Implementation for Us:**
```javascript
// New tool: SN-Sync-Script
async function syncScript({
  script_name,
  script_type = 'sys_script_include',
  file_path,
  direction = 'push'  // 'push' or 'pull'
}) {
  if (direction === 'push') {
    // Read local file
    const scriptContent = await fs.readFile(file_path, 'utf-8');

    // Find script in ServiceNow
    const scripts = await queryTable(script_type, `name=${script_name}`);

    // Update in ServiceNow
    await updateRecord(script_type, scripts[0].sys_id, {
      script: scriptContent
    });
  } else {
    // Pull from ServiceNow to local file
    const scripts = await queryTable(script_type, `name=${script_name}`);
    await fs.writeFile(file_path, scripts[0].script);
  }
}
```

**Extended Functionality:**
```javascript
// Watch mode for continuous sync
SN_Watch_Scripts({
  directory: './servicenow-scripts/',
  script_type: 'sys_script_include',
  auto_sync: true
});

// Bulk sync
SN_Sync_All_Scripts({
  directory: './servicenow-scripts/',
  script_types: ['sys_script_include', 'sys_script', 'sys_ui_script']
});
```

**Recommendation:** **IMPLEMENT THIS** - highly valuable for modern development workflows.

---

### 5. Flexible Input Handling (MEDIUM VALUE)

**Their Pattern:**
```python
async def create_incident(
    incident: IncidentCreate | dict | str,  # Multiple input types
    ctx: dict = None
) -> str:
    # Handle string input (parse as JSON)
    if isinstance(incident, str):
        incident = json.loads(incident)

    # Handle dict input
    if isinstance(incident, dict):
        incident = IncidentCreate(**incident)

    # Now work with validated Pydantic model
    return await client.create_incident(incident.model_dump())
```

**Why It's Valuable:**
- **Better DX** - accepts multiple input formats
- **Validation** - Pydantic models catch errors early
- **Auto-completion** - Type hints improve IDE support

**Current Approach (Ours):**
```javascript
// Requires exact object structure
SN_Create_Incident({
  short_description: "Issue",
  priority: 1
});
```

**Improved Approach (TypeScript):**
```typescript
// Add input validation and transformation
interface IncidentInput {
  short_description: string;
  priority?: number | string;  // Accept "1" or 1
  urgency?: number | string;
}

function createIncident(incident: IncidentInput | string) {
  // Parse string input
  if (typeof incident === 'string') {
    incident = JSON.parse(incident);
  }

  // Normalize priority/urgency
  if (incident.priority) {
    incident.priority = parseInt(incident.priority);
  }

  // Validate required fields
  if (!incident.short_description) {
    throw new Error('short_description is required');
  }

  return snClient.createRecord('incident', incident);
}
```

**Recommendation:** Add input validation and flexible parsing for all tools.

---

## 🔍 Implementation Patterns Analysis

### Authentication Handling

**Their Approach:**
```python
class ServiceNowClient:
    def __init__(self, instance_url, auth_config):
        if auth_config.type == "basic":
            self.auth = (username, password)
        elif auth_config.type == "token":
            self.auth = BearerAuth(token)
        elif auth_config.type == "oauth":
            self.auth = OAuth2Session(client_id, client_secret)
```

**Our Approach:**
```javascript
// Currently: Basic auth only
const auth = Buffer.from(`${username}:${password}`).toString('base64');

// Could add: OAuth support
const oauth = new OAuth2Client(clientId, clientSecret, tokenUrl);
```

**Recommendation:** Add **OAuth 2.0 support** for enterprise deployments.

---

### Error Handling

**Their Approach:**
```python
try:
    response = await client.get_incidents()
    if ctx:
        await ctx.report_progress(f"Found {len(response)} incidents")
    return json.dumps(response)
except Exception as e:
    logger.error(f"Error fetching incidents: {e}")
    raise McpError(
        error_code=ErrorCode.InternalError,
        message=f"Failed to fetch incidents: {str(e)}"
    )
```

**Our Approach:**
```javascript
// Less sophisticated error handling
try {
  const response = await fetch(url, options);
  return await response.json();
} catch (error) {
  console.error(error);
  throw error;
}
```

**Recommendation:** Add:
1. **Progress reporting** for long operations
2. **Structured error codes** (match MCP error spec)
3. **Better error messages** with actionable guidance

---

### Context and Progress Reporting

**Their Innovation:**
```python
@server.call_tool()
async def search_records(
    query: str,
    table: str = "incident",
    ctx: dict = None  # Context object
) -> str:
    if ctx:
        await ctx.report_progress("Searching ServiceNow...")

    results = await client.search(query, table)

    if ctx:
        await ctx.report_progress(f"Found {len(results)} records")

    return json.dumps(results)
```

**Why It's Valuable:**
- **Real-time feedback** for long-running operations
- **Better UX** in Claude Code UI
- **Debugging aid** - shows what's happening

**Implementation for Us:**
```javascript
// Add progress reporting to long operations
async function batchUpdate(updates, ctx) {
  for (let i = 0; i < updates.length; i++) {
    if (ctx?.reportProgress) {
      await ctx.reportProgress(`Updating record ${i+1}/${updates.length}`);
    }
    await updateRecord(updates[i]);
  }
}
```

**Recommendation:** Add **progress reporting** to batch operations, workflow creation, bulk updates.

---

## 📊 Architecture Comparison

| Aspect | Their Approach | Our Approach | Winner |
|--------|---------------|--------------|---------|
| **Language** | Python 3.8+ | Node.js 18+ | Tie |
| **Transport** | Stdio only | Stdio + HTTP/SSE | **Us** |
| **Tool Count** | 10 tools | 34 tools | **Us** |
| **Resources** | 5 resources | 0 resources | **Them** |
| **NL Interface** | Yes (3 tools) | No | **Them** |
| **Multi-Instance** | No | Yes | **Us** |
| **Batch Ops** | No | Yes | **Us** |
| **Update Sets** | No | Full mgmt | **Us** |
| **Workflows** | No | Full support | **Us** |
| **Script Sync** | Yes | No | **Them** |
| **OAuth Support** | Yes | No | **Them** |
| **Type Safety** | Pydantic models | None | **Them** |
| **Testing** | pytest | None | **Them** |
| **Documentation** | Good | Excellent | **Us** |

**Overall Winner:** **Our implementation** is more comprehensive, but **their NL interface and script sync** are valuable additions.

---

## 🎯 Recommendations for Our Implementation

### Priority 1 (High Value, Implement Soon)
1. **Script File Synchronization** (`SN-Sync-Script`, `SN-Watch-Scripts`)
   - Enables local development workflow
   - Git integration for version control
   - **Effort:** Medium | **Value:** High

2. **Natural Language Search** (`SN-Natural-Language-Search`)
   - Use LLM to parse NL → encoded query
   - Fallback to pattern matching for common phrases
   - **Effort:** Medium | **Value:** High

3. **Progress Reporting**
   - Add to batch operations, workflow creation
   - Better UX for long operations
   - **Effort:** Low | **Value:** Medium

### Priority 2 (Medium Value, Consider)
4. **MCP Resources** (read-only resource URIs)
   - Incidents, users, tables, update sets
   - Better MCP spec compliance
   - **Effort:** Low | **Value:** Medium

5. **Incident Convenience Tools**
   - `SN-Add-Comment`, `SN-Add-Work-Notes`
   - `SN-Assign-Incident`, `SN-Resolve-Incident`
   - **Effort:** Low | **Value:** Low-Medium

6. **OAuth 2.0 Support**
   - Enterprise authentication
   - Better security model
   - **Effort:** Medium | **Value:** Medium

### Priority 3 (Low Priority)
7. **Input Validation** (TypeScript + Zod)
   - Type-safe inputs
   - Better error messages
   - **Effort:** High | **Value:** Low-Medium

8. **Knowledge Base Tools**
   - `SN-List-Knowledge`, `SN-Search-Knowledge`
   - **Effort:** Low | **Value:** Low

---

## 💡 Lessons Learned

### 1. Natural Language Is a Game-Changer
Their focus on NL interactions makes ServiceNow **accessible to non-technical users**. This is especially valuable for:
- Product managers querying incidents
- Support teams without ServiceNow training
- AI agents with conversational interfaces

### 2. Local Development Workflow Matters
The `update_script` tool enables **modern development practices**:
- Use your favorite IDE (VS Code, IntelliJ)
- Git version control for scripts
- Automated testing before deployment
- CI/CD integration

### 3. Resources Complement Tools
MCP Resources provide a **read-only, cacheable interface** that:
- Reduces API calls
- Enables better client-side caching
- Separates read (resources) from write (tools)

### 4. Progress Reporting Improves UX
Long operations feel faster with **real-time feedback**:
- "Searching ServiceNow..." → "Found 42 records"
- "Updating 1/50..." → "Updating 50/50... Done!"

### 5. Type Safety Prevents Errors
Pydantic models catch errors **before** API calls:
- Invalid field names
- Wrong data types
- Missing required fields

### 6. OAuth Is Enterprise Standard
Many enterprises **require OAuth** for ServiceNow integrations:
- Better security (no stored passwords)
- Token refresh handling
- Scoped permissions

---

## 🚀 Action Items

### Immediate (Next Sprint)
- [ ] **Implement SN-Sync-Script** for local script development
- [ ] **Add progress reporting** to batch operations
- [ ] **Create SN-Natural-Language-Search** (pattern-based initially)

### Short-Term (1-2 Sprints)
- [ ] **Add MCP Resources** for incidents, users, tables
- [ ] **Implement convenience tools** (add_comment, add_work_notes)
- [ ] **Research OAuth 2.0** integration

### Long-Term (Backlog)
- [ ] **TypeScript migration** with Zod validation
- [ ] **Knowledge Base tools**
- [ ] **Advanced NL parsing** with LLM integration
- [ ] **Script watch mode** for continuous sync

---

## 📝 Conclusion

The **michaelbuckner/servicenow-mcp** implementation offers valuable insights despite having fewer tools (10 vs our 34). Their focus on:

1. **Natural language interactions** - Makes ServiceNow accessible
2. **Script file synchronization** - Enables modern development
3. **MCP resources** - Better spec compliance
4. **Progress reporting** - Improved UX

These features **complement our strengths** (comprehensive tool coverage, multi-instance, update set management, workflows) and represent high-value additions to our roadmap.

**Key Takeaway:** We excel at **breadth and automation**, they excel at **developer experience and accessibility**. Combining both approaches would create the **most powerful ServiceNow MCP server** available.

---

**Next Steps:**
1. Review this evaluation with the team
2. Prioritize recommended features
3. Create implementation tickets for Priority 1 items
4. Update roadmap with new capabilities

**Evaluation Completed:** 2025-10-06
**Evaluator:** Claude Code (with human review)
