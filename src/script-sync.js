/**
 * ServiceNow MCP Server - Script Synchronization
 *
 * Copyright (c) 2025 Happy Technologies LLC
 * Licensed under the MIT License - see LICENSE file for details
 *
 * Enables local script development with Git integration.
 * Supports bidirectional sync between local files and ServiceNow.
 *
 * Features:
 * - Single script sync (push/pull)
 * - Bulk sync (all scripts in directory)
 * - Watch mode (auto-sync on file changes)
 * - Git-friendly file naming convention
 */

import fs from 'fs/promises';
import path from 'path';
import chokidar from 'chokidar';

/**
 * Supported script types with their ServiceNow table mappings
 */
export const SCRIPT_TYPES = {
  sys_script_include: {
    table: 'sys_script_include',
    label: 'Script Include',
    name_field: 'name',
    script_field: 'script',
    extension: '.js'
  },
  sys_script: {
    table: 'sys_script',
    label: 'Business Rule',
    name_field: 'name',
    script_field: 'script',
    extension: '.js'
  },
  sys_ui_script: {
    table: 'sys_ui_script',
    label: 'UI Script',
    name_field: 'name',
    script_field: 'script',
    extension: '.js'
  },
  sys_ui_action: {
    table: 'sys_ui_action',
    label: 'UI Action',
    name_field: 'name',
    script_field: 'script',
    extension: '.js'
  },
  sys_script_client: {
    table: 'sys_script_client',
    label: 'Client Script',
    name_field: 'name',
    script_field: 'script',
    extension: '.js'
  }
};

/**
 * Parse file name to extract script name and type
 * Format: {script_name}.{script_type}.js
 *
 * @param {string} fileName - File name to parse
 * @returns {object} - { scriptName, scriptType, isValid }
 */
export function parseFileName(fileName) {
  const parts = fileName.split('.');

  // Must have at least 3 parts: name, type, js
  if (parts.length < 3) {
    return { isValid: false };
  }

  const extension = parts.pop(); // Remove .js
  const scriptType = parts.pop(); // Remove script type
  const scriptName = parts.join('.'); // Rest is the name

  if (extension !== 'js' || !SCRIPT_TYPES[scriptType]) {
    return { isValid: false };
  }

  return {
    isValid: true,
    scriptName,
    scriptType
  };
}

/**
 * Generate file name from script name and type
 *
 * @param {string} scriptName - Script name
 * @param {string} scriptType - Script type
 * @returns {string} - File name
 */
export function generateFileName(scriptName, scriptType) {
  const sanitizedName = scriptName.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return `${sanitizedName}.${scriptType}.js`;
}

/**
 * Sync a single script between local file and ServiceNow
 *
 * @param {object} serviceNowClient - ServiceNow client instance
 * @param {object} options - Sync options
 * @param {string} options.script_name - Name of the script in ServiceNow
 * @param {string} options.script_type - Type of script (sys_script_include, etc.)
 * @param {string} options.file_path - Local file path
 * @param {string} options.direction - 'push' or 'pull' (auto-detect if not specified)
 * @param {string} options.instance - ServiceNow instance name (optional)
 * @returns {object} - Sync result
 */
