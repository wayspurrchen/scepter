/**
 * Tests for claim search result formatters.
 *
 * @validates {R007.§4.AC.01} List format: FQID, note type, 60-char truncated heading
 * @validates {R007.§4.AC.02} Detailed format: full details per claim
 * @validates {R007.§4.AC.03} JSON format with specified fields
 * @validates {R007.§4.AC.04} Result count + truncation notice
 * @validates {R007.§4.AC.05} Importance >= 4 highlighting (red/bold)
 */
import { describe, it, expect } from 'vitest';
import chalk from 'chalk';
import {
  formatClaimSearchList,
  formatClaimSearchDetailed,
  formatClaimSearchJson,
  formatSearchResults,
} from '../claim-formatter';
import type { ClaimSearchResult } from '../../../claims/index';
import type { ClaimIndexEntry } from '../../../claims/index';

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

function makeResult(
  matches: ClaimIndexEntry[],
  overrides: Partial<ClaimSearchResult> = {},
): ClaimSearchResult {
  return {
    matches,
    total: matches.length,
    truncated: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatClaimSearchList
// @validates {R007.§4.AC.01}
// @validates {R007.§4.AC.04}
// @validates {R007.§4.AC.05}
// ---------------------------------------------------------------------------

describe('formatClaimSearchList', () => {
  // @validates {R007.§4.AC.01}
  it('shows one line per claim with FQID, type, and heading', () => {
    const result = makeResult([
      makeEntry({ fullyQualified: 'R005.1.AC.01', noteType: 'Requirement', heading: '§1.AC.01 Short heading' }),
    ]);
    const output = formatClaimSearchList(result);
    // Strip ANSI codes for content checking
    const stripped = output.replace(/\u001b\[[0-9;]*m/g, '');
    expect(stripped).toContain('R005.1.AC.01');
    expect(stripped).toContain('(Requirement)');
    expect(stripped).toContain('Short heading');
  });

  // @validates {R007.§4.AC.01}
  it('truncates heading to 60 characters with ellipsis', () => {
    const longHeading = '§1.AC.01 ' + 'A'.repeat(80);
    const result = makeResult([
      makeEntry({ heading: longHeading }),
    ]);
    const output = formatClaimSearchList(result);
    const stripped = output.replace(/\u001b\[[0-9;]*m/g, '');
    // The extracted title (after §1.AC.01) should be truncated to 60 chars
    expect(stripped).toContain('...');
  });

  // @validates {R007.§4.AC.04}
  it('shows result count', () => {
    const result = makeResult([makeEntry()]);
    const output = formatClaimSearchList(result);
    const stripped = output.replace(/\u001b\[[0-9;]*m/g, '');
    expect(stripped).toContain('1 claims found.');
  });

  // @validates {R007.§4.AC.04}
  it('shows truncation notice when truncated', () => {
    const result = makeResult([makeEntry()], { total: 55, truncated: true });
    const output = formatClaimSearchList(result);
    const stripped = output.replace(/\u001b\[[0-9;]*m/g, '');
    expect(stripped).toContain('55 claims found (showing first 1).');
  });

  // @validates {R007.§4.AC.04}
  it('shows "no claims" message for empty results', () => {
    const result = makeResult([]);
    const output = formatClaimSearchList(result);
    const stripped = output.replace(/\u001b\[[0-9;]*m/g, '');
    expect(stripped).toContain('No claims match');
  });

  // @validates {R007.§4.AC.05}
  it('highlights importance >= 4 claims with red/bold', () => {
    // Enable chalk for this test
    const level = chalk.level;
    chalk.level = 1;
    try {
      const result = makeResult([
        makeEntry({ importance: 4, fullyQualified: 'R005.1.AC.01' }),
        makeEntry({ importance: 2, fullyQualified: 'R005.1.AC.02', claimId: '1.AC.02' }),
      ]);
      const output = formatClaimSearchList(result);
      // High importance claim should use chalk.red.bold
      expect(output).toContain(chalk.red.bold('R005.1.AC.01'));
      // Low importance claim should use chalk.cyan
      expect(output).toContain(chalk.cyan('R005.1.AC.02'));
    } finally {
      chalk.level = level;
    }
  });
});

// ---------------------------------------------------------------------------
// formatClaimSearchDetailed
// @validates {R007.§4.AC.02}
// @validates {R007.§4.AC.04}
// @validates {R007.§4.AC.05}
// ---------------------------------------------------------------------------

describe('formatClaimSearchDetailed', () => {
  // @validates {R007.§4.AC.02}
  it('shows full details per claim: FQID, type, heading, importance, lifecycle, derivation, file', () => {
    const entry = makeEntry({
      importance: 5,
      lifecycle: { type: 'superseded', target: 'R006.1.AC.01' },
      derivedFrom: ['R004.1.AC.03'],
      noteFilePath: '/project/notes/R005.md',
    });
    const result = makeResult([entry]);
    const output = formatClaimSearchDetailed(result);
    const stripped = output.replace(/\u001b\[[0-9;]*m/g, '');

    expect(stripped).toContain('R005.1.AC.01');
    expect(stripped).toContain('Type:');
    expect(stripped).toContain('Requirement');
    expect(stripped).toContain('Heading:');
    expect(stripped).toContain('Parser extracts importance digits');
    expect(stripped).toContain('Importance:');
    expect(stripped).toContain('5');
    expect(stripped).toContain('Lifecycle:');
    expect(stripped).toContain('superseded');
    expect(stripped).toContain('R006.1.AC.01');
    expect(stripped).toContain('Derived from:');
    expect(stripped).toContain('R004.1.AC.03');
    expect(stripped).toContain('File:');
    expect(stripped).toContain('/project/notes/R005.md');
  });

  // @validates {R007.§4.AC.02}
  it('omits optional fields when absent', () => {
    const entry = makeEntry({
      importance: undefined,
      lifecycle: undefined,
      derivedFrom: [],
    });
    const result = makeResult([entry]);
    const output = formatClaimSearchDetailed(result);
    const stripped = output.replace(/\u001b\[[0-9;]*m/g, '');

    expect(stripped).not.toContain('Importance:');
    expect(stripped).not.toContain('Lifecycle:');
    expect(stripped).not.toContain('Derived from:');
  });

  // @validates {R007.§4.AC.04}
  it('includes result count', () => {
    const result = makeResult([makeEntry(), makeEntry({ fullyQualified: 'R005.1.AC.02', claimId: '1.AC.02' })]);
    const output = formatClaimSearchDetailed(result);
    const stripped = output.replace(/\u001b\[[0-9;]*m/g, '');
    expect(stripped).toContain('2 claims found.');
  });

  // @validates {R007.§4.AC.05}
  it('highlights importance >= 4 in detailed format', () => {
    const level = chalk.level;
    chalk.level = 1;
    try {
      const entry = makeEntry({ importance: 4 });
      const result = makeResult([entry]);
      const output = formatClaimSearchDetailed(result);
      expect(output).toContain(chalk.red.bold('R005.1.AC.01'));
      expect(output).toContain(chalk.red.bold('4'));
    } finally {
      chalk.level = level;
    }
  });
});

// ---------------------------------------------------------------------------
// formatClaimSearchJson
// @validates {R007.§4.AC.03}
// @validates {R007.§4.AC.04}
// ---------------------------------------------------------------------------

describe('formatClaimSearchJson', () => {
  // @validates {R007.§4.AC.03}
  it('outputs JSON array with all specified fields', () => {
    const entry = makeEntry({
      importance: 3,
      lifecycle: { type: 'deferred' },
      derivedFrom: ['R004.1.AC.01'],
    });
    const result = makeResult([entry]);
    const output = formatClaimSearchJson(result);
    const parsed = JSON.parse(output);

    expect(parsed.matches).toHaveLength(1);
    const match = parsed.matches[0];
    expect(match.fullyQualified).toBe('R005.1.AC.01');
    expect(match.noteId).toBe('R005');
    expect(match.noteType).toBe('Requirement');
    expect(match.claimId).toBe('1.AC.01');
    expect(match.heading).toContain('Parser extracts importance digits');
    expect(match.sectionPath).toEqual([1]);
    expect(match.importance).toBe(3);
    expect(match.lifecycle).toBe('deferred');
    expect(match.derivedFrom).toEqual(['R004.1.AC.01']);
    expect(match.noteFilePath).toBe('/path/to/R005.md');
  });

  // @validates {R007.§4.AC.03}
  it('outputs null for absent importance and lifecycle', () => {
    const entry = makeEntry({ importance: undefined, lifecycle: undefined });
    const result = makeResult([entry]);
    const output = formatClaimSearchJson(result);
    const parsed = JSON.parse(output);

    expect(parsed.matches[0].importance).toBeNull();
    expect(parsed.matches[0].lifecycle).toBeNull();
  });

  // @validates {R007.§4.AC.04}
  it('includes total and truncated in JSON metadata', () => {
    const result = makeResult([makeEntry()], { total: 100, truncated: true });
    const output = formatClaimSearchJson(result);
    const parsed = JSON.parse(output);

    expect(parsed.total).toBe(100);
    expect(parsed.truncated).toBe(true);
  });

  // @validates {R007.§4.AC.03}
  it('is valid JSON', () => {
    const result = makeResult([makeEntry()]);
    const output = formatClaimSearchJson(result);
    expect(() => JSON.parse(output)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// formatSearchResults dispatch
// ---------------------------------------------------------------------------

describe('formatSearchResults', () => {
  it('dispatches to list format by default', () => {
    const result = makeResult([makeEntry()]);
    const output = formatSearchResults(result);
    const stripped = output.replace(/\u001b\[[0-9;]*m/g, '');
    // List format shows FQID on a line
    expect(stripped).toContain('R005.1.AC.01');
    expect(stripped).toContain('(Requirement)');
  });

  it('dispatches to detailed format', () => {
    const result = makeResult([makeEntry()]);
    const output = formatSearchResults(result, 'detailed');
    const stripped = output.replace(/\u001b\[[0-9;]*m/g, '');
    expect(stripped).toContain('Type:');
    expect(stripped).toContain('File:');
  });

  it('dispatches to json format', () => {
    const result = makeResult([makeEntry()]);
    const output = formatSearchResults(result, 'json');
    expect(() => JSON.parse(output)).not.toThrow();
  });
});
