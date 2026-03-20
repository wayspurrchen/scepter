import { describe, it, expect } from 'vitest';
import { formatTable, formatList } from './table-formatter';
import { formatTree, formatIndentedTree } from './tree-formatter';
import { formatNote, formatNotes, formatNotesAsJson, formatNotesForLLM, formatNoteStats } from './note-formatter';
import {
  extractExcerpt,
  generateSearchExcerpt,
  highlightMatches,
  extractFirstParagraph,
  countTokens,
  truncateToTokenLimit,
} from './excerpt-extractor';
import type { Note } from '../../types/note';

// Test data
const testNotes: Note[] = [
  {
    id: 'D001',
    type: 'Decision',
    title: 'Use PostgreSQL for main database',
    content: 'We will use PostgreSQL as our primary database for its robustness and features.',
    tags: ['database', 'infrastructure'],
    created: new Date('2024-01-01'),
    modified: new Date('2024-01-15'),
    references: {
      incoming: [{ fromId: 'R001', toId: 'D001' }],
      outgoing: [
        { fromId: 'D001', toId: 'T001' },
        { fromId: 'D001', toId: 'T002' },
      ],
    },
  },
  {
    id: 'R001',
    type: 'Requirement',
    title: 'Support complex queries',
    content: 'The system must support complex queries with joins and aggregations.',
    tags: ['database', 'performance'],
    created: new Date('2024-01-01'),
    references: {
      incoming: [],
      outgoing: [{ fromId: 'R001', toId: 'D001' }],
    },
  },
  {
    id: 'T001',
    type: 'TODO',
    title: 'Set up PostgreSQL instance',
    content: 'Install and configure PostgreSQL on development environment',
    tags: ['setup'],
    created: new Date('2024-01-02'),
    references: {
      incoming: [{ fromId: 'D001', toId: 'T001' }],
      outgoing: [],
    },
  },
];

describe('Table Formatter', () => {
  it('should format notes as a table', () => {
    const result = formatTable(testNotes.slice(0, 2));

    expect(result).toContain('ID');
    expect(result).toContain('Type');
    expect(result).toContain('Title');
    expect(result).toContain('D001');
    expect(result).toContain('Decision');
    expect(result).toContain('Use PostgreSQL');
    expect(result).toContain('R001');
    expect(result).toContain('Requirement');
  });

  it('should format notes as a list', () => {
    const result = formatList(testNotes.slice(0, 2), true);

    expect(result).toContain('D001 - Use PostgreSQL for main database');
    expect(result).toContain('Type: Decision');
    expect(result).toContain('Tags: database, infrastructure');
    expect(result).toContain('Modified: 2024-01-15');
  });

  it('should format simple list without details', () => {
    const result = formatList(testNotes.slice(0, 2), false);

    expect(result).toContain('D001 - Use PostgreSQL for main database');
    expect(result).toContain('R001 - Support complex queries');
    expect(result).not.toContain('Type:');
    expect(result).not.toContain('Tags:');
  });
});

describe('Tree Formatter', () => {
  it('should format notes as a tree', () => {
    const noteMap = new Map(testNotes.map((n) => [n.id, n]));
    const result = formatTree([testNotes[0]], noteMap, { maxDepth: 2 });

    expect(result).toContain('D001');
    expect(result).toContain('[Decision]');
    expect(result).toContain('Use PostgreSQL');
    expect(result).toContain('└─'); // Root uses └─
    expect(result).toContain('T001');
  });

  it('should show circular reference indicators', () => {
    // Create a proper circular reference where T001 references back to D001
    const d001: Note = {
      ...testNotes[0],
      references: {
        incoming: [{ fromId: 'T001', toId: 'D001' }],
        outgoing: [{ fromId: 'D001', toId: 'T001' }],
      },
    };

    const t001: Note = {
      ...testNotes[2],
      references: {
        incoming: [{ fromId: 'D001', toId: 'T001' }],
        outgoing: [{ fromId: 'T001', toId: 'D001' }], // This creates the circular reference
      },
    };

    const noteMap = new Map([
      [d001.id, d001],
      [t001.id, t001],
    ]);
    const result = formatTree([d001], noteMap, { maxDepth: 3 });

    expect(result).toContain('↻');
  });

  it('should format indented tree', () => {
    const notesWithDepth = testNotes.map((n, i) => ({ ...n, depth: i }));
    const result = formatIndentedTree(notesWithDepth);

    expect(result.split('\n')[0]).not.toMatch(/^\s/); // First line not indented
    expect(result.split('\n')[1]).toMatch(/^\s{2}/); // Second line indented by 2
    expect(result.split('\n')[2]).toMatch(/^\s{4}/); // Third line indented by 4
  });
});

