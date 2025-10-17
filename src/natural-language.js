/**
 * ServiceNow MCP Server - Natural Language Query Processing
 *
 * Copyright (c) 2025 Happy Technologies LLC
 * Licensed under the MIT License - see LICENSE file for details
 *
 * Natural Language to ServiceNow Encoded Query Parser
 * Converts human-readable queries into ServiceNow encoded query strings.
 * Uses pattern matching for reliability and speed.
 *
 * @module natural-language
 */

/**
 * Table-specific state mappings
 */
const STATE_MAPPINGS = {
  incident: {
    'new': '1',
    'in progress': '2',
    'on hold': '3',
    'resolved': '6',
    'closed': '7',
    'canceled': '8',
    'open': '1^ORstate=2^ORstate=3', // New, In Progress, or On Hold
    'active': 'active=true'
  },
  change_request: {
    'new': '-5',
    'assess': '-4',
    'authorize': '-3',
    'scheduled': '-2',
    'implement': '-1',
    'review': '0',
    'closed': '3',
    'canceled': '4',
    'open': 'state<0', // Negative states are open
    'active': 'active=true'
  },
  problem: {
    'new': '1',
    'assessed': '2',
    'root cause analysis': '3',
    'fix in progress': '4',
    'resolved': '6',
    'closed': '7',
    'open': '1^ORstate=2^ORstate=3^ORstate=4',
    'active': 'active=true'
  }
};

/**
 * Priority mappings (consistent across tables)
 */
const PRIORITY_MAPPINGS = {
  'critical': '1',
  'high': '2',
  'moderate': '3',
  'low': '4',
  'planning': '5',
  'p1': '1',
  'p2': '2',
  'p3': '3',
  'p4': '4',
  'p5': '5'
};

/**
 * Impact mappings
 */
const IMPACT_MAPPINGS = {
  'high': '1',
  'medium': '2',
  'low': '3'
};

/**
 * Urgency mappings
 */
const URGENCY_MAPPINGS = {
  'high': '1',
  'medium': '2',
  'low': '3'
};

/**
 * Pattern definitions for natural language parsing
 * Each pattern has: regex, parser function, priority (higher = check first)
 */
