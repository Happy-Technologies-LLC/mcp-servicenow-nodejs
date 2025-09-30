# 403 Forbidden Error Troubleshooting Guide

**Last Updated:** 2025-09-29

---

## Issue: sys_dictionary 403 Errors

### Symptoms
- REST API calls to create `sys_dictionary` records return 403 Forbidden
- Error message: "User Not Authorized" or "Failed ACL Validation"
- Previously working operations now fail

### Root Causes

1. **Missing ACL Permissions**
   - System tables like `sys_dictionary` require special permissions
   - CREATE operations need explicit ACL grants
   - Standard API roles don't include system table create permissions

2. **ServiceNow Version Changes**
   - ACL permissions may change between versions
   - Security hardening in newer versions
   - Default roles may have been restricted

3. **Role Changes**
   - API user's roles may have been modified
   - Organization security policy changes
   - ACL modifications by admins

---

## Quick Diagnosis

### Step 1: Test with Admin User
```bash
# Try the same operation with admin credentials
# If it works → Permission issue
# If it fails → Different problem (API issue, table doesn't exist, etc.)
```

### Step 2: Check System Logs
```
Navigate to: System Logs → REST
Filter: Your API username
Look for: ACL validation failures
```

### Step 3: Check User Roles
```
Navigate to: User Administration → Users → [Your API User]
Verify roles include:
- web_service_admin (for REST API access)
- rest_api_explorer (for Table API)
- personalize_dictionary (for sys_dictionary access)
```

---

## Solutions

### Solution 1: Grant personalize_dictionary Role ⚡ FASTEST

**When to Use:** Development/testing environments, trusted users

**Steps:**
1. Navigate to: `User Administration → Users`
2. Search for your API user
3. Click on the user
4. Under "Roles" tab, click "Edit"
5. Add role: `personalize_dictionary`
6. Click "Save"

**⚠️ Warning:** This grants FULL read/write access to dictionary tables

**Test:**
```bash
# Test API call
curl -X POST https://your-instance.service-now.com/api/now/table/sys_dictionary \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic <your-base64-creds>" \
  -d '{
    "name": "test_table",
    "element": "test_field",
    "column_label": "Test Field",
    "internal_type": "string",
    "max_length": 40
  }'
```

---

### Solution 2: Create Custom ACL 🔒 RECOMMENDED

**When to Use:** Production environments, principle of least privilege

**Steps:**

#### A. Create Custom Role
1. Navigate to: `User Administration → Roles`
2. Click "New"
3. Set:
   - **Name:** `x_custom_dictionary_api`
   - **Description:** "API access for dictionary operations"
4. Click "Submit"

#### B. Create ACL for CREATE Operation
1. **Elevate to security_admin:**
   - Click your name (top right)
   - Select "Elevate Role"
   - Choose "security_admin"
   - Enter password

2. **Navigate to:** `System Security → Access Control (ACL)`
3. **Click "New"**
4. **Set:**
   - **Type:** record
   - **Operation:** create
   - **Name:** sys_dictionary
   - **Description:** "Allow custom role to create dictionary entries"
   - **Active:** true
5. **Under "Requires role" tab:**
   - Add role: `x_custom_dictionary_api`
6. **Click "Submit"**

#### C. Assign Role to API User
1. Navigate to: `User Administration → Users`
2. Find your API user
3. Add role: `x_custom_dictionary_api`
4. Save

#### D. Test
```bash
# Test the same API call as above
# Should now succeed
```

---

### Solution 3: Use Fix Script 📝 WORKAROUND

**When to Use:** Cannot modify ACLs, temporary solution, one-off operations

**Steps:**

1. **Generate fix script using MCP:**
```javascript
await mcp__servicenow_nodejs__SN_Create_Fix_Script({
  script_name: "create_dictionary_entries",
  description: "Create dictionary entries for custom table",
  script_content: `
// Dictionary entries to create
var entries = [
  {
    name: 'u_custom_table',
    element: 'u_field1',
    column_label: 'Field 1',
    internal_type: 'string',
    max_length: 40
  },
  {
    name: 'u_custom_table',
    element: 'u_field2',
    column_label: 'Field 2',
    internal_type: 'integer'
  }
];