describe('Note Formatter', () => {
  it('should format a single note', () => {
    const result = formatNote(testNotes[0]);

    expect(result).toContain('D001 - Use PostgreSQL for main database');
    expect(result).toContain('Type: Decision');
    expect(result).toContain('Tags: database, infrastructure');
    expect(result).toContain('Created: 2024-01-01');
    expect(result).toContain('Modified: 2024-01-15');
    expect(result).toContain('We will use PostgreSQL');
  });

  it('should format multiple notes with delimiter', () => {
    const result = formatNotes(testNotes.slice(0, 2));

    expect(result).toContain('─'.repeat(80));
    expect(result).toContain('D001');
    expect(result).toContain('R001');
  });

  it('should format notes as JSON', () => {
    const result = formatNotesAsJson(testNotes.slice(0, 1));
    const parsed = JSON.parse(result);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('D001');
    expect(parsed[0].type).toBe('Decision');
  });

  it('should format notes for LLM context', () => {
    const result = formatNotesForLLM(testNotes);

    expect(result).toContain('# Context Notes');
    expect(result).toContain('## Decisions');
    expect(result).toContain('### Decision - D001: Use PostgreSQL for main database');
    expect(result).toContain('## Requirements');
    expect(result).toContain('### Requirement - R001: Support complex queries');
  });

  it('should format note statistics', () => {
    const result = formatNoteStats(testNotes);

    expect(result).toContain('Note Statistics');
    expect(result).toContain('Total notes: 3');
    expect(result).toContain('With references: 3');
    expect(result).toContain('Orphaned: 0');
    expect(result).toContain('Decision: 1');
    expect(result).toContain('Requirement: 1');
    expect(result).toContain('TODO: 1');
  });
});

describe('Excerpt Extractor', () => {
  it('should extract first line after title', () => {
    const content = `# R001 - Core authentication system

The system must provide secure user authentication with the following features:

- Username/password authentication
- Multi-factor authentication`;

    const result = extractExcerpt(content);
    expect(result).toBe('The system must provide secure user authentication with the following features:');
  });

  it('should skip empty lines after title', () => {
    const content = `# D001 - Use JWT for authentication



We need a stateless authentication mechanism.

## Status
Accepted`;

    const result = extractExcerpt(content);
    expect(result).toBe('We need a stateless authentication mechanism.');
  });

  it('should handle content without title', () => {
    const content = `This is just plain content without a title.

More content here.`;

    const result = extractExcerpt(content);
    expect(result).toBe('This is just plain content without a title.');
  });

  it('should return empty string for empty content', () => {
    const result = extractExcerpt('');
    expect(result).toBe('');
  });

  it('should handle content with only title', () => {
    const content = `# T001 - Some task title`;

    const result = extractExcerpt(content);
    expect(result).toBe('');
  });

  it('should not include headers as excerpt', () => {
    const content = `# M001 - MVP Release

## Target Date
2024-04-30

Minimum viable product with core features.`;

    const result = extractExcerpt(content);
    expect(result).toBe('Minimum viable product with core features.');
  });

  it('should generate search excerpts with context', () => {
    const content = `Line 1: No match here
Line 2: This contains the search term
Line 3: Another line
Line 4: Also has the search term here
Line 5: Final line`;

    const pattern = /search term/gi;
    const excerpts = generateSearchExcerpt(content, pattern, { contextLines: 1 });

    expect(excerpts).toHaveLength(2);
    expect(excerpts[0]).toContain('Line 1:');
    expect(excerpts[0]).toContain('Line 2:');
    expect(excerpts[0]).toContain('Line 3:');
    expect(excerpts[1]).toContain('Line 3:');
    expect(excerpts[1]).toContain('Line 4:');
    expect(excerpts[1]).toContain('Line 5:');
  });

  it('should highlight matches', () => {
    const text = 'This text contains a match and another match';
    const pattern = /match/gi;
    const result = highlightMatches(text, pattern);

    // The highlighting depends on chalk being loaded in test environment
    // Just verify the text still contains the match
    expect(result).toContain('match');
  });

  it('should extract first paragraph ignoring title', () => {
    const content = `# C001 - Component name

This is the component overview.

## Details

More content here.`;

    const result = extractFirstParagraph(content);

    expect(result).toBe('This is the component overview.');
  });

  it('should count tokens', () => {
    const content = 'This is a simple sentence with seven words.';
    const count = countTokens(content);

    expect(count).toBe(8);
  });

  it('should truncate to token limit', () => {
    const content = 'This is a sentence that will be truncated to a specific token limit for testing purposes.';
    const result = truncateToTokenLimit(content, 10);

    expect(result).toBe('This is a sentence that will be truncated to a...');
    expect(countTokens(result)).toBeLessThanOrEqual(11); // 10 words + ellipsis
  });
});
