import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';
import { configManager } from './config-manager.js';

export async function createMcpServer(serviceNowClient) {
  const server = new Server(
    {
      name: 'servicenow-server',
      version: '2.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      }
    }
  );

  // Load table metadata
  let tableMetadata = {};
  try {
    const metadataPath = path.resolve(path.dirname(import.meta.url.replace('file://', '')), 'config/comprehensive-table-definitions.json');
    const rawData = await fs.readFile(metadataPath, 'utf-8');
    const fullData = JSON.parse(rawData);

    // Extract just the table definitions, filtering out metadata
    Object.entries(fullData).forEach(([key, value]) => {
      if (!key.startsWith('_') && typeof value === 'object' && value.table) {
        tableMetadata[key] = value;
      }
    });

    console.error(`✅ Loaded metadata for ${Object.keys(tableMetadata).length} ServiceNow tables`);
  } catch (error) {
    console.error('⚠️  Failed to load table metadata:', error.message);
  }

  // Set up consolidated tool handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    console.error(`📋 Tool list requested by Claude Code`);

    const tools = [
      {
        name: 'SN-Set-Instance',
        description: 'Switch to a different ServiceNow instance. Use this at the start of your session to target a specific instance (dev, test, prod, etc.). Lists available instances if no name provided.',
        inputSchema: {
          type: 'object',
          properties: {
            instance_name: {
              type: 'string',
              description: 'Name of the instance to switch to (e.g., "dev", "prod", "test"). Leave empty to list available instances.'
            }
          }
        }
      },
      {
        name: 'SN-Get-Current-Instance',
        description: 'Get information about the currently active ServiceNow instance',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'SN-Query-Table',
        description: 'Query any ServiceNow table by name with flexible filtering',
        inputSchema: {
          type: 'object',
          properties: {
            table_name: {
              type: 'string',
              description: 'ServiceNow table name (e.g., "incident", "sys_user", "cmdb_ci") (required)'
            },
            query: {
              type: 'string',
              description: 'ServiceNow encoded query string (e.g., "state=1^priority=1") (optional)'
            },
            fields: {
              type: 'string',
              description: 'Comma-separated list of fields to return (optional)'
            },
            limit: {
              type: 'number',
              description: 'Maximum number of records to return (default: 25)',
              default: 25
            },
            offset: {
              type: 'number',
              description: 'Number of records to skip for pagination (optional)'
            },
            order_by: {
              type: 'string',
              description: 'Field to sort by (e.g., "created_on" or "-priority" for descending) (optional)'
            }
          },
          required: ['table_name']
        }
      },
      {
        name: 'SN-Create-Record',
        description: 'Create a record in any ServiceNow table by name. WARNING: For catalog_ui_policy_action table, fields ui_policy and catalog_variable cannot be set via REST API - use SN-Execute-Background-Script with setValue() after creation.',
        inputSchema: {
          type: 'object',
          properties: {
            table_name: {
              type: 'string',
              description: 'ServiceNow table name (e.g., "incident", "sys_user", "cmdb_ci") (required)'
            },
            data: {
              type: 'object',
              description: 'Record data as key-value pairs (e.g., {"short_description": "Test", "priority": 1}) (required)'
            }
          },
          required: ['table_name', 'data']
        }
      },
      {
        name: 'SN-Get-Record',
        description: 'Get a specific record from any ServiceNow table by sys_id',
        inputSchema: {
          type: 'object',
          properties: {
            table_name: {
              type: 'string',
              description: 'ServiceNow table name (e.g., "incident", "sys_user", "cmdb_ci") (required)'
            },
            sys_id: {
              type: 'string',
              description: 'System ID of the record to retrieve (required)'
            },
            fields: {
              type: 'string',
              description: 'Comma-separated list of fields to return (optional)'
            }
          },
          required: ['table_name', 'sys_id']
        }
      },
      {
        name: 'SN-Update-Record',
        description: 'Update a record in any ServiceNow table by sys_id',
        inputSchema: {
          type: 'object',
          properties: {
            table_name: {
              type: 'string',
              description: 'ServiceNow table name (e.g., "incident", "sys_user", "cmdb_ci") (required)'
            },
            sys_id: {
              type: 'string',
              description: 'System ID of the record to update (required)'
            },
            data: {
              type: 'object',
              description: 'Record data to update as key-value pairs (e.g., {"state": 6, "resolution_notes": "Fixed"}) (required)'
            }
          },
          required: ['table_name', 'sys_id', 'data']
        }
      },
      {
        name: 'SN-Get-Table-Schema',
        description: 'Get the schema/metadata for any ServiceNow table including required fields, common fields, and field descriptions',
        inputSchema: {
          type: 'object',
          properties: {
            table_name: {
              type: 'string',
              description: 'ServiceNow table name (required)'
            }
          },
          required: ['table_name']
        }
      },
      {
        name: 'SN-List-Available-Tables',
        description: 'List all available ServiceNow tables with their descriptions and capabilities',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Filter by category: "core_itsm", "platform", "service_catalog", "cmdb", or "all" (optional)'
            }
          },
          required: []
        }
      },
      // Convenience tools for most common operations
      {
        name: 'SN-List-Incidents',
        description: 'List Incident records with filtering and pagination',
        inputSchema: {
          type: 'object',
          properties: {
            state: {
              type: 'string',
              description: 'Filter by state (e.g., "New", "In Progress", "Resolved") (optional)'
            },
            priority: {
              type: 'number',
              description: 'Filter by priority (1-5) (optional)'
            },
            query: {
              type: 'string',
              description: 'ServiceNow encoded query string (e.g., "state=1^priority=1") (optional)'
            },
            limit: {
              type: 'number',
              description: 'Maximum number of records to return (default: 25)',
              default: 25
            },
            offset: {
              type: 'number',
              description: 'Number of records to skip for pagination (optional)'
            },
            fields: {
              type: 'string',
              description: 'Comma-separated list of fields to return (optional)'
            },
            order_by: {
              type: 'string',
              description: 'Field to sort by (e.g., "created_on" or "-priority" for descending) (optional)'
            }
          },
          required: []
        }
      },
      {
        name: 'SN-Create-Incident',
        description: 'Create a new Incident',
        inputSchema: {
          type: 'object',
          properties: {
            short_description: { type: 'string', description: 'short description (required)' },
            description: { type: 'string', description: 'description (optional)' },
            caller_id: { type: 'string', description: 'caller id (optional)' },
            category: { type: 'string', description: 'category (optional)' },
            subcategory: { type: 'string', description: 'subcategory (optional)' },
            urgency: { type: 'string', description: 'urgency (optional)' },
            impact: { type: 'string', description: 'impact (optional)' },
            priority: { type: 'string', description: 'priority (optional)' },
            assigned_to: { type: 'string', description: 'assigned to (optional)' },
            assignment_group: { type: 'string', description: 'assignment group (optional)' },
            state: { type: 'string', description: 'state (optional)' },
            work_notes: { type: 'string', description: 'work notes (optional)' },
            sys_created_by: { type: 'string', description: 'sys created by (optional)' },
            sys_created_on: { type: 'string', description: 'sys created on (optional)' },
            sys_updated_by: { type: 'string', description: 'sys updated by (optional)' },
            sys_updated_on: { type: 'string', description: 'sys updated on (optional)' }
          },
          required: ['short_description']
        }
      },
      {
        name: 'SN-Get-Incident',
        description: 'Get a Incident by ID',
        inputSchema: {
          type: 'object',
          properties: {
            sys_id: { type: 'string', description: 'System ID' }
          },
          required: ['sys_id']
        }
      },
      {
        name: 'SN-List-SysUsers',
        description: 'List Sys User records with filtering and pagination',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'ServiceNow encoded query string (e.g., "state=1^priority=1") (optional)'
            },
            limit: {
              type: 'number',
              description: 'Maximum number of records to return (default: 25)',
              default: 25
            },
            offset: {
              type: 'number',
              description: 'Number of records to skip for pagination (optional)'
            },
            fields: {
              type: 'string',
              description: 'Comma-separated list of fields to return (optional)'
            },
            order_by: {
              type: 'string',
              description: 'Field to sort by (e.g., "created_on" or "-priority" for descending) (optional)'
            }
          },
          required: []
        }
      },
      {
        name: 'SN-List-CmdbCis',
        description: 'List Cmdb Ci records with filtering and pagination',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'ServiceNow encoded query string (e.g., "state=1^priority=1") (optional)'
            },
            limit: {
              type: 'number',
              description: 'Maximum number of records to return (default: 25)',
              default: 25
            },
            offset: {
              type: 'number',
              description: 'Number of records to skip for pagination (optional)'
            },
            fields: {
              type: 'string',
              description: 'Comma-separated list of fields to return (optional)'
            },
            order_by: {
              type: 'string',
              description: 'Field to sort by (e.g., "created_on" or "-priority" for descending) (optional)'
            }
          },
          required: []
        }
      },
      {
        name: 'SN-List-SysUserGroups',
        description: 'List Sys User Group records with filtering and pagination',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'ServiceNow encoded query string (e.g., "state=1^priority=1") (optional)'
            },
            limit: {
              type: 'number',
              description: 'Maximum number of records to return (default: 25)',
              default: 25
            },
            offset: {
              type: 'number',
              description: 'Number of records to skip for pagination (optional)'
            },
            fields: {
              type: 'string',
              description: 'Comma-separated list of fields to return (optional)'
            },
            order_by: {
              type: 'string',
              description: 'Field to sort by (e.g., "created_on" or "-priority" for descending) (optional)'
            }
          },
          required: []
        }
      },
      {
        name: 'SN-List-ChangeRequests',
        description: 'List Change Request records with filtering and pagination',
        inputSchema: {
          type: 'object',
          properties: {
            state: {
              type: 'string',
              description: 'Filter by change state (optional)'
            },
            type: {
              type: 'string',
              description: 'Filter by change type (e.g., "Normal", "Emergency") (optional)'
            },
            query: {
              type: 'string',
              description: 'ServiceNow encoded query string (e.g., "state=1^priority=1") (optional)'
            },
            limit: {
              type: 'number',
              description: 'Maximum number of records to return (default: 25)',
              default: 25
            },
            offset: {
              type: 'number',
              description: 'Number of records to skip for pagination (optional)'
            },
            fields: {
              type: 'string',
              description: 'Comma-separated list of fields to return (optional)'
            },
            order_by: {
              type: 'string',
              description: 'Field to sort by (e.g., "created_on" or "-priority" for descending) (optional)'
            }
          },
          required: []
        }
      },
      {
        name: 'SN-Set-Update-Set',
        description: 'Generate a fix script to set the current update set using GlideUpdateSet API. Cannot be done via REST API - creates script file for manual execution in ServiceNow UI.',
        inputSchema: {
          type: 'object',
          properties: {
            update_set_sys_id: {
              type: 'string',
              description: 'System ID of the update set to make current (required)'
            }
          },
          required: ['update_set_sys_id']
        }
      },
      {
        name: 'SN-Get-Current-Update-Set',
        description: 'Get the currently active update set',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'SN-List-Update-Sets',
        description: 'List available update sets',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'ServiceNow encoded query string (e.g., "state=in progress") (optional)'
            },
            limit: {
              type: 'number',
              description: 'Maximum number of records to return (default: 25)',
              default: 25
            },
            offset: {
              type: 'number',
              description: 'Number of records to skip for pagination (optional)'
            },
            fields: {
              type: 'string',
              description: 'Comma-separated list of fields to return (optional)'
            },
            order_by: {
              type: 'string',
              description: 'Field to sort by (e.g., "created_on" or "-sys_created_on" for descending) (optional)'
            }
          },
          required: []
        }
      },
      {
        name: 'SN-Set-Current-Application',
        description: 'Set the current application scope using the UI API. This changes which application is active for development and configuration changes.',
        inputSchema: {
          type: 'object',
          properties: {
            app_sys_id: {
              type: 'string',
              description: 'System ID of the application to make current (required)'
            }
          },
          required: ['app_sys_id']
        }
      },
      {
        name: 'SN-List-Problems',
        description: 'List Problem records with filtering and pagination',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'ServiceNow encoded query string (e.g., "state=1^priority=1") (optional)'
            },
            limit: {
              type: 'number',
              description: 'Maximum number of records to return (default: 25)',
              default: 25
            },
            offset: {
              type: 'number',
              description: 'Number of records to skip for pagination (optional)'
            },
            fields: {
              type: 'string',
              description: 'Comma-separated list of fields to return (optional)'
            },
            order_by: {
              type: 'string',
              description: 'Field to sort by (e.g., "created_on" or "-priority" for descending) (optional)'
            }
          },
          required: []
        }
      },
      {
        name: 'SN-Execute-Background-Script',
        description: '🚀 EXECUTES background scripts with THREE methods: (1) sys_trigger [DEFAULT & MOST RELIABLE] - Creates scheduled job that runs in 1 second and auto-deletes, (2) UI endpoint (sys.scripts.do) - Attempts direct execution via UI, (3) Fix script - Manual fallback. Use for: setting update sets, complex GlideRecord operations, GlideUpdateSet API calls, etc. The sys_trigger method is most reliable and works consistently!',
        inputSchema: {
          type: 'object',
          properties: {
            script: {
              type: 'string',
              description: 'JavaScript code to execute (required)'
            },
            description: {
              type: 'string',
              description: 'Description of what the script does (optional)'
            },
            execution_method: {
              type: 'string',
              description: 'Execution method: "trigger" (default - most reliable), "ui" (UI endpoint), "auto" (try trigger then ui then fix script)',
              enum: ['trigger', 'ui', 'auto'],
              default: 'trigger'
            }
          },
          required: ['script']
        }
      },
      {
        name: 'SN-Create-Fix-Script',
        description: '⚠️ CREATES (not executes) a fix script file for MANUAL execution. ServiceNow REST API does NOT support direct script execution. This tool generates a .js file in /scripts/ directory with full instructions and optional auto-delete flag. You MUST manually copy and run the script in ServiceNow UI: System Definition → Scripts - Background. Use for: linking UI Policy Actions, setting update sets, complex GlideRecord operations that cannot be done via REST API.',
        inputSchema: {
          type: 'object',
          properties: {
            script_name: {
              type: 'string',
              description: 'Name for the script file (e.g., "link_ui_policy_actions") (required)'
            },
            script_content: {
              type: 'string',
              description: 'JavaScript code content (required)'
            },
            description: {
              type: 'string',
              description: 'Description of what the script does (optional)'
            },
            auto_delete: {
              type: 'boolean',
              description: 'If true, script file will be deleted after you confirm execution (default: false)',
              default: false
            }
          },
          required: ['script_name', 'script_content']
        }
      },
      {
        name: 'SN-Discover-Table-Schema',
        description: 'Deep schema introspection with ServiceNow-specific metadata including type codes, choice tables, and relationships',
        inputSchema: {
          type: 'object',
          properties: {
            table_name: {
              type: 'string',
              description: 'ServiceNow table name (required)'
            },
            include_type_codes: {
              type: 'boolean',
              description: 'Show internal type codes (e.g., 1=Choice, 5=Select Box) (optional)',
              default: false
            },
            include_choice_tables: {
              type: 'boolean',
              description: 'Show which choice tables to use (optional)',
              default: false
            },
            include_relationships: {
              type: 'boolean',
              description: 'Show parent/child table relationships (optional)',
              default: false
            },
            include_ui_policies: {
              type: 'boolean',
              description: 'Show UI policies affecting this table (optional)',
              default: false
            },
            include_business_rules: {
              type: 'boolean',
              description: 'Show business rules for this table (optional)',
              default: false
            },
            include_field_constraints: {
              type: 'boolean',
              description: 'Show field validations and defaults (optional)',
              default: false
            }
          },
          required: ['table_name']
        }
      },
      {
        name: 'SN-Batch-Create',
        description: 'Create multiple related records in one operation with variable references and transactional support',
        inputSchema: {
          type: 'object',
          properties: {
            operations: {
              type: 'array',
              description: 'Array of create operations. Each operation can reference previous operations via ${save_as_name}',
              items: {
                type: 'object',
                properties: {
                  table: { type: 'string', description: 'Table name' },
                  data: { type: 'object', description: 'Record data' },
                  save_as: { type: 'string', description: 'Variable name to save sys_id as (optional)' }
                }
              }
            },
            transaction: {
              type: 'boolean',
              description: 'All-or-nothing transaction (default: true)',
              default: true
            }
          },
          required: ['operations']
        }
      },
      {
        name: 'SN-Batch-Update',
        description: 'Update multiple records efficiently in a single operation',
        inputSchema: {
          type: 'object',
          properties: {
            updates: {
              type: 'array',
              description: 'Array of update operations',
              items: {
                type: 'object',
                properties: {
                  table: { type: 'string', description: 'Table name' },
                  sys_id: { type: 'string', description: 'Record sys_id' },
                  data: { type: 'object', description: 'Fields to update' }
                }
              }
            },
            stop_on_error: {
              type: 'boolean',
              description: 'Stop processing on first error (default: false)',
              default: false
            }
          },
          required: ['updates']
        }
      },
      {
        name: 'SN-Explain-Field',
        description: 'Get comprehensive explanation of a specific field including type, constraints, and known issues',
        inputSchema: {
          type: 'object',
          properties: {
            table: {
              type: 'string',
              description: 'Table name (required)'
            },
            field: {
              type: 'string',
              description: 'Field name (required)'
            },
            include_examples: {
              type: 'boolean',
              description: 'Include usage examples (default: true)',
              default: true
            }
          },
          required: ['table', 'field']
        }
      },
      {
        name: 'SN-Validate-Configuration',
        description: 'Validate catalog item configuration including variables, UI policies, and business rules',
        inputSchema: {
          type: 'object',
          properties: {
            catalog_item: {
              type: 'string',
              description: 'Catalog item sys_id (required)'
            },
            checks: {
              type: 'object',
              description: 'Validation checks to perform',
              properties: {
                variables: {
                  type: 'object',
                  properties: {
                    check_linked: { type: 'boolean' },
                    check_types: { type: 'boolean' },
                    check_choices: { type: 'boolean' },
                    check_mandatory: { type: 'boolean' }
                  }
                },
                ui_policies: {
                  type: 'object',
                  properties: {
                    check_conditions: { type: 'boolean' },
                    check_actions_linked: { type: 'boolean' },
                    check_variables_exist: { type: 'boolean' }
                  }
                }
              }
            }
          },
          required: ['catalog_item']
        }
      },
      {
        name: 'SN-Inspect-Update-Set',
        description: 'Inspect update set contents and verify completeness',
        inputSchema: {
          type: 'object',
          properties: {
            update_set: {
              type: 'string',
              description: 'Update set sys_id (required)'
            },
            show_components: {
              type: 'boolean',
              description: 'Show component breakdown (default: true)',
              default: true
            },
            show_dependencies: {
              type: 'boolean',
              description: 'Show missing dependencies (default: false)',
              default: false
            }
          },
          required: ['update_set']
        }
      },
      {
        name: 'SN-Create-Workflow',
        description: 'Create a complete ServiceNow workflow with activities, transitions, and conditions. This tool orchestrates the entire workflow creation process: base workflow → version → activities → transitions → publish.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Workflow name (required)'
            },
            description: {
              type: 'string',
              description: 'Workflow description (optional)'
            },
            table: {
              type: 'string',
              description: 'Table this workflow runs against (e.g., "incident", "change_request")'
            },
            condition: {
              type: 'string',
              description: 'Condition for workflow to trigger (e.g., "state=1^priority=1") (optional)'
            },
            activities: {
              type: 'array',
              description: 'Array of activity definitions',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Activity name' },
                  script: { type: 'string', description: 'JavaScript code to execute' },
                  activity_definition_sys_id: { type: 'string', description: 'Activity type sys_id (optional)' }
                },
                required: ['name']
              }
            },
            transitions: {
              type: 'array',
              description: 'Array of transition definitions (connects activities)',
              items: {
                type: 'object',
                properties: {
                  from: { type: 'string', description: 'From activity name' },
                  to: { type: 'string', description: 'To activity name' },
                  condition_script: { type: 'string', description: 'JavaScript condition (optional)' }
                },
                required: ['from', 'to']
              }
            },
            publish: {
              type: 'boolean',
              description: 'Publish workflow after creation (default: false)',
              default: false
            }
          },
          required: ['name', 'table', 'activities']
        }
      },
      {
        name: 'SN-Create-Activity',
        description: 'Create a single workflow activity with embedded JavaScript code. Use this for adding activities to existing workflows.',
        inputSchema: {
          type: 'object',
          properties: {
            workflow_version_sys_id: {
              type: 'string',
              description: 'Workflow version sys_id (required)'
            },
            name: {
              type: 'string',
              description: 'Activity name (required)'
            },
            script: {
              type: 'string',
              description: 'JavaScript code to execute in this activity (optional)'
            },
            activity_definition_sys_id: {
              type: 'string',
              description: 'Activity type sys_id (optional - defaults to generic activity)'
            },
            x: {
              type: 'number',
              description: 'X coordinate on canvas (default: 100)'
            },
            y: {
              type: 'number',
              description: 'Y coordinate on canvas (default: 100)'
            }
          },
          required: ['workflow_version_sys_id', 'name']
        }
      },
      {
        name: 'SN-Create-Transition',
        description: 'Create a transition between two workflow activities with optional condition',
        inputSchema: {
          type: 'object',
          properties: {
            from_activity_sys_id: {
              type: 'string',
              description: 'From activity sys_id (required)'
            },
            to_activity_sys_id: {
              type: 'string',
              description: 'To activity sys_id (required)'
            },
            condition_script: {
              type: 'string',
              description: 'JavaScript condition for this transition (optional)'
            },
            order: {
              type: 'number',
              description: 'Transition order (default: 1)'
            }
          },
          required: ['from_activity_sys_id', 'to_activity_sys_id']
        }
      },
      {
        name: 'SN-Publish-Workflow',
        description: 'Publish a workflow version, setting the start activity and making it active',
        inputSchema: {
          type: 'object',
          properties: {
            version_sys_id: {
              type: 'string',
              description: 'Workflow version sys_id (required)'
            },
            start_activity_sys_id: {
              type: 'string',
              description: 'Starting activity sys_id (required)'
            }
          },
          required: ['version_sys_id', 'start_activity_sys_id']
        }
      },
      {
        name: 'SN-Move-Records-To-Update-Set',
        description: 'Move sys_update_xml records to a different update set. Supports filtering by sys_ids, time range, or source update set. Extremely useful when records end up in wrong update set (e.g., "Default" instead of custom set).',
        inputSchema: {
          type: 'object',
          properties: {
            update_set_id: {
              type: 'string',
              description: 'Target update set sys_id to move records to (required)'
            },
            record_sys_ids: {
              type: 'array',
              description: 'Array of sys_update_xml sys_ids to move (optional)',
              items: { type: 'string' }
            },
            time_range: {
              type: 'object',
              description: 'Time range to filter records (optional - format: YYYY-MM-DD HH:MM:SS)',
              properties: {
                start: { type: 'string', description: 'Start time (e.g., "2025-09-29 20:00:00")' },
                end: { type: 'string', description: 'End time (e.g., "2025-09-29 20:03:31")' }
              }
            },
            source_update_set: {
              type: 'string',
              description: 'Filter by source update set name (e.g., "Default") (optional)'
            },
            table: {
              type: 'string',
              description: 'Table name (default: sys_update_xml)',
              default: 'sys_update_xml'
            }
          },
          required: ['update_set_id']
        }
      },
      {
        name: 'SN-Clone-Update-Set',
        description: 'Clone an entire update set with all its sys_update_xml records. Creates a complete copy for backup, testing, or branching development work.',
        inputSchema: {
          type: 'object',
          properties: {
            source_update_set_id: {
              type: 'string',
              description: 'Source update set sys_id to clone (required)'
            },
            new_name: {
              type: 'string',
              description: 'Name for the new cloned update set (required)'
            }
          },
          required: ['source_update_set_id', 'new_name']
        }
      }
    ];

    console.error(`✅ Returning ${tools.length} consolidated tools to Claude Code`);
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'SN-Set-Instance': {
          const { instance_name } = args;

          // If no instance name provided, list available instances
          if (!instance_name) {
            const instances = configManager.listInstances();
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  message: 'Available ServiceNow instances',
                  current_instance: serviceNowClient.getCurrentInstance(),
                  instances: instances
                }, null, 2)
              }]
            };
          }

          // Get instance configuration
          const instance = configManager.getInstance(instance_name);

          // Switch the client to the new instance
          serviceNowClient.setInstance(instance.url, instance.username, instance.password, instance.name);

          console.error(`🔄 Switched to instance: ${instance.name} (${instance.url})`);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Switched to ServiceNow instance: ${instance.name}`,
                instance: {
                  name: instance.name,
                  url: instance.url,
                  description: instance.description
                }
              }, null, 2)
            }]
          };
        }

        case 'SN-Get-Current-Instance': {
          const currentInstance = serviceNowClient.getCurrentInstance();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                current_instance: currentInstance,
                message: `Currently connected to: ${currentInstance.name} (${currentInstance.url})`
              }, null, 2)
            }]
          };
        }

        case 'SN-Query-Table': {
          const { table_name, query, fields, limit = 25, offset, order_by } = args;

          const queryParams = {
            sysparm_limit: limit,
            sysparm_query: query,
            sysparm_fields: fields,
            sysparm_offset: offset
          };

          if (order_by) {
            queryParams.sysparm_order_by = order_by;
          }

          const results = await serviceNowClient.getRecords(table_name, queryParams);

          return {
            content: [{
              type: 'text',
              text: `Found ${results.length} records in ${table_name}:\n${JSON.stringify(results, null, 2)}`
            }]
          };
        }

        case 'SN-Create-Record': {
          const { table_name, data } = args;
          const result = await serviceNowClient.createRecord(table_name, data);

          const metadata = tableMetadata[table_name];
          const keyField = metadata?.key_field || 'sys_id';
          const identifier = result[keyField] || result.sys_id;

          return {
            content: [{
              type: 'text',
              text: `Created ${metadata?.label || table_name} successfully: ${identifier}\n${JSON.stringify(result, null, 2)}`
            }]
          };
        }

        case 'SN-Get-Record': {
          const { table_name, sys_id, fields } = args;

          const queryParams = {};
          if (fields) queryParams.sysparm_fields = fields;

          const result = await serviceNowClient.getRecord(table_name, sys_id, queryParams);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          };
        }

        case 'SN-Update-Record': {
          const { table_name, sys_id, data } = args;
          const result = await serviceNowClient.updateRecord(table_name, sys_id, data);

          const metadata = tableMetadata[table_name];
          const keyField = metadata?.key_field || 'sys_id';
          const identifier = result[keyField] || sys_id;

          return {
            content: [{
              type: 'text',
              text: `Updated ${metadata?.label || table_name} ${identifier} successfully\n${JSON.stringify(result, null, 2)}`
            }]
          };
        }

        case 'SN-Get-Table-Schema': {
          const { table_name } = args;
          const schema = tableMetadata[table_name];

          if (!schema) {
            // FALLBACK: Try to fetch schema from ServiceNow API
            console.error(`⚠️  Table "${table_name}" not in local metadata, attempting API fallback...`);
            try {
              const apiSchema = await serviceNowClient.discoverTableSchema(table_name, {
                include_type_codes: false,
                include_choice_tables: false,
                include_relationships: false
              });

              return {
                content: [{
                  type: 'text',
                  text: `Schema for ${table_name} (fetched from ServiceNow API):\n${JSON.stringify({
                    table_name,
                    label: apiSchema.label,
                    fields: apiSchema.fields,
                    source: 'live_api',
                    note: 'This table is not in local metadata. Consider adding it to comprehensive-table-definitions.json for faster lookups.'
                  }, null, 2)}`
                }]
              };
            } catch (error) {
              return {
                content: [{
                  type: 'text',
                  text: `No schema metadata found for table "${table_name}" in local cache, and API lookup failed: ${error.message}. The table may not exist or you may not have permissions. Use SN-Query-Table to attempt to query it.`
                }],
                isError: false
              };
            }
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                table_name,
                label: schema.label,
                key_field: schema.key_field,
                display_field: schema.display_field,
                required_fields: schema.required_fields || [],
                common_fields: schema.common_fields || [],
                operations: schema.operations || ['create', 'read', 'update', 'list'],
                description: schema.description,
                package: schema.package,
                source: 'local_cache'
              }, null, 2)
            }]
          };
        }

        case 'SN-List-Available-Tables': {
          const { category } = args;

          const categories = {
            core_itsm: ['incident', 'change_request', 'problem', 'change_task', 'problem_task'],
            platform: ['sys_user', 'sys_user_group', 'sys_db_object', 'sys_dictionary', 'sys_properties'],
            service_catalog: ['sc_request', 'sc_req_item', 'sc_cat_item', 'sc_category'],
            cmdb: ['cmdb_ci', 'cmdb_ci_computer', 'cmdb_ci_server', 'cmdb_rel_ci']
          };

          let tablesToList = Object.keys(tableMetadata);

          if (category && category !== 'all' && categories[category]) {
            tablesToList = tablesToList.filter(t => categories[category].includes(t));
          }

          const tableList = tablesToList.map(tableName => {
            const meta = tableMetadata[tableName];
            return {
              table_name: tableName,
              label: meta.label,
              description: meta.description,
              key_field: meta.key_field,
              priority: meta.priority,
              package: meta.package
            };
          });

          return {
            content: [{
              type: 'text',
              text: `Available ServiceNow tables (${tableList.length} total):\n${JSON.stringify(tableList, null, 2)}`
            }]
          };
        }

        // Convenience tool handlers
        case 'SN-List-Incidents': {
          const { state, priority, query, limit = 25, offset, fields, order_by } = args;

          let finalQuery = query || '';
          if (state && !finalQuery.includes('state')) {
            finalQuery += (finalQuery ? '^' : '') + `state=${state}`;
          }
          if (priority && !finalQuery.includes('priority')) {
            finalQuery += (finalQuery ? '^' : '') + `priority=${priority}`;
          }

          const queryParams = {
            sysparm_limit: limit,
            sysparm_query: finalQuery || undefined,
            sysparm_fields: fields,
            sysparm_offset: offset
          };

          if (order_by) {
            queryParams.sysparm_order_by = order_by;
          }

          const results = await serviceNowClient.getRecords('incident', queryParams);

          return {
            content: [{
              type: 'text',
              text: `Found ${results.length} Incident(s):\n${JSON.stringify(results, null, 2)}`
            }]
          };
        }

        case 'SN-Create-Incident': {
          const result = await serviceNowClient.createRecord('incident', args);
          return {
            content: [{
              type: 'text',
              text: `Created Incident: ${result.number}\n${JSON.stringify(result, null, 2)}`
            }]
          };
        }

        case 'SN-Get-Incident': {
          const result = await serviceNowClient.getRecord('incident', args.sys_id);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          };
        }

        case 'SN-List-SysUsers': {
          const { query, limit = 25, offset, fields, order_by } = args;

          const queryParams = {
            sysparm_limit: limit,
            sysparm_query: query,
            sysparm_fields: fields,
            sysparm_offset: offset
          };

          if (order_by) {
            queryParams.sysparm_order_by = order_by;
          }

          const results = await serviceNowClient.getRecords('sys_user', queryParams);

          return {
            content: [{
              type: 'text',
              text: `Found ${results.length} Sys User(s):\n${JSON.stringify(results, null, 2)}`
            }]
          };
        }

        case 'SN-List-CmdbCis': {
          const { query, limit = 25, offset, fields, order_by } = args;

          const queryParams = {
            sysparm_limit: limit,
            sysparm_query: query,
            sysparm_fields: fields,
            sysparm_offset: offset
          };

          if (order_by) {
            queryParams.sysparm_order_by = order_by;
          }

          const results = await serviceNowClient.getRecords('cmdb_ci', queryParams);

          return {
            content: [{
              type: 'text',
              text: `Found ${results.length} Cmdb Ci(s):\n${JSON.stringify(results, null, 2)}`
            }]
          };
        }

        case 'SN-List-SysUserGroups': {
          const { query, limit = 25, offset, fields, order_by } = args;

          const queryParams = {
            sysparm_limit: limit,
            sysparm_query: query,
            sysparm_fields: fields,
            sysparm_offset: offset
          };

          if (order_by) {
            queryParams.sysparm_order_by = order_by;
          }

          const results = await serviceNowClient.getRecords('sys_user_group', queryParams);

          return {
            content: [{
              type: 'text',
              text: `Found ${results.length} Sys User Group(s):\n${JSON.stringify(results, null, 2)}`
            }]
          };
        }

        case 'SN-List-ChangeRequests': {
          const { state, type, query, limit = 25, offset, fields, order_by } = args;

          let finalQuery = query || '';
          if (state && !finalQuery.includes('state')) {
            finalQuery += (finalQuery ? '^' : '') + `state=${state}`;
          }
          if (type && !finalQuery.includes('type')) {
            finalQuery += (finalQuery ? '^' : '') + `type=${type}`;
          }

          const queryParams = {
            sysparm_limit: limit,
            sysparm_query: finalQuery || undefined,
            sysparm_fields: fields,
            sysparm_offset: offset
          };

          if (order_by) {
            queryParams.sysparm_order_by = order_by;
          }

          const results = await serviceNowClient.getRecords('change_request', queryParams);

          return {
            content: [{
              type: 'text',
              text: `Found ${results.length} Change Request(s):\n${JSON.stringify(results, null, 2)}`
            }]
          };
        }

        case 'SN-List-Problems': {
          const { query, limit = 25, offset, fields, order_by } = args;

          const queryParams = {
            sysparm_limit: limit,
            sysparm_query: query,
            sysparm_fields: fields,
            sysparm_offset: offset
          };

          if (order_by) {
            queryParams.sysparm_order_by = order_by;
          }

          const results = await serviceNowClient.getRecords('problem', queryParams);

          return {
            content: [{
              type: 'text',
              text: `Found ${results.length} Problem(s):\n${JSON.stringify(results, null, 2)}`
            }]
          };
        }

        case 'SN-Set-Update-Set': {
          const { update_set_sys_id } = args;

          console.error(`🔄 Setting current update set to: ${update_set_sys_id}`);

          try {
            // Try to set via API (UI endpoint or sys_trigger)
            const result = await serviceNowClient.setCurrentUpdateSet(update_set_sys_id);

            if (result.method === 'sys_trigger') {
              return {
                content: [{
                  type: 'text',
                  text: `✅ Update set change scheduled via sys_trigger!