entries.forEach(function(entry) {
  var gr = new GlideRecord('sys_dictionary');
  gr.initialize();
  gr.name = entry.name;
  gr.element = entry.element;
  gr.column_label = entry.column_label;
  gr.internal_type = entry.internal_type;
  if (entry.max_length) gr.max_length = entry.max_length;

  var sysId = gr.insert();
  if (sysId) {
    gs.info('✅ Created dictionary entry: ' + entry.name + '.' + entry.element + ' (' + sysId + ')');
  } else {
    gs.error('❌ Failed to create: ' + entry.name + '.' + entry.element);
  }
});

gs.info('Dictionary creation complete');
  `,
  auto_delete: true
});
```

2. **Run the script:**
   - Open file from `/scripts/` directory
   - Copy entire content
   - Navigate to ServiceNow: `System Definition → Scripts - Background`
   - Paste and click "Run script"
   - Verify output shows success messages

---

## Verification

### Confirm ACL is Working
```bash
# 1. Test CREATE operation
curl -X POST https://your-instance.service-now.com/api/now/table/sys_dictionary \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic <creds>" \
  -d '{"name":"test_table","element":"test_field","internal_type":"string"}'

# Should return 201 Created with sys_id

# 2. Test READ operation
curl -X GET https://your-instance.service-now.com/api/now/table/sys_dictionary?sysparm_limit=1 \
  -H "Authorization: Basic <creds>"

# Should return dictionary records

# 3. Test UPDATE operation
curl -X PUT https://your-instance.service-now.com/api/now/table/sys_dictionary/<sys_id> \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic <creds>" \
  -d '{"column_label":"Updated Label"}'

# Should return updated record
```

---

## Related System Tables

If you're getting 403s on other system tables, apply the same solutions:

| Table | Required Role | Purpose |
|-------|--------------|---------|
| `sys_dictionary` | personalize_dictionary | Field definitions |
| `sys_db_object` | personalize_dictionary | Table definitions |
| `sys_choice` | admin | Choice list values |
| `sys_glide_object` | admin | Data type definitions |
| `sys_ui_policy` | admin | UI policy definitions |
| `sys_script` | admin | Business rules |
| `sys_properties` | admin | System properties |

---

## Prevention

### For Development
- Use dedicated API user with appropriate roles
- Document required roles in your integration docs
- Test permission changes in sub-production first

### For Production
- Use custom roles with minimal permissions
- Regular ACL audits
- Monitor system logs for permission failures
- Document all custom ACLs

---

## Still Getting 403?

### Additional Checks

1. **IP Restrictions:**
   - Check: `System Security → IP Address Access Control`
   - Verify your IP is allowed

2. **Field-Level ACLs:**
   - Some fields may have separate ACLs
   - Check: `System Security → Access Control (ACL)` → Filter by table and field

3. **Table-Level ACLs:**
   - The table itself may be restricted
   - Check for `sys_dictionary` and `sys_dictionary.*` ACLs

4. **Update Set Context:**
   - Some operations require active update set
   - Create/set an update set first

5. **Application Scope:**
   - Global vs scoped applications
   - Check if table requires specific scope

---

## Quick Reference: MCP Tools

### Check Permissions
```javascript
// Query existing ACLs for sys_dictionary
await mcp__servicenow_nodejs__SN_Query_Table({
  table_name: "sys_security_acl",
  query: "name=sys_dictionary",
  fields: "operation,roles,description"
});
```

### Check User Roles
```javascript
// Get roles for API user
await mcp__servicenow_nodejs__SN_Query_Table({
  table_name: "sys_user_has_role",
  query: "user.user_name=YOUR_API_USER",
  fields: "role.name,role.description"
});
```

### Create Dictionary Entry (if permissions work)
```javascript
await mcp__servicenow_nodejs__SN_Create_Record({
  table_name: "sys_dictionary",
  data: {
    name: "u_custom_table",
    element: "u_custom_field",
    column_label: "Custom Field",
    internal_type: "string",
    max_length: 100
  }
});
```

---

## Contact & Resources

- **ServiceNow Community:** https://www.servicenow.com/community/
- **ACL Documentation:** Search "Access Control Rules" in ServiceNow docs
- **Your Instance Docs:** https://your-instance.service-now.com/nav_to.do?uri=sys_security_acl_list.do