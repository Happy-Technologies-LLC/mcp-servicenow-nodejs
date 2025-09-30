# Testing Recommendations for ServiceNow MCP Server

**Created:** 2025-09-29
**Purpose:** Document what needs testing and what requires your ServiceNow instance research

---

## ✅ Changes Implemented (Need Testing)

### 1. **API Fallback for Table Schema** ✨ NEW
**Location:** `src/mcp-server-consolidated.js:748-802`

**What Changed:**
- `SN-Get-Table-Schema` now falls back to live API when table not in local metadata
- Uses `serviceNowClient.discoverTableSchema()` to fetch from ServiceNow
- Returns fields, labels, and type info dynamically

**Testing Needed:**
```javascript
// Test with a table NOT in comprehensive-table-definitions.json
mcp__servicenow-nodejs__SN-Get-Table-Schema({
  table_name: "u_custom_table_not_in_metadata"
})
```

**Expected Result:**
- Should fetch schema from ServiceNow API
- Should show: `"source": "live_api"`
- Should display all fields with types and labels

**Failure Scenario:**
- If table doesn't exist: Should provide clear error message
- Should NOT crash the server

---

### 2. **Fixed SN-Set-Update-Set Implementation**
**Location:** `src/servicenow-client.js:50-79`

**What Changed:**
- Now uses background script approach with `gs.setUpdateSet()`
- Falls back to manual instructions if script execution fails
- No longer uses broken `/api/now/ui/preferences` endpoint

**Testing Needed:**
```javascript
// 1. Create an update set first
const updateSet = await mcp__servicenow-nodejs__SN-Create-Record({
  table_name: "sys_update_set",
  data: {
    name: "Test Update Set via MCP",
    description: "Testing set update functionality"
  }
});

// 2. Try to set it as current
await mcp__servicenow-nodejs__SN-Set-Update-Set({
  update_set_sys_id: updateSet.sys_id
});

// 3. Verify it worked
await mcp__servicenow-nodejs__SN-Get-Current-Update-Set();
```

**Expected Result:**
- Update set should be set as current
- Verify in ServiceNow UI: System Update Sets → Current update set name matches

**Failure Scenario:**
- If it fails, error should suggest manual UI method
- Should NOT throw 400 error silently

---

### 3. **Fixed SN-Get-Record Query Parameters**
**Location:** `src/servicenow-client.js:29-40`

**What Changed:**
- Now properly passes `sysparm_fields`, `sysparm_display_value`, etc.
- Fixed URL construction to append query params correctly

**Testing Needed:**
```javascript
// Test field filtering
const incident = await mcp__servicenow-nodejs__SN-Get-Record({
  table_name: "incident",
  sys_id: "YOUR_INCIDENT_SYS_ID",
  fields: "number,short_description,state"
});

// Should only return those 3 fields, not all fields
console.log(Object.keys(incident)); // Should be: ['number', 'short_description', 'state', 'sys_id']
```

**Expected Result:**
- Should only return requested fields
- Response should be smaller/faster

---

## ⚠️ CRITICAL: Background Script API Endpoint Research Required

### **Issue:** Unknown Correct Endpoint

**Current Implementation:** `src/servicenow-client.js:378-409`
```javascript
// Using: POST /api/now/ui/script
```

**Research Findings:**
- **No official documentation found** for `/api/now/ui/script` endpoint
- ServiceNow community suggests using **Scripted REST APIs** instead
- Direct script execution via REST API is **discouraged for security reasons**
- Alternatives mentioned:
  1. Custom Scripted REST API
  2. Processors with Script Includes
  3. SOAP-based script execution (legacy)

### **What You Need to Test:**

#### Test 1: Simple Script Execution
```javascript
const result = await mcp__servicenow-nodejs__SN-Execute-Background-Script({
  script: "gs.info('Test from MCP'); 'Success';"
});

// Check if it works and what it returns
console.log(result);
```

#### Test 2: Check ServiceNow System Logs
After running the script, check in ServiceNow:
- **System Logs → System Log → All**
- Look for: "Test from MCP" message
- Verify script actually executed

#### Test 3: Script with Return Value
```javascript
const result = await mcp__servicenow-nodejs__SN-Execute-Background-Script({
  script: `
