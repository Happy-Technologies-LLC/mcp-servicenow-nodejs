# ServiceNow MCP Convenience Tools

## Overview

Convenience tools provide a better user experience by accepting human-readable identifiers (like incident numbers) instead of technical sys_ids. These tools are wrappers around the generic `SN-Update-Record` tool with built-in validation and user/group resolution.

**Total Convenience Tools Added:** 10
**New Total MCP Tools:** 44 (up from 34)

---

## Incident Convenience Tools (5)

### SN-Add-Comment
Add a customer-visible comment to an incident.

**Parameters:**
- `incident_number` (required): Incident number (e.g., "INC0012345")
- `comment` (required): Comment text to add
- `instance` (optional): Instance name

**Example:**
```javascript
SN-Add-Comment({
  incident_number: "INC0012345",
  comment: "Issue has been identified and fix is being deployed"
})
```

**Returns:**
- Incident number and sys_id
- Comment text
- Timestamp of update
- Confirmation message

---

### SN-Add-Work-Notes
Add internal work notes to an incident (not visible to customer).

**Parameters:**
- `incident_number` (required): Incident number (e.g., "INC0012345")
- `work_notes` (required): Work notes text to add
- `instance` (optional): Instance name

**Example:**
```javascript
SN-Add-Work-Notes({
  incident_number: "INC0012345",
  work_notes: "Restarted application server, issue resolved"
})
```

**Returns:**
- Incident number and sys_id
- Work notes text
- Timestamp of update
- Confirmation message

---

### SN-Assign-Incident
Assign an incident to a user and/or group. Automatically resolves user names to sys_ids.

**Parameters:**
- `incident_number` (required): Incident number (e.g., "INC0012345")
- `assigned_to` (required): User name or sys_id to assign to
- `assignment_group` (optional): Assignment group name or sys_id
- `instance` (optional): Instance name

**Features:**
- Accepts user name or sys_id for `assigned_to`
- Accepts group name or sys_id for `assignment_group`
- Automatically resolves names to sys_ids
- Validates user/group exists before assignment

**Example:**
```javascript
SN-Assign-Incident({
  incident_number: "INC0012345",
  assigned_to: "John Smith",  // Or sys_id
  assignment_group: "Network Support"  // Or sys_id
})
```

**Returns:**
- Incident number and sys_id
- Assigned user (with display value)
- Assignment group (with display value)
- Timestamp of update
- Confirmation message

---

### SN-Resolve-Incident
Resolve an incident with resolution notes and optional resolution code.

**Parameters:**
- `incident_number` (required): Incident number (e.g., "INC0012345")
- `resolution_notes` (required): Resolution notes describing the fix
- `resolution_code` (optional): Resolution code (e.g., "Solved (Permanently)")
- `instance` (optional): Instance name

**Example:**
```javascript
SN-Resolve-Incident({
  incident_number: "INC0012345",
  resolution_notes: "Application server restarted, service restored",
  resolution_code: "Solved (Permanently)"
})
```

**State Change:** Sets state to 6 (Resolved)

**Returns:**
- Incident number and sys_id
- State value (6)
- Resolution notes
- Resolution code (if provided)
- Timestamp of update
- Confirmation message

---

### SN-Close-Incident
Close an incident with close notes and optional close code.

**Parameters:**
- `incident_number` (required): Incident number (e.g., "INC0012345")
- `close_notes` (required): Close notes
- `close_code` (optional): Close code (e.g., "Solved (Work Around)")
- `instance` (optional): Instance name

**Example:**
```javascript
SN-Close-Incident({
  incident_number: "INC0012345",
  close_notes: "Incident resolved, customer confirmed fix",
  close_code: "Solved (Permanently)"
})
```

**State Change:** Sets state to 7 (Closed)

**Returns:**
- Incident number and sys_id
- State value (7)
- Close notes
- Close code (if provided)
- Timestamp of update
- Confirmation message

---

## Change Request Convenience Tools (3)

### SN-Add-Change-Comment
Add a comment to a change request.

**Parameters:**
- `change_number` (required): Change request number (e.g., "CHG0012345")
- `comment` (required): Comment text to add
- `instance` (optional): Instance name

**Example:**
```javascript
SN-Add-Change-Comment({
  change_number: "CHG0012345",
  comment: "Change implementation completed successfully"
})
```

**Returns:**
- Change request number and sys_id
- Comment text
- Timestamp of update
- Confirmation message

---

### SN-Assign-Change
Assign a change request to a user and/or group.

**Parameters:**
- `change_number` (required): Change request number (e.g., "CHG0012345")
- `assigned_to` (required): User name or sys_id to assign to
- `assignment_group` (optional): Assignment group name or sys_id
- `instance` (optional): Instance name

**Features:**
- Accepts user name or sys_id for `assigned_to`
- Accepts group name or sys_id for `assignment_group`
- Automatically resolves names to sys_ids
- Validates user/group exists before assignment

**Example:**
```javascript
SN-Assign-Change({
  change_number: "CHG0012345",
  assigned_to: "Jane Doe",
  assignment_group: "Change Management"
})
```

