/**
 * ServiceNow MCP Server - REST API Client
 *
 * Copyright (c) 2025 Happy Technologies LLC
 * Licensed under the MIT License - see LICENSE file for details
 */

import axios from 'axios';

export class ServiceNowClient {
  constructor(instanceUrl, username, password) {
    this.currentInstanceName = 'default';
    this.setInstance(instanceUrl, username, password);
    this.progressCallback = null; // Callback for progress notifications
  }

  /**
   * Set progress callback for notifications
   * @param {Function} callback - Function to call with progress updates
   */
  setProgressCallback(callback) {
    this.progressCallback = callback;
  }

  /**
   * Send progress notification
   * @param {string} message - Progress message
   */
  notifyProgress(message) {
    if (this.progressCallback) {
      this.progressCallback(message);
    }
  }

  /**
   * Switch to a different ServiceNow instance
   * @param {string} instanceUrl - Instance URL
   * @param {string} username - Username
   * @param {string} password - Password
   * @param {string} instanceName - Optional instance name for tracking
   */
  setInstance(instanceUrl, username, password, instanceName = null) {
    this.instanceUrl = instanceUrl.replace(/\/$/, ''); // Remove trailing slash
    this.auth = Buffer.from(`${username}:${password}`).toString('base64');

    if (instanceName) {
      this.currentInstanceName = instanceName;
    }

    this.client = axios.create({
      baseURL: this.instanceUrl,
      headers: {
        'Authorization': `Basic ${this.auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
  }

  /**
   * Get current instance information
   * @returns {object} Current instance details
   */
  getCurrentInstance() {
    return {
      name: this.currentInstanceName,
      url: this.instanceUrl
    };
  }

  // Generic table operations
  async getRecords(table, query = {}) {
    const params = new URLSearchParams();
    if (query.sysparm_query) params.append('sysparm_query', query.sysparm_query);
    if (query.sysparm_limit) params.append('sysparm_limit', query.sysparm_limit);
    if (query.sysparm_fields) params.append('sysparm_fields', query.sysparm_fields);

    const response = await this.client.get(`/api/now/table/${table}?${params}`);
    return response.data.result;
  }

  async getRecord(table, sysId, queryParams = {}) {
    const params = new URLSearchParams();
    if (queryParams.sysparm_fields) params.append('sysparm_fields', queryParams.sysparm_fields);
    if (queryParams.sysparm_display_value) params.append('sysparm_display_value', queryParams.sysparm_display_value);
    if (queryParams.sysparm_exclude_reference_link) params.append('sysparm_exclude_reference_link', queryParams.sysparm_exclude_reference_link);

    const queryString = params.toString();
    const url = queryString ? `/api/now/table/${table}/${sysId}?${queryString}` : `/api/now/table/${table}/${sysId}`;

    const response = await this.client.get(url);
    return response.data.result;
  }

  async createRecord(table, data) {
    const response = await this.client.post(`/api/now/table/${table}`, data);
    return response.data.result;
  }

  async updateRecord(table, sysId, data) {
    const response = await this.client.put(`/api/now/table/${table}/${sysId}`, data);
    return response.data.result;
  }

  async deleteRecord(table, sysId) {
    await this.client.delete(`/api/now/table/${table}/${sysId}`);
    return { success: true };
  }

  // Update set management via UI API endpoint
  async setCurrentUpdateSet(updateSetSysId) {
    try {
      // First, get the update set name
      const updateSet = await this.getRecord('sys_update_set', updateSetSysId);

      // Create axios client with UI session
      const axiosWithCookies = axios.create({
        baseURL: this.instanceUrl,
        headers: {
          'Authorization': `Basic ${this.auth}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'ServiceNow-MCP-Client/2.0'
        },
        withCredentials: true,
        maxRedirects: 5
      });

      // Establish session first
      await axiosWithCookies.get('/', {
        headers: { 'Accept': 'text/html' }
      });

      // Set the update set via UI API
      const response = await axiosWithCookies.put(
        '/api/now/ui/concoursepicker/updateset',
        {
          name: updateSet.name,
          sysId: updateSetSysId
        }
      );

      return {
        success: true,
        update_set: updateSet.name,
        sys_id: updateSetSysId,
        response: response.data
      };
    } catch (error) {
      // If UI API fails, fall back to sys_trigger method
      console.log('UI API failed, falling back to sys_trigger...');

      const updateSet = await this.getRecord('sys_update_set', updateSetSysId);
      const script = `// Update user preference for current update set
var updateSetId = '${updateSetSysId}';

// Delete existing preference
var delGR = new GlideRecord('sys_user_preference');
delGR.addQuery('user', gs.getUserID());
delGR.addQuery('name', 'sys_update_set');
delGR.query();
if (delGR.next()) {
  delGR.deleteRecord();
}

// Create new preference
var gr = new GlideRecord('sys_user_preference');
gr.initialize();
gr.user = gs.getUserID();
gr.name = 'sys_update_set';
gr.value = updateSetId;
gr.insert();

gs.info('✅ Update set changed to: ${updateSet.name}');`;

      const result = await this.executeScriptViaTrigger(script, `Set update set to: ${updateSet.name}`, true);
      return {
        success: true,
        update_set: updateSet.name,
        sys_id: updateSetSysId,
        method: 'sys_trigger',
        trigger_details: result
      };
    }
  }

  async getCurrentUpdateSet() {
    // Get the current update set preference
    const response = await this.client.get(`/api/now/ui/preferences/sys_update_set`);
    return response.data;
  }

  async listUpdateSets(query = {}) {
    // List available update sets
    return this.getRecords('sys_update_set', query);
  }

  async setCurrentApplication(appSysId) {
    const startTime = Date.now();

    try {
      // Validate input
      if (!appSysId) {
        throw new Error('app_sys_id is required');
      }

      // Validate sys_id format (32-character hex string)
      if (!/^[0-9a-f]{32}$/i.test(appSysId)) {
        throw new Error(`Invalid sys_id format: ${appSysId}. Must be a 32-character hexadecimal string.`);
      }

      // Get previous application scope (for rollback information)
      let previousScope = null;
      try {
        const prefResponse = await this.client.get('/api/now/ui/preferences/apps.current');
        if (prefResponse.data && prefResponse.data.result) {
          previousScope = {
            sys_id: prefResponse.data.result.value || null,
            name: prefResponse.data.result.display_value || null
          };
        }
      } catch (prefError) {
        // Previous scope query failed - not critical, continue
        console.log('Could not retrieve previous scope:', prefError.message);
      }

      // Get application details
      let app;
      try {
        app = await this.getRecord('sys_app', appSysId);
      } catch (appError) {
        if (appError.response && appError.response.status === 404) {
          throw new Error(`Application not found with sys_id: ${appSysId}. Please verify the sys_id is correct.`);
        }
        throw appError;
      }

      // Create axios client with cookie jar
      const axiosWithCookies = axios.create({
        baseURL: this.instanceUrl,
        headers: {
          'Authorization': `Basic ${this.auth}`,
          'Content-Type': 'application/json',
          'User-Agent': 'ServiceNow-MCP-Client/2.0'
        },
        withCredentials: true,
        maxRedirects: 5
      });

      // Establish session first
      await axiosWithCookies.get('/', {
        headers: { 'Accept': 'text/html' }
      });

      // Set the application via UI API
      const response = await axiosWithCookies.put(
        '/api/now/ui/concoursepicker/application',
        {
          app_id: appSysId
        }
      );

      // Verify the scope was set correctly
      let verified = false;
      let verificationError = null;
      try {
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait for preference to update
        const verifyResponse = await this.client.get('/api/now/ui/preferences/apps.current');
        if (verifyResponse.data && verifyResponse.data.result) {
          const currentAppId = verifyResponse.data.result.value;
          verified = (currentAppId === appSysId);
          if (!verified) {
            verificationError = `Verification failed: Current app is ${currentAppId}, expected ${appSysId}`;
          }
        }
      } catch (verifyError) {
        verificationError = `Verification query failed: ${verifyError.message}`;
      }

      const executionTime = Date.now() - startTime;

      const result = {
        success: true,
        application: app.name,
        scope: app.scope || 'global',
        sys_id: appSysId,
        previous_scope: previousScope,
        verified: verified,
        verification_error: verificationError,
        timestamp: new Date().toISOString(),
        execution_time_ms: executionTime,
        method: 'ui_api',
        endpoint: '/api/now/ui/concoursepicker/application',
        response: response.data
      };

      // Add warnings if applicable
      result.warnings = [];
      if (!verified) {
        result.warnings.push('Could not verify scope change - please check ServiceNow UI');
      }
      if (verificationError) {
        result.warnings.push(verificationError);
      }

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;

      // Enhanced error messages based on error type
      let errorMessage = error.message;

      if (error.response) {
        const status = error.response.status;
        if (status === 401) {
          errorMessage = 'Authentication failed. Please check your credentials.';
        } else if (status === 403) {
          errorMessage = `Access denied. Please verify:\n1. You have admin or developer role\n2. You have access to the application\n3. The application is active`;
        } else if (status === 404) {
          errorMessage = `Application not found with sys_id: ${appSysId}`;
        } else if (status >= 500) {
          errorMessage = `ServiceNow server error (${status}). Please try again later.`;
        }
      }

      console.error('Failed to set current application:', errorMessage);

      const enhancedError = new Error(`Failed to set current application: ${errorMessage}`);
      enhancedError.execution_time_ms = executionTime;
      enhancedError.app_sys_id = appSysId;
      enhancedError.original_error = error;

      throw enhancedError;
    }
  }

  // Incident-specific methods
  async getIncidents(query = {}) {
    return this.getRecords('incident', query);
  }

  async getIncidentByNumber(number) {
    const incidents = await this.getRecords('incident', {
      sysparm_query: `number=${number}`,
      sysparm_limit: 1
    });
    return incidents[0] || null;
  }

  async createIncident(data) {
    return this.createRecord('incident', data);
  }

  async updateIncident(sysId, data) {
    return this.updateRecord('incident', sysId, data);
  }

  // User management
  async getUsers(query = {}) {
    return this.getRecords('sys_user', query);
  }

  async createUser(data) {
    return this.createRecord('sys_user', data);
  }

  async updateUser(sysId, data) {
    return this.updateRecord('sys_user', sysId, data);
  }

  // Catalog items
  async getCatalogItems(query = {}) {
    return this.getRecords('sc_cat_item', query);
  }

  async createCatalogItem(data) {
    return this.createRecord('sc_cat_item', data);
  }

  // Change requests
  async getChangeRequests(query = {}) {
    return this.getRecords('change_request', query);
  }

  async getChangeRequestByNumber(number) {
    const changes = await this.getRecords('change_request', {
      sysparm_query: `number=${number}`,
      sysparm_limit: 1
    });
    return changes[0] || null;
  }

  async createChangeRequest(data) {
    return this.createRecord('change_request', data);
  }

  async updateChangeRequest(sysId, data) {
    return this.updateRecord('change_request', sysId, data);
  }

  // Problems
  async getProblems(query = {}) {
    return this.getRecords('problem', query);
  }

  async getProblemByNumber(number) {
    const problems = await this.getRecords('problem', {
      sysparm_query: `number=${number}`,
      sysparm_limit: 1
    });
    return problems[0] || null;
  }

  async createProblem(data) {
    return this.createRecord('problem', data);
  }

  async updateProblem(sysId, data) {
    return this.updateRecord('problem', sysId, data);
  }

  // Service Requests
  async getServiceRequests(query = {}) {
    return this.getRecords('sc_request', query);
  }

  async createServiceRequest(data) {
    return this.createRecord('sc_request', data);
  }

  async updateServiceRequest(sysId, data) {
    return this.updateRecord('sc_request', sysId, data);
  }

  // Groups
  async getGroups(query = {}) {
    return this.getRecords('sys_user_group', query);
  }

  async createGroup(data) {
    return this.createRecord('sys_user_group', data);
  }

  async updateGroup(sysId, data) {
    return this.updateRecord('sys_user_group', sysId, data);
  }

  // Group membership
  async addUserToGroup(userId, groupId) {
    return this.createRecord('sys_user_grmember', {
      user: userId,
      group: groupId
    });
  }

  async removeUserFromGroup(userId, groupId) {
    const members = await this.getRecords('sys_user_grmember', {
      sysparm_query: `user=${userId}^group=${groupId}`,
      sysparm_limit: 1
    });
    if (members[0]) {
      await this.deleteRecord('sys_user_grmember', members[0].sys_id);
    }
    return { success: true };
  }

  // Knowledge Base
  async getKnowledgeBases(query = {}) {
    return this.getRecords('kb_knowledge_base', query);
  }

  async createKnowledgeBase(data) {
    return this.createRecord('kb_knowledge_base', data);
  }

  // Knowledge Articles
  async getKnowledgeArticles(query = {}) {
    return this.getRecords('kb_knowledge', query);
  }

  async createKnowledgeArticle(data) {
    return this.createRecord('kb_knowledge', data);
  }

  async updateKnowledgeArticle(sysId, data) {
    return this.updateRecord('kb_knowledge', sysId, data);
  }

  // Catalog Categories
  async getCatalogCategories(query = {}) {
    return this.getRecords('sc_category', query);
  }

  async createCatalogCategory(data) {
    return this.createRecord('sc_category', data);
  }

  async updateCatalogCategory(sysId, data) {
    return this.updateRecord('sc_category', sysId, data);
  }

  // Add comments/work notes to any table
  async addComment(table, recordId, comment, isWorkNote = false) {
    const field = isWorkNote ? 'work_notes' : 'comments';
    const updateData = { [field]: comment };
    return this.updateRecord(table, recordId, updateData);
  }

  // Generic search across tables
  async searchRecords(table, searchTerm, fields = [], limit = 10) {
    const searchQuery = fields.length > 0
      ? fields.map(field => `${field}CONTAINS${searchTerm}`).join('^OR')
      : `short_descriptionCONTAINS${searchTerm}^ORdescriptionCONTAINS${searchTerm}`;

    return this.getRecords(table, {
      sysparm_query: searchQuery,
      sysparm_limit: limit
    });
  }

  // Configuration Items (CMDB)
  async getConfigurationItems(query = {}) {
    return this.getRecords('cmdb_ci', query);
  }

  async getConfigurationItem(sysId) {
    return this.getRecord('cmdb_ci', sysId);
  }

  async createConfigurationItem(data) {
    return this.createRecord('cmdb_ci', data);
  }

  async updateConfigurationItem(sysId, data) {
    return this.updateRecord('cmdb_ci', sysId, data);
  }

  // Business Rules
  async getBusinessRules(query = {}) {
    return this.getRecords('sys_script', query);
  }

  async createBusinessRule(data) {
    return this.createRecord('sys_script', data);
  }

  async updateBusinessRule(sysId, data) {
    return this.updateRecord('sys_script', sysId, data);
  }

  // Update Sets
  async getUpdateSets(query = {}) {
    return this.getRecords('sys_update_set', query);
  }

  async createUpdateSet(data) {
    return this.createRecord('sys_update_set', data);
  }

  async updateUpdateSet(sysId, data) {
    return this.updateRecord('sys_update_set', sysId, data);
  }

  // Workflows
  async getWorkflows(query = {}) {
    return this.getRecords('wf_workflow', query);
  }

  async createWorkflow(data) {
    return this.createRecord('wf_workflow', data);
  }

  // Attachments
  async getAttachments(tableId, recordId) {
    return this.getRecords('sys_attachment', {
      sysparm_query: `table_name=${tableId}^table_sys_id=${recordId}`
    });
  }

  async createAttachment(tableName, recordId, fileName, contentType, data) {
    const formData = new FormData();
    formData.append('table_name', tableName);
    formData.append('table_sys_id', recordId);
    formData.append('file_name', fileName);
    formData.append('content_type', contentType);
    formData.append('content', data);

    const response = await this.client.post('/api/now/attachment/file', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    return response.data.result;
  }

  // SLA Management
  async getSLAs(query = {}) {
    return this.getRecords('contract_sla', query);
  }

  async getSLADefinitions(query = {}) {
    return this.getRecords('sla_definition', query);
  }

  // Task Assignment
  async assignTask(table, recordId, assignedTo, assignmentGroup = null) {
    const updateData = { assigned_to: assignedTo };
    if (assignmentGroup) {
      updateData.assignment_group = assignmentGroup;
    }
    return this.updateRecord(table, recordId, updateData);
  }

  // Reports
  async getReports(query = {}) {
    return this.getRecords('sys_report', query);
  }

  async createReport(data) {
    return this.createRecord('sys_report', data);
  }

  // Execute script via sys_trigger (scheduled job that runs immediately)
  async executeScriptViaTrigger(script, description = 'MCP Script Execution', autoDelete = true) {
    try {
      // Calculate next action time (1 second from now)
      const now = new Date();
      const nextAction = new Date(now.getTime() + 1000); // 1 second from now

      // Format: YYYY-MM-DD HH:MM:SS
      const formatDateTime = (date) => {
        const pad = (n) => n.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
      };

      // Wrap script with auto-delete logic if requested
      let finalScript = script;
      let triggerSysId = null;
      if (autoDelete) {
        // We'll set the sys_id after creation, then update the script
        finalScript = script;  // Use original script for now
      }

      // Create sys_trigger record
      const trigger = await this.createRecord('sys_trigger', {
        name: `MCP_Script_${Date.now()}`,
        script: finalScript,
        next_action: formatDateTime(nextAction),
        trigger_type: '0', // Run once
        state: '0', // Ready state
        description: description || 'Automated script execution via MCP'
      });

      // If auto-delete requested, update script with self-delete logic
      if (autoDelete) {
        const scriptWithDelete = `
// Auto-generated MCP script trigger
try {
  ${script}
} finally {
  // Auto-delete this trigger after execution
  var triggerGR = new GlideRecord('sys_trigger');
  if (triggerGR.get('${trigger.sys_id}')) {
    triggerGR.deleteRecord();
    gs.info('MCP: Auto-deleted trigger ${trigger.sys_id}');
  }
}`;

        await this.updateRecord('sys_trigger', trigger.sys_id, {
          script: scriptWithDelete
        });
      }

      return {
        success: true,
        trigger_sys_id: trigger.sys_id,
        trigger_name: trigger.name,
        next_action: formatDateTime(nextAction),
        auto_delete: autoDelete,
        message: `Script scheduled to run at ${formatDateTime(nextAction)}. ${autoDelete ? 'Trigger will auto-delete after execution.' : 'Trigger will remain after execution.'}`
      };
    } catch (error) {
      throw new Error(`Failed to create script trigger: ${error.message}`);
    }
  }

  // Background script execution via UI endpoint (NOT WORKING - requires interactive session)
  // NOTE: /sys.scripts.do endpoint requires interactive browser session with cookies
  // from login.do - Basic Auth is not sufficient. Always fails with X-Is-Logged-In: false
  // Use executeScriptViaTrigger() instead.
  async executeBackgroundScript(script, scope = 'global') {
    throw new Error('Direct UI script execution not supported - use sys_trigger method instead');
  }

  // Batch operations
  async batchCreate(operations, transaction = true, reportProgress = true) {
    const results = {
      success: true,
      created_count: 0,
      sys_ids: {},
      errors: [],
      execution_time_ms: 0
    };

    const startTime = Date.now();
    const total = operations.length;

    // Determine progress reporting frequency
    const shouldReport = (index) => {
      if (!reportProgress) return false;
      if (total <= 10) return true; // Report every item for small batches
      if (total <= 50) return (index + 1) % 5 === 0 || index === total - 1; // Every 5 items
      return (index + 1) % Math.ceil(total / 10) === 0 || index === total - 1; // Every 10%
    };

    try {
      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        try {
          // Replace variable references from previous operations
          let processedData = JSON.stringify(op.data);
          Object.keys(results.sys_ids).forEach(key => {
            processedData = processedData.replace(`\${${key}}`, results.sys_ids[key]);
          });
          const data = JSON.parse(processedData);

          const result = await this.createRecord(op.table, data);

          // Save sys_id with the save_as key or operation index
          const key = op.save_as || `operation_${i}`;
          results.sys_ids[key] = result.sys_id;
          results.created_count++;

          // Report progress
          if (shouldReport(i)) {
            const percentage = Math.round(((i + 1) / total) * 100);
            this.notifyProgress(`Creating record ${i + 1}/${total} (${percentage}%): ${op.table}`);
          }
        } catch (error) {
          results.errors.push({
            operation_index: i,
            table: op.table,
            error: error.message
          });

          if (reportProgress) {
            this.notifyProgress(`Failed ${i + 1}/${total}: ${op.table} - ${error.message}`);
          }

          if (transaction) {
            results.success = false;
            throw new Error(`Batch create failed at operation ${i}: ${error.message}`);
          }
        }
      }

      // Final summary
      if (reportProgress) {
        const failedCount = results.errors.length;
        if (failedCount > 0) {
          this.notifyProgress(`Complete: ${results.created_count}/${total} records created (${failedCount} failed)`);
        } else {
          this.notifyProgress(`Complete: All ${total} records created successfully`);
        }
      }
    } finally {
      results.execution_time_ms = Date.now() - startTime;
    }

    return results;
  }

  async batchUpdate(updates, stopOnError = false, reportProgress = true) {
    const results = {
      success: true,
      updated_count: 0,
      errors: [],
      execution_time_ms: 0
    };

    const startTime = Date.now();
    const total = updates.length;

    // Determine progress reporting frequency
    const shouldReport = (index) => {
      if (!reportProgress) return false;
      if (total <= 10) return true; // Report every item for small batches
      if (total <= 50) return (index + 1) % 5 === 0 || index === total - 1; // Every 5 items
      return (index + 1) % Math.ceil(total / 10) === 0 || index === total - 1; // Every 10%
    };

    for (let i = 0; i < updates.length; i++) {
      const update = updates[i];
      try {
        await this.updateRecord(update.table, update.sys_id, update.data);
        results.updated_count++;

        // Report progress
        if (shouldReport(i)) {
          const percentage = Math.round(((i + 1) / total) * 100);
          this.notifyProgress(`Updating record ${i + 1}/${total} (${percentage}%): ${update.table}`);
        }
      } catch (error) {
        results.errors.push({
          update_index: i,
          table: update.table,
          sys_id: update.sys_id,
          error: error.message
        });

        if (reportProgress) {
          this.notifyProgress(`Failed ${i + 1}/${total}: ${update.table} - ${error.message}`);
        }

        if (stopOnError) {
          results.success = false;
          break;
        }
      }
    }

    // Final summary
    if (reportProgress) {
      const failedCount = results.errors.length;
      if (failedCount > 0) {
        this.notifyProgress(`Complete: ${results.updated_count}/${total} records updated (${failedCount} failed)`);
      } else {
        this.notifyProgress(`Complete: All ${total} records updated successfully`);
      }
    }

    results.execution_time_ms = Date.now() - startTime;
    return results;
  }

  // Workflow creation methods
  async createWorkflow(workflowData) {
    // Create base workflow
    const workflow = await this.createRecord('wf_workflow', {
      name: workflowData.name,
      description: workflowData.description || '',
      template: workflowData.template || false,
      access: workflowData.access || 'public'
    });

    return {
      workflow_sys_id: workflow.sys_id,
      name: workflowData.name
    };
  }

  async createWorkflowVersion(versionData) {
    // Create workflow version
    const version = await this.createRecord('wf_workflow_version', {
      name: versionData.name,
      workflow: versionData.workflow_sys_id,
      table: versionData.table,
      description: versionData.description || '',
      active: versionData.active !== undefined ? versionData.active : true,
      published: versionData.published || false,
      condition: versionData.condition || '',
      order: versionData.order || 100,
      run_multiple: versionData.run_multiple || false,
      after_business_rules: versionData.after_business_rules !== undefined ? versionData.after_business_rules : true,
      expected_time: versionData.expected_time || '',
      condition_type: versionData.condition_type || ''
    });

    return {
      version_sys_id: version.sys_id,
      name: versionData.name
    };
  }

  async createActivity(activityData) {
    // Create activity
    const activity = await this.createRecord('wf_activity', {
      name: activityData.name,
      workflow_version: activityData.workflow_version_sys_id,
      activity_definition: activityData.activity_definition_sys_id || '',
      x: activityData.x || 100,
      y: activityData.y || 100,
      width: activityData.width || 150,
      height: activityData.height || 80,
      input: activityData.script || activityData.input || '',
      vars: activityData.vars || '',
      stage: activityData.stage_sys_id || '',
      parent: activityData.parent_sys_id || '',
      timeout: activityData.timeout || '0 00:00:00'
    });

    return {
      activity_sys_id: activity.sys_id,
      name: activityData.name
    };
  }

  async createCondition(conditionData) {
    // Create condition
    const condition = await this.createRecord('wf_condition', {
      activity: conditionData.activity_sys_id,
      name: conditionData.name,
      short_description: conditionData.description || '',
      condition: conditionData.condition || '',
      order: conditionData.order || 1,
      else_flag: conditionData.else_flag || false,
      event: conditionData.event || false,
      event_name: conditionData.event_name || '',
      condition_type: conditionData.condition_type || 'standard'
    });

    return {
      condition_sys_id: condition.sys_id,
      name: conditionData.name
    };
  }

  async createTransition(transitionData) {
    // Create transition
    const transition = await this.createRecord('wf_transition', {
      from: transitionData.from_activity_sys_id,
      to: transitionData.to_activity_sys_id,
      condition: transitionData.condition_sys_id || '',
      order: transitionData.order || 1
    });

    return {
      transition_sys_id: transition.sys_id
    };
  }

  async publishWorkflow(versionSysId, startActivitySysId) {
    // Update workflow version to set start activity and publish
    const updated = await this.updateRecord('wf_workflow_version', versionSysId, {
      start: startActivitySysId,
      published: true
    });

    return {
      version_sys_id: versionSysId,
      published: true,
      start_activity: startActivitySysId
    };
  }

  async createCompleteWorkflow(workflowSpec, reportProgress = true) {
    // Create complete workflow with activities and transitions in one call
    const results = {
      workflow_sys_id: '',
      version_sys_id: '',
      activity_sys_ids: {},
      transition_sys_ids: [],
      published: false
    };

    try {
      // 1. Create base workflow
      if (reportProgress) this.notifyProgress('Creating workflow base');
      const workflow = await this.createWorkflow({
        name: workflowSpec.name,
        description: workflowSpec.description,
        template: workflowSpec.template,
        access: workflowSpec.access
      });
      results.workflow_sys_id = workflow.workflow_sys_id;

      // 2. Create workflow version
      if (reportProgress) this.notifyProgress('Creating workflow version');
      const version = await this.createWorkflowVersion({
        name: workflowSpec.name,
        workflow_sys_id: workflow.workflow_sys_id,
        table: workflowSpec.table,
        description: workflowSpec.description,
        active: workflowSpec.active,
        published: false,  // Don't publish yet
        condition: workflowSpec.condition,
        order: workflowSpec.order,
        run_multiple: workflowSpec.run_multiple,
        after_business_rules: workflowSpec.after_business_rules
      });
      results.version_sys_id = version.version_sys_id;

      // 3. Create activities
      const activities = workflowSpec.activities || [];
      const totalActivities = activities.length;
      for (let i = 0; i < activities.length; i++) {
        const actSpec = activities[i];

        if (reportProgress) {
          this.notifyProgress(`Creating activity ${i + 1}/${totalActivities}: ${actSpec.name}`);
        }

        const activity = await this.createActivity({
          name: actSpec.name,
          workflow_version_sys_id: version.version_sys_id,
          activity_definition_sys_id: actSpec.activity_type,
          x: actSpec.x !== undefined ? actSpec.x : (100 + i * 150),
          y: actSpec.y !== undefined ? actSpec.y : 100,
          width: actSpec.width,
          height: actSpec.height,
          script: actSpec.script,
          vars: actSpec.vars,
          stage_sys_id: actSpec.stage,
          parent_sys_id: actSpec.parent,
          timeout: actSpec.timeout
        });

        const key = actSpec.id || `activity_${i}`;
        results.activity_sys_ids[key] = activity.activity_sys_id;
      }

      // 4. Create transitions
      const transitions = workflowSpec.transitions || [];
      const totalTransitions = transitions.length;
      for (let i = 0; i < transitions.length; i++) {
        const transSpec = transitions[i];

        if (reportProgress) {
          this.notifyProgress(`Creating transition ${i + 1}/${totalTransitions}`);
        }

        // Resolve activity references
        const fromId = typeof transSpec.from === 'number'
          ? results.activity_sys_ids[`activity_${transSpec.from}`]
          : results.activity_sys_ids[transSpec.from] || transSpec.from;

        const toId = typeof transSpec.to === 'number'
          ? results.activity_sys_ids[`activity_${transSpec.to}`]
          : results.activity_sys_ids[transSpec.to] || transSpec.to;

        // Create condition if specified
        let conditionId = transSpec.condition_sys_id;
        if (transSpec.condition && !conditionId) {
          const condition = await this.createCondition({
            activity_sys_id: fromId,
            name: transSpec.condition_name || 'Condition',
            description: transSpec.condition_description,
            condition: transSpec.condition,
            order: transSpec.order,
            else_flag: transSpec.else_flag
          });
          conditionId = condition.condition_sys_id;
        }

        // Create transition
        const transition = await this.createTransition({
          from_activity_sys_id: fromId,
          to_activity_sys_id: toId,
          condition_sys_id: conditionId,
          order: transSpec.order
        });

        results.transition_sys_ids.push(transition.transition_sys_id);
      }

      // 5. Publish if requested
      if (workflowSpec.publish && activities.length > 0) {
        if (reportProgress) this.notifyProgress('Publishing workflow');

        const startActivityId = workflowSpec.start_activity
          ? (results.activity_sys_ids[workflowSpec.start_activity] || workflowSpec.start_activity)
          : results.activity_sys_ids['activity_0'] || results.activity_sys_ids[Object.keys(results.activity_sys_ids)[0]];

        await this.publishWorkflow(version.version_sys_id, startActivityId);
        results.published = true;
        results.start_activity = startActivityId;
      }

      if (reportProgress) {
        this.notifyProgress(`Complete: Workflow created with ${totalActivities} activities and ${totalTransitions} transitions`);
      }

      return results;
    } catch (error) {
      throw new Error(`Failed to create workflow: ${error.message}`);
    }
  }

  // Move records to update set
  async moveRecordsToUpdateSet(updateSetId, options = {}) {
    const {
      record_sys_ids = [],
      time_range = null,
      source_update_set = null,
      table = 'sys_update_xml',
      reportProgress = true
    } = options;

    try {
      const results = {
        moved: 0,
        failed: 0,
        records: [],
        errors: []
      };

      let recordsToMove = [];

      // Get records by sys_ids
      if (record_sys_ids.length > 0) {
        if (reportProgress) this.notifyProgress(`Fetching ${record_sys_ids.length} records to move`);
        const sysIdsQuery = record_sys_ids.map(id => `sys_id=${id}`).join('^OR');
        recordsToMove = await this.getRecords(table, {
          sysparm_query: sysIdsQuery,
          sysparm_limit: 1000
        });
      }
      // Get records by time range
      else if (time_range) {
        if (reportProgress) this.notifyProgress('Fetching records by time range');
        let query = `sys_created_on>=${time_range.start}^sys_created_on<=${time_range.end}`;
        if (source_update_set) {
          query += `^update_set.name=${source_update_set}`;
        }
        recordsToMove = await this.getRecords(table, {
          sysparm_query: query,
          sysparm_limit: 1000
        });
      }

      const total = recordsToMove.length;
      if (total === 0) {
        if (reportProgress) this.notifyProgress('No records found to move');
        return results;
      }

      if (reportProgress) this.notifyProgress(`Moving ${total} records to update set`);

      // Determine progress reporting frequency
      const shouldReport = (index) => {
        if (!reportProgress) return false;
        if (total <= 10) return true;
        if (total <= 50) return (index + 1) % 5 === 0 || index === total - 1;
        return (index + 1) % Math.ceil(total / 10) === 0 || index === total - 1;
      };

      // Move each record
      for (let i = 0; i < recordsToMove.length; i++) {
        const record = recordsToMove[i];
        try {
          await this.updateRecord(table, record.sys_id, {
            update_set: updateSetId
          });
          results.moved++;
          results.records.push({
            sys_id: record.sys_id,
            name: record.name,
            type: record.type,
            status: 'moved'
          });

          if (shouldReport(i)) {
            const percentage = Math.round(((i + 1) / total) * 100);
            this.notifyProgress(`Moving record ${i + 1}/${total} (${percentage}%): ${record.type || 'unknown'}`);
          }
        } catch (error) {
          results.failed++;
          results.errors.push({
            sys_id: record.sys_id,
            error: error.message
          });

          if (reportProgress) {
            this.notifyProgress(`Failed ${i + 1}/${total}: ${record.sys_id} - ${error.message}`);
          }
        }
      }

      if (reportProgress) {
        if (results.failed > 0) {
          this.notifyProgress(`Complete: ${results.moved}/${total} records moved (${results.failed} failed)`);
        } else {
          this.notifyProgress(`Complete: All ${total} records moved successfully`);
        }
      }

      return results;
    } catch (error) {
      throw new Error(`Failed to move records to update set: ${error.message}`);
    }
  }

  // Clone update set
  async cloneUpdateSet(sourceUpdateSetId, newName, reportProgress = true) {
    try {
      // Get source update set
      if (reportProgress) this.notifyProgress('Fetching source update set');
      const sourceSet = await this.getRecord('sys_update_set', sourceUpdateSetId);

      // Create new update set
      if (reportProgress) this.notifyProgress(`Creating new update set: ${newName}`);
      const newSet = await this.createRecord('sys_update_set', {
        name: newName,
        description: `Clone of: ${sourceSet.name}\n\n${sourceSet.description || ''}`,
        application: sourceSet.application,
        state: 'in progress'
      });

      // Get all update XML records from source
      if (reportProgress) this.notifyProgress('Fetching update records from source');
      const updateRecords = await this.getRecords('sys_update_xml', {
        sysparm_query: `update_set=${sourceUpdateSetId}`,
        sysparm_limit: 5000
      });

      const total = updateRecords.length;
      if (reportProgress) this.notifyProgress(`Cloning ${total} update records`);

      // Determine progress reporting frequency
      const shouldReport = (index) => {
        if (!reportProgress) return false;
        if (total <= 10) return true;
        if (total <= 50) return (index + 1) % 5 === 0 || index === total - 1;
        return (index + 1) % Math.ceil(total / 10) === 0 || index === total - 1;
      };

      // Clone each update record (create new records pointing to new set)
      const clonedRecords = [];
      let failedCount = 0;
      for (let i = 0; i < updateRecords.length; i++) {
        const record = updateRecords[i];
        try {
          const cloned = await this.createRecord('sys_update_xml', {
            update_set: newSet.sys_id,
            name: record.name,
            type: record.type,
            target_name: record.target_name,
            payload: record.payload,
            category: record.category
          });
          clonedRecords.push(cloned);

          if (shouldReport(i)) {
            const percentage = Math.round(((i + 1) / total) * 100);
            this.notifyProgress(`Cloning record ${i + 1}/${total} (${percentage}%): ${record.type || 'unknown'}`);
          }
        } catch (error) {
          failedCount++;
          console.error(`Failed to clone record ${record.sys_id}: ${error.message}`);
          if (reportProgress && failedCount <= 5) { // Only report first 5 failures to avoid spam
            this.notifyProgress(`Failed to clone record ${i + 1}/${total}: ${error.message}`);
          }
        }
      }

      if (reportProgress) {
        if (failedCount > 0) {
          this.notifyProgress(`Complete: ${clonedRecords.length}/${total} records cloned (${failedCount} failed)`);
        } else {
          this.notifyProgress(`Complete: All ${total} records cloned successfully`);
        }
      }

      return {
        new_update_set_id: newSet.sys_id,
        new_update_set_name: newSet.name,
        source_update_set_id: sourceUpdateSetId,
        source_update_set_name: sourceSet.name,
        records_cloned: clonedRecords.length,
        total_source_records: updateRecords.length
      };
    } catch (error) {
      throw new Error(`Failed to clone update set: ${error.message}`);
    }
  }

  // Enhanced schema discovery
  async discoverTableSchema(tableName, options = {}) {
    const {
      include_type_codes = false,
      include_choice_tables = false,
      include_relationships = false,
      include_ui_policies = false,
      include_business_rules = false,
      include_field_constraints = false
    } = options;

    const schema = {
      table: tableName,
      label: null,
      fields: []
    };

    try {
      // Get table metadata
      const tables = await this.getRecords('sys_db_object', {
        sysparm_query: `name=${tableName}`,
        sysparm_limit: 1
      });

      if (tables.length > 0) {
        schema.label = tables[0].label;
        schema.super_class = tables[0].super_class?.value;
      }

      // Get field definitions
      const fields = await this.getRecords('sys_dictionary', {
        sysparm_query: `name=${tableName}`,
        sysparm_limit: 1000
      });

      for (const field of fields) {
        const fieldInfo = {
          name: field.element,
          label: field.column_label,
          internal_type: field.internal_type?.value || field.internal_type,
          max_length: field.max_length,
          mandatory: field.mandatory === 'true' || field.mandatory === true,
          read_only: field.read_only === 'true' || field.read_only === true
        };

        // Add type codes for integer fields (like variable types)
        if (include_type_codes && fieldInfo.internal_type === 'integer' && field.element === 'type') {
          const choices = await this.getRecords('sys_choice', {
            sysparm_query: `name=${tableName}^element=type`,
            sysparm_limit: 100
          });

          if (choices.length > 0) {
            fieldInfo.type_codes = {};
            choices.forEach(choice => {
              fieldInfo.type_codes[choice.value] = choice.label;
            });
          }
        }

        // Add reference information
        if (fieldInfo.internal_type === 'reference' && field.reference) {
          fieldInfo.reference_table = field.reference.value || field.reference;
        }

        if (include_field_constraints && field.default_value) {
          fieldInfo.default_value = field.default_value;
        }

        schema.fields.push(fieldInfo);
      }

      // Choice tables
      if (include_choice_tables) {
        schema.choice_tables = {
          sys_choice: 'For table field choices',
          question_choice: 'For catalog variable choices'
        };
      }

      // Relationships
      if (include_relationships) {
        schema.relationships = {};
        const refFields = schema.fields.filter(f => f.internal_type === 'reference');
        for (const field of refFields) {
          if (field.reference_table) {
            schema.relationships[field.name] = {
              type: 'reference',
              table: field.reference_table,
              description: field.label
            };
          }
        }
      }

      // UI Policies
      if (include_ui_policies) {
        const policies = await this.getRecords('sys_ui_policy', {
          sysparm_query: `table=${tableName}^active=true`,
          sysparm_fields: 'sys_id,short_description',
          sysparm_limit: 100
        });
        schema.ui_policies = policies.map(p => ({
          sys_id: p.sys_id,
          description: p.short_description
        }));
      }

      // Business Rules
      if (include_business_rules) {
        const rules = await this.getRecords('sys_script', {
          sysparm_query: `collection=${tableName}^active=true`,
          sysparm_fields: 'sys_id,name,when',
          sysparm_limit: 100
        });
        schema.business_rules = rules.map(r => ({
          sys_id: r.sys_id,
          name: r.name,
          when: r.when
        }));
      }

    } catch (error) {
      throw new Error(`Failed to discover schema for ${tableName}: ${error.message}`);
    }

    return schema;
  }

  // Field explanation
  async explainField(tableName, fieldName, includeExamples = true) {
    try {
      const fields = await this.getRecords('sys_dictionary', {
        sysparm_query: `name=${tableName}^element=${fieldName}`,
        sysparm_limit: 1
      });

      if (fields.length === 0) {
        throw new Error(`Field ${fieldName} not found in table ${tableName}`);
      }

      const field = fields[0];
      const explanation = {
        field: fieldName,
        table: tableName,
        label: field.column_label,
        type: field.internal_type?.value || field.internal_type,
        max_length: field.max_length,
        mandatory: field.mandatory === 'true' || field.mandatory === true,
        read_only: field.read_only === 'true' || field.read_only === true,
        comments: field.comments,
        help: field.help
      };

      // Get reference info
      if (field.reference) {
        explanation.reference_table = field.reference.value || field.reference;
      }

      // Get choices for choice fields
      if (field.internal_type === 'choice' || field.internal_type === 'integer') {
        const choices = await this.getRecords('sys_choice', {
          sysparm_query: `name=${tableName}^element=${fieldName}`,
          sysparm_limit: 100
        });

        if (choices.length > 0) {
          explanation.choices = choices.map(c => ({
            value: c.value,
            label: c.label
          }));
        }
      }

      // Known issues for specific fields
      if (tableName === 'catalog_ui_policy_action' && (fieldName === 'ui_policy' || fieldName === 'catalog_variable')) {
        explanation.known_issues = [
          'Cannot be set via REST API - use background script with setValue()',
          fieldName === 'catalog_variable' ? 'Must include IO: prefix or linkage will fail' : null
        ].filter(Boolean);

        if (fieldName === 'catalog_variable') {
          explanation.special_format = 'IO:<variable_sys_id>';
          if (includeExamples) {
            explanation.example = 'IO:94ababd1c35432101fcbbd43e40131bf';
          }
        }
      }

      return explanation;
    } catch (error) {
      throw new Error(`Failed to explain field: ${error.message}`);
    }
  }

  // Validate catalog configuration
  async validateCatalogConfiguration(catalogItemSysId, checks = {}) {
    const results = {
      valid: true,
      issues: [],
      warnings: 0,
      errors: 0
    };

    try {
      // Validate variables
      if (checks.variables) {
        const variables = await this.getRecords('item_option_new', {
          sysparm_query: `cat_item=${catalogItemSysId}`,
          sysparm_limit: 1000
        });

        for (const variable of variables) {
          // Check if linked
          if (checks.variables.check_linked && !variable.cat_item) {
            results.issues.push({
              severity: 'error',
              component: 'variable',
              sys_id: variable.sys_id,
              issue: `Variable ${variable.name} is not linked to catalog item`,
              fix: 'Update cat_item field'
            });
            results.errors++;
            results.valid = false;
          }

          // Check tooltip length
          if (variable.tooltip && variable.tooltip.length > 40) {
            results.issues.push({
              severity: 'warning',
              component: 'variable',
              sys_id: variable.sys_id,
              issue: `Tooltip exceeds 40 characters and will be truncated (${variable.tooltip.length} chars)`,
              fix: 'Move detailed help to help_text field'
            });
            results.warnings++;
          }

          // Check for choices
          if (checks.variables.check_choices && (variable.type === '1' || variable.type === '5')) {
            const choices = await this.getRecords('question_choice', {
              sysparm_query: `question=${variable.sys_id}`,
              sysparm_limit: 1
            });

            if (choices.length === 0) {
              results.issues.push({
                severity: 'error',
                component: 'variable',
                sys_id: variable.sys_id,
                issue: `Variable ${variable.name} is type ${variable.type === '1' ? 'Choice' : 'Select Box'} but has no choices defined`,
                fix: 'Add choices via question_choice table'
              });
              results.errors++;
              results.valid = false;
            }
          }
        }
      }

      // Validate UI policies
      if (checks.ui_policies) {
        const policies = await this.getRecords('catalog_ui_policy', {
          sysparm_query: `catalog_item=${catalogItemSysId}`,
          sysparm_limit: 1000
        });

        for (const policy of policies) {
          if (checks.ui_policies.check_actions_linked) {
            const actions = await this.getRecords('catalog_ui_policy_action', {
              sysparm_query: `ui_policy=${policy.sys_id}`,
              sysparm_limit: 1000
            });

            for (const action of actions) {
              if (!action.catalog_variable || action.catalog_variable === '') {
                results.issues.push({
                  severity: 'error',
                  component: 'ui_policy_action',
                  sys_id: action.sys_id,
                  issue: 'catalog_variable field is empty - action not linked to policy',
                  fix: 'Run background script to set catalog_variable value'
                });
                results.errors++;
                results.valid = false;
              }
            }
          }
        }
      }

    } catch (error) {
      results.issues.push({
        severity: 'error',
        component: 'validation',
        issue: `Validation failed: ${error.message}`
      });
      results.errors++;
      results.valid = false;
    }

    return results;
  }

  // Inspect update set
  async inspectUpdateSet(updateSetSysId, options = {}) {
    const {
      show_components = true,
      show_dependencies = false
    } = options;

    try {
      const updateSet = await this.getRecord('sys_update_set', updateSetSysId);

      const result = {
        update_set: {
          sys_id: updateSet.sys_id,
          name: updateSet.name,
          state: updateSet.state,
          description: updateSet.description
        },
        total_records: 0,
        components: []
      };

      if (show_components) {
        const updates = await this.getRecords('sys_update_xml', {
          sysparm_query: `update_set=${updateSetSysId}`,
          sysparm_fields: 'type,name,target_name',
          sysparm_limit: 10000
        });

        result.total_records = updates.length;

        // Group by type
        const typeGroups = {};
        updates.forEach(update => {
          const type = update.type || 'unknown';
          if (!typeGroups[type]) {
            typeGroups[type] = [];
          }
          typeGroups[type].push(update);
        });

        result.components = Object.keys(typeGroups).map(type => ({
          type,
          count: typeGroups[type].length,
          items: typeGroups[type].slice(0, 10).map(u => u.name || u.target_name)
        }));
      }

      result.ready_to_deploy = result.update_set.state === 'complete';

      return result;
    } catch (error) {
      throw new Error(`Failed to inspect update set: ${error.message}`);
    }
  }
}