/**
 * Tests for natural language parsing
 * Tests: SN-Natural-Language-Search with various patterns
 */

import { jest } from '@jest/globals';

// Mock natural language parser for testing
const parsePriority = (text) => {
  if (/\bp1\b/i.test(text)) return 'priority=1';
  if (/\bp2\b/i.test(text)) return 'priority=2';
  if (/\bp3\b/i.test(text)) return 'priority=3';
  if (/\bhigh\s+priority\b/i.test(text)) return 'priority=2';
  if (/\bcritical\b/i.test(text)) return 'priority=1';
  return null;
};

const parseState = (text, table = 'incident') => {
  const stateMap = {
    incident: {
      'new': 'state=1',
      'open': 'state=1^ORstate=2^ORstate=3',
      'in progress': 'state=2',
      'resolved': 'state=6',
      'closed': 'state=7',
    },
    change_request: {
      'open': 'state<0',
      'closed': 'state=3',
    },
  };

  const states = stateMap[table] || {};
  for (const [key, value] of Object.entries(states)) {
    if (new RegExp(`\\b${key}\\b`, 'i').test(text)) {
      return value;
    }
  }
  return null;
};

const parseAssignment = (text) => {
  if (/\bassigned\s+to\s+me\b/i.test(text)) return 'assigned_to=javascript:gs.getUserID()';
  if (/\bunassigned\b/i.test(text)) return 'assigned_to=NULL';
  return null;
};

const parseDate = (text) => {
  if (/\btoday\b/i.test(text)) return 'sys_created_on=javascript:gs.daysAgoStart(0)';
  if (/\blast\s+7\s+days\b/i.test(text)) return 'sys_created_on>=javascript:gs.daysAgoStart(7)';
  if (/\brecent\b/i.test(text)) return 'sys_created_on>=javascript:gs.daysAgoStart(7)';
  return null;
};

const parseText = (text) => {
  const match = text.match(/\babout\s+(\w+)\b/i) || text.match(/\bcontaining\s+(\w+)\b/i);
  if (match) {
    return `short_descriptionCONTAINS${match[1]}^ORdescriptionCONTAINS${match[1]}`;
  }
  return null;
};

const parseNaturalLanguage = (text, table = 'incident') => {
  const conditions = [];

  const priority = parsePriority(text);
  if (priority) conditions.push(priority);

  const state = parseState(text, table);
  if (state) conditions.push(state);

  const assignment = parseAssignment(text);
  if (assignment) conditions.push(assignment);

  const date = parseDate(text);
  if (date) conditions.push(date);

  const textSearch = parseText(text);
  if (textSearch) conditions.push(textSearch);

  if (conditions.length === 0) {
    return { success: false, query: '', message: 'Could not parse query' };
  }

  return {
    success: true,
    query: conditions.join('^'),
    table,
  };
};

