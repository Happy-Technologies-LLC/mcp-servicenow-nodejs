# Flow Designer MCP Tools - Feasibility Assessment

**Date:** 2025-09-30
**Status:** ✅ FEASIBLE with Limitations
**Tested By:** MCP ServiceNow Server v2.0

## Executive Summary

Building MCP tools for Flow Designer is **technically feasible** via REST API access to flow tables. Basic CRUD operations work successfully, but complete flow creation requires understanding complex table relationships and may not fully replicate the Flow Designer UI experience.

---

## Test Results

### ✅ What Works (REST API)

| Operation | Table | Status | Notes |
|-----------|-------|--------|-------|
| **Read Flows** | `sys_hub_flow`, `sys_hub_flow_base` | ✅ Working | Full access to all flow metadata |
| **Create Flows** | `sys_hub_flow`, `sys_hub_flow_base` | ✅ Working | Successfully created test flow |
| **Create Variables** | `sys_hub_flow_variable` | ✅ Working | Successfully created flow variables |
| **Create Stages** | `sys_hub_flow_stage` | ✅ Working | Successfully created flow stages |
| **Read Logic Definitions** | `sys_hub_flow_logic_definition` | ✅ Working | Access to If, For Each, Try, etc. |
| **Read Logic Instances** | `sys_hub_flow_logic` | ✅ Working | Can read existing flow logic |
| **Update Flows** | All flow tables | ✅ Working | Standard REST API updates |
| **Delete Flows** | All flow tables | ✅ Working | Via background script or REST |

### ⚠️ Limitations & Challenges

1. **Complex JSON Structures**
   - Logic blocks use nested JSON in `inputs`, `outputs_assigned`, `attributes` fields
   - No documented schema for these JSON structures
   - Reverse engineering required from existing flows

2. **UI-Specific Metadata**
   - Fields like `ui_id`, `parent_ui_id` used for Flow Designer canvas positioning
   - `connected_to` field defines flow logic connections (undocumented format)
   - `attributes` field contains serialized configuration (undocumented)

3. **Snapshot System**
   - Flows use `sys_hub_flow_snapshot` for versioning
   - Relationship between `master_snapshot`, `latest_snapshot` unclear
   - May require snapshot creation for flows to be editable in UI

4. **Compilation & Validation**
   - Flows require compilation (`pre_compiled`, `compiler_build` fields)
   - No REST API endpoint for triggering compilation
   - Invalid flows may not execute properly

5. **No Official Flow Creation API**
   - ServiceNow recommends using Flow Designer UI
   - Community discussions confirm no official programmatic creation API
   - FlowAPI only supports **executing** flows, not **creating** them

### ❌ What Doesn't Work

| Operation | Limitation | Workaround |
|-----------|-----------|------------|
| **Flow Compilation** | No REST API endpoint | Create flows in "draft" status, compile in UI |
| **Canvas Positioning** | No documentation for UI coordinates | Default positioning, manual adjustment in UI |
| **Complex Logic Validation** | No validation endpoint | Test flows manually after creation |
| **Snapshot Management** | Snapshot creation logic unclear | Let ServiceNow auto-create snapshots |

---

## Flow Designer Table Architecture

### Core Tables

```
sys_hub_flow_base (abstract parent)
├── sys_hub_flow (flows)
├── sys_hub_flow_snapshot (flow versions)
└── sys_hub_action_type_base (subflows/actions)

sys_hub_flow_logic (flow components)
├── References: sys_hub_flow_logic_definition (types: IF, FOREACH, etc.)
├── References: sys_hub_flow_block (block containers)
└── Contains: inputs, outputs, connections (JSON)

sys_hub_flow_variable (flow variables)
sys_hub_flow_stage (flow stages)
sys_hub_flow_input (flow inputs)
sys_hub_flow_output (flow outputs)
```

### Key Relationships

- **Flow → Logic**: One-to-many (flow contains multiple logic blocks)
- **Logic → Definition**: Many-to-one (logic instances reference type definitions)
- **Flow → Variables**: One-to-many (flow can have multiple variables)
- **Flow → Snapshots**: One-to-many (flow can have multiple versions)

---

## Recommended MCP Tool Set

### Tier 1: Core Tools (High Priority)

1. **SN-List-Flows**
   - List all flows with filtering (active, type, category)
   - Return: name, description, active, status, type, sys_id

2. **SN-Get-Flow**
   - Get complete flow details including variables, stages, logic
   - Return: Full flow structure as JSON

3. **SN-Create-Flow**
   - Create basic flow structure
   - Parameters: name, description, type (flow/subflow), access
   - Return: Flow sys_id for further configuration

4. **SN-Update-Flow**
   - Update flow metadata (name, description, active status)
   - Parameters: sys_id, fields to update

5. **SN-Delete-Flow**
   - Delete flow and related components
   - Parameters: sys_id

### Tier 2: Component Tools (Medium Priority)

6. **SN-Add-Flow-Variable**
   - Add variable to existing flow
   - Parameters: flow_sys_id, name, type, label

7. **SN-Add-Flow-Stage**
   - Add stage to existing flow
   - Parameters: flow_sys_id, label, value, order

8. **SN-Add-Flow-Input**
   - Add input parameter to flow
   - Parameters: flow_sys_id, name, type, mandatory