Update Set: ${result.update_set}
sys_id: ${result.sys_id}

🔧 Method: sys_trigger (scheduled job)
📊 Trigger Details:
- Trigger sys_id: ${result.trigger_details.trigger_sys_id}
- Trigger name: ${result.trigger_details.trigger_name}
- Scheduled time: ${result.trigger_details.next_action}
- Auto-delete: ${result.trigger_details.auto_delete ? 'Yes' : 'No'}

The script will execute in ~1 second and set your current update set. Refresh your ServiceNow browser after 2 seconds to see the change in the top bar.`
                }]
              };
            } else {
              return {
                content: [{
                  type: 'text',
                  text: `✅ Update set set to current: ${result.update_set}

🔧 Method: UI API endpoint (/api/now/ui/concoursepicker/updateset)
📊 Response: ${JSON.stringify(result.response, null, 2)}

The update set has been set as your current update set. Refresh your ServiceNow browser to see the change in the top bar.`
                }]
              };
            }
          } catch (error) {
            // If both methods fail, fall back to creating fix script
            console.error('⚠️  Direct update set change failed, creating fix script...');

            const updateSet = await serviceNowClient.getRecord('sys_update_set', update_set_sys_id);

            const fs = await import('fs/promises');
            const path = await import('path');

            const scriptsDir = path.resolve(process.cwd(), 'scripts');
            await fs.mkdir(scriptsDir, { recursive: true });

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = `set_update_set_${updateSet.name?.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}.js`;
            const filePath = path.join(scriptsDir, fileName);

            const scriptContent = `// Set current update set using GlideUpdateSet API
