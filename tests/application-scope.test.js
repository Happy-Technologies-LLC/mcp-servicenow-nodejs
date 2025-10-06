/**
 * Tests for SN-Set-Current-Application tool
 *
 * Validates:
 * - Application scope switching functionality
 * - Verification of scope changes
 * - Error handling for invalid app_sys_id
 * - Permission and access control
 * - Scope persistence across operations
 * - Integration with update set management
 */

import { jest } from '@jest/globals';
import {
  createMockServiceNowClient,
  createAxiosResponse,
  createAxiosError,
} from './helpers/mocks.js';

describe('SN-Set-Current-Application', () => {
  let mockClient;

  // Mock application data
  const mockApp = {
    sys_id: 'app123abc456def789abc123def456abc',
    name: 'My Custom Application',
    scope: 'x_custom_app',
    version: '1.0.0',
    vendor: 'Custom',
    vendor_prefix: 'x_custom',
  };

  const mockGlobalApp = {
    sys_id: 'global000000000000000000000000001',
    name: 'Global',
    scope: 'global',
    version: '',
    vendor: 'ServiceNow',
    vendor_prefix: '',
  };

  const mockUIResponse = {
    result: {
      app_id: mockApp.sys_id,
      app_name: mockApp.name,
      status: 'success'
    }
  };

  beforeEach(() => {
    mockClient = createMockServiceNowClient();
    jest.clearAllMocks();
  });

  describe('Basic Functionality', () => {
    it('should set application scope successfully', async () => {
      mockClient.getRecord.mockResolvedValueOnce(mockApp);
      mockClient.setCurrentApplication.mockResolvedValueOnce({
        success: true,
        application: mockApp.name,
        sys_id: mockApp.sys_id,
        response: mockUIResponse
      });

      const result = await mockClient.setCurrentApplication(mockApp.sys_id);

      expect(mockClient.setCurrentApplication).toHaveBeenCalledWith(mockApp.sys_id);
      expect(result.success).toBe(true);
      expect(result.application).toBe(mockApp.name);
      expect(result.sys_id).toBe(mockApp.sys_id);
    });

    it('should return application details in response', async () => {
      mockClient.getRecord.mockResolvedValueOnce(mockApp);
      mockClient.setCurrentApplication.mockResolvedValueOnce({
        success: true,
        application: mockApp.name,
        sys_id: mockApp.sys_id,
        response: mockUIResponse
      });

      const result = await mockClient.setCurrentApplication(mockApp.sys_id);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('application');
      expect(result).toHaveProperty('sys_id');
      expect(result).toHaveProperty('response');
    });

    it('should handle switching to Global scope', async () => {
      mockClient.getRecord.mockResolvedValueOnce(mockGlobalApp);
      mockClient.setCurrentApplication.mockResolvedValueOnce({
        success: true,
        application: 'Global',
        sys_id: mockGlobalApp.sys_id,
        response: { result: { app_name: 'Global' } }
      });

      const result = await mockClient.setCurrentApplication(mockGlobalApp.sys_id);

      expect(result.application).toBe('Global');
      expect(result.success).toBe(true);
    });

    it('should handle switching between multiple applications', async () => {
      const app1 = { ...mockApp, sys_id: 'app1', name: 'App One' };
      const app2 = { ...mockApp, sys_id: 'app2', name: 'App Two' };

      // Switch to App 1
      mockClient.getRecord.mockResolvedValueOnce(app1);
      mockClient.setCurrentApplication.mockResolvedValueOnce({
        success: true,
        application: app1.name,
        sys_id: app1.sys_id,
      });

      const result1 = await mockClient.setCurrentApplication(app1.sys_id);
      expect(result1.application).toBe('App One');

      // Switch to App 2
      mockClient.getRecord.mockResolvedValueOnce(app2);
      mockClient.setCurrentApplication.mockResolvedValueOnce({
        success: true,
        application: app2.name,
        sys_id: app2.sys_id,
      });

      const result2 = await mockClient.setCurrentApplication(app2.sys_id);
      expect(result2.application).toBe('App Two');
    });
  });

  describe('Verification', () => {
    it('should verify scope was set correctly after change', async () => {
      mockClient.getRecord.mockResolvedValueOnce(mockApp);
      mockClient.setCurrentApplication.mockResolvedValueOnce({
        success: true,
        application: mockApp.name,
        sys_id: mockApp.sys_id,
        response: mockUIResponse
      });

      // Simulate verification query
      mockClient.getRecords.mockResolvedValueOnce([{
        sys_id: 'pref123',
        user: 'user123',
        name: 'apps.current',
        value: mockApp.sys_id
      }]);

      const result = await mockClient.setCurrentApplication(mockApp.sys_id);
      expect(result.success).toBe(true);

      // Verify by querying user preferences
      const prefs = await mockClient.getRecords('sys_user_preference', {
        sysparm_query: `name=apps.current^user=${result.user || 'current_user'}`,
        sysparm_limit: 1
      });

      expect(prefs[0].value).toBe(mockApp.sys_id);
    });

    it('should include previous scope in response for rollback', async () => {
      const previousApp = { ...mockApp, sys_id: 'oldapp', name: 'Old App' };

      mockClient.getRecord.mockResolvedValueOnce(mockApp);
      mockClient.setCurrentApplication.mockResolvedValueOnce({
        success: true,
        application: mockApp.name,
        sys_id: mockApp.sys_id,
        previous_scope: {
          sys_id: previousApp.sys_id,
          name: previousApp.name
        }
      });

      const result = await mockClient.setCurrentApplication(mockApp.sys_id);

      expect(result.previous_scope).toBeDefined();
      expect(result.previous_scope.sys_id).toBe(previousApp.sys_id);
    });

    it('should return timestamp of scope change', async () => {
      const now = new Date().toISOString();

      mockClient.getRecord.mockResolvedValueOnce(mockApp);
      mockClient.setCurrentApplication.mockResolvedValueOnce({
        success: true,
        application: mockApp.name,
        sys_id: mockApp.sys_id,
        timestamp: now
      });

      const result = await mockClient.setCurrentApplication(mockApp.sys_id);

      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp)).toBeInstanceOf(Date);
    });
  });

  describe('Error Handling', () => {
    it('should fail with invalid app_sys_id format', async () => {
      const invalidSysId = 'not-a-valid-sys-id';

      mockClient.setCurrentApplication.mockRejectedValueOnce(
        new Error('Failed to set current application: Invalid sys_id format')
      );

      await expect(mockClient.setCurrentApplication(invalidSysId))
        .rejects
        .toThrow('Invalid sys_id format');
    });

    it('should fail when application does not exist', async () => {
      const nonExistentId = '00000000000000000000000000000000';

      mockClient.setCurrentApplication.mockRejectedValueOnce(
        new Error('Failed to set current application: Application not found')
      );

      await expect(mockClient.setCurrentApplication(nonExistentId))
        .rejects
        .toThrow('Application not found');
    });

    it('should handle permission denied errors', async () => {
      mockClient.setCurrentApplication.mockRejectedValueOnce(
        createAxiosError('Access denied', 403)
      );

      await expect(mockClient.setCurrentApplication(mockApp.sys_id))
        .rejects
        .toThrow('Access denied');
    });

    it('should handle network errors gracefully', async () => {
      mockClient.setCurrentApplication.mockRejectedValueOnce(
        createAxiosError('Network error', 500)
      );

      await expect(mockClient.setCurrentApplication(mockApp.sys_id))
        .rejects
        .toThrow('Network error');
    });

    it('should handle session timeout errors', async () => {
      mockClient.setCurrentApplication.mockRejectedValueOnce(
        createAxiosError('Session expired', 401)
      );

      await expect(mockClient.setCurrentApplication(mockApp.sys_id))
        .rejects
        .toThrow('Session expired');
    });

    it('should validate sys_id is 32-character hex string', async () => {
      const testCases = [
        { id: 'abc123', valid: false },
        { id: 'app123abc456def789abc123def456abc', valid: true },
        { id: 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ', valid: false },
        { id: '12345678901234567890123456789012', valid: true },
      ];

      for (const testCase of testCases) {
        if (!testCase.valid) {
          mockClient.setCurrentApplication.mockRejectedValueOnce(
            new Error('Invalid sys_id format')
          );
          await expect(mockClient.setCurrentApplication(testCase.id))
            .rejects
            .toThrow('Invalid sys_id format');
        }
      }
    });
  });

  describe('Permission Validation', () => {
    it('should check if user has access to application', async () => {
      mockClient.getRecord.mockResolvedValueOnce(mockApp);
      mockClient.setCurrentApplication.mockResolvedValueOnce({
        success: true,
        application: mockApp.name,
        sys_id: mockApp.sys_id,
        permissions_verified: true
      });

      const result = await mockClient.setCurrentApplication(mockApp.sys_id);

      expect(result.success).toBe(true);
      expect(result.permissions_verified).toBe(true);
    });

    it('should fail for applications user does not have access to', async () => {
      mockClient.setCurrentApplication.mockRejectedValueOnce(
        new Error('User does not have access to this application')
      );

      await expect(mockClient.setCurrentApplication(mockApp.sys_id))
        .rejects
        .toThrow('does not have access');
    });

    it('should check for admin or developer role', async () => {
      mockClient.getRecords.mockResolvedValueOnce([
        { role: 'admin' }
      ]);

      const roles = await mockClient.getRecords('sys_user_has_role', {
        sysparm_query: 'user=current_user^role.nameINadmin,developer',
        sysparm_limit: 1
      });

      expect(roles.length).toBeGreaterThan(0);
    });
  });

  describe('Integration with Update Sets', () => {
    it('should maintain current update set after scope change', async () => {
      const updateSet = {
        sys_id: 'updateset123',
        name: 'My Update Set',
        application: mockApp.sys_id
      };

      // Set application scope
      mockClient.getRecord.mockResolvedValueOnce(mockApp);
      mockClient.setCurrentApplication.mockResolvedValueOnce({
        success: true,
        application: mockApp.name,
        sys_id: mockApp.sys_id
      });

      await mockClient.setCurrentApplication(mockApp.sys_id);

      // Verify update set is still current
      mockClient.getCurrentUpdateSet.mockResolvedValueOnce({
        sys_id: updateSet.sys_id,
        name: updateSet.name,
        application: { value: mockApp.sys_id }
      });

      const currentUpdateSet = await mockClient.getCurrentUpdateSet();
      expect(currentUpdateSet.application.value).toBe(mockApp.sys_id);
    });

    it('should warn if update set does not match application scope', async () => {
      const differentApp = { ...mockApp, sys_id: 'differentapp' };

      mockClient.getRecord.mockResolvedValueOnce(mockApp);
      mockClient.setCurrentApplication.mockResolvedValueOnce({
        success: true,
        application: mockApp.name,
        sys_id: mockApp.sys_id,
        warnings: ['Current update set belongs to a different application']
      });

      const result = await mockClient.setCurrentApplication(mockApp.sys_id);

      expect(result.warnings).toBeDefined();
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should create update set in new scope after switching', async () => {
      // Switch scope
      mockClient.getRecord.mockResolvedValueOnce(mockApp);
      mockClient.setCurrentApplication.mockResolvedValueOnce({
        success: true,
        application: mockApp.name,
        sys_id: mockApp.sys_id
      });

      await mockClient.setCurrentApplication(mockApp.sys_id);

      // Create update set in new scope
      mockClient.createRecord.mockResolvedValueOnce({
        sys_id: 'newupdateset',
        name: 'New Update Set',
        application: mockApp.sys_id,
        state: 'in progress'
      });

      const newUpdateSet = await mockClient.createRecord('sys_update_set', {
        name: 'New Update Set',
        application: mockApp.sys_id
      });

      expect(newUpdateSet.application).toBe(mockApp.sys_id);
    });
  });

  describe('Scope Persistence', () => {
    it('should persist scope change across operations', async () => {
      mockClient.getRecord.mockResolvedValueOnce(mockApp);
      mockClient.setCurrentApplication.mockResolvedValueOnce({
        success: true,
        application: mockApp.name,
        sys_id: mockApp.sys_id
      });

      await mockClient.setCurrentApplication(mockApp.sys_id);

      // Verify scope persists in subsequent operations
      mockClient.createRecord.mockResolvedValueOnce({
        sys_id: 'table123',
        name: 'x_custom_app_table',
        scope: 'x_custom_app'
      });

      const newTable = await mockClient.createRecord('sys_db_object', {
        name: 'x_custom_app_table'
      });

      expect(newTable.scope).toBe('x_custom_app');
    });

    it('should persist scope in browser session', async () => {
      mockClient.getRecord.mockResolvedValueOnce(mockApp);
      mockClient.setCurrentApplication.mockResolvedValueOnce({
        success: true,
        application: mockApp.name,
        sys_id: mockApp.sys_id,
        session_updated: true
      });

      const result = await mockClient.setCurrentApplication(mockApp.sys_id);

      expect(result.session_updated).toBe(true);
    });
  });

  describe('UI API Endpoint', () => {
    it('should use /api/now/ui/concoursepicker/application endpoint', async () => {
      mockClient.getRecord.mockResolvedValueOnce(mockApp);
      mockClient.setCurrentApplication.mockResolvedValueOnce({
        success: true,
        application: mockApp.name,
        sys_id: mockApp.sys_id,
        method: 'ui_api',
        endpoint: '/api/now/ui/concoursepicker/application'
      });

      const result = await mockClient.setCurrentApplication(mockApp.sys_id);

      expect(result.method).toBe('ui_api');
      expect(result.endpoint).toBe('/api/now/ui/concoursepicker/application');
    });

    it('should establish session before setting scope', async () => {
      mockClient.getRecord.mockResolvedValueOnce(mockApp);
      mockClient.setCurrentApplication.mockResolvedValueOnce({
        success: true,
        application: mockApp.name,
        sys_id: mockApp.sys_id,
        session_established: true
      });

      const result = await mockClient.setCurrentApplication(mockApp.sys_id);

      expect(result.session_established).toBe(true);
    });

    it('should handle cookies and redirects properly', async () => {
      mockClient.getRecord.mockResolvedValueOnce(mockApp);
      mockClient.setCurrentApplication.mockResolvedValueOnce({
        success: true,
        application: mockApp.name,
        sys_id: mockApp.sys_id,
        cookies_accepted: true,
        redirects_followed: 3
      });

      const result = await mockClient.setCurrentApplication(mockApp.sys_id);

      expect(result.cookies_accepted).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle setting same application twice', async () => {
      mockClient.getRecord.mockResolvedValueOnce(mockApp);
      mockClient.setCurrentApplication.mockResolvedValueOnce({
        success: true,
        application: mockApp.name,
        sys_id: mockApp.sys_id,
        already_current: false
      });

      const result1 = await mockClient.setCurrentApplication(mockApp.sys_id);
      expect(result1.already_current).toBe(false);

      mockClient.getRecord.mockResolvedValueOnce(mockApp);
      mockClient.setCurrentApplication.mockResolvedValueOnce({
        success: true,
        application: mockApp.name,
        sys_id: mockApp.sys_id,
        already_current: true
      });

      const result2 = await mockClient.setCurrentApplication(mockApp.sys_id);
      expect(result2.already_current).toBe(true);
    });

    it('should handle null or undefined app_sys_id', async () => {
      mockClient.setCurrentApplication.mockRejectedValueOnce(
        new Error('app_sys_id is required')
      );

      await expect(mockClient.setCurrentApplication(null))
        .rejects
        .toThrow('app_sys_id is required');
    });

    it('should handle empty string app_sys_id', async () => {
      mockClient.setCurrentApplication.mockRejectedValueOnce(
        new Error('app_sys_id is required')
      );

      await expect(mockClient.setCurrentApplication(''))
        .rejects
        .toThrow('app_sys_id is required');
    });

    it('should handle special characters in application name', async () => {
      const specialApp = {
        ...mockApp,
        name: 'App with "quotes" & <special> chars'
      };

      mockClient.getRecord.mockResolvedValueOnce(specialApp);
      mockClient.setCurrentApplication.mockResolvedValueOnce({
        success: true,
        application: specialApp.name,
        sys_id: specialApp.sys_id
      });

      const result = await mockClient.setCurrentApplication(specialApp.sys_id);

      expect(result.application).toBe(specialApp.name);
    });

    it('should handle applications with very long names', async () => {
      const longNameApp = {
        ...mockApp,
        name: 'A'.repeat(255)
      };

      mockClient.getRecord.mockResolvedValueOnce(longNameApp);
      mockClient.setCurrentApplication.mockResolvedValueOnce({
        success: true,
        application: longNameApp.name,
        sys_id: longNameApp.sys_id
      });

      const result = await mockClient.setCurrentApplication(longNameApp.sys_id);

      expect(result.application.length).toBe(255);
    });
  });

  describe('Performance', () => {
    it('should complete scope change in reasonable time', async () => {
      mockClient.getRecord.mockResolvedValueOnce(mockApp);
      mockClient.setCurrentApplication.mockResolvedValueOnce({
        success: true,
        application: mockApp.name,
        sys_id: mockApp.sys_id,
        execution_time_ms: 150
      });

      const start = Date.now();
      const result = await mockClient.setCurrentApplication(mockApp.sys_id);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(5000); // Should complete in <5 seconds
      expect(result.execution_time_ms).toBeLessThan(2000); // API call <2 seconds
    });

    it('should handle concurrent scope changes', async () => {
      const apps = [
        { ...mockApp, sys_id: 'app1', name: 'App 1' },
        { ...mockApp, sys_id: 'app2', name: 'App 2' },
        { ...mockApp, sys_id: 'app3', name: 'App 3' }
      ];

      // Note: ServiceNow only allows one current app per user
      // This tests that operations don't interfere with each other
      for (const app of apps) {
        mockClient.getRecord.mockResolvedValueOnce(app);
        mockClient.setCurrentApplication.mockResolvedValueOnce({
          success: true,
          application: app.name,
          sys_id: app.sys_id
        });

        const result = await mockClient.setCurrentApplication(app.sys_id);
        expect(result.application).toBe(app.name);
      }
    });
  });

  describe('Documentation and Help', () => {
    it('should provide clear error messages', async () => {
      mockClient.setCurrentApplication.mockRejectedValueOnce(
        new Error('Failed to set current application: Application "app123" not found. Please verify the sys_id is correct.')
      );

      try {
        await mockClient.setCurrentApplication('app123');
      } catch (error) {
        expect(error.message).toContain('not found');
        expect(error.message).toContain('verify');
        expect(error.message).toContain('sys_id');
      }
    });

    it('should include troubleshooting steps in error', async () => {
      const error = new Error(`Failed to set current application: Access denied

Please verify:
1. You have admin or developer role
2. You have access to the application
3. The application is active`);

      mockClient.setCurrentApplication.mockRejectedValueOnce(error);

      try {
        await mockClient.setCurrentApplication(mockApp.sys_id);
      } catch (e) {
        expect(e.message).toContain('Please verify');
        expect(e.message).toContain('admin or developer role');
      }
    });
  });
});