9. **SN-Add-Flow-Output**
   - Add output parameter to flow
   - Parameters: flow_sys_id, name, type

### Tier 3: Advanced Tools (Low Priority)

10. **SN-Clone-Flow**
    - Clone existing flow with all components
    - Parameters: source_sys_id, new_name

11. **SN-Export-Flow**
    - Export flow as JSON for backup/migration
    - Parameters: sys_id

12. **SN-Import-Flow**
    - Import flow from JSON
    - Parameters: flow_json

13. **SN-Execute-Flow** (Already possible via FlowAPI)
    - Execute existing flow programmatically
    - Parameters: flow_name, inputs

---

## Implementation Recommendations

### Phase 1: Basic CRUD (Weeks 1-2)
- Implement Tier 1 tools (List, Get, Create, Update, Delete)
- Focus on `sys_hub_flow_base` and `sys_hub_flow` tables
- Provide basic flow lifecycle management

### Phase 2: Component Management (Weeks 3-4)
- Implement Tier 2 tools (Variables, Stages, Inputs, Outputs)
- Test integration with Flow Designer UI
- Validate that MCP-created flows are editable in UI

### Phase 3: Advanced Features (Weeks 5-6)
- Implement Tier 3 tools (Clone, Export, Import)
- Add logic block creation (IF, FOREACH) if feasible
- Document limitations and workarounds

### Phase 4: Logic Block Creation (Optional)
- **Only if customer demand is high**
- Requires extensive reverse engineering
- Focus on most common blocks: IF, FOREACH, ACTION

---

## Risk Assessment

### Low Risk ✅
- Reading flows and components
- Creating basic flow structures
- Managing flow variables/stages
- Deleting flows

### Medium Risk ⚠️
- Creating flows that are editable in UI
- Setting correct default values for all fields
- Maintaining compatibility across ServiceNow versions

### High Risk ❌
- Creating complex logic blocks programmatically
- Managing flow snapshots correctly
- Ensuring flows compile and execute properly

---

## Alternative Approaches

### 1. Hybrid Approach (Recommended)
- Use MCP tools for basic flow scaffolding
- Complete complex logic in Flow Designer UI
- Use MCP for reading/listing/managing existing flows

### 2. Template-Based Approach
- Create flow templates in UI
- Clone and modify via MCP tools
- Reduces complexity, ensures UI compatibility

### 3. Export/Import Approach
- Export flows as Update Sets
- Modify XML programmatically
- Re-import to ServiceNow
- Highest compatibility, most complex

---

## Comparison with Workflows

| Feature | Workflows | Flows |
|---------|-----------|-------|
| **REST API Support** | ✅ Full (`wf_workflow`) | ⚠️ Partial (tables accessible) |
| **Programmatic Creation** | ✅ `SN-Create-Workflow` | ⚠️ Possible but complex |
| **UI Compatibility** | ✅ Excellent | ⚠️ Requires testing |
| **Official Documentation** | ✅ Available | ❌ Limited |
| **Community Support** | ✅ Strong | ⚠️ Growing |

**Verdict:** Workflows have better programmatic support, but Flows are the future of ServiceNow automation.

---

## Conclusion

### ✅ Proceed with Flow Designer MCP Tools

**Reasoning:**
1. Basic operations (CRUD) are fully functional
2. Customer demand for Flow automation is high
3. Tier 1 tools provide immediate value
4. Can expand to Tier 2/3 based on feedback

**Success Criteria:**
- Users can list and read flows via MCP
- Users can create basic flow structures
- Users can manage flow variables/stages
- MCP-created flows are editable in Flow Designer UI

**Not in Scope (Initially):**
- Creating complex logic blocks (IF, FOREACH with conditions)
- Full flow compilation/validation
- Advanced snapshot management
- Canvas positioning/UI layout

### Next Steps

1. ✅ Create `/src/mcp/tools/flows.js` with Tier 1 tools
2. ✅ Add flow-related tool registrations to MCP server
3. ✅ Write integration tests for flow operations
4. ✅ Document usage examples and limitations
5. ✅ Gather user feedback on Tier 1 tools
6. ⏳ Plan Tier 2 implementation based on demand

---

## Test Data

**Test Flows Created:**
- `sys_hub_flow_base`: d0b5ff69c39872101fcbbd43e40131d5 (MCP Test Flow)
- `sys_hub_flow`: 6ab5bf69c39872101fcbbd43e401315d (MCP Test Flow Extended)
- `sys_hub_flow_variable`: 78c577a9c39872101fcbbd43e401313f (Test Variable)
- `sys_hub_flow_stage`: c1c577a9c39872101fcbbd43e4013172 (Test Stage)

**Test Status:** ✅ All records created successfully via REST API
**Cleanup Status:** ✅ All test records deleted via background script

---

## References

- **Flow Tables:** `sys_hub_flow_*` (17 tables discovered)
- **Community Discussion:** [Create flow/subflow/action in Flow Designer using Scripts/API](https://www.servicenow.com/community/developer-forum/create-a-flow-subflow-action-in-flow-designer-using-scripts-api/m-p/2953398)
- **FlowAPI Documentation:** `sn_fd.FlowAPI.executeFlow()` (execution only)
- **Table Storage:** [Where Are Flow Designer Flows Stored?](https://www.ikconsulting.com/post/where-are-flow-designer-flows-subflows-and-actions-stored-in-servicenow)