**Returns:**
- Change request number and sys_id
- Assigned user (with display value)
- Assignment group (with display value)
- Timestamp of update
- Confirmation message

---

### SN-Approve-Change
Approve a change request.

**Parameters:**
- `change_number` (required): Change request number (e.g., "CHG0012345")
- `approval_comments` (optional): Comments for the approval
- `instance` (optional): Instance name

**Example:**
```javascript
SN-Approve-Change({
  change_number: "CHG0012345",
  approval_comments: "All requirements met, approved for implementation"
})
```

**Returns:**
- Change request number and sys_id
- Approval status (approved)
- Approval comments (if provided)
- Timestamp of update
- Confirmation message

---

## Problem Convenience Tools (2)

### SN-Add-Problem-Comment
Add a comment to a problem record.

**Parameters:**
- `problem_number` (required): Problem number (e.g., "PRB0012345")
- `comment` (required): Comment text to add
- `instance` (optional): Instance name

**Example:**
```javascript
SN-Add-Problem-Comment({
  problem_number: "PRB0012345",
  comment: "Root cause identified: memory leak in application"
})
```

**Returns:**
- Problem number and sys_id
- Comment text
- Timestamp of update
- Confirmation message

---

### SN-Close-Problem
Close a problem with resolution information.

**Parameters:**
- `problem_number` (required): Problem number (e.g., "PRB0012345")
- `resolution_notes` (required): Resolution notes
- `resolution_code` (optional): Resolution code
- `instance` (optional): Instance name

**Example:**
```javascript
SN-Close-Problem({
  problem_number: "PRB0012345",
  resolution_notes: "Memory leak fixed in application version 2.1",
  resolution_code: "Permanent Fix"
})
```

**State Change:** Sets state to 3 (Resolved/Closed)

**Returns:**
- Problem number and sys_id
- State value (3)
- Resolution notes
- Resolution code (if provided)
- Timestamp of update
- Confirmation message

---

## Implementation Details

### Architecture

All convenience tools follow a common pattern:

1. **Lookup by Number**: Query the table using the human-readable number
   ```javascript
   const records = await serviceNowClient.getRecords('incident', {
     sysparm_query: `number=${incident_number}`,
     sysparm_limit: 1
   });
   ```

2. **Validation**: Check if record exists
   ```javascript
   if (!records || records.length === 0) {
     throw new Error(`Incident ${incident_number} not found`);
   }
   ```

3. **User/Group Resolution**: For assignment tools, resolve names to sys_ids
   ```javascript
   // Check if input is already a sys_id (32 char hex)
   if (!/^[0-9a-f]{32}$/i.test(assigned_to)) {
     // Look up user by name
     const users = await serviceNowClient.getRecords('sys_user', {
       sysparm_query: `name=${assigned_to}^ORuser_name=${assigned_to}`,
       sysparm_limit: 1
     });
     assignedToId = users[0].sys_id;
   }
   ```

4. **Update Record**: Use generic SN-Update-Record under the hood
   ```javascript
   const result = await serviceNowClient.updateRecord('incident', sys_id, data);
   ```

5. **Friendly Response**: Return human-readable confirmation
   ```javascript
   return {
     content: [{
       type: 'text',
       text: `✅ ${incident_number} assigned successfully

       Incident: ${incident_number}
       sys_id: ${sys_id}
       Assigned To: ${user_display_value}
       Updated: ${timestamp}`
     }]
   };
   ```

### Error Handling

All tools include comprehensive error handling:

- **Record Not Found**: Clear error message with record number
- **User Not Found**: Validation before assignment
- **Group Not Found**: Validation before assignment
- **API Errors**: Propagated from underlying ServiceNow client

### Multi-Instance Support

All convenience tools support the optional `instance` parameter for routing to specific ServiceNow instances:

```javascript
SN-Add-Comment({
  incident_number: "INC0012345",
  comment: "Test comment",
  instance: "dev"  // Routes to dev instance
})
```

---

## Benefits vs Generic Tools

### Before (Generic Tool)
```javascript
// Step 1: Look up incident
SN-Query-Table({
  table_name: "incident",
  query: "number=INC0012345",
  limit: 1
})

// Step 2: Extract sys_id from response
// sys_id: abc123def456...

// Step 3: Update record
SN-Update-Record({
  table_name: "incident",
  sys_id: "abc123def456...",
  data: { comments: "This is a comment" }
})
```

### After (Convenience Tool)
```javascript
// One call, no sys_id needed
SN-Add-Comment({
  incident_number: "INC0012345",
  comment: "This is a comment"
})
```

**Advantages:**
- 66% fewer tool calls (1 vs 3)
- No need to extract sys_ids from responses
- Clear intent in tool name
- User/group name resolution built-in
- Better error messages
- Validation included

---

## Testing

### Test Scenarios

1. **Add Comment**
   - Valid incident number → Success
   - Invalid incident number → Error "Incident not found"

2. **Assign Incident**
   - User by name → Resolves to sys_id, assigns
   - User by sys_id → Direct assignment
   - Invalid user → Error "User not found"
   - Group by name → Resolves to sys_id, assigns
   - Invalid group → Error "Group not found"