var gus = new GlideUpdateSet();
gus.set('${update_set_sys_id}');
gs.info('✅ Update set changed to: ${updateSet.name}');`;

            const fileContent = `/**
 * Fix Script: Set Current Update Set
 * Update Set: ${updateSet.name}
 * Update Set sys_id: ${update_set_sys_id}
 * Created: ${new Date().toISOString()}
 *
 * Note: Automated methods failed. Manual execution required.
 *
 * INSTRUCTIONS:
 * 1. Copy the script below (the GlideUpdateSet part)
 * 2. Navigate to ServiceNow: System Definition → Scripts - Background
 * 3. Paste the script
 * 4. Click "Run script"
 * 5. Verify output: "Update set changed to: ${updateSet.name}"
 * 6. Refresh your browser to see the update set in the top bar
 *
 * ALTERNATIVE: Manual UI Method
 * 1. Navigate to: System Update Sets → Local Update Sets
 * 2. Find: ${updateSet.name}
 * 3. Click "Make this my current set"
 */

${scriptContent}`;

            await fs.writeFile(filePath, fileContent, 'utf-8');

            return {
              content: [{
                type: 'text',
                text: `⚠️ Automated update set change not available.
Created fix script for manual execution: ${filePath}

Update Set: ${updateSet.name}
Sys ID: ${update_set_sys_id}

