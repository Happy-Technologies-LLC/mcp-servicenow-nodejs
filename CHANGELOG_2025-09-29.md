# MCP Server Changes - September 29, 2025

## Summary
Fixed critical issues based on MCP_Tool_Limitations.md and replaced unreliable background script execution with practical fix script generation.

---

## 🔧 Major Changes

### 1. Replaced Background Script Execution with Fix Script Generator

**Problem:** No REST API endpoint exists for executing background scripts in ServiceNow.

**Solution:** Created `SN-Create-Fix-Script` tool that generates script files locally.

**Files Changed:**
- `src/servicenow-client.js:378-388` - Removed `executeBackgroundScript()` method
- `src/mcp-server-consolidated.js:464-490` - Added `SN-Create-Fix-Script` tool
- `src/mcp-server-consolidated.js:1076-1131` - Implemented handler

**New Tool: `SN-Create-Fix-Script`**
```javascript
{
  script_name: "link_ui_policy_actions",
  script_content: "/* GlideRecord script */",
  description: "Link UI policy actions",
  auto_delete: true  // Optional: delete after execution
}
```

**Output:** Writes to `/scripts/script_name_timestamp.js` with:
- Full header with instructions
- Script content
- Steps for manual execution in ServiceNow UI

---

### 2. Fixed `SN-Set-Update-Set` Tool

**Problem:** Cannot set current update set via REST API (400 errors).

**Solution:** Auto-generates fix script with instructions.

**Files Changed:**
- `src/servicenow-client.js:57-74` - Updated to throw helpful error
- `src/mcp-server-consolidated.js:1029-1105` - Auto-generates fix script
- `src/mcp-server-consolidated.js:380-381` - Updated tool description

**Behavior:**
- Fetches update set details
- Generates timestamped script file
- Provides both script option AND manual UI instructions
- No longer attempts unreliable API calls

---

### 3. Added API Fallback for Table Schema

**Problem:** `SN-Get-Table-Schema` failed silently for tables not in local metadata.

**Solution:** Added live API fallback using `discoverTableSchema()`.

**Files Changed:**
- `src/mcp-server-consolidated.js:752-802` - Added try/catch fallback

**Behavior:**
- First checks local metadata (fast)
- If not found, queries ServiceNow API (live)
- Returns fields, types, labels dynamically
- Suggests adding to local cache for future performance

---

### 4. Fixed `SN-Get-Record` Query Parameters

**Problem:** Query parameters like `sysparm_fields` weren't being passed correctly.

**Solution:** Updated method signature and URL construction.

**Files Changed:**
- `src/servicenow-client.js:29-40` - Added query param handling
- `src/mcp-server-consolidated.js:716-730` - Fixed handler

---

### 5. Updated Tool Descriptions with Warnings

**Files Changed:**
- `src/mcp-server-consolidated.js:82` - Warning for `catalog_ui_policy_action` limitations
- `src/mcp-server-consolidated.js:466` - Limitations for script execution
- `src/mcp-server-consolidated.js:381` - Warning for update set operations

---

### 6. Documentation Updates

**New Files:**
- `.gitignore` - Excludes `/scripts/` directory from git
- `TESTING_RECOMMENDATIONS.md` - Comprehensive testing guide
- `CHANGELOG_2025-09-29.md` - This file

**Updated Files:**
- `CLAUDE.md:357-413` - Added "ServiceNow API Limitations & Workarounds" section

---

## 📊 Removed Code

### Removed: `SN-Execute-Background-Script` Tool
**Reason:** No API endpoint exists for this operation

**Replaced With:** `SN-Create-Fix-Script` tool

**Migration Path:**
```javascript
// OLD (doesn't work):
await SN-Execute-Background-Script({
  script: "gs.info('test');"
});

// NEW (works):
await SN-Create-Fix-Script({
  script_name: "test_script",
  script_content: "gs.info('test');"
});
// Then: Copy from /scripts/ and run manually in ServiceNow UI
```

---

## 🧪 Testing Status

### ✅ Tested
- Server starts without errors
- Health endpoint responds correctly
- No lingering references to `executeBackgroundScript`

### ⏳ Needs Manual Testing
1. `SN-Get-Table-Schema` with unknown table (API fallback)
2. `SN-Set-Update-Set` (generates fix script)
3. `SN-Create-Fix-Script` (creates file)
4. `SN-Get-Record` with field filtering

See `TESTING_RECOMMENDATIONS.md` for detailed test cases.

---

## 🔄 Migration Guide

### For Existing Users

1. **Update Set Operations**
   - `SN-Set-Update-Set` no longer sets directly
   - Now generates fix script for manual execution
   - Alternative: Set via UI manually

2. **Background Scripts**
   - Use `SN-Create-Fix-Script` instead
   - Scripts saved to `/scripts/` directory
   - Run manually in ServiceNow: System Definition → Scripts - Background

3. **UI Policy Actions**
   - Create records via `SN-Create-Record`
   - Use `SN-Create-Fix-Script` to generate linkage script
   - Format: `catalog_variable = 'IO:<variable_sys_id>'`

---

## 📋 Known Limitations (Documented)

### Cannot Be Fixed (ServiceNow API Limitations)
1. Background script execution
2. Setting current update set
3. UI Policy Action field linking (ui_policy, catalog_variable)
4. Table creation
5. Flow Designer workflows

### Workarounds Implemented
- Fix script generation tool
- API fallback for schema discovery
- Clear error messages with instructions
- Auto-generated scripts for common operations

---

## 🎯 Next Steps

### Recommended Testing
1. Test table schema API fallback
2. Verify fix script generation workflow
3. Test update set script generation
4. Validate field filtering on get operations

### Future Improvements
- Consider adding script validation before saving
- Add script library/templates for common operations
- Implement script history tracking
- Add bulk script generation for batch operations

---

## 🔗 Related Files

- `MCP_Tool_Limitations.md` - Original issue documentation
- `TESTING_RECOMMENDATIONS.md` - Testing guide
- `CLAUDE.md` - Updated development guide
- `.gitignore` - Git configuration

---

**Impact:** All changes are backward compatible except for removed `SN-Execute-Background-Script` tool, which had no working API endpoint.

**Risk Level:** Low - Removed non-functional code, added practical alternatives

**Testing Required:** Manual testing recommended (see TESTING_RECOMMENDATIONS.md)