3. **State Transitions**
   - Resolve incident → State changes to 6
   - Close incident → State changes to 7
   - Close problem → State changes to 3

4. **Multi-Instance**
   - Default instance → Uses config default
   - Specific instance → Routes to specified instance

---

## Usage Examples

### Complete Incident Workflow

```javascript
// 1. List open incidents
SN-List-Incidents({ state: "1", limit: 10 })

// 2. Add work notes
SN-Add-Work-Notes({
  incident_number: "INC0012345",
  work_notes: "Investigating root cause"
})

// 3. Assign to engineer
SN-Assign-Incident({
  incident_number: "INC0012345",
  assigned_to: "John Smith",
  assignment_group: "Network Support"
})

// 4. Add customer comment
SN-Add-Comment({
  incident_number: "INC0012345",
  comment: "We are working on a fix"
})

// 5. Resolve when fixed
SN-Resolve-Incident({
  incident_number: "INC0012345",
  resolution_notes: "Network configuration corrected",
  resolution_code: "Solved (Permanently)"
})

// 6. Close after confirmation
SN-Close-Incident({
  incident_number: "INC0012345",
  close_notes: "Customer confirmed resolution",
  close_code: "Solved (Permanently)"
})
```

### Change Management Workflow

```javascript
// 1. List pending changes
SN-List-ChangeRequests({ state: "Pending Approval", limit: 10 })

// 2. Assign for review
SN-Assign-Change({
  change_number: "CHG0012345",
  assigned_to: "Jane Doe",
  assignment_group: "Change Advisory Board"
})

// 3. Add review comment
SN-Add-Change-Comment({
  change_number: "CHG0012345",
  comment: "Technical review completed, no issues found"
})

// 4. Approve change
SN-Approve-Change({
  change_number: "CHG0012345",
  approval_comments: "Approved for implementation on 2025-10-10"
})
```

### Problem Management Workflow

```javascript
// 1. List active problems
SN-List-Problems({ state: "Open", limit: 10 })

// 2. Add analysis comment
SN-Add-Problem-Comment({
  problem_number: "PRB0012345",
  comment: "Root cause: memory leak in v1.0 application"
})

// 3. Close when resolved
SN-Close-Problem({
  problem_number: "PRB0012345",
  resolution_notes: "Upgraded to v2.0 with memory leak fix",
  resolution_code: "Permanent Fix"
})
```

---

## Future Enhancements

Potential additional convenience tools:

1. **SN-Reopen-Incident** - Reopen a closed incident
2. **SN-Escalate-Incident** - Escalate priority and notify management
3. **SN-Link-Incidents** - Link related incidents (parent/child)
4. **SN-Schedule-Change** - Schedule change with start/end times
5. **SN-Add-Task** - Add task to incident/change/problem
6. **SN-Attach-File** - Attach file to record
7. **SN-Subscribe** - Subscribe user to record updates
8. **SN-Merge-Incidents** - Merge duplicate incidents

---

## Comparison: Generic vs Convenience Tools

| Feature | Generic Tools | Convenience Tools |
|---------|--------------|-------------------|
| **Record Lookup** | Manual (SN-Query-Table) | Automatic (by number) |
| **sys_id Handling** | Required | Hidden |
| **User Resolution** | Manual lookup | Automatic |
| **Group Resolution** | Manual lookup | Automatic |
| **Validation** | Manual | Built-in |
| **Error Messages** | Generic | Context-specific |
| **Tool Calls** | 2-3 per operation | 1 per operation |
| **Intent Clarity** | Low ("Update Record") | High ("Resolve Incident") |
| **Learning Curve** | High | Low |

---

## Tool Count Summary

**Before:**
- Total MCP Tools: 34

**After:**
- Incident Tools: 5
- Change Request Tools: 3
- Problem Tools: 2
- **Total New Tools: 10**
- **Total MCP Tools: 44**

**Tool Categories:**
- Generic CRUD: 6 tools (Query, Create, Get, Update, Schema, List Tables)
- Update Set Management: 6 tools
- Workflow Tools: 4 tools
- Batch Operations: 2 tools
- ITSM Convenience: 10 tools (NEW)
- Other Specialized: 16 tools

---

## Documentation

- **API Reference**: `/docs/API_REFERENCE.md` (update in progress)
- **Setup Guide**: `/docs/SETUP_GUIDE.md`
- **This Guide**: `/docs/CONVENIENCE_TOOLS.md`

---

## Conclusion

The convenience tools dramatically improve the user experience for common ITSM operations by:

1. **Hiding Technical Complexity**: No need to work with sys_ids
2. **Reducing Tool Calls**: 66% fewer calls per operation
3. **Better Intent Communication**: Tool names clearly indicate purpose
4. **Automatic Resolution**: User and group names automatically resolved
5. **Built-in Validation**: Error handling and record existence checks
6. **Human-Friendly Responses**: Clear confirmation messages with context

These tools make ServiceNow operations accessible to users who may not be familiar with ServiceNow's internal data model while still leveraging the powerful generic tools under the hood.
