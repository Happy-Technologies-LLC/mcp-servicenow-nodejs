# Flow Designer Best Practices Guide

**Version:** 1.0
**Date:** 2025-10-06
**Audience:** Developers using ServiceNow MCP Server

---

## Overview

Flow Designer is ServiceNow's no-code/low-code automation platform. While powerful through the UI, flow creation **cannot be fully automated** via REST API. This guide provides best practices for working with Flow Designer in an MCP-enabled environment.

---

## Table of Contents

1. [When to Use Flow Designer](#when-to-use-flow-designer)
2. [Flow Designer vs Workflow](#flow-designer-vs-workflow)
3. [Creating Flows](#creating-flows)
4. [Executing Flows](#executing-flows)
5. [Flow Templates](#flow-templates)
6. [Deployment Strategy](#deployment-strategy)
7. [Testing Flows](#testing-flows)
8. [Best Practices](#best-practices)

---

## When to Use Flow Designer

### Use Flow Designer For:

✅ **Complex Business Logic**
- Multi-step approval processes
- Conditional branching with multiple paths
- Integration with external systems
- Data transformation and enrichment

✅ **No-Code/Low-Code Requirements**
- Business analysts creating automation
- Rapid prototyping without scripting
- Visual process documentation

✅ **Modern ServiceNow Features**
- Integration Hub spokes
- Flow Designer-specific actions
- REST API callouts
- Natural language processing

---

### Use Workflows Instead For:

⚡ **Simple Linear Processes**
- Basic approval chains
- Sequential notifications
- Simple data updates

⚡ **Programmatic Creation**
- Automated workflow generation
- Template-based workflows
- MCP-driven automation

**See:** `docs/research/WORKFLOW_VS_FLOW_DESIGNER.md` for detailed comparison

---

## Flow Designer vs Workflow

| Feature | Flow Designer | Workflow |
|---------|--------------|----------|
| **Creation** | ❌ UI only | ✅ Programmatic via MCP |
| **Execution** | ✅ FlowAPI | ✅ Workflow API |
| **Visual Design** | ✅ Modern UI | ⚠️ Legacy UI |
| **Integration Hub** | ✅ Native support | ❌ Limited |
| **No-Code** | ✅ Excellent | ⚠️ Basic |
| **Performance** | ✅ Fast | ✅ Fast |
| **MCP Automation** | ⚠️ Execution only | ✅ Full automation |

**Recommendation:** Use Flow Designer for complex user-facing automation, use Workflows for programmatic automation.

---

## Creating Flows

### Manual Creation (Required)

**Steps:**
1. Navigate to **Flow Designer** in ServiceNow
2. Click **New** → **Flow**
3. Define flow properties:
   - **Name:** Descriptive name (e.g., "Auto-Assign High Priority Incidents")
   - **Application:** Choose application scope
   - **Description:** Document purpose and behavior
4. Select **Trigger:**
   - **Record Created/Updated:** React to table changes
   - **Scheduled:** Run at intervals
   - **Application Event:** React to custom events
   - **REST API:** Enable REST API execution (MCP-friendly!)
5. Add **Actions:**
   - **Create Record**
   - **Update Record**
   - **Send Notification**
   - **Script Step** (for custom logic)
   - **Integration Hub Actions** (external APIs)
6. Add **Flow Logic:**
   - **If/Else** conditions
   - **Switch** (multiple branches)
   - **Wait** (delays)
   - **Loop** (iterate over records)
7. Test flow with **Test** button
8. **Activate** flow when ready

---

### REST API Trigger (MCP-Friendly)

For flows that need to be executed via MCP, use **REST API trigger**:

**Configuration:**
```
1. Flow Designer → New Flow
2. Trigger: REST API
3. Define Inputs:
   - incident_number (String)
   - priority (Integer)
   - category (String)
4. Define Outputs:
   - result (String)
   - sys_id (String)
   - error_message (String)
5. Build flow logic
6. Activate flow
```

**Execution via MCP:**
```javascript
// Execute REST-triggered flow
const result = await SN-Execute-Background-Script({
  script: `
    var inputs = {
      incident_number: 'INC0012345',
      priority: 1,
      category: 'hardware'
    };
    var outputs = sn_fd.FlowAPI.executeFlow('your_flow_sys_id', inputs);
    gs.print(JSON.stringify(outputs));
  `,
  description: "Execute auto-assign flow"
});
```

**Why This Works:**
- ✅ Flow created once in UI (manual)
- ✅ Flow executed programmatically via MCP (automated)
- ✅ Inputs/outputs clearly defined
- ✅ Testable and reusable

---

## Executing Flows

### Method 1: FlowAPI (Server-Side)

**Use Case:** Execute flows from background scripts, business rules, or scheduled jobs

**Implementation:**
```javascript
// Background script via MCP
await SN-Execute-Background-Script({
  script: `
    // Define inputs
    var inputs = {
      incident_sys_id: 'abc123...',
      assignment_group: 'IT Support'
    };

    // Execute flow
    var outputs = sn_fd.FlowAPI.executeFlow('flow_sys_id_here', inputs);

    // Log results
    gs.info('Flow executed: ' + JSON.stringify(outputs));
  `,
  description: "Execute incident assignment flow"
});
```

**Get Flow sys_id:**
```javascript
// Query sys_hub_flow table
await SN-Query-Table({
  table_name: 'sys_hub_flow',
  query: 'name=Auto-Assign Incidents',
  fields: 'sys_id,name,description'
});
```

---

### Method 2: REST API Trigger

**Use Case:** Execute flows from external systems or MCP

**Prerequisites:**
- Flow must have **REST API trigger**
- Flow must be **activated**

**Endpoint:**
```
POST /api/now/processflow/flow/{flow_sys_id}
```

**Request:**
```json
{
  "inputs": {
    "incident_number": "INC0012345",
    "priority": 1
  }
}
```

**Response:**
```json
{
  "result": {
    "outputs": {
      "result": "success",
      "assigned_to": "John Smith",
      "sys_id": "abc123..."
    },
    "status": "completed"
  }
}
```

**MCP Implementation:**
```javascript
// NOTE: Not yet implemented in MCP server
// Future tool: SN-Execute-Flow
await SN-Execute-Flow({
  flow_sys_id: 'abc123...',
  inputs: {
    incident_number: 'INC0012345',
    priority: 1
  }
});
```

---

### Method 3: Subflow Execution

**Use Case:** Execute reusable subflows from parent flows or scripts

**Subflow Design:**
- No trigger (executed programmatically)
- Well-defined inputs and outputs
- Reusable logic

**Execution:**
```javascript
await SN-Execute-Background-Script({
  script: `
    var inputs = { table: 'incident', sys_id: 'abc123...' };
    var outputs = sn_fd.FlowAPI.executeSubflow('subflow_sys_id', inputs);
    gs.print('Subflow result: ' + outputs.result);
  `
});
```

---

## Flow Templates

### Common Flow Patterns

ServiceNow MCP Server provides flow templates in `/templates/flows/`:

#### 1. Auto-Assignment Flow

**Purpose:** Automatically assign records based on criteria

**Use Case:**
- Assign incidents to groups based on category
- Assign changes to approval groups
- Round-robin assignment

**Template:** `templates/flows/auto-assign-incident.xml`

**Configuration:**
1. Import template via update set
2. Customize assignment rules in flow
3. Activate flow

---

#### 2. Notification Flow

**Purpose:** Send notifications on record events

**Use Case:**
- Email on high-priority incident creation
- Slack notification on critical alerts
- Teams notification on approval needed

**Template:** `templates/flows/notification-on-create.xml`

**Configuration:**
1. Import template
2. Configure notification recipients
3. Customize message template
4. Activate flow

---

#### 3. Multi-Stage Approval Flow

**Purpose:** Complex approval workflows with multiple stages

**Use Case:**
- Change approval (CAB → Manager → Director)
- Purchase requisition approval
- Access request approval

**Template:** `templates/flows/change-approval.xml`

**Configuration:**
1. Import template
2. Define approval stages
3. Configure approval criteria
4. Set timeout/escalation rules
5. Activate flow

---

#### 4. SLA Escalation Flow

**Purpose:** Escalate records when SLA breaches

**Use Case:**
- Escalate overdue incidents
- Notify management on SLA breach
- Auto-prioritize at-risk tickets

**Template:** `templates/flows/sla-escalation.xml`

**Configuration:**
1. Import template
2. Define SLA thresholds
3. Configure escalation actions
4. Set escalation recipients
5. Activate flow

---

## Deployment Strategy

### Development Workflow

```
┌─────────────────────────────────────────────────┐
│  1. CREATE FLOW IN DEV                          │
│     • Flow Designer UI                          │
│     • Test with sample data                     │
│     • Document inputs/outputs                   │
└─────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────┐
│  2. CAPTURE IN UPDATE SET                       │
│     • SN-Set-Update-Set via MCP                 │
│     • Flow automatically captured               │
│     • Verify with SN-Inspect-Update-Set         │
└─────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────┐
│  3. EXPORT UPDATE SET                           │
│     • Navigate to Update Sets                   │
│     • Mark as Complete                          │
│     • Export to XML                             │
│     • Store in version control                  │
└─────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────┐
│  4. IMPORT TO TEST                              │
│     • Navigate to Retrieved Update Sets         │
│     • Import XML                                │
│     • Preview                                   │
│     • Commit                                    │
└─────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────┐
│  5. TEST IN TEST ENVIRONMENT                    │
│     • Execute via FlowAPI                       │
│     • Verify outputs                            │
│     • Check error handling                      │
│     • Performance test                          │
└─────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────┐
│  6. PROMOTE TO PRODUCTION                       │
│     • Import update set to PROD                 │
│     • Preview and commit                        │
│     • Activate flow                             │
│     • Monitor execution                         │
└─────────────────────────────────────────────────┘
```

---

### MCP-Assisted Deployment

**Automated Steps (via MCP):**

```javascript
// 1. Set update set in DEV
await SN-Set-Update-Set({
  update_set_sys_id: 'dev_update_set_id',
  instance: 'dev'
});

// 2. Create flow manually in UI (cannot be automated)
// ... manual work in Flow Designer UI ...

// 3. Verify flow captured in update set
const updateSetContents = await SN-Inspect-Update-Set({
  update_set: 'dev_update_set_id',
  show_components: true,
  instance: 'dev'
});

// 4. Export update set (manual: UI → Export XML)

// 5. Import to TEST (manual: Retrieved Update Sets → Import)

// 6. Verify flow imported
const testFlow = await SN-Query-Table({
  table_name: 'sys_hub_flow',
  query: 'name=My Flow Name',
  instance: 'test'
});

// 7. Test flow execution
await SN-Execute-Background-Script({
  script: `
    var inputs = { test: 'data' };
    var outputs = sn_fd.FlowAPI.executeFlow('${testFlow.sys_id}', inputs);
    gs.info('Test result: ' + JSON.stringify(outputs));
  `,
  instance: 'test'
});

// 8. Promote to PROD (repeat import steps)
```

---

## Testing Flows

### Test Strategy

#### Unit Testing (Flow Designer)

**Built-in Test Runner:**
1. Open flow in Flow Designer
2. Click **Test** button
3. Provide test inputs
4. Verify outputs
5. Check execution log

**Best Practices:**
- Test happy path
- Test error conditions
- Test edge cases (null values, empty strings)
- Test with real production-like data

---

#### Integration Testing (ATF)

**Automated Test Framework (ATF):**

While ATF test creation is UI-only, you can execute tests via MCP:

```javascript
// Execute ATF test suite
await SN-Execute-Background-Script({
  script: `
    var testRunner = new sn_atf.TestRunner();
    var result = testRunner.runTest('test_sys_id_here');
    gs.info('Test result: ' + result.getStatus());
  `
});
```

**ATF Test Coverage:**
- Flow triggers correctly
- Inputs processed correctly
- Outputs match expectations
- Error handling works
- Performance meets SLAs

---

#### Smoke Testing (Production)

**Post-Deployment Verification:**

```javascript
// Smoke test in production
await SN-Execute-Background-Script({
  script: `
    // Execute flow with known-good data
    var inputs = { test_mode: true, incident_number: 'INC0000001' };
    var outputs = sn_fd.FlowAPI.executeFlow('flow_sys_id', inputs);

    // Verify expected output
    if (outputs.result === 'success') {
      gs.info('✅ Smoke test passed');
    } else {
      gs.error('❌ Smoke test failed: ' + outputs.error);
    }
  `,
  instance: 'prod'
});
```

---

## Best Practices

### Design Principles

#### 1. Single Responsibility

**Bad:**
```
Flow: "Process Incident"
├── Assign incident
├── Send notification
├── Create change request
├── Update CMDB
└── Generate report
```

**Good:**
```
Flow: "Auto-Assign Incident"
└── Assign incident based on category

Flow: "Notify on Assignment"
└── Send notification to assignee

Flow: "Create Related Change"
└── Create change request from incident
```

**Why:** Smaller flows are easier to test, debug, and reuse

---

#### 2. Clear Input/Output Contracts

**Bad:**
```javascript
// Ambiguous inputs
inputs: {
  data: "some data",
  flag: true,
  stuff: { ... }
}
```

**Good:**
```javascript
// Well-defined inputs
inputs: {
  incident_sys_id: "abc123...",          // Required, sys_id format
  assignment_group: "IT Support",         // Required, group name
  priority_override: 2,                   // Optional, 1-5
  skip_notification: false                // Optional, boolean
}

outputs: {
  result: "success",                      // "success" or "error"
  assigned_to: "john.smith",              // User ID
  sys_id: "def456...",                    // Updated record sys_id
  error_message: null                     // Error details if result="error"
}
```

**Why:** Clear contracts make flows easier to integrate and debug

---

#### 3. Comprehensive Error Handling

**Pattern:**
```
Flow Start
    ↓
Try: Execute Logic
    ↓
Success? → Set output: result="success"
    ↓
Error? → Catch Error
    ↓
    Log Error
    ↓
    Set output: result="error", error_message="..."
    ↓
Flow End
```

**Implementation:**
- Use **If** condition to check for errors
- Set output variables for both success and error paths
- Log errors to system log
- Return meaningful error messages
- Don't fail silently

---

#### 4. Idempotency

**Principle:** Flow can be safely re-executed without unintended side effects

**Example: Assign Incident**
```javascript
// BAD: Always assigns (creates duplicates on retry)
current.assignment_group = 'IT Support';
current.update();

// GOOD: Only assigns if not already assigned
if (current.assignment_group.nil()) {
  current.assignment_group = 'IT Support';
  current.update();
}
```

**Why:** Flows may be retried on errors, timeouts, or manual re-execution

---

#### 5. Performance Optimization

**Tips:**
- ✅ Minimize database queries (use inputs instead of lookups)
- ✅ Batch operations when possible
- ✅ Use indexes on queried fields
- ✅ Avoid loops with large datasets
- ✅ Set reasonable timeouts

**Performance Targets:**
- Simple flows: <1 second
- Complex flows: <5 seconds
- Flows with external APIs: <10 seconds

**Monitoring:**
```javascript
// Check flow execution time
await SN-Query-Table({
  table_name: 'sys_flow_context',
  query: 'flow=abc123...^ORDERBYDESCsys_created_on',
  fields: 'state,duration,sys_created_on',
  limit: 10
});
```

---

#### 6. Logging and Observability

**Log Important Events:**
```javascript
// In Script Step action
gs.info('Flow started for incident: ' + inputs.incident_number);

// On error
gs.error('Flow failed: ' + error.message);

// On success
gs.info('Flow completed: assigned to ' + outputs.assigned_to);
```

**Monitor Flow Execution:**
```javascript
// Query flow execution history
await SN-Query-Table({
  table_name: 'sys_flow_context',
  query: 'flow.name=My Flow^state=failed',
  fields: 'sys_id,state,error_message,sys_created_on',
  limit: 10
});
```

---

#### 7. Version Control

**Update Set Management:**

```javascript
// Create update set for flow development
const updateSet = await SN-Create-Record({
  table_name: 'sys_update_set',
  data: {
    name: 'Auto-Assign Flow v2.0',
    description: 'Enhanced auto-assignment logic with category-based routing',
    state: 'in progress'
  }
});

// Set as current
await SN-Set-Update-Set({
  update_set_sys_id: updateSet.sys_id
});

// Make flow changes in UI

// Export update set and commit to git
// Store in: git/update-sets/auto-assign-v2.0.xml
```

**Git Repository Structure:**
```
/repo
├── update-sets/
│   ├── auto-assign-v1.0.xml
│   ├── auto-assign-v2.0.xml
│   └── notification-flow-v1.0.xml
├── flow-docs/
│   ├── auto-assign-flow.md
│   └── notification-flow.md
└── test-data/
    ├── auto-assign-test-inputs.json
    └── notification-test-inputs.json
```

---

## Common Patterns

### Pattern 1: Conditional Assignment

**Use Case:** Assign records to different groups based on criteria

**Flow Structure:**
```
Trigger: Incident Created
    ↓
If: category = "hardware"
    → Assign to "Hardware Support"
Else If: category = "software"
    → Assign to "Software Support"
Else If: category = "network"
    → Assign to "Network Team"
Else
    → Assign to "General Support"
```

**MCP Execution:**
```javascript
await SN-Execute-Background-Script({
  script: `
    var inputs = { incident_sys_id: 'abc123...' };
    var outputs = sn_fd.FlowAPI.executeFlow('conditional_assign_flow_id', inputs);
    gs.info('Assigned to: ' + outputs.assignment_group);
  `
});
```

---

### Pattern 2: Approval Chain

**Use Case:** Multi-stage approval process

**Flow Structure:**
```
Trigger: Change Request Created
    ↓
Stage 1: Submit for CAB Approval
    ↓
Wait: CAB Approval
    ↓
Approved? → Stage 2: Submit to Manager
    ↓
Wait: Manager Approval
    ↓
Approved? → Stage 3: Submit to Director
    ↓
Wait: Director Approval
    ↓
Approved? → Change to "Approved" state
Rejected? → Change to "Rejected" state
```

---

### Pattern 3: Integration with External System

**Use Case:** Call external REST API from flow

**Flow Structure:**
```
Trigger: Incident Created
    ↓
Action: REST API Call
    URL: https://external-api.com/tickets
    Method: POST
    Body: { incident: current.number }
    ↓
Parse Response
    ↓
Update Incident with External Ticket ID
```

**Integration Hub:** Use spoke actions for common integrations (Slack, Teams, Jira, etc.)

---

## Troubleshooting

### Common Issues

#### Issue 1: Flow Not Triggering

**Symptoms:**
- Flow exists and is active
- Trigger condition met
- Flow doesn't execute

**Causes:**
- Flow not activated
- Trigger condition incorrect
- Application scope mismatch
- User lacks permissions

**Debug Steps:**
```javascript
// 1. Verify flow is active
await SN-Get-Record({
  table_name: 'sys_hub_flow',
  sys_id: 'flow_sys_id',
  fields: 'name,active,application'
});

// 2. Check recent executions
await SN-Query-Table({
  table_name: 'sys_flow_context',
  query: 'flow=flow_sys_id^ORDERBYDESCsys_created_on',
  fields: 'state,error_message,sys_created_on',
  limit: 10
});

// 3. Check system logs
// Navigate to: System Logs → System Log → All
// Filter: Source = "Flow Designer"
```

---

#### Issue 2: Flow Execution Failed

**Symptoms:**
- Flow triggers but fails mid-execution
- Error message in flow context

**Debug:**
```javascript
// Get flow context with error
await SN-Query-Table({
  table_name: 'sys_flow_context',
  query: 'flow=flow_sys_id^state=failed',
  fields: 'sys_id,state,error_message,stage',
  limit: 1
});

// Get execution details
await SN-Get-Record({
  table_name: 'sys_flow_context',
  sys_id: 'context_sys_id',
  fields: 'error_message,stage,state,data'
});
```

**Common Errors:**
- Null reference (check input data)
- Permission error (check user ACLs)
- Timeout (optimize flow performance)
- API limit exceeded (add retry logic)

---

#### Issue 3: Slow Flow Performance

**Symptoms:**
- Flow takes >10 seconds
- Timeouts in production

**Optimization:**
```javascript
// Profile flow execution
await SN-Query-Table({
  table_name: 'sys_flow_context',
  query: 'flow=flow_sys_id^ORDERBYDESCduration',
  fields: 'sys_id,duration,stage',
  limit: 10
});

// Identify slow stages
// Optimize database queries
// Reduce external API calls
// Add caching where possible
```

---

## Migration from Workflow

### When to Migrate

**Consider Migration When:**
- ✅ Need modern UI and better user experience
- ✅ Want to use Integration Hub spokes
- ✅ Need complex branching logic
- ✅ Want better error handling

**Stay with Workflow When:**
- ✅ Workflow works well and is stable
- ✅ Need programmatic creation (MCP automation)
- ✅ Simple linear processes
- ✅ Don't have time for migration effort

---

### Migration Process

**Steps:**
1. Document existing workflow logic
2. Create equivalent flow in Flow Designer
3. Test flow with production data
4. Run both workflow and flow in parallel (monitoring)
5. Disable workflow, activate flow
6. Monitor for issues
7. Remove old workflow when stable

**MCP Support:**
```javascript
// Disable old workflow
await SN-Update-Record({
  table_name: 'wf_workflow',
  sys_id: 'workflow_sys_id',
  data: { active: false }
});

// Activate new flow
await SN-Update-Record({
  table_name: 'sys_hub_flow',
  sys_id: 'flow_sys_id',
  data: { active: true }
});

// Monitor both
await SN-Query-Table({
  table_name: 'sys_flow_context',
  query: 'flow=flow_sys_id^sys_created_on>=javascript:gs.daysAgo(1)',
  fields: 'state,sys_created_on'
});
```

---

## Resources

**ServiceNow Documentation:**
- Flow Designer User Guide
- FlowAPI Reference
- Integration Hub Documentation

**MCP Documentation:**
- `/docs/API_REFERENCE.md` - MCP tool reference
- `/docs/research/FLOW_DESIGNER_LIMITATIONS.md` - Technical limitations
- `/docs/research/WORKFLOW_VS_FLOW_DESIGNER.md` - Comparison guide
- `/docs/UI_OPERATIONS_ARCHITECTURE.md` - Architecture decisions

**Templates:**
- `/templates/flows/auto-assign-incident.xml`
- `/templates/flows/notification-on-create.xml`
- `/templates/flows/change-approval.xml`
- `/templates/flows/sla-escalation.xml`

---

## Summary

**Key Takeaways:**

1. ✅ **Flow Designer creation is UI-only** (cannot be automated via MCP)
2. ✅ **Flow execution is fully automated** via FlowAPI and background scripts
3. ✅ **Use REST API triggers** for MCP-friendly flows
4. ✅ **Update sets handle deployment** across environments
5. ✅ **Templates accelerate development** for common patterns
6. ✅ **FlowAPI enables programmatic execution** from MCP

**Recommended Workflow:**
1. Create flows manually in UI (one-time effort)
2. Capture in update sets automatically (via MCP)
3. Export and version control update sets
4. Execute flows programmatically via FlowAPI (fully automated)
5. Monitor and optimize flow performance

**For Questions:**
- Check Flow Designer documentation
- Review flow templates in `/templates/flows/`
- Consult `docs/research/FLOW_DESIGNER_LIMITATIONS.md`
- Test in sub-production before deploying to prod

---

**END OF GUIDE**
