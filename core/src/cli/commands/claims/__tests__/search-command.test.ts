/**
 * Tests for `scepter claims search` CLI command wiring.
 *
 * These tests verify that the Commander command is correctly configured
 * with all options, argument parsing, and help text. They also verify
 * structural wiring for index building, in-memory operation, and error handling.
 *
 * @validates {R007.§5.AC.01} Command registered with positional query and all options
 * @validates {R007.§5.AC.02} Command builds claim index via ensureIndex() before search
 * @validates {R007.§5.AC.03} No file I/O after index build — searchClaims is pure in-memory
 * @validates {R007.§5.AC.04} Error messages for invalid options are specific and actionable
 * @validates {R007.§5.AC.05} Help text with descriptions for all options
 */
import { describe, it, expect } from 'vitest';
import { searchCommand } from '../search-command';
import { searchClaims } from '../../../../claims/claim-search';
import type { ClaimIndexData, ClaimIndexEntry } from '../../../../claims/claim-index';
import type { ClaimIndex } from '../../../../claims/claim-index';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Command structure tests
// @validates {R007.§5.AC.01}
// @validates {R007.§5.AC.05}
// ---------------------------------------------------------------------------

describe('searchCommand structure', () => {
  // @validates {R007.§5.AC.01}
  it('is named "search"', () => {
    expect(searchCommand.name()).toBe('search');
  });

  // @validates {R007.§5.AC.05}
  it('has a description', () => {
    expect(searchCommand.description()).toBeTruthy();
    expect(searchCommand.description()).toContain('Search');
  });

  // @validates {R007.§5.AC.01}
  it('has a [query] argument', () => {
    const args = searchCommand.registeredArguments;
    expect(args.length).toBe(1);
    expect(args[0].name()).toBe('query');
  });

  // @validates {R007.§5.AC.01}
  it('has --id-only flag', () => {
    const opt = searchCommand.options.find(o => o.long === '--id-only');
    expect(opt).toBeDefined();
  });

  // @validates {R007.§5.AC.01}
  it('has --regex flag', () => {
    const opt = searchCommand.options.find(o => o.long === '--regex');
    expect(opt).toBeDefined();
  });

  // @validates {R007.§5.AC.01}
  it('has --types option', () => {
    const opt = searchCommand.options.find(o => o.long === '--types');
    expect(opt).toBeDefined();
  });

  // @validates {R007.§5.AC.01}
  it('has --note option', () => {
    const opt = searchCommand.options.find(o => o.long === '--note');
    expect(opt).toBeDefined();
  });

  // @validates {R007.§5.AC.01}
  it('has --importance option', () => {
    const opt = searchCommand.options.find(o => o.long === '--importance');
    expect(opt).toBeDefined();
  });

  // @validates {R007.§5.AC.01}
  it('has --lifecycle option', () => {
    const opt = searchCommand.options.find(o => o.long === '--lifecycle');
    expect(opt).toBeDefined();
  });

  // @validates {R007.§5.AC.01}
  it('has --derives-from option', () => {
    const opt = searchCommand.options.find(o => o.long === '--derives-from');
    expect(opt).toBeDefined();
  });

  // @validates {R007.§5.AC.01}
  it('has --derivatives-of option', () => {
    const opt = searchCommand.options.find(o => o.long === '--derivatives-of');
    expect(opt).toBeDefined();
  });

  // @validates {R007.§5.AC.01}
  it('has --has-derivation flag', () => {
    const opt = searchCommand.options.find(o => o.long === '--has-derivation');
    expect(opt).toBeDefined();
  });

  // @validates {R007.§5.AC.01}
  it('has --format option with list as default', () => {
    const opt = searchCommand.options.find(o => o.long === '--format');
    expect(opt).toBeDefined();
    expect(opt?.defaultValue).toBe('list');
  });

  // @validates {R007.§5.AC.01}
  it('has --limit option', () => {
    const opt = searchCommand.options.find(o => o.long === '--limit');
    expect(opt).toBeDefined();
  });

  // @validates {R007.§5.AC.05}
  it('all options have descriptions', () => {
    for (const opt of searchCommand.options) {
      expect(opt.description).toBeTruthy();
    }
  });

  // @validates {R007.§5.AC.01}
  it('has all 12 expected options', () => {
    const expectedOptions = [
      '--id-only', '--regex', '--types', '--note',
      '--importance', '--lifecycle', '--derives-from',
      '--derivatives-of', '--has-derivation', '--format', '--limit',
    ];
    const optionLongs = searchCommand.options.map(o => o.long);
    for (const expected of expectedOptions) {
      expect(optionLongs).toContain(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// Structural wiring verification
// @validates {R007.§5.AC.02} ensureIndex() is imported and used
// @validates {R007.§5.AC.03} searchClaims is pure in-memory (no file I/O)
// ---------------------------------------------------------------------------

describe('searchCommand wiring', () => {
  // @validates {R007.§5.AC.02}
  it('imports ensureIndex from ensure-index module', () => {
    // Verify the source file imports ensureIndex — structural verification
    // that the command builds the index before searching
    const sourcePath = path.resolve(__dirname, '../search-command.ts');
    const source = fs.readFileSync(sourcePath, 'utf-8');
    expect(source).toContain("import { ensureIndex } from './ensure-index.js'");
    // Verify ensureIndex is called in the action handler
    expect(source).toContain('ensureIndex(context.projectManager)');
  });

  // @validates {R007.§5.AC.03}
  it('uses searchClaims (pure in-memory) after index build — no additional file I/O', () => {
    // Verify the source imports searchClaims from the claims module
    const sourcePath = path.resolve(__dirname, '../search-command.ts');
    const source = fs.readFileSync(sourcePath, 'utf-8');
    expect(source).toContain("import { searchClaims } from '../../../claims/index.js'");
    // Verify searchClaims is called with the index data (in-memory operation)
    expect(source).toContain('searchClaims(data, claimIndex, searchOptions)');
    // searchClaims is a pure function — verify it has no fs/file imports
    const searchSource = fs.readFileSync(
      path.resolve(__dirname, '../../../../claims/claim-search.ts'),
      'utf-8',
    );
    expect(searchSource).not.toContain("import * as fs");
    expect(searchSource).not.toContain("from 'fs");
    expect(searchSource).not.toContain("readFile");
  });
});

// ---------------------------------------------------------------------------
// Error message validation via searchClaims integration
// @validates {R007.§5.AC.04} Specific and actionable error messages
// ---------------------------------------------------------------------------

describe('searchCommand error handling', () => {
  // Helper to build test fixtures for searchClaims validation
  function makeEntry(overrides: Partial<ClaimIndexEntry> = {}): ClaimIndexEntry {
    return {
      noteId: 'R005',
      claimId: '1.AC.01',
      fullyQualified: 'R005.1.AC.01',
      sectionPath: [1],
      claimPrefix: 'AC',
      claimNumber: 1,
      heading: '§1.AC.01 Test claim',
      line: 10,
      endLine: 15,
      metadata: [],
      importance: undefined,
      lifecycle: undefined,
      parsedTags: [],
      derivedFrom: [],
      noteType: 'Requirement',
      noteFilePath: '/path/to/R005.md',
      ...overrides,
    };
  }

  function makeData(entries: ClaimIndexEntry[]): ClaimIndexData {
    const map = new Map<string, ClaimIndexEntry>();
    for (const e of entries) map.set(e.fullyQualified, e);
    return { entries: map, trees: new Map(), noteTypes: new Map(), crossRefs: [], errors: [] };
  }

  const mockIndex = { getDerivatives: () => [] } as unknown as ClaimIndex;
  const data = makeData([makeEntry()]);

  // @validates {R007.§5.AC.04}
  it('produces specific error for invalid importance value', () => {
    const result = searchClaims(data, mockIndex, { query: '', importance: 7 });
    expect(result.error).toBeDefined();
    expect(result.error).toContain('7');
    expect(result.error).toContain('1-5');
  });

  // @validates {R007.§5.AC.04}
  it('produces specific error for invalid lifecycle state', () => {
    const result = searchClaims(data, mockIndex, { query: '', lifecycle: 'invalid' });
    expect(result.error).toBeDefined();
    expect(result.error).toContain('invalid');
    expect(result.error).toContain('closed');
    expect(result.error).toContain('deferred');
    expect(result.error).toContain('removed');
    expect(result.error).toContain('superseded');
  });

  // @validates {R007.§5.AC.04}
  it('produces specific error for unrecognized note ID', () => {
    const result = searchClaims(data, mockIndex, { query: '', note: 'NONEXIST' });
    expect(result.error).toBeDefined();
    expect(result.error).toContain('NONEXIST');
  });

  // @validates {R007.§5.AC.04}
  it('produces specific error for unresolvable --derives-from target', () => {
    const result = searchClaims(data, mockIndex, { query: '', derivesFrom: 'X.1.AC.99' });
    expect(result.error).toBeDefined();
    expect(result.error).toContain('X.1.AC.99');
    expect(result.error).toContain('--derives-from');
  });

  // @validates {R007.§5.AC.04}
  it('produces specific error for unresolvable --derivatives-of target', () => {
    const result = searchClaims(data, mockIndex, { query: '', derivativesOf: 'X.1.AC.99' });
    expect(result.error).toBeDefined();
    expect(result.error).toContain('X.1.AC.99');
    expect(result.error).toContain('--derivatives-of');
  });

  // @validates {R007.§5.AC.04}
  it('produces specific error for invalid regex pattern', () => {
    const result = searchClaims(data, mockIndex, { query: '[unclosed', regex: true });
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Invalid regex');
  });

  // @validates {R007.§5.AC.04}
  it('search-command source validates format option before calling searchClaims', () => {
    const sourcePath = path.resolve(__dirname, '../search-command.ts');
    const source = fs.readFileSync(sourcePath, 'utf-8');
    // Verify the command validates the format value
    expect(source).toContain("validFormats.includes(format)");
    expect(source).toContain('Invalid format');
  });
});