var gr = new GlideRecord('incident');
gr.addQuery('active', true);
gr.query();
gr.getRowCount() + ' active incidents';
  `
});

// Should return count
console.log(result.output);
```

### **Alternative Endpoints to Research:**

Try these in your ServiceNow instance (via Postman or curl):

1. **`POST /api/now/table/sys_script_execution`**
   ```json
   {
     "script": "gs.info('test'); 'success';",
     "scope": "global"
   }
   ```

2. **`POST /sys.evalScript`** (mentioned in some forums)
   ```json
   {
     "script": "gs.info('test');"
   }
   ```

3. **Create Custom Scripted REST API** (Most Recommended)
   - Navigate to: System Web Services → Scripted REST APIs
   - Create endpoint: `/api/x_custom/script_runner/run`
   - Resource script:
   ```javascript
   (function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {
       var script = request.body.data.script;
       var result = new GlideScopedEvaluator().evaluateScript(script, 'script');
       return { output: result };
   })(request, response);
   ```

---

## 🔍 What You Should Investigate

### 1. **Background Script Endpoint Verification**
**Priority:** HIGH
**Why:** Current endpoint may not work or may require specific permissions

**Steps:**
1. Open ServiceNow Developer Tools (Network tab)
2. Navigate to: System Definition → Scripts - Background
3. Run a simple script: `gs.info('test');`
4. Watch network requests
5. **Find the actual endpoint used by ServiceNow UI**

**Look for:**
- URL: `/api/...` or `/sys...`
- Request payload format
- Response format
- Required headers

### 2. **Update Set API Verification**
**Priority:** MEDIUM
**Why:** Current implementation uses script execution as workaround

**Steps:**
1. Test if `SN-Set-Update-Set` actually works
2. Check System Logs for errors
3. Verify update set changes in UI
4. If it fails, document the exact error

### 3. **Catalog UI Policy Action Fields**
**Priority:** LOW (Already documented in limitations)
**Why:** Known to fail via REST API

**Already Handled:**
- Warning added to tool descriptions
- Error messages guide to workarounds
- No testing needed (documented limitation)

---

## 📋 Testing Checklist

### Before Production Use:
- [ ] Test `SN-Get-Table-Schema` with custom table not in metadata
- [ ] Test `SN-Set-Update-Set` end-to-end
- [ ] Test `SN-Get-Record` with field filtering
- [ ] Verify background script API endpoint works
- [ ] Document actual endpoint if different
- [ ] Test script execution with 50+ line script
- [ ] Test script execution with 200+ line script (should fail gracefully)

### ServiceNow Instance Research:
- [ ] Identify actual background script REST endpoint
- [ ] Test alternative endpoints (sys.evalScript, etc.)
- [ ] Check permissions required for script execution
- [ ] Verify update set API behavior
- [ ] Document any instance-specific configuration needs

---

## 🎯 Recommended Next Steps

1. **Immediate:** Test the API fallback for table schema
2. **High Priority:** Research correct background script endpoint
3. **Medium Priority:** Test update set functionality
4. **Nice to Have:** Create custom Scripted REST API for script execution

---

## 📝 Notes from Limitations Document

From `/Users/nczitzer/ServiceNowDevelopment/docs/MCP_Tool_Limitations.md`:

### Known Working (95%+ success):
- ✅ Create records (most tables)
- ✅ Update records (most tables)
- ✅ Query/list operations
- ✅ Table schema discovery (now with API fallback!)

### Known Limitations (Cannot Fix):
- ❌ `catalog_ui_policy_action` fields (ui_policy, catalog_variable)
- ❌ Table creation via REST API
- ❌ Flow Designer workflows
- ⚠️ Background scripts > 100 lines
- ⚠️ Update set context switching (unreliable)

### What We Fixed:
- ✅ Better error messages for failures
- ✅ API fallback for unknown tables
- ✅ Alternative approach for update sets
- ✅ Proper query param handling

---

**Questions to Answer:**
1. Does `/api/now/ui/script` actually exist in your ServiceNow instance?
2. If yes, what format does it expect and return?
3. If no, what's the correct alternative?
4. Are there permissions required beyond basic API access?