🔧 To Apply:
1. Open: ${filePath}
2. Copy the GlideUpdateSet script
3. Run in ServiceNow: System Definition → Scripts - Background
4. Refresh browser to see change

💡 Alternative: Set manually in UI (System Update Sets → Local Update Sets → Make Current)`
              }]
            };
          }
        }

        case 'SN-Get-Current-Update-Set': {
          const result = await serviceNowClient.getCurrentUpdateSet();

          return {
            content: [{
              type: 'text',
              text: `Current update set:\n${JSON.stringify(result, null, 2)}`
            }]
          };
        }

        case 'SN-List-Update-Sets': {
          const { query, limit = 25, offset, fields, order_by } = args;

          const queryParams = {
            sysparm_limit: limit,
            sysparm_query: query,
            sysparm_fields: fields,
            sysparm_offset: offset
          };

          if (order_by) {
            queryParams.sysparm_order_by = order_by;
          }

          const results = await serviceNowClient.listUpdateSets(queryParams);

          return {
            content: [{
              type: 'text',
              text: `Found ${results.length} Update Set(s):\n${JSON.stringify(results, null, 2)}`
            }]
          };
        }

        case 'SN-Set-Current-Application': {
          const { app_sys_id } = args;

          console.error(`🔄 Setting current application to: ${app_sys_id}`);

          try {
            const result = await serviceNowClient.setCurrentApplication(app_sys_id);

            return {
              content: [{
                type: 'text',
                text: `✅ Application set to current: ${result.application}

