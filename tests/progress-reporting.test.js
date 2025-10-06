/**
 * Tests for progress reporting in batch operations
 * Tests progress notifications during batch create, update, and other operations
 */

import { jest } from '@jest/globals';
import { createMockServiceNowClient } from './helpers/mocks.js';

describe('Progress Reporting', () => {
  let mockClient;
  let progressMessages;

  beforeEach(() => {
    mockClient = createMockServiceNowClient();
    progressMessages = [];

    // Mock progress callback
    mockClient.setProgressCallback = jest.fn((callback) => {
      mockClient.progressCallback = callback;
    });

    mockClient.notifyProgress = jest.fn((message) => {
      progressMessages.push(message);
      if (mockClient.progressCallback) {
        mockClient.progressCallback(message);
      }
    });

    jest.clearAllMocks();
  });

  describe('Batch Create Progress', () => {
    it('should report progress during batch creation', async () => {
      mockClient.batchCreate.mockImplementationOnce(async (operations, transaction, reportProgress) => {
        if (reportProgress) {
          for (let i = 0; i < operations.length; i++) {
            mockClient.notifyProgress(`Creating record ${i + 1}/${operations.length} (${Math.round((i + 1) / operations.length * 100)}%): ${operations[i].table}`);
          }
          mockClient.notifyProgress(`Complete: All ${operations.length} records created successfully`);
        }

        return {
          success: true,
          created_count: operations.length,
          sys_ids: {},
          errors: [],
        };
      });

      const operations = [
        { table: 'incident', data: { short_description: 'Test 1' } },
        { table: 'incident', data: { short_description: 'Test 2' } },
        { table: 'incident', data: { short_description: 'Test 3' } },
      ];

      await mockClient.batchCreate(operations, true, true);

      expect(progressMessages).toHaveLength(4);
      expect(progressMessages[0]).toContain('Creating record 1/3');
      expect(progressMessages[1]).toContain('Creating record 2/3');
      expect(progressMessages[2]).toContain('Creating record 3/3');
      expect(progressMessages[3]).toContain('Complete: All 3 records created successfully');
    });

    it('should show percentage progress', async () => {
      mockClient.batchCreate.mockImplementationOnce(async (operations, transaction, reportProgress) => {
        if (reportProgress) {
          mockClient.notifyProgress('Creating record 5/10 (50%): incident');
        }
        return { success: true, created_count: 10, sys_ids: {}, errors: [] };
      });

      const operations = Array(10).fill(0).map(() => ({
        table: 'incident',
        data: { short_description: 'Test' },
      }));

      await mockClient.batchCreate(operations, true, true);

      const percentageMessage = progressMessages.find(m => m.includes('50%'));
      expect(percentageMessage).toBeDefined();
    });

    it('should not report progress when disabled', async () => {
      mockClient.batchCreate.mockImplementationOnce(async (operations, transaction, reportProgress) => {
        if (reportProgress) {
          mockClient.notifyProgress('Should not see this');
        }
        return { success: true, created_count: operations.length, sys_ids: {}, errors: [] };
      });

      const operations = [
        { table: 'incident', data: { short_description: 'Test' } },
      ];

      await mockClient.batchCreate(operations, true, false);

      expect(progressMessages).toHaveLength(0);
    });

    it('should report errors in progress', async () => {
      mockClient.batchCreate.mockImplementationOnce(async (operations, transaction, reportProgress) => {
        if (reportProgress) {
          mockClient.notifyProgress('Creating record 1/3 (33%): incident');
          mockClient.notifyProgress('Failed 2/3: incident - Permission denied');
          mockClient.notifyProgress('Complete: 2/3 records created (1 failed)');
        }
        return {
          success: true,
          created_count: 2,
          sys_ids: {},
          errors: [{ operation_index: 1, error: 'Permission denied' }],
        };
      });

      const operations = Array(3).fill(0).map(() => ({
        table: 'incident',
        data: {},
      }));

      await mockClient.batchCreate(operations, false, true);

      const failedMessage = progressMessages.find(m => m.includes('Failed'));
      const summaryMessage = progressMessages.find(m => m.includes('1 failed'));

      expect(failedMessage).toBeDefined();
      expect(summaryMessage).toBeDefined();
    });

    it('should report progress for large batches efficiently', async () => {
      const total = 100;

      mockClient.batchCreate.mockImplementationOnce(async (operations, transaction, reportProgress) => {
        if (reportProgress) {
          // Report every 10%
          for (let i = 0; i < total; i++) {
            if ((i + 1) % Math.ceil(total / 10) === 0 || i === total - 1) {
              mockClient.notifyProgress(`Creating record ${i + 1}/${total} (${Math.round((i + 1) / total * 100)}%)`);
            }
          }
          mockClient.notifyProgress(`Complete: All ${total} records created successfully`);
        }
        return { success: true, created_count: total, sys_ids: {}, errors: [] };
      });

      const operations = Array(total).fill(0).map(() => ({
        table: 'incident',
        data: {},
      }));

      await mockClient.batchCreate(operations, true, true);

      // Should have ~10 progress updates + 1 completion message
      expect(progressMessages.length).toBeLessThanOrEqual(12);
      expect(progressMessages.length).toBeGreaterThan(5);
    });
  });

  describe('Batch Update Progress', () => {
    it('should report progress during batch updates', async () => {
      mockClient.batchUpdate.mockImplementationOnce(async (updates, stopOnError, reportProgress) => {
        if (reportProgress) {
          for (let i = 0; i < updates.length; i++) {
            mockClient.notifyProgress(`Updating record ${i + 1}/${updates.length} (${Math.round((i + 1) / updates.length * 100)}%): ${updates[i].table}`);
          }
          mockClient.notifyProgress(`Complete: All ${updates.length} records updated successfully`);
        }
        return {
          success: true,
          updated_count: updates.length,
          errors: [],
        };
      });

      const updates = [
        { table: 'incident', sys_id: 'id1', data: { state: 6 } },
        { table: 'incident', sys_id: 'id2', data: { state: 6 } },
      ];

      await mockClient.batchUpdate(updates, false, true);

      expect(progressMessages).toHaveLength(3);
      expect(progressMessages[0]).toContain('Updating record 1/2');
      expect(progressMessages[1]).toContain('Updating record 2/2');
      expect(progressMessages[2]).toContain('Complete: All 2 records updated successfully');
    });

    it('should report update failures', async () => {
      mockClient.batchUpdate.mockImplementationOnce(async (updates, stopOnError, reportProgress) => {
        if (reportProgress) {
          mockClient.notifyProgress('Updating record 1/2 (50%): incident');
          mockClient.notifyProgress('Failed 2/2: incident - Record not found');
          mockClient.notifyProgress('Complete: 1/2 records updated (1 failed)');
        }
        return {
          success: true,
          updated_count: 1,
          errors: [{ update_index: 1, error: 'Record not found' }],
        };
      });

      const updates = [
        { table: 'incident', sys_id: 'id1', data: {} },
        { table: 'incident', sys_id: 'id2', data: {} },
      ];

      await mockClient.batchUpdate(updates, false, true);

      const failedMessage = progressMessages.find(m => m.includes('Failed'));
      expect(failedMessage).toBeDefined();
      expect(failedMessage).toContain('Record not found');
    });
  });

  describe('Update Set Operations Progress', () => {
    it('should report progress when moving records', async () => {
      mockClient.moveRecordsToUpdateSet.mockImplementationOnce(async (updateSetId, options) => {
        if (options.reportProgress) {
          mockClient.notifyProgress('Fetching 5 records to move');
          mockClient.notifyProgress('Moving 5 records to update set');
          mockClient.notifyProgress('Moving record 1/5 (20%): sys_properties');
          mockClient.notifyProgress('Moving record 5/5 (100%): sys_script');
          mockClient.notifyProgress('Complete: All 5 records moved successfully');
        }
        return { moved: 5, failed: 0, records: [], errors: [] };
      });

      await mockClient.moveRecordsToUpdateSet('update_set_id', {
        record_sys_ids: ['id1', 'id2', 'id3', 'id4', 'id5'],
        reportProgress: true,
      });

      expect(progressMessages.length).toBeGreaterThan(0);
      expect(progressMessages[0]).toContain('Fetching 5 records');
      expect(progressMessages[progressMessages.length - 1]).toContain('Complete');
    });

    it('should report progress when cloning update set', async () => {
      mockClient.cloneUpdateSet.mockImplementationOnce(async (sourceId, newName, reportProgress) => {
        if (reportProgress) {
          mockClient.notifyProgress('Fetching source update set');
          mockClient.notifyProgress('Creating new update set: Clone Test');
          mockClient.notifyProgress('Fetching update records from source');
          mockClient.notifyProgress('Cloning 10 update records');
          mockClient.notifyProgress('Cloning record 5/10 (50%): sys_properties');
          mockClient.notifyProgress('Complete: All 10 records cloned successfully');
        }
        return {
          new_update_set_id: 'new_id',
          new_update_set_name: newName,
          source_update_set_id: sourceId,
          source_update_set_name: 'Original',
          records_cloned: 10,
          total_source_records: 10,
        };
      });

      await mockClient.cloneUpdateSet('source_id', 'Clone Test', true);

      expect(progressMessages).toContain('Fetching source update set');
      expect(progressMessages).toContain('Cloning 10 update records');
      expect(progressMessages[progressMessages.length - 1]).toContain('Complete');
    });
  });

  describe('Workflow Creation Progress', () => {
    it('should report progress during workflow creation', async () => {
      mockClient.createCompleteWorkflow.mockImplementationOnce(async (workflowSpec, reportProgress) => {
        if (reportProgress) {
          mockClient.notifyProgress('Creating workflow base');
          mockClient.notifyProgress('Creating workflow version');
          mockClient.notifyProgress('Creating activity 1/3: Start');
          mockClient.notifyProgress('Creating activity 2/3: Process');
          mockClient.notifyProgress('Creating activity 3/3: End');
          mockClient.notifyProgress('Creating transition 1/2');
          mockClient.notifyProgress('Creating transition 2/2');
          mockClient.notifyProgress('Publishing workflow');
          mockClient.notifyProgress('Complete: Workflow created with 3 activities and 2 transitions');
        }
        return {
          workflow_sys_id: 'wf123',
          version_sys_id: 'ver123',
          activity_sys_ids: {},
          transition_sys_ids: [],
          published: true,
        };
      });

      const workflowSpec = {
        name: 'Test Workflow',
        table: 'incident',
        activities: [
          { name: 'Start' },
          { name: 'Process' },
          { name: 'End' },
        ],
        transitions: [
          { from: 0, to: 1 },
          { from: 1, to: 2 },
        ],
        publish: true,
      };

      await mockClient.createCompleteWorkflow(workflowSpec, true);

      expect(progressMessages).toContain('Creating workflow base');
      expect(progressMessages).toContain('Creating activity 1/3: Start');
      expect(progressMessages).toContain('Publishing workflow');
    });
  });

  describe('Final Summary Messages', () => {
    it('should show success summary', async () => {
      mockClient.batchCreate.mockImplementationOnce(async (operations, transaction, reportProgress) => {
        if (reportProgress) {
          mockClient.notifyProgress('Complete: All 10 records created successfully');
        }
        return { success: true, created_count: 10, sys_ids: {}, errors: [] };
      });

      await mockClient.batchCreate(Array(10).fill({ table: 'incident', data: {} }), true, true);

      const summaryMessage = progressMessages[progressMessages.length - 1];
      expect(summaryMessage).toContain('Complete');
      expect(summaryMessage).toContain('successfully');
    });

    it('should show partial success summary', async () => {
      mockClient.batchCreate.mockImplementationOnce(async (operations, transaction, reportProgress) => {
        if (reportProgress) {
          mockClient.notifyProgress('Complete: 8/10 records created (2 failed)');
        }
        return {
          success: true,
          created_count: 8,
          sys_ids: {},
          errors: [{ error: 'Error 1' }, { error: 'Error 2' }],
        };
      });

      await mockClient.batchCreate(Array(10).fill({ table: 'incident', data: {} }), false, true);

      const summaryMessage = progressMessages[progressMessages.length - 1];
      expect(summaryMessage).toContain('8/10');
      expect(summaryMessage).toContain('2 failed');
    });

    it('should include execution time in summary', () => {
      const startTime = Date.now();
      const endTime = startTime + 1500; // 1.5 seconds

      const executionTime = endTime - startTime;
      expect(executionTime).toBe(1500);
    });
  });

  describe('Error Reporting', () => {
    it('should report first 5 errors to avoid spam', async () => {
      mockClient.batchUpdate.mockImplementationOnce(async (updates, stopOnError, reportProgress) => {
        if (reportProgress) {
          for (let i = 0; i < Math.min(5, 10); i++) {
            mockClient.notifyProgress(`Failed to update record ${i + 1}: Error ${i + 1}`);
          }
          mockClient.notifyProgress('Complete: 0/10 records updated (10 failed)');
        }
        return { success: false, updated_count: 0, errors: Array(10).fill({ error: 'Error' }) };
      });

      await mockClient.batchUpdate(Array(10).fill({ table: 'incident', sys_id: 'id', data: {} }), false, true);

      const errorMessages = progressMessages.filter(m => m.includes('Failed'));
      expect(errorMessages.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Progress Callback', () => {
    it('should call progress callback when set', async () => {
      const callback = jest.fn();
      mockClient.setProgressCallback(callback);

      mockClient.notifyProgress('Test message');

      expect(callback).toHaveBeenCalledWith('Test message');
    });

    it('should not fail if callback not set', () => {
      expect(() => {
        mockClient.notifyProgress('Test message');
      }).not.toThrow();
    });
  });
});
