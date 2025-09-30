# Workflow vs Flow Designer: Automation Creation Analysis

**Last Updated:** 2025-09-29
**Question:** Can we create automations programmatically? Should we use Workflow (legacy) or Flow Designer (modern)?

---

## TL;DR Summary

| Feature | Workflow (Legacy) | Flow Designer (Modern) |
|---------|------------------|----------------------|
| **Create via REST API** | ❌ No | ❌ No |
| **Create via Background Script** | ⚠️ Possible but complex | ❌ No |
| **Export/Import XML** | ✅ Yes (via Update Sets) | ✅ Yes (via Update Sets) |
| **Execute Programmatically** | ✅ Yes (Workflow API) | ✅ Yes (FlowAPI) |
| **Trigger via Record Changes** | ✅ Yes | ✅ Yes |
| **Trigger via REST** | ⚠️ Indirect | ✅ Yes (with REST trigger) |
| **ServiceNow Recommendation** | ⚠️ Legacy (being phased out) | ✅ Current standard |
| **Complexity** | High | Very High |
| **MCP Tool Viability** | ⚠️ Marginal | ❌ Not viable |

**Recommendation:** Neither is viable for programmatic creation. Use **template + export approach** for both.

---

## Deep Dive: Classic Workflow

### What Is It?

The original ServiceNow automation engine (pre-Flow Designer). Uses graphical canvas with activities (approvals, tasks, conditions, scripts, etc.).

### Tables Involved

- `wf_workflow` - Workflow definitions
- `wf_workflow_version` - Published versions
- `wf_activity` - Individual activities (steps)
- `wf_context` - Execution contexts
- `wf_stage` - Workflow stages

### Can We Create Workflows via API? ⚠️

**Technically possible but extremely impractical:**

1. **Via REST API:**
   - ❌ No dedicated endpoint
   - ⚠️ Could POST to `wf_workflow` table but...
   - Missing: Activities, transitions, conditions, stages
   - Would require coordinated inserts across 5+ tables
   - No validation

2. **Via Background Script:**
   - ⚠️ Theoretically possible with GlideRecord
   - Must create workflow record
   - Must create activity records
   - Must link activities with transitions
   - Must configure conditions
   - **Problem:** Workflow XML structure is complex and undocumented

### What DOES Work? ✅

#### 1. Workflow API (Execution)

```javascript
// Start a workflow
var workflow = new Workflow();
var flowID = 'workflow_sys_id'; // From wf_workflow table
workflow.startFlow(flowID, current, current.operation());

// Cancel workflow
workflow.cancel(current);

// Restart workflow
workflow.restartWorkflow(current);
```

**Use Case:** Execute pre-existing workflows programmatically

#### 2. Export/Import via Update Sets

**Best Practice Approach:**

```javascript
// 1. Create workflow in UI (Workflow Editor)
// 2. Publish workflow (creates sys_update_xml record)
// 3. Update set captures entire workflow structure
// 4. Export update set as XML
// 5. Import XML into target instances
```

**Why This Works:**
- Publishing creates `sys_update_xml` record with complete workflow
- Includes all activities, stages, transitions
- Validated by ServiceNow
- Version controlled

#### 3. Trigger via Record State

**Common Pattern:**

```javascript
// Workflow has condition: state = 'new'
// Via REST API, set state to trigger workflow
POST /api/now/table/incident
{
  "short_description": "Test",
  "state": "1"  // Triggers workflow
}
```

### Workflow XML Structure Example

```xml
<workflow name="Approval Workflow">
  <activities>
    <activity type="approval">
      <name>Manager Approval</name>
      <assigned_to>user_sys_id</assigned_to>
      <transitions>
        <transition condition="approved" to="activity_2"/>
        <transition condition="rejected" to="activity_end"/>
      </transitions>
    </activity>
    <activity type="task">
      <name>Create Task</name>
      <!-- Complex nested structure -->
    </activity>
  </activities>
  <stages>
    <!-- Stage definitions -->
  </stages>
</workflow>
```

**Problem:** Structure is complex, version-dependent, undocumented for programmatic creation.

---

## Deep Dive: Flow Designer

### What Is It?

Modern no-code automation platform (replaced Workflow). Uses flow canvas with actions, conditions, logic blocks.

### Tables Involved