🔧 Method: UI API endpoint (/api/now/ui/concoursepicker/application)
📊 Response: ${JSON.stringify(result.response, null, 2)}

The application scope has been set as your current application. Refresh your ServiceNow browser to see the change in the top bar.`
              }]
            };
          } catch (error) {
            console.error('❌ Failed to set current application:', error);
            return {
              content: [{
                type: 'text',
                text: `❌ Failed to set current application: ${error.message}

Please verify:
1. The app_sys_id is valid
2. You have permissions to access the application
3. The application exists in your instance`
              }]
            };
          }
        }

        case 'SN-Execute-Background-Script': {
          const { script, description } = args;

          console.error(`🚀 Executing background script via sys_trigger...`);

          try {
            // Primary method: sys_trigger (ONLY working method)
            const result = await serviceNowClient.executeScriptViaTrigger(script, description, true);

            return {
              content: [{
                type: 'text',
                text: `✅ Script scheduled for execution via sys_trigger!

${description ? `Description: ${description}\n` : ''}
📊 Trigger Details:
- Trigger sys_id: ${result.trigger_sys_id}
- Trigger name: ${result.trigger_name}
- Scheduled time: ${result.next_action}
- Auto-delete: ${result.auto_delete ? 'Yes' : 'No'}

${result.message}

