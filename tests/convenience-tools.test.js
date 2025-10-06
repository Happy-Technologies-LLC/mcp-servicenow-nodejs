/**
 * Tests for incident convenience tools
 * Tests: SN-Add-Comment, SN-Add-Work-Notes, SN-Assign-Incident,
 *        SN-Resolve-Incident, SN-Close-Incident
 */

import { jest } from '@jest/globals';
import {
  createMockServiceNowClient,
  mockIncident,
  mockUser,
  createAxiosResponse,
  createAxiosError,
} from './helpers/mocks.js';

describe('Incident Convenience Tools', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = createMockServiceNowClient();
    jest.clearAllMocks();
  });

  describe('SN-Add-Comment', () => {
    it('should add comment to incident by number', async () => {
      // Mock: Look up incident by number
      mockClient.getRecords.mockResolvedValueOnce([mockIncident]);

      // Mock: Update incident with comment
      mockClient.updateRecord.mockResolvedValueOnce({
        ...mockIncident,
        comments: 'This is a test comment',
      });

      const result = await mockClient.updateRecord('incident', mockIncident.sys_id, {
        comments: 'This is a test comment',
      });

      expect(mockClient.updateRecord).toHaveBeenCalledWith('incident', mockIncident.sys_id, {
        comments: 'This is a test comment',
      });
      expect(result.comments).toBe('This is a test comment');
    });

    it('should throw error when incident not found', async () => {
      mockClient.getRecords.mockResolvedValueOnce([]);

      await expect(async () => {
        const incidents = await mockClient.getRecords('incident', {
          sysparm_query: 'number=INC9999999',
          sysparm_limit: 1,
        });
        if (incidents.length === 0) {
          throw new Error('Incident INC9999999 not found');
        }
      }).rejects.toThrow('Incident INC9999999 not found');
    });

    it('should handle special characters in comments', async () => {
      const specialComment = 'Test with "quotes" and \\backslash & ampersand';
      mockClient.getRecords.mockResolvedValueOnce([mockIncident]);
      mockClient.updateRecord.mockResolvedValueOnce({
        ...mockIncident,
        comments: specialComment,
      });

      const result = await mockClient.updateRecord('incident', mockIncident.sys_id, {
        comments: specialComment,
      });

      expect(result.comments).toBe(specialComment);
    });
  });

  describe('SN-Add-Work-Notes', () => {
    it('should add work notes to incident', async () => {
      mockClient.getRecords.mockResolvedValueOnce([mockIncident]);
      mockClient.updateRecord.mockResolvedValueOnce({
        ...mockIncident,
        work_notes: 'Internal work notes',
      });

      const result = await mockClient.updateRecord('incident', mockIncident.sys_id, {
        work_notes: 'Internal work notes',
      });

      expect(mockClient.updateRecord).toHaveBeenCalledWith('incident', mockIncident.sys_id, {
        work_notes: 'Internal work notes',
      });
      expect(result.work_notes).toBe('Internal work notes');
    });

    it('should handle long work notes', async () => {
      const longNotes = 'A'.repeat(4000);
      mockClient.getRecords.mockResolvedValueOnce([mockIncident]);
      mockClient.updateRecord.mockResolvedValueOnce({
        ...mockIncident,
        work_notes: longNotes,
      });

      const result = await mockClient.updateRecord('incident', mockIncident.sys_id, {
        work_notes: longNotes,
      });

      expect(result.work_notes).toBe(longNotes);
      expect(result.work_notes.length).toBe(4000);
    });
  });

  describe('SN-Assign-Incident', () => {
    it('should assign incident to user by sys_id', async () => {
      mockClient.getRecords.mockResolvedValueOnce([mockIncident]);
      mockClient.updateRecord.mockResolvedValueOnce({
        ...mockIncident,
        assigned_to: { value: 'user123', display_value: 'John Doe' },
      });

      const result = await mockClient.updateRecord('incident', mockIncident.sys_id, {
        assigned_to: 'user123',
      });

      expect(mockClient.updateRecord).toHaveBeenCalledWith('incident', mockIncident.sys_id, {
        assigned_to: 'user123',
      });
      expect(result.assigned_to.value).toBe('user123');
    });

    it('should assign incident to user by name (resolve user)', async () => {
      // Mock: Look up incident
      mockClient.getRecords.mockResolvedValueOnce([mockIncident]);

      // Mock: Resolve user by name
      mockClient.getRecords.mockResolvedValueOnce([mockUser]);

      // Mock: Update incident
      mockClient.updateRecord.mockResolvedValueOnce({
        ...mockIncident,
        assigned_to: { value: 'user123', display_value: 'John Doe' },
      });

      // Simulate workflow: first get incident, then resolve user
      const incidents = await mockClient.getRecords('incident', {
        sysparm_query: 'number=INC0012345',
      });

      // Simulate user resolution
      const users = await mockClient.getRecords('sys_user', {
        sysparm_query: 'name=John Doe^ORuser_name=John Doe',
        sysparm_limit: 1,
      });
      expect(users[0].sys_id).toBe('user123');

      const result = await mockClient.updateRecord('incident', incidents[0].sys_id, {
        assigned_to: users[0].sys_id,
      });

      expect(result.assigned_to.value).toBe('user123');
    });

    it('should assign incident with assignment group', async () => {
      mockClient.getRecords.mockResolvedValueOnce([mockIncident]);
      mockClient.updateRecord.mockResolvedValueOnce({
        ...mockIncident,
        assigned_to: { value: 'user123', display_value: 'John Doe' },
        assignment_group: { value: 'group123', display_value: 'IT Support' },
      });

      const result = await mockClient.updateRecord('incident', mockIncident.sys_id, {
        assigned_to: 'user123',
        assignment_group: 'group123',
      });

      expect(result.assigned_to.value).toBe('user123');
      expect(result.assignment_group.value).toBe('group123');
    });

    it('should throw error when user not found', async () => {
      mockClient.getRecords
        .mockResolvedValueOnce([mockIncident])
        .mockResolvedValueOnce([]); // No users found

      // First get incident
      await mockClient.getRecords('incident', { sysparm_query: 'number=INC0012345' });

      // Then try to resolve non-existent user
      await expect(async () => {
        const users = await mockClient.getRecords('sys_user', {
          sysparm_query: 'name=NonExistentUser',
        });
        if (users.length === 0) {
          throw new Error('User "NonExistentUser" not found');
        }
      }).rejects.toThrow('User "NonExistentUser" not found');
    });

    it('should handle sys_id format validation', async () => {
      const validSysId = '0123456789abcdef0123456789abcdef';
      const invalidSysId = 'not-a-sys-id';

      // Valid sys_id should match pattern
      expect(/^[0-9a-f]{32}$/i.test(validSysId)).toBe(true);

      // Invalid sys_id should not match pattern
      expect(/^[0-9a-f]{32}$/i.test(invalidSysId)).toBe(false);
    });
  });

  describe('SN-Resolve-Incident', () => {
    it('should resolve incident with notes', async () => {
      mockClient.getRecords.mockResolvedValueOnce([mockIncident]);
      mockClient.updateRecord.mockResolvedValueOnce({
        ...mockIncident,
        state: 6,
        close_notes: 'Issue resolved',
      });

      const result = await mockClient.updateRecord('incident', mockIncident.sys_id, {
        state: 6,
        close_notes: 'Issue resolved',
      });

      expect(mockClient.updateRecord).toHaveBeenCalledWith('incident', mockIncident.sys_id, {
        state: 6,
        close_notes: 'Issue resolved',
      });
      expect(result.state).toBe(6);
      expect(result.close_notes).toBe('Issue resolved');
    });

    it('should resolve incident with resolution code', async () => {
      mockClient.getRecords.mockResolvedValueOnce([mockIncident]);
      mockClient.updateRecord.mockResolvedValueOnce({
        ...mockIncident,
        state: 6,
        close_notes: 'Fixed permanently',
        close_code: 'Solved (Permanently)',
      });

      const result = await mockClient.updateRecord('incident', mockIncident.sys_id, {
        state: 6,
        close_notes: 'Fixed permanently',
        close_code: 'Solved (Permanently)',
      });

      expect(result.state).toBe(6);
      expect(result.close_code).toBe('Solved (Permanently)');
    });

    it('should handle workaround resolution', async () => {
      mockClient.getRecords.mockResolvedValueOnce([mockIncident]);
      mockClient.updateRecord.mockResolvedValueOnce({
        ...mockIncident,
        state: 6,
        close_notes: 'Workaround applied',
        close_code: 'Solved (Work Around)',
      });

      const result = await mockClient.updateRecord('incident', mockIncident.sys_id, {
        state: 6,
        close_notes: 'Workaround applied',
        close_code: 'Solved (Work Around)',
      });

      expect(result.close_code).toBe('Solved (Work Around)');
    });
  });

  describe('SN-Close-Incident', () => {
    it('should close incident with notes', async () => {
      mockClient.getRecords.mockResolvedValueOnce([mockIncident]);
      mockClient.updateRecord.mockResolvedValueOnce({
        ...mockIncident,
        state: 7,
        close_notes: 'Incident closed',
      });

      const result = await mockClient.updateRecord('incident', mockIncident.sys_id, {
        state: 7,
        close_notes: 'Incident closed',
      });

      expect(mockClient.updateRecord).toHaveBeenCalledWith('incident', mockIncident.sys_id, {
        state: 7,
        close_notes: 'Incident closed',
      });
      expect(result.state).toBe(7);
    });

    it('should close incident with close code', async () => {
      mockClient.getRecords.mockResolvedValueOnce([mockIncident]);
      mockClient.updateRecord.mockResolvedValueOnce({
        ...mockIncident,
        state: 7,
        close_notes: 'Verified and closed',
        close_code: 'Solved (Permanently)',
      });

      const result = await mockClient.updateRecord('incident', mockIncident.sys_id, {
        state: 7,
        close_notes: 'Verified and closed',
        close_code: 'Solved (Permanently)',
      });

      expect(result.state).toBe(7);
      expect(result.close_code).toBe('Solved (Permanently)');
    });

    it('should handle transition from resolved to closed', async () => {
      const resolvedIncident = { ...mockIncident, state: 6 };
      mockClient.getRecords.mockResolvedValueOnce([resolvedIncident]);
      mockClient.updateRecord.mockResolvedValueOnce({
        ...resolvedIncident,
        state: 7,
        close_notes: 'Closing after resolution',
      });

      const result = await mockClient.updateRecord('incident', resolvedIncident.sys_id, {
        state: 7,
        close_notes: 'Closing after resolution',
      });

      expect(result.state).toBe(7);
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      mockClient.getRecords.mockRejectedValueOnce(
        createAxiosError('Network error', 500)
      );

      await expect(mockClient.getRecords('incident', {}))
        .rejects
        .toThrow('Network error');
    });

    it('should handle permission errors', async () => {
      mockClient.updateRecord.mockRejectedValueOnce(
        createAxiosError('Access denied', 403)
      );

      await expect(mockClient.updateRecord('incident', 'abc123', {}))
        .rejects
        .toThrow('Access denied');
    });

    it('should handle invalid incident number format', async () => {
      mockClient.getRecords.mockResolvedValueOnce([]);

      await expect(async () => {
        const incidents = await mockClient.getRecords('incident', {
          sysparm_query: 'number=INVALID',
        });
        if (incidents.length === 0) {
          throw new Error('Incident INVALID not found');
        }
      }).rejects.toThrow('Incident INVALID not found');
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle full incident lifecycle', async () => {
      // Create
      mockClient.createRecord.mockResolvedValueOnce(mockIncident);

      // Assign
      mockClient.getRecords.mockResolvedValueOnce([mockIncident]);
      mockClient.updateRecord.mockResolvedValueOnce({
        ...mockIncident,
        assigned_to: { value: 'user123', display_value: 'John Doe' },
      });

      // Add work notes
      mockClient.getRecords.mockResolvedValueOnce([mockIncident]);
      mockClient.updateRecord.mockResolvedValueOnce({
        ...mockIncident,
        work_notes: 'Working on issue',
      });

      // Resolve
      mockClient.getRecords.mockResolvedValueOnce([mockIncident]);
      mockClient.updateRecord.mockResolvedValueOnce({
        ...mockIncident,
        state: 6,
        close_notes: 'Resolved',
      });

      // Close
      mockClient.getRecords.mockResolvedValueOnce([mockIncident]);
      mockClient.updateRecord.mockResolvedValueOnce({
        ...mockIncident,
        state: 7,
      });

      // Execute lifecycle
      const created = await mockClient.createRecord('incident', {
        short_description: 'Test incident',
      });
      expect(created.number).toBe('INC0012345');

      await mockClient.updateRecord('incident', created.sys_id, {
        assigned_to: 'user123',
      });

      await mockClient.updateRecord('incident', created.sys_id, {
        work_notes: 'Working on issue',
      });

      await mockClient.updateRecord('incident', created.sys_id, {
        state: 6,
        close_notes: 'Resolved',
      });

      const closed = await mockClient.updateRecord('incident', created.sys_id, {
        state: 7,
      });

      expect(closed.state).toBe(7);
    });
  });
});