15+ interconnected tables:
- `sys_hub_flow` - Flow definitions
- `sys_hub_flow_logic` - Flow logic
- `sys_hub_flow_logic_definition` - Action definitions
- `sys_hub_action_instance` - Action instances
- `sys_hub_step_instance` - Step configurations
- `sys_hub_flow_variable` - Variables
- `sys_hub_flow_input` / `sys_hub_flow_output` - I/O
- Plus 8+ more supporting tables

### Can We Create Flows via API? ❌

**Absolutely not viable:**

1. **No REST API exists**
2. **Complex JSON structure** across 15+ tables:
   ```json
   {
     "actionInstances": {
       "action_id_1": {
         "type": "create_record",
         "inputs": {...},
         "next": "action_id_2"
       }
     },
     "flowLogicInstances": {
       "if_1": {
         "condition": {...},
         "then": "action_1",
         "else": "action_2"
       }
     }
   }
   ```
3. **Undocumented structure** - Proprietary format
4. **No validation** - Malformed flows accepted but won't run
5. **Version-dependent** - Changes between ServiceNow releases

### What DOES Work? ✅

#### 1. FlowAPI (Execution)

```javascript
// Execute a flow
var inputs = {
  current: current,
  table_name: 'incident'
};
sn_fd.FlowAPI.executeFlow('global.my_flow', inputs);

// Execute subflow
var outputs = sn_fd.FlowAPI.executeSubflow('global.my_subflow', inputs);
```

**Use Case:** Execute pre-existing flows programmatically

#### 2. REST-Triggered Flows

**Best Approach for External Triggering:**

```javascript
// 1. Create flow in Flow Designer UI
// 2. Set trigger type: "REST API"
// 3. Configure inputs/outputs
// 4. Publish flow

// 5. Trigger via REST
POST /api/now/processflow/flow/{flow_sys_id}
{
  "inputs": {
    "incident_number": "INC0001234",
    "priority": 2
  }
}
```

**Advantages:**
- Proper REST endpoint
- Input/output validation
- ServiceNow-managed

#### 3. Export/Import via Update Sets

**Same as Workflow:**

```javascript
// 1. Create flow in Flow Designer UI
// 2. Create new update set
// 3. Copy flow to capture it in update set
// 4. Export update set as XML
// 5. Import XML into target instances
```

---

## Comparison Matrix

### Creation Methods

| Method | Workflow | Flow Designer | Viability |
|--------|----------|---------------|-----------|
| **REST API POST** | ❌ No endpoint | ❌ No endpoint | Not possible |
| **Background Script** | ⚠️ Possible (complex) | ❌ Too complex | Not practical |
| **UI + Export XML** | ✅ Works | ✅ Works | ✅ Recommended |
| **Template Cloning** | ⚠️ Possible via script | ❌ Very complex | Not recommended |

### Execution Methods

| Method | Workflow | Flow Designer | Use Case |
|--------|----------|---------------|----------|
| **API Execution** | ✅ Workflow API | ✅ FlowAPI | Trigger existing automation |
| **REST Trigger** | ⚠️ Indirect | ✅ Direct | External system integration |
| **Record State** | ✅ Yes | ✅ Yes | Event-driven automation |
| **Scheduled** | ✅ Yes | ✅ Yes | Recurring tasks |

### Feature Comparison

| Feature | Workflow | Flow Designer |
|---------|----------|---------------|
| **Learning Curve** | Steep | Moderate |
| **Visual Designer** | Basic | Modern |
| **Integration Hub** | ❌ No | ✅ Yes |
| **Subflows** | ❌ No | ✅ Yes |
| **Debugging** | Limited | Better |
| **Error Handling** | Basic | Advanced |
| **Active Development** | ❌ Legacy | ✅ Active |
| **ServiceNow Recommendation** | Phase out | Use this |

---

## Recommendations for MCP Tool Development

### ❌ Do NOT Build: Creation Tools

**Why:**
- Neither platform supports programmatic creation
- Structure too complex and undocumented
- High risk of breaking changes
- Maintenance nightmare

### ✅ DO Build: Execution Tools

#### SN-Execute-Workflow
```javascript
{
  workflow_sys_id: 'abc123',
  record_sys_id: 'def456',
  table: 'incident'
}
```

**Implementation:**
```javascript
var workflow = new Workflow();
workflow.startFlow(workflow_sys_id, record, 'insert');
```

#### SN-Execute-Flow
```javascript
{
  flow_sys_id: 'abc123',
  inputs: {
    incident_number: 'INC001',
    priority: 2
  }
}
```

**Implementation:**
```javascript
// For REST-triggered flows
POST /api/now/processflow/flow/{flow_sys_id}

// For server-side execution
sn_fd.FlowAPI.executeFlow(flow_sys_id, inputs);
```