export async function syncScript(serviceNowClient, options) {
  const { script_name, script_type, file_path, direction, instance } = options;

  // Validate script type
  const scriptConfig = SCRIPT_TYPES[script_type];
  if (!scriptConfig) {
    throw new Error(`Invalid script type: ${script_type}. Supported types: ${Object.keys(SCRIPT_TYPES).join(', ')}`);
  }

  const result = {
    script_name,
    script_type,
    file_path,
    direction: null,
    success: false,
    timestamp: new Date().toISOString(),
    error: null
  };

  try {
    // Auto-detect direction if not specified
    let syncDirection = direction;
    if (!syncDirection) {
      try {
        await fs.access(file_path);
        syncDirection = 'push'; // File exists, push to ServiceNow
      } catch {
        syncDirection = 'pull'; // File doesn't exist, pull from ServiceNow
      }
    }

    result.direction = syncDirection;

    if (syncDirection === 'pull') {
      // Pull from ServiceNow to local file
      const records = await serviceNowClient.getRecords(scriptConfig.table, {
        sysparm_query: `${scriptConfig.name_field}=${script_name}`,
        sysparm_limit: 1,
        sysparm_fields: `sys_id,${scriptConfig.name_field},${scriptConfig.script_field}`
      });

      if (records.length === 0) {
        throw new Error(`Script not found in ServiceNow: ${script_name}`);
      }

      const record = records[0];
      const scriptContent = record[scriptConfig.script_field] || '';

      // Add metadata header
      const fileContent = `/**
 * ServiceNow Script: ${record[scriptConfig.name_field]}
 * Type: ${scriptConfig.label}
 * Table: ${scriptConfig.table}
 * sys_id: ${record.sys_id}
 *
 * Last synced: ${new Date().toISOString()}
 *
 * This file is managed by ServiceNow MCP Script Sync.
 * Changes will be pushed to ServiceNow on save.
 */

${scriptContent}`;

      // Ensure directory exists
      const dir = path.dirname(file_path);
      await fs.mkdir(dir, { recursive: true });

      // Write file
      await fs.writeFile(file_path, fileContent, 'utf-8');

      result.success = true;
      result.sys_id = record.sys_id;
      result.message = `Successfully pulled script from ServiceNow to ${file_path}`;

    } else if (syncDirection === 'push') {
      // Push from local file to ServiceNow
      let fileContent;
      try {
        fileContent = await fs.readFile(file_path, 'utf-8');
      } catch (error) {
        throw new Error(`Failed to read file: ${error.message}`);
      }

      // Remove metadata header if present (lines starting with /** to */)
      let scriptContent = fileContent;
      const headerMatch = fileContent.match(/^\/\*\*[\s\S]*?\*\//);
      if (headerMatch) {
        scriptContent = fileContent.substring(headerMatch[0].length).trim();
      }

      // Find existing script in ServiceNow
      const records = await serviceNowClient.getRecords(scriptConfig.table, {
        sysparm_query: `${scriptConfig.name_field}=${script_name}`,
        sysparm_limit: 1,
        sysparm_fields: `sys_id,${scriptConfig.name_field}`
      });

      if (records.length === 0) {
        throw new Error(`Script not found in ServiceNow: ${script_name}. Create it first, then sync.`);
      }

      const record = records[0];

      // Update script in ServiceNow
      await serviceNowClient.updateRecord(scriptConfig.table, record.sys_id, {
        [scriptConfig.script_field]: scriptContent
      });

      result.success = true;
      result.sys_id = record.sys_id;
      result.message = `Successfully pushed script from ${file_path} to ServiceNow`;

    } else {
      throw new Error(`Invalid direction: ${syncDirection}. Must be 'push' or 'pull'.`);
    }

  } catch (error) {
    result.error = error.message;
    result.message = `Sync failed: ${error.message}`;
  }

  return result;
}

/**
 * Sync all scripts in a directory
 *
 * @param {object} serviceNowClient - ServiceNow client instance
 * @param {object} options - Sync options
 * @param {string} options.directory - Directory containing scripts
 * @param {array} options.script_types - Script types to sync (optional, defaults to all)
 * @param {string} options.instance - ServiceNow instance name (optional)
 * @returns {object} - Sync results
 */
export async function syncAllScripts(serviceNowClient, options) {
  const { directory, script_types, instance } = options;

  const result = {
    directory,
    script_types: script_types || Object.keys(SCRIPT_TYPES),
    total_files: 0,
    synced: 0,
    failed: 0,
    scripts: [],
    timestamp: new Date().toISOString()
  };

  try {
    // Ensure directory exists
    await fs.mkdir(directory, { recursive: true });

    // Read all files in directory
    const files = await fs.readdir(directory);

    // Filter for script files matching our naming convention
    const scriptFiles = files.filter(file => {
      const parsed = parseFileName(file);
      if (!parsed.isValid) return false;

      // Filter by script types if specified
      if (script_types && !script_types.includes(parsed.scriptType)) {
        return false;
      }

      return true;
    });

    result.total_files = scriptFiles.length;

    // Sync each file
    for (const file of scriptFiles) {
      const parsed = parseFileName(file);
      const filePath = path.join(directory, file);

      try {
        const syncResult = await syncScript(serviceNowClient, {
          script_name: parsed.scriptName,
          script_type: parsed.scriptType,
          file_path: filePath,
          direction: 'push', // Default to push for bulk sync
          instance
        });

        result.scripts.push(syncResult);

        if (syncResult.success) {
          result.synced++;
        } else {
          result.failed++;
        }
      } catch (error) {
        result.scripts.push({
          script_name: parsed.scriptName,
          script_type: parsed.scriptType,
          file_path: filePath,
          success: false,
          error: error.message
        });
        result.failed++;
      }
    }

  } catch (error) {
    result.error = error.message;
  }

  return result;
}

/**
 * Watch a directory for changes and auto-sync scripts
 *
 * NOTE: This function returns a watcher instance that runs in the background.
 * The caller is responsible for managing the watcher lifecycle.
 *
 * @param {object} serviceNowClient - ServiceNow client instance
 * @param {object} options - Watch options
 * @param {string} options.directory - Directory to watch
 * @param {string} options.script_type - Script type to watch (optional, defaults to all)
 * @param {boolean} options.auto_sync - Auto-sync on file changes (default: true)
 * @param {function} options.onSync - Callback function called after each sync
 * @param {string} options.instance - ServiceNow instance name (optional)
 * @returns {object} - { watcher, stop() }
 */
export function watchScripts(serviceNowClient, options) {
  const { directory, script_type, auto_sync = true, onSync, instance } = options;

  // Track files being synced to prevent duplicate syncs
  const syncingFiles = new Set();

  // Create watcher
  const watcher = chokidar.watch(directory, {
    ignored: /(^|[\/\\])\../, // Ignore dot files
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100
    }
  });

  // Handle file changes
  const handleFileChange = async (filePath) => {
    // Prevent duplicate syncs
    if (syncingFiles.has(filePath)) {
      return;
    }

    const fileName = path.basename(filePath);
    const parsed = parseFileName(fileName);

    // Validate file name
    if (!parsed.isValid) {
      return;
    }

    // Filter by script type if specified
    if (script_type && parsed.scriptType !== script_type) {
      return;
    }

    // Mark as syncing
    syncingFiles.add(filePath);

    try {
      if (auto_sync) {
        const result = await syncScript(serviceNowClient, {
          script_name: parsed.scriptName,
          script_type: parsed.scriptType,
          file_path: filePath,
          direction: 'push',
          instance
        });

        if (onSync) {
          onSync(result);
        }
      }
    } catch (error) {
      if (onSync) {
        onSync({
          script_name: parsed.scriptName,
          script_type: parsed.scriptType,
          file_path: filePath,
          success: false,
          error: error.message
        });
      }
    } finally {
      // Remove from syncing set after delay
      setTimeout(() => {
        syncingFiles.delete(filePath);
      }, 1000);
    }
  };

  // Watch for file changes
  watcher.on('add', handleFileChange);
  watcher.on('change', handleFileChange);

  // Watch for errors
  watcher.on('error', (error) => {
    console.error('Watcher error:', error);
  });

  // Return watcher control object
  return {
    watcher,
    stop: () => {
      return watcher.close();
    }
  };
}
