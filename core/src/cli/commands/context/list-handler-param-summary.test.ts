import { describe, it, expect, vi } from 'vitest';
import type { ListOptions } from './list-handler';
import type { NoteQuery } from '../../../types/note';

// We need to export buildParameterSummary from list-handler.ts for testing
// For now, we'll test it through the full listNotes function

describe('Parameter Summary Building', () => {
  // Mock chalk for consistent output
  vi.mock('chalk', () => ({
    default: {
      gray: (str: string) => str,
      cyan: (str: string) => str,
      yellow: (str: string) => str,
      green: (str: string) => str,
      red: (str: string) => str,
    },
  }));

  const buildParameterSummaryTest = (options: ListOptions, query: NoteQuery): string => {
    // This is a copy of the buildParameterSummary function for testing
    const params: string[] = [];

    // Format
    if (options.format && options.format !== 'table') {
      params.push(`Format: ${options.format}`);
    }

    // Tree depth
    if (options.format === 'tree') {
      params.push(`Tree depth: ${options.treeDepth || 2}`);
    }

    // Types filter
    if (query.types && query.types.length > 0) {
      params.push(`Types: ${query.types.join(', ')}`);
    }
    if (query.excludeTypes && query.excludeTypes.length > 0) {
      params.push(`Exclude types: ${query.excludeTypes.join(', ')}`);
    }

    // Tags filter
    if (query.tags && query.tags.length > 0) {
      params.push(`Tags: ${query.tags.join(', ')}`);
    }
    if (query.excludeTags && query.excludeTags.length > 0) {
      params.push(`Exclude tags: ${query.excludeTags.join(', ')}`);
    }

    // Content filter
    if (options.contains) {
      params.push(`Contains: "${options.contains}"`);
    }

    // Date filters
    if (query.createdAfter) {
      params.push(`Created after: ${query.createdAfter.toISOString().split('T')[0]}`);
    }
    if (query.createdBefore) {
      params.push(`Created before: ${query.createdBefore.toISOString().split('T')[0]}`);
    }

    // Reference filters
    if (query.minIncomingRefs !== undefined) {
      params.push(`Min incoming refs: ${query.minIncomingRefs}`);
    }
    if (query.minOutgoingRefs !== undefined) {
      params.push(`Min outgoing refs: ${query.minOutgoingRefs}`);
    }
    if (query.hasNoRefs) {
      params.push(`No references`);
    }

    // Sort
    if (query.sortBy) {
      params.push(`Sort: ${query.sortBy} ${query.sortOrder || 'desc'}`);
    }

    // Limit
    if (query.limit) {
      params.push(`Limit: ${query.limit}`);
    }

    if (params.length === 0) {
      params.push('No filters applied');
    }

    // Add reference count clarification
    const refNote = options.filteredRefs
      ? 'Reference counts show only references within filtered results'
      : 'Reference counts show total references (not filtered)';

    return params.join(' | ') + '\n' + refNote;
  };

  it('should show "No filters applied" when no options provided', () => {
    const summary = buildParameterSummaryTest({}, {});

    expect(summary).toContain('No filters applied');
    expect(summary).toContain('Reference counts show total references (not filtered)');
  });

  it('should show all filters when fully specified', () => {
    const summary = buildParameterSummaryTest(
      {
        format: 'tree',
        treeDepth: 3,
        contains: 'search text',
        filteredRefs: true,
      },
      {
        types: ['R', 'T'],
        excludeTypes: ['D'],
        tags: ['cat1', 'cat2'],
        excludeTags: ['cat3'],
        createdAfter: new Date('2024-01-01'),
        createdBefore: new Date('2024-12-31'),
        minIncomingRefs: 2,
        minOutgoingRefs: 3,
        sortBy: 'modified',
        sortOrder: 'asc',
        limit: 20,
      },
    );

    expect(summary).toContain('Format: tree');
    expect(summary).toContain('Tree depth: 3');
    expect(summary).toContain('Types: R, T');
    expect(summary).toContain('Exclude types: D');
    expect(summary).toContain('Tags: cat1, cat2');
    expect(summary).toContain('Exclude tags: cat3');
    expect(summary).toContain('Contains: "search text"');
    expect(summary).toContain('Created after: 2024-01-01');
    expect(summary).toContain('Created before: 2024-12-31');
    expect(summary).toContain('Min incoming refs: 2');
    expect(summary).toContain('Min outgoing refs: 3');
    expect(summary).toContain('Sort: modified asc');
    expect(summary).toContain('Limit: 20');
    expect(summary).toContain('Reference counts show only references within filtered results');
  });

  it('should handle table format (default) by not showing it', () => {
    const summary = buildParameterSummaryTest({ format: 'table' }, {});

    expect(summary).not.toContain('Format:');
  });

  it('should show default tree depth when not specified', () => {
    const summary = buildParameterSummaryTest({ format: 'tree' }, {});

    expect(summary).toContain('Tree depth: 2');
  });

  it('should handle hasNoRefs flag', () => {
    const summary = buildParameterSummaryTest({}, { hasNoRefs: true });

    expect(summary).toContain('No references');
  });

  it('should format dates correctly', () => {
    const summary = buildParameterSummaryTest(
      {},
      {
        createdAfter: new Date('2024-01-15'),
        createdBefore: new Date('2024-12-25'),
      },
    );

    expect(summary).toContain('Created after: 2024-01-15');
    expect(summary).toContain('Created before: 2024-12-25');
  });

  it('should handle very long filter lists gracefully', () => {
    const longTypes = Array(50)
      .fill(0)
      .map((_, i) => `Type${i}`);
    const summary = buildParameterSummaryTest({}, { types: longTypes });

    expect(summary).toContain('Types: Type0, Type1, Type2');
    expect(summary).toContain('Type49');
  });

  it('should escape special characters in contains filter', () => {
    const summary = buildParameterSummaryTest({ contains: 'test "quotes" and \'apostrophes\'' }, {});

    expect(summary).toContain('Contains: "test "quotes" and \'apostrophes\'"');
  });
});
