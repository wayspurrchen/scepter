/**
 * Tests for claim search and filtering.
 *
 * @validates {R007.§1.AC.01} Text query matches fullyQualified + heading
 * @validates {R007.§1.AC.02} --id-only restricts to fullyQualified + claimId
 * @validates {R007.§1.AC.03} Regex mode with \| normalization
 * @validates {R007.§1.AC.04} Literal mode with case-insensitive matching
 * @validates {R007.§1.AC.05} Empty query valid with filters
 * @validates {R007.§1.AC.06} Empty query without filters produces error
 * @validates {R007.§2.AC.01} --types filter by note type
 * @validates {R007.§2.AC.02} --note filter by note ID
 * @validates {R007.§2.AC.03} --importance filter (>= threshold)
 * @validates {R007.§2.AC.04} --lifecycle filter by state
 * @validates {R007.§2.AC.05} Conjunctive composition (AND)
 * @validates {R007.§2.AC.06} --limit with default 50
 * @validates {R007.§3.AC.01} --derives-from filter
 * @validates {R007.§3.AC.02} --derivatives-of via getDerivatives()
 * @validates {R007.§3.AC.03} --has-derivation filter
 * @validates {R007.§3.AC.04} Derivation filters compose with text + other filters
 * @validates {R007.§3.AC.05} Unresolvable derivation target produces error
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildSearchPattern,
  matchesQuery,
  matchesTypeFilter,
  matchesNoteFilter,
  matchesImportanceFilter,
  matchesLifecycleFilter,
  matchesDerivedFromFilter,
  matchesHasDerivation,
  searchClaims,
} from '../claim-search';
import type { ClaimSearchOptions, ClaimSearchResult } from '../claim-search';
import type { ClaimIndexData, ClaimIndexEntry } from '../claim-index';
import type { ClaimIndex } from '../claim-index';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<ClaimIndexEntry> = {}): ClaimIndexEntry {
  return {
    noteId: 'R005',
    claimId: '1.AC.01',
    fullyQualified: 'R005.1.AC.01',
    sectionPath: [1],
    claimPrefix: 'AC',
    claimNumber: 1,
    heading: '§1.AC.01 Parser extracts importance digits',
    line: 10,
    endLine: 15,
    metadata: ['4'],
    importance: 4,
    lifecycle: undefined,
    parsedTags: [],
    derivedFrom: [],
    noteType: 'Requirement',
    noteFilePath: '/path/to/R005.md',
    ...overrides,
  };
}

function makeIndexData(entries: ClaimIndexEntry[]): ClaimIndexData {
  const map = new Map<string, ClaimIndexEntry>();
  for (const e of entries) {
    map.set(e.fullyQualified, e);
  }
  return {
    entries: map,
    trees: new Map(),
    noteTypes: new Map(),
    crossRefs: [],
    errors: [],
  };
}

function makeMockClaimIndex(derivativesMap: Record<string, string[]> = {}): ClaimIndex {
  return {
    getDerivatives: (claimId: string) => derivativesMap[claimId] ?? [],
  } as unknown as ClaimIndex;
}

// ---------------------------------------------------------------------------
// buildSearchPattern
// @validates {R007.§1.AC.03} regex mode with \| normalization
// @validates {R007.§1.AC.04} literal mode with case-insensitive matching
// ---------------------------------------------------------------------------

describe('buildSearchPattern', () => {
  // @validates {R007.§1.AC.04}
  it('builds a case-insensitive literal pattern by default', () => {
    const pattern = buildSearchPattern('AC.01', { regex: false });
    expect(pattern.flags).toContain('i');
    expect(pattern.test('AC.01')).toBe(true);
    expect(pattern.test('ac.01')).toBe(true);
    // Special chars should be escaped
    expect(pattern.test('AC001')).toBe(false); // dot is literal, not wildcard
  });

  // @validates {R007.§1.AC.04}
  it('escapes special regex characters in literal mode', () => {
    const pattern = buildSearchPattern('foo.*bar', { regex: false });
    expect(pattern.test('foo.*bar')).toBe(true);
    expect(pattern.test('fooXXbar')).toBe(false); // .* should be literal
  });

  // @validates {R007.§1.AC.03}
  it('treats query as regex when regex=true', () => {
    const pattern = buildSearchPattern('AC\\.0[1-3]', { regex: true });
    expect(pattern.test('AC.01')).toBe(true);
    expect(pattern.test('AC.02')).toBe(true);
    expect(pattern.test('AC.03')).toBe(true);
    expect(pattern.test('AC.04')).toBe(false);
  });

  // @validates {R007.§1.AC.03}
  it('normalizes shell-escaped \\| to | for alternation in regex mode', () => {
    const pattern = buildSearchPattern('foo\\|bar', { regex: true });
    expect(pattern.test('foo')).toBe(true);
    expect(pattern.test('bar')).toBe(true);
    expect(pattern.test('baz')).toBe(false);
  });

  // @validates {R007.§1.AC.03}
  it('regex mode is case-insensitive', () => {
    const pattern = buildSearchPattern('ac\\.01', { regex: true });
    expect(pattern.test('AC.01')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// matchesQuery
// @validates {R007.§1.AC.01} default: fullyQualified + heading
// @validates {R007.§1.AC.02} idOnly: fullyQualified + claimId
// ---------------------------------------------------------------------------

describe('matchesQuery', () => {
  const entry = makeEntry({
    fullyQualified: 'R005.1.AC.01',
    claimId: '1.AC.01',
    heading: '§1.AC.01 Parser extracts importance digits',
  });

  // @validates {R007.§1.AC.01}
  it('matches against fullyQualified in default mode', () => {
    const pattern = /R005/i;
    expect(matchesQuery(entry, pattern, false)).toBe(true);
  });

  // @validates {R007.§1.AC.01}
  it('matches against heading in default mode', () => {
    const pattern = /importance/i;
    expect(matchesQuery(entry, pattern, false)).toBe(true);
  });

  // @validates {R007.§1.AC.01}
  it('does not match when neither field matches in default mode', () => {
    const pattern = /nonexistent/i;
    expect(matchesQuery(entry, pattern, false)).toBe(false);
  });

  // @validates {R007.§1.AC.02}
  it('matches against fullyQualified in id-only mode', () => {
    const pattern = /R005\.1\.AC\.01/i;
    expect(matchesQuery(entry, pattern, true)).toBe(true);
  });

  // @validates {R007.§1.AC.02}
  it('matches against claimId in id-only mode', () => {
    const pattern = /1\.AC\.01/i;
    expect(matchesQuery(entry, pattern, true)).toBe(true);
  });

  // @validates {R007.§1.AC.02}
  it('does NOT match heading text in id-only mode', () => {
    const pattern = /importance/i;
    expect(matchesQuery(entry, pattern, true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Filter predicates
// ---------------------------------------------------------------------------

describe('matchesTypeFilter', () => {
  const entry = makeEntry({ noteType: 'Requirement' });

  // @validates {R007.§2.AC.01}
  it('returns true when noteType is in the types list', () => {
    expect(matchesTypeFilter(entry, ['Requirement', 'DetailedDesign'])).toBe(true);
  });

  // @validates {R007.§2.AC.01}
  it('returns false when noteType is not in the types list', () => {
    expect(matchesTypeFilter(entry, ['DetailedDesign', 'Specification'])).toBe(false);
  });
});

describe('matchesNoteFilter', () => {
  const entry = makeEntry({ noteId: 'R005' });

  // @validates {R007.§2.AC.02}
  it('returns true for exact noteId match', () => {
    expect(matchesNoteFilter(entry, 'R005')).toBe(true);
  });

  // @validates {R007.§2.AC.02}
  it('returns false for non-matching noteId', () => {
    expect(matchesNoteFilter(entry, 'R006')).toBe(false);
  });
});

describe('matchesImportanceFilter', () => {
  // @validates {R007.§2.AC.03}
  it('returns true when importance >= threshold', () => {
    expect(matchesImportanceFilter(makeEntry({ importance: 4 }), 4)).toBe(true);
    expect(matchesImportanceFilter(makeEntry({ importance: 5 }), 4)).toBe(true);
  });

  // @validates {R007.§2.AC.03}
  it('returns false when importance < threshold', () => {
    expect(matchesImportanceFilter(makeEntry({ importance: 3 }), 4)).toBe(false);
  });

  // @validates {R007.§2.AC.03}
  it('returns false when importance is undefined', () => {
    expect(matchesImportanceFilter(makeEntry({ importance: undefined }), 1)).toBe(false);
  });
});

describe('matchesLifecycleFilter', () => {
  // @validates {R007.§2.AC.04}
  it('returns true when lifecycle type matches', () => {
    const entry = makeEntry({ lifecycle: { type: 'closed' } });
    expect(matchesLifecycleFilter(entry, 'closed')).toBe(true);
  });

  // @validates {R007.§2.AC.04}
  it('returns false when lifecycle type does not match', () => {
    const entry = makeEntry({ lifecycle: { type: 'closed' } });
    expect(matchesLifecycleFilter(entry, 'deferred')).toBe(false);
  });

  // @validates {R007.§2.AC.04}
  it('returns false when lifecycle is undefined', () => {
    const entry = makeEntry({ lifecycle: undefined });
    expect(matchesLifecycleFilter(entry, 'closed')).toBe(false);
  });
});

describe('matchesDerivedFromFilter', () => {
  // @validates {R007.§3.AC.01}
  it('returns true when derivedFrom contains the target', () => {
    const entry = makeEntry({ derivedFrom: ['R005.1.AC.01', 'R005.1.AC.02'] });
    expect(matchesDerivedFromFilter(entry, 'R005.1.AC.01')).toBe(true);
  });

  // @validates {R007.§3.AC.01}
  it('returns false when derivedFrom does not contain the target', () => {
    const entry = makeEntry({ derivedFrom: ['R005.1.AC.02'] });
    expect(matchesDerivedFromFilter(entry, 'R005.1.AC.01')).toBe(false);
  });

  // @validates {R007.§3.AC.01}
  it('returns false when derivedFrom is empty', () => {
    const entry = makeEntry({ derivedFrom: [] });
    expect(matchesDerivedFromFilter(entry, 'R005.1.AC.01')).toBe(false);
  });
});

describe('matchesHasDerivation', () => {
  // @validates {R007.§3.AC.03}
  it('returns true when derivedFrom is non-empty', () => {
    expect(matchesHasDerivation(makeEntry({ derivedFrom: ['R005.1.AC.01'] }))).toBe(true);
  });

  // @validates {R007.§3.AC.03}
  it('returns false when derivedFrom is empty', () => {
    expect(matchesHasDerivation(makeEntry({ derivedFrom: [] }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// searchClaims — integration of query + filters
// ---------------------------------------------------------------------------

describe('searchClaims', () => {
  // Build a rich fixture set
  const entries: ClaimIndexEntry[] = [
    makeEntry({
      noteId: 'R005',
      claimId: '1.AC.01',
      fullyQualified: 'R005.1.AC.01',
      heading: '§1.AC.01 Parser extracts importance digits',
      importance: 4,
      noteType: 'Requirement',
      derivedFrom: [],
    }),
    makeEntry({
      noteId: 'R005',
      claimId: '1.AC.02',
      fullyQualified: 'R005.1.AC.02',
      heading: '§1.AC.02 Lifecycle tags recognized',
      importance: 3,
      noteType: 'Requirement',
      lifecycle: { type: 'closed' },
      derivedFrom: [],
    }),
    makeEntry({
      noteId: 'DD003',
      claimId: '1.DC.01',
      fullyQualified: 'DD003.1.DC.01',
      heading: '§1.DC.01 Derivation resolution at build time',
      importance: 5,
      noteType: 'DetailedDesign',
      derivedFrom: ['R005.1.AC.01'],
    }),
    makeEntry({
      noteId: 'DD003',
      claimId: '1.DC.02',
      fullyQualified: 'DD003.1.DC.02',
      heading: '§1.DC.02 Bidirectional derivation index',
      importance: undefined,
      noteType: 'DetailedDesign',
      derivedFrom: ['R005.1.AC.01'],
    }),
    makeEntry({
      noteId: 'S006',
      claimId: '1.SC.01',
      fullyQualified: 'S006.1.SC.01',
      heading: '§1.SC.01 Catalog tradition parsing',
      importance: 2,
      noteType: 'Specification',
      derivedFrom: [],
    }),
  ];

  const data = makeIndexData(entries);

  const derivativesMap: Record<string, string[]> = {
    'R005.1.AC.01': ['DD003.1.DC.01', 'DD003.1.DC.02'],
  };
  const claimIndex = makeMockClaimIndex(derivativesMap);

  // --- Empty query validation ---

  // @validates {R007.§1.AC.06}
  it('returns error for empty query with no filters', () => {
    const result = searchClaims(data, claimIndex, { query: '' });
    expect(result.error).toBeDefined();
    expect(result.matches).toHaveLength(0);
  });

  // @validates {R007.§1.AC.05}
  it('accepts empty query when filters are present', () => {
    const result = searchClaims(data, claimIndex, { query: '', types: ['Requirement'] });
    expect(result.error).toBeUndefined();
    expect(result.matches.length).toBeGreaterThan(0);
  });

  // --- Text query matching ---

  // @validates {R007.§1.AC.01}
  it('matches text query against fullyQualified', () => {
    const result = searchClaims(data, claimIndex, { query: 'R005.1.AC.01' });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].fullyQualified).toBe('R005.1.AC.01');
  });

  // @validates {R007.§1.AC.01}
  it('matches text query against heading', () => {
    const result = searchClaims(data, claimIndex, { query: 'catalog' });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].fullyQualified).toBe('S006.1.SC.01');
  });

  // @validates {R007.§1.AC.04}
  it('literal matching is case-insensitive', () => {
    const result = searchClaims(data, claimIndex, { query: 'CATALOG' });
    expect(result.matches).toHaveLength(1);
  });

  // @validates {R007.§1.AC.02}
  it('--id-only restricts to ID fields', () => {
    // "importance" is in the heading, not the ID
    const result = searchClaims(data, claimIndex, { query: 'importance', idOnly: true });
    expect(result.matches).toHaveLength(0);
  });

  // @validates {R007.§1.AC.02}
  it('--id-only still matches fullyQualified', () => {
    const result = searchClaims(data, claimIndex, { query: 'AC.01', idOnly: true });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].fullyQualified).toBe('R005.1.AC.01');
  });

  // @validates {R007.§1.AC.03}
  it('--regex enables regex matching with \\| normalization', () => {
    const result = searchClaims(data, claimIndex, { query: 'catalog\\|importance', regex: true });
    expect(result.matches).toHaveLength(2);
    const fqids = result.matches.map(m => m.fullyQualified).sort();
    expect(fqids).toContain('R005.1.AC.01');
    expect(fqids).toContain('S006.1.SC.01');
  });

  // @validates {R007.§1.AC.03}
  it('--regex supports character classes', () => {
    const result = searchClaims(data, claimIndex, { query: 'DC\\.0[1-2]', regex: true });
    expect(result.matches).toHaveLength(2);
  });

  // --- Invalid regex ---

  it('returns error for invalid regex', () => {
    const result = searchClaims(data, claimIndex, { query: '[unclosed', regex: true });
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Invalid regex');
  });

  // --- Filters ---

  // @validates {R007.§2.AC.01}
  it('--types filters by note type', () => {
    const result = searchClaims(data, claimIndex, { query: '', types: ['Requirement'] });
    expect(result.matches).toHaveLength(2);
    expect(result.matches.every(m => m.noteType === 'Requirement')).toBe(true);
  });

  // @validates {R007.§2.AC.01}
  it('--types accepts multiple types', () => {
    const result = searchClaims(data, claimIndex, { query: '', types: ['Requirement', 'Specification'] });
    expect(result.matches).toHaveLength(3);
  });

  // @validates {R007.§2.AC.02}
  it('--note filters by note ID', () => {
    const result = searchClaims(data, claimIndex, { query: '', note: 'DD003' });
    expect(result.matches).toHaveLength(2);
    expect(result.matches.every(m => m.noteId === 'DD003')).toBe(true);
  });

  // @validates {R007.§2.AC.02}
  it('--note returns error for unknown note ID', () => {
    const result = searchClaims(data, claimIndex, { query: '', note: 'R999' });
    expect(result.error).toBeDefined();
    expect(result.error).toContain('R999');
  });

  // @validates {R007.§2.AC.03}
  it('--importance filters by minimum importance', () => {
    const result = searchClaims(data, claimIndex, { query: '', importance: 4 });
    expect(result.matches).toHaveLength(2);
    expect(result.matches.every(m => m.importance !== undefined && m.importance >= 4)).toBe(true);
  });

  // @validates {R007.§2.AC.03}
  it('--importance excludes claims with no importance', () => {
    const result = searchClaims(data, claimIndex, { query: '', importance: 1 });
    // DD003.1.DC.02 has undefined importance, should be excluded
    expect(result.matches.every(m => m.importance !== undefined)).toBe(true);
  });

  // @validates {R007.§2.AC.04}
  it('--lifecycle filters by lifecycle state', () => {
    const result = searchClaims(data, claimIndex, { query: '', lifecycle: 'closed' });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].fullyQualified).toBe('R005.1.AC.02');
  });

  // @validates {R007.§2.AC.04}
  it('--lifecycle excludes claims with no lifecycle', () => {
    const result = searchClaims(data, claimIndex, { query: '', lifecycle: 'deferred' });
    expect(result.matches).toHaveLength(0);
  });

  // Invalid lifecycle
  it('returns error for invalid lifecycle value', () => {
    const result = searchClaims(data, claimIndex, { query: '', lifecycle: 'unknown' });
    expect(result.error).toBeDefined();
    expect(result.error).toContain('unknown');
  });

  // Invalid importance
  it('returns error for importance out of range', () => {
    const result = searchClaims(data, claimIndex, { query: '', importance: 7 });
    expect(result.error).toBeDefined();
    expect(result.error).toContain('7');
  });

  // @validates {R007.§2.AC.05}
  it('multiple filters compose conjunctively (AND)', () => {
    const result = searchClaims(data, claimIndex, {
      query: 'AC',
      types: ['Requirement'],
      importance: 4,
    });
    // Only R005.1.AC.01 matches: has "AC" in ID, is Requirement, importance=4
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].fullyQualified).toBe('R005.1.AC.01');
  });

  // @validates {R007.§2.AC.06}
  it('default limit is 50', () => {
    // Create a large dataset
    const manyEntries: ClaimIndexEntry[] = [];
    for (let i = 0; i < 60; i++) {
      manyEntries.push(makeEntry({
        noteId: 'BIG',
        claimId: `1.AC.${String(i + 1).padStart(2, '0')}`,
        fullyQualified: `BIG.1.AC.${String(i + 1).padStart(2, '0')}`,
        heading: `§1.AC.${String(i + 1).padStart(2, '0')} Claim number ${i + 1}`,
      }));
    }
    const bigData = makeIndexData(manyEntries);
    const result = searchClaims(bigData, claimIndex, { query: '', note: 'BIG' });
    expect(result.matches).toHaveLength(50);
    expect(result.total).toBe(60);
    expect(result.truncated).toBe(true);
  });

  // @validates {R007.§2.AC.06}
  it('custom limit overrides default', () => {
    const result = searchClaims(data, claimIndex, { query: '', types: ['Requirement'], limit: 1 });
    expect(result.matches).toHaveLength(1);
    expect(result.total).toBe(2);
    expect(result.truncated).toBe(true);
  });

  // @validates {R007.§2.AC.06}
  it('truncated is false when results fit within limit', () => {
    const result = searchClaims(data, claimIndex, { query: 'catalog' });
    expect(result.truncated).toBe(false);
    expect(result.total).toBe(1);
  });

  // --- Derivation queries ---

  // @validates {R007.§3.AC.01}
  it('--derives-from finds claims deriving from a specific source', () => {
    const result = searchClaims(data, claimIndex, { query: '', derivesFrom: 'R005.1.AC.01' });
    expect(result.matches).toHaveLength(2);
    const fqids = result.matches.map(m => m.fullyQualified).sort();
    expect(fqids).toEqual(['DD003.1.DC.01', 'DD003.1.DC.02']);
  });

  // @validates {R007.§3.AC.02}
  it('--derivatives-of finds claims via reverse derivation index', () => {
    const result = searchClaims(data, claimIndex, { query: '', derivativesOf: 'R005.1.AC.01' });
    expect(result.matches).toHaveLength(2);
    const fqids = result.matches.map(m => m.fullyQualified).sort();
    expect(fqids).toEqual(['DD003.1.DC.01', 'DD003.1.DC.02']);
  });

  // @validates {R007.§3.AC.03}
  it('--has-derivation filters to claims with derivedFrom', () => {
    const result = searchClaims(data, claimIndex, { query: '', hasDerivation: true });
    expect(result.matches).toHaveLength(2);
    expect(result.matches.every(m => m.derivedFrom.length > 0)).toBe(true);
  });

  // @validates {R007.§3.AC.04}
  it('derivation filters compose with text query and other filters', () => {
    const result = searchClaims(data, claimIndex, {
      query: 'resolution',
      derivesFrom: 'R005.1.AC.01',
    });
    // Only DD003.1.DC.01 has "resolution" in heading AND derives from R005.1.AC.01
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].fullyQualified).toBe('DD003.1.DC.01');
  });

  // @validates {R007.§3.AC.04}
  it('--derivatives-of composes with --types filter', () => {
    const result = searchClaims(data, claimIndex, {
      query: '',
      derivativesOf: 'R005.1.AC.01',
      types: ['DetailedDesign'],
    });
    expect(result.matches).toHaveLength(2);
  });

  // @validates {R007.§3.AC.04}
  it('--derivatives-of composes with importance filter', () => {
    const result = searchClaims(data, claimIndex, {
      query: '',
      derivativesOf: 'R005.1.AC.01',
      importance: 5,
    });
    // Only DD003.1.DC.01 has importance=5
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].fullyQualified).toBe('DD003.1.DC.01');
  });

  // @validates {R007.§3.AC.05}
  it('--derives-from with unresolvable claim produces error', () => {
    const result = searchClaims(data, claimIndex, { query: '', derivesFrom: 'NONEXIST.1.AC.01' });
    expect(result.error).toBeDefined();
    expect(result.error).toContain('NONEXIST.1.AC.01');
  });

  // @validates {R007.§3.AC.05}
  it('--derivatives-of with unresolvable claim produces error', () => {
    const result = searchClaims(data, claimIndex, { query: '', derivativesOf: 'NONEXIST.1.AC.01' });
    expect(result.error).toBeDefined();
    expect(result.error).toContain('NONEXIST.1.AC.01');
  });

  // @validates {R007.§3.AC.05}
  it('strips § from derivation target for index lookup', () => {
    // The fixture entry is "R005.1.AC.01" (without §)
    // User passes "R005.§1.AC.01" (with §)
    const result = searchClaims(data, claimIndex, { query: '', derivesFrom: 'R005.§1.AC.01' });
    expect(result.error).toBeUndefined();
    expect(result.matches).toHaveLength(2);
  });

  // --- Edge cases ---

  it('returns empty results for query that matches nothing', () => {
    const result = searchClaims(data, claimIndex, { query: 'xyznonexistent' });
    expect(result.matches).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it('works with empty index', () => {
    const emptyData = makeIndexData([]);
    const result = searchClaims(emptyData, claimIndex, { query: '', types: ['Requirement'] });
    expect(result.matches).toHaveLength(0);
    expect(result.error).toBeUndefined();
  });
});