#### SN-List-Workflows / SN-List-Flows
```javascript
// List available workflows
GET /api/now/table/wf_workflow?sysparm_query=active=true

// List available flows
GET /api/now/table/sys_hub_flow?sysparm_query=active=true
```

#### SN-Cancel-Workflow
```javascript
var workflow = new Workflow();
workflow.cancel(record);
```

---

## Alternative: Business Rules + Script Actions

### Consider This Instead

If you need programmatic automation creation, consider simpler alternatives:

#### 1. Business Rules

**Can be created via REST API:**
```javascript
POST /api/now/table/sys_script
{
  "name": "Auto-assign Incident",
  "table": "incident",
  "when": "after",
  "insert": true,
  "script": "current.assigned_to = '...'; current.update();"
}
```

**Advantages:**
- ✅ Simple REST API creation
- ✅ Direct GlideRecord control
- ✅ Well-documented
- ✅ Easy to test

**Limitations:**
- ❌ No visual flow
- ❌ No approval workflows
- ❌ Limited error handling

#### 2. Scheduled Jobs

**Can be created via REST API:**
```javascript
POST /api/now/table/sysauto_script
{
  "name": "Daily Cleanup",
  "script": "// Your script",
  "run_dayofweek": "1,2,3,4,5",
  "run_time": "02:00:00"
}
```

#### 3. Script Actions

**Lightweight automation:**
```javascript
POST /api/now/table/sysevent_script_action
{
  "name": "Process Incident",
  "event_name": "incident.created",
  "script": "// Handle event"
}
```

---

## Recommended Approach: Hybrid Strategy

### For New Automation Needs

1. **Simple Logic** → Business Rules (via REST API)
2. **Complex Logic** → Flow Designer (create in UI, export XML)
3. **Approvals** → Flow Designer (create in UI, export XML)
4. **External Triggers** → Flow Designer with REST trigger
5. **Execution** → FlowAPI / Workflow API (via background scripts)

### For MCP Server

**Implement These Tools:**

✅ **Execution Tools:**
- `SN-Execute-Workflow` - Execute existing workflows
- `SN-Execute-Flow` - Execute REST-triggered flows
- `SN-Cancel-Workflow` - Cancel running workflows
- `SN-List-Workflows` - List available workflows
- `SN-List-Flows` - List available flows

✅ **Creation Tools (Simple):**
- `SN-Create-Business-Rule` - Create business rules via REST API
- `SN-Create-Scheduled-Job` - Create scheduled scripts
- `SN-Create-Script-Action` - Create event-driven scripts

❌ **Do NOT Implement:**
- `SN-Create-Workflow` - Not viable
- `SN-Create-Flow` - Not viable

### XML Template Strategy

**For complex automations:**

1. Create template workflows/flows in UI
2. Export as XML via update sets
3. Store XML templates in version control
4. Use MCP tool to apply templates:
   ```javascript
   SN-Import-Update-Set-XML({
     xml_file_path: '/templates/approval_workflow.xml',
     replace_variables: {
       'APPROVAL_GROUP': 'sys_id_here',
       'TABLE_NAME': 'incident'
     }
   });
   ```

---

## Conclusion

**Q: Can we create workflows/flows programmatically?**
**A: No - not practically.**

**Q: Should we use Workflow or Flow Designer?**
**A: Flow Designer - it's the current standard.**

**Q: What CAN we do programmatically?**
**A: Execute existing workflows/flows + create simple Business Rules**

**Best Practice:**
1. Create complex automations in UI
2. Export as XML templates
3. Import templates programmatically
4. Execute via API/FlowAPI
5. Use Business Rules for simple logic

This hybrid approach gives you:
- ✅ Visual flow design (ServiceNow UI)
- ✅ Version control (XML templates)
- ✅ Programmatic deployment (XML import)
- ✅ Programmatic execution (API)
- ✅ Simple logic automation (Business Rules via REST API)

---

## Resources

- **Workflow API Docs:** ServiceNow Docs → Workflow → API Reference
- **FlowAPI Docs:** ServiceNow Docs → Flow Designer → API Access
- **Update Sets:** ServiceNow Docs → Platform Administration → Export/Import XML
- **Business Rules:** `/api/now/table/sys_script`
- **Related Docs:**
  - `/docs/FLOW_DESIGNER_LIMITATIONS.md`
  - `/docs/BACKGROUND_SCRIPT_EXECUTION.md`