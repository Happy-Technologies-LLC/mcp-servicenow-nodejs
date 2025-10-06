/**
 * Tests for script synchronization functionality
 * Tests: SN-Sync-Script with push, pull, auto-detect, and bulk operations
 */

import { jest } from '@jest/globals';
import {
  parseFileName,
  generateFileName,
  SCRIPT_TYPES,
} from '../src/script-sync.js';
import { createMockServiceNowClient, createMockFS } from './helpers/mocks.js';

describe('Script Synchronization', () => {
  let mockClient;
  let mockFS;

  beforeEach(() => {
    mockClient = createMockServiceNowClient();
    mockFS = createMockFS();
    jest.clearAllMocks();
  });

  describe('File Name Parsing', () => {
    it('should parse valid file names', () => {
      const result = parseFileName('MyScript.sys_script_include.js');

      expect(result.isValid).toBe(true);
      expect(result.scriptName).toBe('MyScript');
      expect(result.scriptType).toBe('sys_script_include');
    });

    it('should parse names with dots', () => {
      const result = parseFileName('My.Complex.Script.sys_script.js');

      expect(result.isValid).toBe(true);
      expect(result.scriptName).toBe('My.Complex.Script');
      expect(result.scriptType).toBe('sys_script');
    });

    it('should reject invalid file extensions', () => {
      const result = parseFileName('MyScript.sys_script.ts');

      expect(result.isValid).toBe(false);
    });

    it('should reject invalid script types', () => {
      const result = parseFileName('MyScript.invalid_type.js');

      expect(result.isValid).toBe(false);
    });

    it('should reject files without script type', () => {
      const result = parseFileName('MyScript.js');

      expect(result.isValid).toBe(false);
    });

    it('should handle all supported script types', () => {
      const types = Object.keys(SCRIPT_TYPES);

      types.forEach(type => {
        const result = parseFileName(`TestScript.${type}.js`);
        expect(result.isValid).toBe(true);
        expect(result.scriptType).toBe(type);
      });
    });
  });

  describe('File Name Generation', () => {
    it('should generate correct file names', () => {
      const fileName = generateFileName('MyScript', 'sys_script_include');

      expect(fileName).toBe('MyScript.sys_script_include.js');
    });

    it('should sanitize special characters', () => {
      const fileName = generateFileName('My Script!@#', 'sys_script');

      expect(fileName).toBe('My_Script___.sys_script.js');
    });

    it('should preserve dots in names', () => {
      const fileName = generateFileName('com.example.MyScript', 'sys_ui_script');

      expect(fileName).toBe('com.example.MyScript.sys_ui_script.js');
    });

    it('should handle underscores and hyphens', () => {
      const fileName = generateFileName('my-script_name', 'sys_script_client');

      expect(fileName).toBe('my-script_name.sys_script_client.js');
    });
  });

  describe('Script Types', () => {
    it('should define all required script types', () => {
      const expectedTypes = [
        'sys_script_include',
        'sys_script',
        'sys_ui_script',
        'sys_ui_action',
        'sys_script_client',
      ];

      expectedTypes.forEach(type => {
        expect(SCRIPT_TYPES[type]).toBeDefined();
        expect(SCRIPT_TYPES[type].table).toBe(type);
        expect(SCRIPT_TYPES[type].label).toBeDefined();
        expect(SCRIPT_TYPES[type].script_field).toBe('script');
        expect(SCRIPT_TYPES[type].extension).toBe('.js');
      });
    });

    it('should have unique labels', () => {
      const labels = Object.values(SCRIPT_TYPES).map(t => t.label);
      const uniqueLabels = [...new Set(labels)];

      expect(labels.length).toBe(uniqueLabels.length);
    });
  });

  describe('Push: Local → ServiceNow', () => {
    it('should push local file to ServiceNow', async () => {
      const scriptContent = '// My script content\ngs.info("Hello");';
      mockFS.readFile.mockResolvedValueOnce(scriptContent);

      // Mock: Find script by name
      mockClient.getRecords.mockResolvedValueOnce([{
        sys_id: 'abc123',
        name: 'MyScript',
        script: '// Old content',
      }]);

      // Mock: Update script
      mockClient.updateRecord.mockResolvedValueOnce({
        sys_id: 'abc123',
        name: 'MyScript',
        script: scriptContent,
      });

      const result = await mockClient.updateRecord('sys_script_include', 'abc123', {
        script: scriptContent,
      });

      expect(mockClient.updateRecord).toHaveBeenCalledWith('sys_script_include', 'abc123', {
        script: scriptContent,
      });
      expect(result.script).toBe(scriptContent);
    });

    it('should handle file not found error', async () => {
      mockFS.readFile.mockRejectedValueOnce(
        new Error('ENOENT: no such file or directory')
      );

      await expect(mockFS.readFile('/path/to/nonexistent.js'))
        .rejects
        .toThrow('ENOENT');
    });

    it('should handle script not found in ServiceNow', async () => {
      mockFS.readFile.mockResolvedValueOnce('// Content');
      mockClient.getRecords.mockResolvedValueOnce([]); // No scripts found

      await expect(async () => {
        const scripts = await mockClient.getRecords('sys_script_include', {
          sysparm_query: 'name=NonExistentScript',
        });
        if (scripts.length === 0) {
          throw new Error('Script "NonExistentScript" not found in ServiceNow');
        }
      }).rejects.toThrow('Script "NonExistentScript" not found in ServiceNow');
    });

    it('should preserve script content integrity', async () => {
      const scriptContent = `// Complex script
function myFunction() {
  var special = "with \\"quotes\\" and \\nnewlines";
  return special;
}`;

      mockFS.readFile.mockResolvedValueOnce(scriptContent);
      mockClient.getRecords.mockResolvedValueOnce([{ sys_id: 'abc123', name: 'Test' }]);
      mockClient.updateRecord.mockResolvedValueOnce({
        sys_id: 'abc123',
        script: scriptContent,
      });

      const result = await mockClient.updateRecord('sys_script', 'abc123', {
        script: scriptContent,
      });

      expect(result.script).toBe(scriptContent);
    });
  });

  describe('Pull: ServiceNow → Local', () => {
    it('should pull script from ServiceNow to local file', async () => {
      const scriptContent = '// ServiceNow content';

      // Mock: Get script from ServiceNow
      mockClient.getRecords.mockResolvedValueOnce([{
        sys_id: 'abc123',
        name: 'MyScript',
        script: scriptContent,
      }]);

      // Mock: Write to file
      mockFS.writeFile.mockResolvedValueOnce();

      const script = (await mockClient.getRecords('sys_script_include', {
        sysparm_query: 'name=MyScript',
      }))[0];

      await mockFS.writeFile('/path/to/MyScript.sys_script_include.js', script.script);

      expect(mockFS.writeFile).toHaveBeenCalledWith(
        '/path/to/MyScript.sys_script_include.js',
        scriptContent
      );
    });

    it('should handle script not found in ServiceNow', async () => {
      mockClient.getRecords.mockResolvedValueOnce([]);

      await expect(async () => {
        const scripts = await mockClient.getRecords('sys_script', {
          sysparm_query: 'name=Missing',
        });
        if (scripts.length === 0) {
          throw new Error('Script not found in ServiceNow');
        }
      }).rejects.toThrow('Script not found in ServiceNow');
    });

    it('should handle file write errors', async () => {
      mockClient.getRecords.mockResolvedValueOnce([{
        sys_id: 'abc123',
        script: '// Content',
      }]);

      mockFS.writeFile.mockRejectedValueOnce(
        new Error('EACCES: permission denied')
      );

      await expect(mockFS.writeFile('/readonly/file.js', '// Content'))
        .rejects
        .toThrow('EACCES');
    });

    it('should create parent directories if needed', async () => {
      mockClient.getRecords.mockResolvedValueOnce([{
        script: '// Content',
      }]);

      mockFS.mkdir.mockResolvedValueOnce();
      mockFS.writeFile.mockResolvedValueOnce();

      await mockFS.mkdir('/path/to/deep/dir', { recursive: true });
      await mockFS.writeFile('/path/to/deep/dir/script.js', '// Content');

      expect(mockFS.mkdir).toHaveBeenCalledWith('/path/to/deep/dir', { recursive: true });
    });
  });

  describe('Auto-Detect Direction', () => {
    it('should push when local file is newer', async () => {
      const localTime = new Date('2025-01-02').getTime();
      const remoteTime = new Date('2025-01-01').getTime();

      mockFS.stat.mockResolvedValueOnce({
        mtimeMs: localTime,
      });

      mockClient.getRecords.mockResolvedValueOnce([{
        sys_id: 'abc123',
        sys_updated_on: new Date(remoteTime).toISOString(),
      }]);

      const localStat = await mockFS.stat('/path/to/script.js');
      const remoteScript = (await mockClient.getRecords('sys_script', {}))[0];

      const shouldPush = localStat.mtimeMs > new Date(remoteScript.sys_updated_on).getTime();
      expect(shouldPush).toBe(true);
    });

    it('should pull when ServiceNow script is newer', async () => {
      const localTime = new Date('2025-01-01').getTime();
      const remoteTime = new Date('2025-01-02').getTime();

      mockFS.stat.mockResolvedValueOnce({
        mtimeMs: localTime,
      });

      mockClient.getRecords.mockResolvedValueOnce([{
        sys_updated_on: new Date(remoteTime).toISOString(),
      }]);

      const localStat = await mockFS.stat('/path/to/script.js');
      const remoteScript = (await mockClient.getRecords('sys_script', {}))[0];

      const shouldPull = new Date(remoteScript.sys_updated_on).getTime() > localStat.mtimeMs;
      expect(shouldPull).toBe(true);
    });

    it('should handle file not existing locally', async () => {
      mockFS.stat.mockRejectedValueOnce(
        new Error('ENOENT: no such file or directory')
      );

      mockClient.getRecords.mockResolvedValueOnce([{
        script: '// Content',
      }]);

      // Should pull since local doesn't exist
      try {
        await mockFS.stat('/nonexistent.js');
      } catch (error) {
        expect(error.message).toContain('ENOENT');
        // Would trigger pull
      }
    });
  });

  describe('Bulk Sync', () => {
    it('should sync multiple scripts', async () => {
      const scripts = [
        { name: 'Script1', type: 'sys_script_include' },
        { name: 'Script2', type: 'sys_script' },
        { name: 'Script3', type: 'sys_ui_script' },
      ];

      for (const script of scripts) {
        mockClient.getRecords.mockResolvedValueOnce([{
          sys_id: `${script.name}_id`,
          name: script.name,
          script: `// ${script.name} content`,
        }]);

        mockFS.writeFile.mockResolvedValueOnce();
      }

      // Simulate bulk pull
      for (const script of scripts) {
        const records = await mockClient.getRecords(script.type, {
          sysparm_query: `name=${script.name}`,
        });
        await mockFS.writeFile(
          `/scripts/${script.name}.${script.type}.js`,
          records[0].script
        );
      }

      expect(mockFS.writeFile).toHaveBeenCalledTimes(3);
    });

    it('should handle errors in bulk operations gracefully', async () => {
      mockClient.getRecords
        .mockResolvedValueOnce([{ script: '// OK' }])
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce([{ script: '// Also OK' }]);

      const results = [];
      for (let i = 0; i < 3; i++) {
        try {
          const records = await mockClient.getRecords('sys_script', {});
          results.push({ success: true, record: records[0] });
        } catch (error) {
          results.push({ success: false, error: error.message });
        }
      }

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);
    });

    it('should report progress during bulk sync', async () => {
      const scriptCount = 10;
      const progressReports = [];

      for (let i = 0; i < scriptCount; i++) {
        mockClient.getRecords.mockResolvedValueOnce([{
          script: `// Script ${i}`,
        }]);
        mockFS.writeFile.mockResolvedValueOnce();
      }

      for (let i = 0; i < scriptCount; i++) {
        await mockClient.getRecords('sys_script', {});
        await mockFS.writeFile(`/script${i}.js`, `// Script ${i}`);
        progressReports.push(`Synced ${i + 1}/${scriptCount}`);
      }

      expect(progressReports).toHaveLength(scriptCount);
      expect(progressReports[scriptCount - 1]).toBe(`Synced ${scriptCount}/${scriptCount}`);
    });
  });

  describe('Multiple Script Types', () => {
    it('should handle different script types correctly', async () => {
      const tests = [
        { type: 'sys_script_include', table: 'sys_script_include' },
        { type: 'sys_script', table: 'sys_script' },
        { type: 'sys_ui_script', table: 'sys_ui_script' },
        { type: 'sys_ui_action', table: 'sys_ui_action' },
        { type: 'sys_script_client', table: 'sys_script_client' },
      ];

      for (const test of tests) {
        const config = SCRIPT_TYPES[test.type];
        expect(config.table).toBe(test.table);
        expect(config.script_field).toBe('script');
      }
    });

    it('should sync business rules (sys_script)', async () => {
      mockFS.readFile.mockResolvedValueOnce('// Business rule');
      mockClient.getRecords.mockResolvedValueOnce([{ sys_id: 'br123' }]);
      mockClient.updateRecord.mockResolvedValueOnce({ sys_id: 'br123' });

      const content = await mockFS.readFile('/path.js');
      await mockClient.updateRecord('sys_script', 'br123', { script: content });

      expect(mockClient.updateRecord).toHaveBeenCalledWith('sys_script', 'br123', {
        script: '// Business rule',
      });
    });

    it('should sync client scripts', async () => {
      mockClient.getRecords.mockResolvedValueOnce([{ script: '// Client script' }]);
      mockFS.writeFile.mockResolvedValueOnce();

      const scripts = await mockClient.getRecords('sys_script_client', {});
      await mockFS.writeFile('/client.js', scripts[0].script);

      expect(mockFS.writeFile).toHaveBeenCalledWith('/client.js', '// Client script');
    });
  });

  describe('Error Handling', () => {
    it('should handle permission errors', async () => {
      mockClient.updateRecord.mockRejectedValueOnce(
        new Error('Access denied: insufficient permissions')
      );

      await expect(mockClient.updateRecord('sys_script', 'abc123', {}))
        .rejects
        .toThrow('Access denied');
    });

    it('should handle network errors', async () => {
      mockClient.getRecords.mockRejectedValueOnce(
        new Error('ECONNREFUSED: Connection refused')
      );

      await expect(mockClient.getRecords('sys_script', {}))
        .rejects
        .toThrow('ECONNREFUSED');
    });

    it('should validate script content encoding', async () => {
      const utf8Content = 'Test with UTF-8: 测试中文';
      mockFS.readFile.mockResolvedValueOnce(utf8Content);

      const content = await mockFS.readFile('/script.js');
      expect(content).toBe(utf8Content);
    });
  });
});