const PATTERNS = [
  // Priority patterns
  {
    regex: /\b(critical|high|moderate|low|planning)\s+priority\b/i,
    priority: 10,
    parser: (match) => {
      const level = match[1].toLowerCase();
      return `priority=${PRIORITY_MAPPINGS[level]}`;
    }
  },
  {
    regex: /\bp([1-5])\b/i,
    priority: 10,
    parser: (match) => {
      return `priority=${match[1]}`;
    }
  },
  {
    regex: /\bpriority\s+(critical|high|moderate|low|planning|[1-5])\b/i,
    priority: 10,
    parser: (match) => {
      const level = match[1].toLowerCase();
      return `priority=${PRIORITY_MAPPINGS[level] || match[1]}`;
    }
  },

  // Impact patterns
  {
    regex: /\b(high|medium|low)\s+impact\b/i,
    priority: 9,
    parser: (match) => {
      const level = match[1].toLowerCase();
      return `impact=${IMPACT_MAPPINGS[level]}`;
    }
  },

  // Urgency patterns
  {
    regex: /\b(high|medium|low)\s+urgency\b/i,
    priority: 9,
    parser: (match) => {
      const level = match[1].toLowerCase();
      return `urgency=${URGENCY_MAPPINGS[level]}`;
    }
  },

  // Assignment patterns
  {
    regex: /\b(assigned\s+to\s+me|my\s+(incidents|problems|changes|tickets))\b/i,
    priority: 15,
    parser: () => 'assigned_to=javascript:gs.getUserID()'
  },
  {
    regex: /\bunassigned\b/i,
    priority: 15,
    parser: () => 'assigned_toISEMPTY'
  },
  {
    regex: /\bassigned\s+to\s+([a-zA-Z\s]+?)(?:\s+(?:and|or|with|created|opened|updated)|\s*$)/i,
    priority: 14,
    parser: (match) => {
      const userName = match[1].trim();
      // Note: This creates a LIKE query - could be enhanced with user lookup
      return `assigned_to.nameLIKE${userName}`;
    }
  },

  // Date patterns - relative
  {
    regex: /\b(created|opened|updated|modified|closed)\s+(today|yesterday)\b/i,
    priority: 12,
    parser: (match) => {
      const field = match[1].toLowerCase() === 'opened' ? 'sys_created_on' : `${match[1].toLowerCase()}_on`;
      const days = match[2].toLowerCase() === 'today' ? 0 : 1;
      return `${field}>javascript:gs.daysAgoStart(${days})`;
    }
  },
  {
    regex: /\b(created|opened|updated|modified|closed)\s+(?:in\s+)?(?:the\s+)?last\s+(\d+)\s+(days?|weeks?|months?)\b/i,
    priority: 12,
    parser: (match) => {
      const field = match[1].toLowerCase() === 'opened' ? 'sys_created_on' : `${match[1].toLowerCase()}_on`;
      const amount = parseInt(match[2]);
      const unit = match[3].toLowerCase();

      let days = amount;
      if (unit.startsWith('week')) days = amount * 7;
      if (unit.startsWith('month')) days = amount * 30;

      return `${field}>javascript:gs.daysAgo(${days})`;
    }
  },
  {
    regex: /\b(recent|recently\s+created|new)\b/i,
    priority: 8,
    parser: () => 'sys_created_on>javascript:gs.daysAgo(7)'
  },
  {
    regex: /\b(created|opened|updated|modified|closed)\s+before\s+([a-zA-Z]+\s+\d{1,2}(?:,?\s+\d{4})?)\b/i,
    priority: 11,
    parser: (match) => {
      const field = match[1].toLowerCase() === 'opened' ? 'sys_created_on' : `${match[1].toLowerCase()}_on`;
      // Simple date parsing - could be enhanced
      return `${field}<${match[2]}`;
    }
  },
  {
    regex: /\b(created|opened|updated|modified|closed)\s+after\s+([a-zA-Z]+\s+\d{1,2}(?:,?\s+\d{4})?)\b/i,
    priority: 11,
    parser: (match) => {
      const field = match[1].toLowerCase() === 'opened' ? 'sys_created_on' : `${match[1].toLowerCase()}_on`;
      return `${field}>${match[2]}`;
    }
  },

  // State patterns (table-dependent)
  {
    regex: /\b(new|open|active|in\s+progress|on\s+hold|resolved|closed|canceled)\b/i,
    priority: 7,
    parser: (match, table) => {
      const state = match[1].toLowerCase().trim();
      const mapping = STATE_MAPPINGS[table] || STATE_MAPPINGS.incident;
      return mapping[state] || `state=${state}`;
    }
  },

  // Content search patterns
  {
    regex: /\b(?:about|containing|with|includes?)\s+["']?([a-zA-Z0-9\s]+?)["']?(?:\s+(?:and|or|in|with|created|opened|assigned)|\s*$)/i,
    priority: 5,
    parser: (match) => {
      const searchTerm = match[1].trim();
      return `short_descriptionLIKE${searchTerm}^ORdescriptionLIKE${searchTerm}`;
    }
  },
  {
    regex: /\bdescription\s+(?:contains|includes)\s+["']?([^"']+?)["']?(?:\s+(?:and|or)|\s*$)/i,
    priority: 6,
    parser: (match) => {
      const searchTerm = match[1].trim();
      return `descriptionLIKE${searchTerm}`;
    }
  },

  // Number patterns
  {
    regex: /\bnumber\s+(?:is|=|equals?)\s+([A-Z]{3}\d{7})\b/i,
    priority: 20,
    parser: (match) => `number=${match[1]}`
  },

  // Caller patterns
  {
    regex: /\bcaller\s+(?:is|=)\s+([a-zA-Z\s]+?)(?:\s+(?:and|or|with)|\s*$)/i,
    priority: 10,
    parser: (match) => {
      const callerName = match[1].trim();
      return `caller_id.nameLIKE${callerName}`;
    }
  },

  // Category patterns
  {
    regex: /\bcategory\s+(?:is|=)\s+([a-zA-Z\s]+?)(?:\s+(?:and|or|with)|\s*$)/i,
    priority: 10,
    parser: (match) => {
      const category = match[1].trim();
      return `categoryLIKE${category}`;
    }
  },

  // Assignment group patterns
  {
    regex: /\bassignment\s+group\s+(?:is|=)\s+([a-zA-Z\s]+?)(?:\s+(?:and|or|with)|\s*$)/i,
    priority: 10,
    parser: (match) => {
      const group = match[1].trim();
      return `assignment_group.nameLIKE${group}`;
    }
  }
];

/**
 * Parse natural language query into ServiceNow encoded query
 *
 * @param {string} query - Natural language query
 * @param {string} table - Target ServiceNow table (default: 'incident')
 * @returns {object} - { encodedQuery, matchedPatterns, unmatchedText, suggestions }
 */
export function parseNaturalLanguage(query, table = 'incident') {
  if (!query || typeof query !== 'string') {
    return {
      encodedQuery: '',
      matchedPatterns: [],
      unmatchedText: query,
      suggestions: ['Please provide a valid query string']
    };
  }

  const originalQuery = query;
  let remainingQuery = query;
  const conditions = [];
  const matchedPatterns = [];
  const suggestions = [];

  // Sort patterns by priority (highest first)
  const sortedPatterns = [...PATTERNS].sort((a, b) => b.priority - a.priority);

  // Process each pattern
  for (const pattern of sortedPatterns) {
    const match = remainingQuery.match(pattern.regex);
    if (match) {
      try {
        const condition = pattern.parser(match, table);
        conditions.push(condition);
        matchedPatterns.push({
          pattern: pattern.regex.toString(),
          matched: match[0],
          condition
        });

        // Remove matched text from remaining query
        remainingQuery = remainingQuery.replace(match[0], ' ').trim();
      } catch (error) {
        console.error(`Pattern parsing error:`, error);
      }
    }
  }

  // Check for logical operators in remaining text
  const hasAnd = /\band\b/i.test(remainingQuery);
  const hasOr = /\bor\b/i.test(remainingQuery);

  // Build encoded query
  let encodedQuery = '';
  if (conditions.length > 0) {
    // Use OR if query contains "or", otherwise use AND (default)
    const operator = hasOr ? '^OR' : '^';
    encodedQuery = conditions.join(operator);
  }

  // Clean up remaining query
  remainingQuery = remainingQuery
    .replace(/\b(and|or|with|in|the|a|an)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Generate suggestions for unmatched text
  if (remainingQuery.length > 3) {
    suggestions.push(`Unrecognized: "${remainingQuery}"`);
    suggestions.push('Try using encoded query format: field=value^field2=value2');
    suggestions.push('Supported patterns: priority (P1-P5), state (new/open/closed), assigned to me/unassigned, recent, dates');
  }

  // If no patterns matched, return original query (might be encoded query already)
  if (conditions.length === 0) {
    // Check if it looks like an encoded query already
    if (/[=^]/.test(originalQuery)) {
      return {
        encodedQuery: originalQuery,
        matchedPatterns: [],
        unmatchedText: '',
        suggestions: ['Using query as-is (appears to be encoded query format)']
      };
    }

    return {
      encodedQuery: '',
      matchedPatterns: [],
      unmatchedText: originalQuery,
      suggestions: [
        'No patterns matched. Supported patterns:',
        '- Priority: "high priority", "P1", "priority 2"',
        '- Assignment: "assigned to me", "unassigned", "assigned to John"',
        '- State: "new", "open", "closed", "in progress"',
        '- Dates: "created today", "last 7 days", "recent"',
        '- Content: "about SAP", "containing error"',
        'Or use ServiceNow encoded query format: field=value^field2=value2'
      ]
    };
  }

  return {
    encodedQuery,
    matchedPatterns,
    unmatchedText: remainingQuery,
    suggestions: suggestions.length > 0 ? suggestions : ['Query parsed successfully']
  };
}

/**
 * Test the natural language parser with example queries
 *
 * @param {string} table - Table name to test against
 * @returns {Array} - Array of test results
 */
export function testParser(table = 'incident') {
  const testQueries = [
    'find all P1 incidents',
    'show recent problems assigned to me',
    'high priority changes created last week',
    'open incidents about SAP',
    'unassigned P2 incidents',
    'incidents created today with high priority',
    'closed problems assigned to John Smith',
    'critical incidents opened in the last 30 days',
    'show me my active tickets',
    'new incidents with high impact and high urgency',
    'incidents containing database error',
    'P1 incidents assigned to Network Team',
    'incidents created after January 1',
    'resolved incidents about authentication'
  ];

  return testQueries.map(query => ({
    query,
    result: parseNaturalLanguage(query, table)
  }));
}

/**
 * Get supported patterns documentation
 *
 * @returns {object} - Documentation of supported patterns
 */
export function getSupportedPatterns() {
  return {
    priority: {
      examples: ['high priority', 'P1', 'priority 2', 'critical priority'],
      encodedQuery: 'priority=1'
    },
    assignment: {
      examples: ['assigned to me', 'unassigned', 'assigned to John Smith', 'my incidents'],
      encodedQuery: 'assigned_to=javascript:gs.getUserID() or assigned_toISEMPTY'
    },
    state: {
      examples: ['new', 'open', 'active', 'in progress', 'closed', 'resolved'],
      encodedQuery: 'state=1 (varies by table)'
    },
    dates: {
      examples: ['created today', 'last 7 days', 'recent', 'opened yesterday', 'updated last week'],
      encodedQuery: 'sys_created_on>javascript:gs.daysAgo(7)'
    },
    content: {
      examples: ['about SAP', 'containing error', 'description contains authentication'],
      encodedQuery: 'short_descriptionLIKESAP'
    },
    impact: {
      examples: ['high impact', 'medium impact', 'low impact'],
      encodedQuery: 'impact=1'
    },
    urgency: {
      examples: ['high urgency', 'medium urgency', 'low urgency'],
      encodedQuery: 'urgency=1'
    },
    number: {
      examples: ['number is INC0012345'],
      encodedQuery: 'number=INC0012345'
    },
    caller: {
      examples: ['caller is John Smith'],
      encodedQuery: 'caller_id.nameLIKEJohn Smith'
    },
    category: {
      examples: ['category is Software'],
      encodedQuery: 'categoryLIKESoftware'
    },
    assignmentGroup: {
      examples: ['assignment group is Network Team'],
      encodedQuery: 'assignment_group.nameLIKENetwork Team'
    },
    combining: {
      examples: ['high priority and assigned to me', 'P1 or P2 incidents', 'recent and unassigned'],
      encodedQuery: 'Use "and" for ^ operator, "or" for ^OR operator'
    }
  };
}

export default {
  parseNaturalLanguage,
  testParser,
  getSupportedPatterns
};