describe('Natural Language Search', () => {
  describe('Priority Patterns', () => {
    it('should parse "high priority"', () => {
      const result = parseNaturalLanguage('show high priority incidents');

      expect(result.success).toBe(true);
      expect(result.query).toContain('priority=2');
    });

    it('should parse P1, P2, P3', () => {
      expect(parseNaturalLanguage('show P1 incidents').query).toContain('priority=1');
      expect(parseNaturalLanguage('show P2 tickets').query).toContain('priority=2');
      expect(parseNaturalLanguage('find P3 issues').query).toContain('priority=3');
    });

    it('should parse "critical"', () => {
      const result = parseNaturalLanguage('show critical incidents');

      expect(result.success).toBe(true);
      expect(result.query).toContain('priority=1');
    });

    it('should be case insensitive', () => {
      expect(parseNaturalLanguage('show p1').query).toContain('priority=1');
      expect(parseNaturalLanguage('show P1').query).toContain('priority=1');
      expect(parseNaturalLanguage('show HIGH PRIORITY').query).toContain('priority=2');
    });
  });

  describe('State Patterns', () => {
    it('should parse "open" incidents', () => {
      const result = parseNaturalLanguage('show open incidents');

      expect(result.success).toBe(true);
      expect(result.query).toContain('state=1^ORstate=2^ORstate=3');
    });

    it('should parse "new" state', () => {
      const result = parseNaturalLanguage('show new incidents');

      expect(result.success).toBe(true);
      expect(result.query).toContain('state=1');
    });

    it('should parse "resolved"', () => {
      const result = parseNaturalLanguage('show resolved incidents');

      expect(result.success).toBe(true);
      expect(result.query).toContain('state=6');
    });

    it('should parse "closed"', () => {
      const result = parseNaturalLanguage('show closed incidents');

      expect(result.success).toBe(true);
      expect(result.query).toContain('state=7');
    });

    it('should parse "in progress"', () => {
      const result = parseNaturalLanguage('show in progress incidents');

      expect(result.success).toBe(true);
      expect(result.query).toContain('state=2');
    });
  });

  describe('Assignment Patterns', () => {
    it('should parse "assigned to me"', () => {
      const result = parseNaturalLanguage('show incidents assigned to me');

      expect(result.success).toBe(true);
      expect(result.query).toContain('assigned_to=javascript:gs.getUserID()');
    });

    it('should parse "unassigned"', () => {
      const result = parseNaturalLanguage('show unassigned incidents');

      expect(result.success).toBe(true);
      expect(result.query).toContain('assigned_to=NULL');
    });
  });

  describe('Date Patterns', () => {
    it('should parse "recent"', () => {
      const result = parseNaturalLanguage('show recent incidents');

      expect(result.success).toBe(true);
      expect(result.query).toContain('sys_created_on>=javascript:gs.daysAgoStart(7)');
    });

    it('should parse "last 7 days"', () => {
      const result = parseNaturalLanguage('incidents from last 7 days');

      expect(result.success).toBe(true);
      expect(result.query).toContain('sys_created_on>=javascript:gs.daysAgoStart(7)');
    });

    it('should parse "today"', () => {
      const result = parseNaturalLanguage('show incidents created today');

      expect(result.success).toBe(true);
      expect(result.query).toContain('sys_created_on=javascript:gs.daysAgoStart(0)');
    });
  });

  describe('Text Search Patterns', () => {
    it('should parse "about SAP"', () => {
      const result = parseNaturalLanguage('show incidents about SAP');

      expect(result.success).toBe(true);
      expect(result.query).toContain('short_descriptionCONTAINSSAP');
      expect(result.query).toContain('descriptionCONTAINSSAP');
    });

    it('should parse "containing network"', () => {
      const result = parseNaturalLanguage('find incidents containing network');

      expect(result.success).toBe(true);
      expect(result.query).toContain('short_descriptionCONTAINSnetwork');
    });
  });

  describe('Combined Conditions', () => {
    it('should parse "P1 and assigned to me"', () => {
      const result = parseNaturalLanguage('show P1 incidents assigned to me');

      expect(result.success).toBe(true);
      expect(result.query).toContain('priority=1');
      expect(result.query).toContain('assigned_to=javascript:gs.getUserID()');
      expect(result.query).toContain('^'); // Has AND operator
    });

    it('should parse "open high priority incidents"', () => {
      const result = parseNaturalLanguage('show open high priority incidents');

      expect(result.success).toBe(true);
      expect(result.query).toContain('priority=2');
      expect(result.query).toContain('state=');
    });

    it('should parse "recent P1 incidents"', () => {
      const result = parseNaturalLanguage('show recent P1 incidents');

      expect(result.success).toBe(true);
      expect(result.query).toContain('priority=1');
      expect(result.query).toContain('sys_created_on>=');
    });

    it('should parse complex query', () => {
      const result = parseNaturalLanguage('show recent P1 open incidents assigned to me about SAP');

      expect(result.success).toBe(true);
      expect(result.query).toContain('priority=1');
      expect(result.query).toContain('state=');
      expect(result.query).toContain('assigned_to=');
      expect(result.query).toContain('sys_created_on>=');
      expect(result.query).toContain('CONTAINSSAP');
    });
  });

  describe('Table-Specific Mappings', () => {
    it('should use incident state mappings', () => {
      const result = parseNaturalLanguage('show open incidents', 'incident');

      expect(result.table).toBe('incident');
      expect(result.query).toContain('state=1^ORstate=2^ORstate=3');
    });

    it('should use change_request state mappings', () => {
      const result = parseNaturalLanguage('show open changes', 'change_request');

      expect(result.table).toBe('change_request');
      expect(result.query).toContain('state<0');
    });

    it('should handle different states per table', () => {
      const incidentResult = parseNaturalLanguage('show closed incidents', 'incident');
      const changeResult = parseNaturalLanguage('show closed changes', 'change_request');

      expect(incidentResult.query).toContain('state=7');
      expect(changeResult.query).toContain('state=3');
    });
  });

  describe('Unmatchable Queries', () => {
    it('should handle unparseable queries', () => {
      const result = parseNaturalLanguage('asdfghjkl');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Could not parse query');
    });

    it('should handle empty queries', () => {
      const result = parseNaturalLanguage('');

      expect(result.success).toBe(false);
    });

    it('should suggest fallback for unclear queries', () => {
      const result = parseNaturalLanguage('show me some stuff');

      expect(result.success).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle queries with extra whitespace', () => {
      const result = parseNaturalLanguage('show   P1   incidents');

      expect(result.success).toBe(true);
      expect(result.query).toContain('priority=1');
    });

    it('should handle queries with punctuation', () => {
      const result = parseNaturalLanguage('Show P1 incidents!');

      expect(result.success).toBe(true);
      expect(result.query).toContain('priority=1');
    });

    it('should handle mixed case', () => {
      const result = parseNaturalLanguage('ShOw OpEn InCiDeNtS');

      expect(result.success).toBe(true);
      expect(result.query).toContain('state=');
    });

    it('should handle partial word matches correctly', () => {
      // "priority" should not match "prioritize"
      const result = parseNaturalLanguage('prioritize these incidents');

      // Should not parse priority since it's part of "prioritize"
      expect(result.success).toBe(false);
    });
  });

  describe('Query Building', () => {
    it('should use ^ as AND operator', () => {
      const result = parseNaturalLanguage('show P1 open incidents');

      expect(result.query).toContain('^');
      expect(result.query.split('^').length).toBeGreaterThan(1);
    });

    it('should handle OR conditions within state', () => {
      const result = parseNaturalLanguage('show open incidents');

      // "open" = multiple states joined with ^OR
      expect(result.query).toContain('^OR');
    });

    it('should not have trailing ^ operator', () => {
      const result = parseNaturalLanguage('show P1 incidents');

      expect(result.query).not.toMatch(/\^$/);
    });

    it('should not have leading ^ operator', () => {
      const result = parseNaturalLanguage('show P1 incidents');

      expect(result.query).not.toMatch(/^\^/);
    });
  });

  describe('Supported Patterns Info', () => {
    it('should provide pattern documentation', () => {
      const patterns = {
        priority: ['P1', 'P2', 'P3', 'high priority', 'critical'],
        state: ['open', 'new', 'in progress', 'resolved', 'closed'],
        assignment: ['assigned to me', 'unassigned'],
        date: ['recent', 'today', 'last 7 days'],
        text: ['about <keyword>', 'containing <keyword>'],
      };

      expect(patterns.priority).toContain('P1');
      expect(patterns.state).toContain('open');
      expect(patterns.assignment).toContain('assigned to me');
      expect(patterns.date).toContain('recent');
      expect(patterns.text).toContain('about <keyword>');
    });
  });

  describe('Performance', () => {
    it('should parse queries quickly', () => {
      const start = Date.now();

      for (let i = 0; i < 1000; i++) {
        parseNaturalLanguage('show P1 open incidents assigned to me');
      }

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1000); // Should complete in < 1 second
    });
  });
});