The script will execute in ~1 second. You can monitor execution in:
- System Logs → System Log → All
- System Definition → Scheduled Jobs (filter by name: ${result.trigger_name})

🔍 Script to execute:
${script.substring(0, 300)}${script.length > 300 ? '...' : ''}`
              }]
            };
          } catch (triggerError) {
            // Fallback: Create fix script if sys_trigger fails
            console.error('⚠️  Trigger method failed, creating fix script...', triggerError.message);

            // Fallback: Create fix script file
            const fs = await import('fs/promises');
            const path = await import('path');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const script_name = `background_script_${timestamp}`;

            const scriptsDir = path.resolve(process.cwd(), 'scripts');
            await fs.mkdir(scriptsDir, { recursive: true });

            const fileName = `${script_name}.js`;
            const filePath = path.join(scriptsDir, fileName);

            const fileContent = `/**
 * Background Script (Manual Execution Required)
 * Created: ${new Date().toISOString()}
 * ${description ? `Description: ${description}` : ''}
 *
 * Note: Direct execution failed due to authentication requirements.
 * This script must be executed manually in ServiceNow UI.
 *
 * INSTRUCTIONS:
 * 1. Copy the script below
 * 2. Navigate to ServiceNow: System Definition → Scripts - Background
 * 3. Paste the script
 * 4. Click "Run script"
 * 5. Verify output in the output panel
 */

${script}

// End of script
`;

            await fs.writeFile(filePath, fileContent, 'utf-8');

            return {
              content: [{
                type: 'text',
                text: `⚠️ Direct execution not available (requires UI session).
Created fix script for manual execution: ${filePath}

📋 To Execute Manually:
1. Open: ${filePath}
2. Copy the script content
3. In ServiceNow: System Definition → Scripts - Background
4. Paste and click "Run script"

Script Preview:
${script.substring(0, 200)}${script.length > 200 ? '...' : ''}`
              }]
            };
          }
        }

        case 'SN-Create-Fix-Script': {
          const { script_name, script_content, description, auto_delete = false } = args;

          console.error(`📝 Creating fix script: ${script_name}`);

          // Import fs for file operations
          const fs = await import('fs/promises');
          const path = await import('path');

          // Ensure /scripts directory exists
          const scriptsDir = path.resolve(process.cwd(), 'scripts');
          await fs.mkdir(scriptsDir, { recursive: true });

          // Generate script file with header
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const fileName = `${script_name}_${timestamp}.js`;
          const filePath = path.join(scriptsDir, fileName);

          const fileContent = `/**
 * Fix Script: ${script_name}
 * Created: ${new Date().toISOString()}
 * ${description ? `Description: ${description}` : ''}
 *
 * INSTRUCTIONS:
 * 1. Copy the entire script below
 * 2. Navigate to ServiceNow: System Definition → Scripts - Background
 * 3. Paste the script
 * 4. Click "Run script"
 * 5. Verify output in the output panel
 * ${auto_delete ? '6. Delete this file after successful execution' : ''}
 */

${script_content}

// End of script
`;

          await fs.writeFile(filePath, fileContent, 'utf-8');

          return {
            content: [{
              type: 'text',
              text: `✅ Fix script created: ${filePath}

📋 Next Steps:
1. Open the file: ${filePath}
2. Copy the entire script content
3. In ServiceNow, navigate to: System Definition → Scripts - Background
4. Paste and run the script
5. Verify the output${auto_delete ? '\n6. Delete the file after successful execution' : ''}

Script Preview (first 200 chars):
${script_content.substring(0, 200)}${script_content.length > 200 ? '...' : ''}`
            }]
          };
        }

        case 'SN-Discover-Table-Schema': {
          const {
            table_name,
            include_type_codes = false,
            include_choice_tables = false,
            include_relationships = false,
            include_ui_policies = false,
            include_business_rules = false,
            include_field_constraints = false
          } = args;

          console.error(`🔍 Discovering enhanced schema for ${table_name}`);
          const schema = await serviceNowClient.discoverTableSchema(table_name, {
            include_type_codes,
            include_choice_tables,
            include_relationships,
            include_ui_policies,
            include_business_rules,
            include_field_constraints
          });

          return {
            content: [{
              type: 'text',
              text: `Enhanced schema for ${table_name}:\n${JSON.stringify(schema, null, 2)}`
            }]
          };
        }

        case 'SN-Batch-Create': {
          const { operations, transaction = true } = args;

          console.error(`📦 Batch creating ${operations.length} records (transaction: ${transaction})`);
          const result = await serviceNowClient.batchCreate(operations, transaction);

          return {
            content: [{
              type: 'text',
              text: `Batch create ${result.success ? 'completed' : 'failed'}:\n${JSON.stringify(result, null, 2)}`
            }]
          };
        }

        case 'SN-Batch-Update': {
          const { updates, stop_on_error = false } = args;

          console.error(`📦 Batch updating ${updates.length} records`);
          const result = await serviceNowClient.batchUpdate(updates, stop_on_error);

          return {
            content: [{
              type: 'text',
              text: `Batch update ${result.success ? 'completed' : 'completed with errors'}:\n${JSON.stringify(result, null, 2)}`
            }]
          };
        }

        case 'SN-Explain-Field': {
          const { table, field, include_examples = true } = args;

          console.error(`📖 Explaining field ${table}.${field}`);
          const explanation = await serviceNowClient.explainField(table, field, include_examples);

          return {
            content: [{
              type: 'text',
              text: `Field explanation for ${table}.${field}:\n${JSON.stringify(explanation, null, 2)}`
            }]
          };
        }

        case 'SN-Validate-Configuration': {
          const { catalog_item, checks = {} } = args;

          console.error(`✅ Validating catalog item ${catalog_item}`);
          const validation = await serviceNowClient.validateCatalogConfiguration(catalog_item, checks);

          return {
            content: [{
              type: 'text',
              text: `Validation ${validation.valid ? 'PASSED' : 'FAILED'}:\n${JSON.stringify(validation, null, 2)}`
            }]
          };
        }

        case 'SN-Inspect-Update-Set': {
          const { update_set, show_components = true, show_dependencies = false } = args;

          console.error(`🔎 Inspecting update set ${update_set}`);
          const inspection = await serviceNowClient.inspectUpdateSet(update_set, {
            show_components,
            show_dependencies
          });

          return {
            content: [{
              type: 'text',
              text: `Update set inspection:\n${JSON.stringify(inspection, null, 2)}`
            }]
          };
        }

        case 'SN-Create-Workflow': {
          const { name, description, table, condition, activities, transitions, publish = false } = args;

          console.error(`🔄 Creating workflow: ${name}`);

          // Build workflow specification
          const workflowSpec = {
            name,
            description,
            table,
            condition,
            activities,
            transitions,
            publish
          };

          const result = await serviceNowClient.createCompleteWorkflow(workflowSpec);

          return {
            content: [{
              type: 'text',
              text: `✅ Workflow created successfully!

Workflow: ${result.workflow_name}
Workflow sys_id: ${result.workflow_sys_id}
Version sys_id: ${result.version_sys_id}
Status: ${result.published ? 'Published' : 'Draft'}

Activities created: ${result.activities.length}
${result.activities.map(a => `  - ${a.name} (${a.activity_sys_id})`).join('\n')}

Transitions created: ${result.transitions.length}

${result.published ? '✅ Workflow is published and ready to use!' : '⚠️ Workflow is in draft mode. Use SN-Publish-Workflow to publish it.'}

Full result:
${JSON.stringify(result, null, 2)}`
            }]
          };
        }

        case 'SN-Create-Activity': {
          const { workflow_version_sys_id, name, script, activity_definition_sys_id, x, y } = args;

          console.error(`➕ Creating activity: ${name}`);

          const activityData = {
            workflow_version_sys_id,
            name,
            script,
            activity_definition_sys_id,
            x,
            y
          };

          const result = await serviceNowClient.createActivity(activityData);

          return {
            content: [{
              type: 'text',
              text: `✅ Activity created successfully!

Activity: ${result.name}
Activity sys_id: ${result.activity_sys_id}

You can now:
- Create transitions to/from this activity using SN-Create-Transition
- Add this activity to workflow canvas in ServiceNow UI`
            }]
          };
        }

        case 'SN-Create-Transition': {
          const { from_activity_sys_id, to_activity_sys_id, condition_script, order } = args;

          console.error(`🔗 Creating transition`);

          const transitionData = {
            from_activity_sys_id,
            to_activity_sys_id,
            order
          };

          // If condition script provided, create condition first
          let condition_sys_id = null;
          if (condition_script) {
            const conditionData = {
              activity_sys_id: from_activity_sys_id,
              name: 'Transition Condition',
              condition: condition_script
            };
            const conditionResult = await serviceNowClient.createCondition(conditionData);
            condition_sys_id = conditionResult.condition_sys_id;
            transitionData.condition_sys_id = condition_sys_id;
          }

          const result = await serviceNowClient.createTransition(transitionData);

          return {
            content: [{
              type: 'text',
              text: `✅ Transition created successfully!

Transition sys_id: ${result.transition_sys_id}
From activity: ${from_activity_sys_id}
To activity: ${to_activity_sys_id}
${condition_sys_id ? `Condition sys_id: ${condition_sys_id}` : 'No condition (always transitions)'}

The workflow will now transition from the source activity to the target activity${condition_script ? ' when the condition is met' : ''}.`
            }]
          };
        }

        case 'SN-Publish-Workflow': {
          const { version_sys_id, start_activity_sys_id } = args;

          console.error(`🚀 Publishing workflow version ${version_sys_id}`);

          const result = await serviceNowClient.publishWorkflow(version_sys_id, start_activity_sys_id);

          return {
            content: [{
              type: 'text',
              text: `✅ Workflow published successfully!

Version sys_id: ${result.version_sys_id}
Start activity: ${result.start_activity}
Status: Published

The workflow is now active and will trigger based on its configured conditions.`
            }]
          };
        }

        case 'SN-Move-Records-To-Update-Set': {
          const { update_set_id, record_sys_ids, time_range, source_update_set, table } = args;

          console.error(`📦 Moving records to update set ${update_set_id}`);

          const result = await serviceNowClient.moveRecordsToUpdateSet(update_set_id, {
            record_sys_ids,
            time_range,
            source_update_set,
            table
          });

          return {
            content: [{
              type: 'text',
              text: `✅ Records moved to update set!

Moved: ${result.moved} records
Failed: ${result.failed} records

${result.records.length > 0 ? `\nMoved records:\n${result.records.map(r => `  - ${r.type}: ${r.name} (${r.sys_id})`).join('\n')}` : ''}

${result.errors.length > 0 ? `\n❌ Errors:\n${result.errors.map(e => `  - ${e.sys_id}: ${e.error}`).join('\n')}` : ''}

Full result:
${JSON.stringify(result, null, 2)}`
            }]
          };
        }

        case 'SN-Clone-Update-Set': {
          const { source_update_set_id, new_name } = args;

          console.error(`🔄 Cloning update set ${source_update_set_id}`);

          const result = await serviceNowClient.cloneUpdateSet(source_update_set_id, new_name);

          return {
            content: [{
              type: 'text',
              text: `✅ Update set cloned successfully!

Source Update Set: ${result.source_update_set_name}
Source sys_id: ${result.source_update_set_id}

New Update Set: ${result.new_update_set_name}
New sys_id: ${result.new_update_set_id}

Records cloned: ${result.records_cloned} / ${result.total_source_records}

The cloned update set is now in "In Progress" state and ready for use.`
            }]
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  });

  // Add resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: 'servicenow://instance',
          mimeType: 'application/json',
          name: 'ServiceNow Instance Info',
          description: 'Information about the connected ServiceNow instance'
        },
        {
          uri: 'servicenow://tables/all',
          mimeType: 'application/json',
          name: 'All ServiceNow Tables',
          description: 'Complete list of available ServiceNow tables with metadata'
        }
      ]
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === 'servicenow://instance') {
      const config = {
        server_info: {
          name: 'ServiceNow MCP Server (Consolidated)',
          version: '2.0.0',
          description: 'Consolidated ServiceNow integration with metadata-driven schema lookups'
        },
        instance_info: {
          url: process.env.SERVICENOW_INSTANCE_URL,
          username: process.env.SERVICENOW_USERNAME
        },
        capabilities: {
          total_tables: Object.keys(tableMetadata).length,
          operations: ['create', 'read', 'update', 'query', 'schema_lookup'],
          tools: 6
        }
      };

      return {
        contents: [{
          uri: uri,
          mimeType: 'application/json',
          text: JSON.stringify(config, null, 2)
        }]
      };
    }

    if (uri === 'servicenow://tables/all') {
      return {
        contents: [{
          uri: uri,
          mimeType: 'application/json',
          text: JSON.stringify(tableMetadata, null, 2)
        }]
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  return server;
}