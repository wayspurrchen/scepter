/**
 * Tests for staleness detection.
 *
 * @validates {R005.§4.AC.01} Staleness computation
 * @validates {R005.§4.AC.02} Separate stale/unverified/current statuses
 * @validates {R005.§4.AC.04} File mtime comparison
 * @validates {R005.§4.AC.05} No-Source claims excluded
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { computeStaleness } from '../staleness';
import type { ClaimIndexData, ClaimIndexEntry, ClaimCrossReference } from '../claim-index';
import type { VerificationStore } from '../verification-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<ClaimIndexEntry> & { fullyQualified: string; noteId: string }): ClaimIndexEntry {
  return {
    claimId: overrides.fullyQualified.replace(`${overrides.noteId}.`, ''),
    sectionPath: [1],
    claimPrefix: 'AC',
    claimNumber: 1,
    heading: 'Test claim',
    line: 1,
    endLine: 1,
    metadata: [],
    parsedTags: [],
    noteType: 'Requirement',
    noteFilePath: 'test.md',
    ...overrides,
  };
}

function makeIndex(
  entries: ClaimIndexEntry[],
  crossRefs: ClaimCrossReference[] = [],
): ClaimIndexData {
  const entriesMap = new Map<string, ClaimIndexEntry>();
  const noteTypes = new Map<string, string>();

  for (const entry of entries) {
    entriesMap.set(entry.fullyQualified, entry);
    noteTypes.set(entry.noteId, entry.noteType);
  }

  // Add source note types for cross-refs
  for (const ref of crossRefs) {
    if (ref.fromNoteId.startsWith('source:')) {
      noteTypes.set(ref.fromNoteId, 'Source');
    }
  }

  return {
    entries: entriesMap,
    trees: new Map(),
    noteTypes,
    crossRefs,
    errors: [],
  };
}

describe('computeStaleness', () => {
  let tmpDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scepter-stale-test-'));
    testFilePath = path.join(tmpDir, 'auth.ts');
    await fs.writeFile(testFilePath, 'export class Auth {}', 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // @validates {R005.§4.AC.05}
  it('should exclude claims without Source cross-references', async () => {
    const entry = makeEntry({
      fullyQualified: 'R004.1.AC.01',
      noteId: 'R004',
    });

    const index = makeIndex([entry]);
    const store: VerificationStore = {};

    const results = await computeStaleness(index, store);
    expect(results).toHaveLength(0);
  });

  // @validates {R005.§4.AC.02}
  it('should report unverified when no verification events exist', async () => {
    const entry = makeEntry({
      fullyQualified: 'R004.1.AC.01',
      noteId: 'R004',
    });

    const crossRef: ClaimCrossReference = {
      fromClaim: `source:auth.ts:L10`,
      toClaim: 'R004.1.AC.01',
      fromNoteId: 'source:auth.ts',
      toNoteId: 'R004',
      line: 10,
      filePath: testFilePath,
    };

    const index = makeIndex([entry], [crossRef]);
    const store: VerificationStore = {};

    const results = await computeStaleness(index, store);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('unverified');
    expect(results[0].claimId).toBe('R004.1.AC.01');
    expect(results[0].lastVerified).toBeUndefined();
    expect(results[0].implementingFiles).toContain(testFilePath);
  });

  // @validates {R005.§4.AC.01} @validates {R005.§4.AC.04}
  it('should report stale when file modified after verification', async () => {
    const entry = makeEntry({
      fullyQualified: 'R004.1.AC.01',
      noteId: 'R004',
    });

    const crossRef: ClaimCrossReference = {
      fromClaim: `source:auth.ts:L10`,
      toClaim: 'R004.1.AC.01',
      fromNoteId: 'source:auth.ts',
      toNoteId: 'R004',
      line: 10,
      filePath: testFilePath,
    };

    const index = makeIndex([entry], [crossRef]);

    // Verification was in the past
    const store: VerificationStore = {
      'R004.1.AC.01': [{
        claimId: 'R004.1.AC.01',
        date: '2020-01-01',
        actor: 'dev',
      }],
    };

    // File is more recent than 2020
    const results = await computeStaleness(index, store);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('stale');
    expect(results[0].lastVerified).toBe('2020-01-01');
    expect(results[0].lastModified).toBeDefined();
  });

  it('should report current when verified after file modification', async () => {
    const entry = makeEntry({
      fullyQualified: 'R004.1.AC.01',
      noteId: 'R004',
    });

    const crossRef: ClaimCrossReference = {
      fromClaim: `source:auth.ts:L10`,
      toClaim: 'R004.1.AC.01',
      fromNoteId: 'source:auth.ts',
      toNoteId: 'R004',
      line: 10,
      filePath: testFilePath,
    };

    const index = makeIndex([entry], [crossRef]);

    // Verification far in the future
    const store: VerificationStore = {
      'R004.1.AC.01': [{
        claimId: 'R004.1.AC.01',
        date: '2099-01-01',
        actor: 'dev',
      }],
    };

    const results = await computeStaleness(index, store);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('current');
  });

  it('should sort results: stale first, then unverified, then current', async () => {
    // Create three claims with different statuses
    const file1 = path.join(tmpDir, 'file1.ts');
    const file2 = path.join(tmpDir, 'file2.ts');
    const file3 = path.join(tmpDir, 'file3.ts');
    await fs.writeFile(file1, 'x', 'utf-8');
    await fs.writeFile(file2, 'x', 'utf-8');
    await fs.writeFile(file3, 'x', 'utf-8');

    const entries = [
      makeEntry({ fullyQualified: 'R004.1.AC.01', noteId: 'R004', claimNumber: 1 }),
      makeEntry({ fullyQualified: 'R004.1.AC.02', noteId: 'R004', claimNumber: 2 }),
      makeEntry({ fullyQualified: 'R004.1.AC.03', noteId: 'R004', claimNumber: 3 }),
    ];

    const crossRefs: ClaimCrossReference[] = [
      { fromClaim: 'source:file1.ts:L1', toClaim: 'R004.1.AC.01', fromNoteId: 'source:file1.ts', toNoteId: 'R004', line: 1, filePath: file1 },
      { fromClaim: 'source:file2.ts:L1', toClaim: 'R004.1.AC.02', fromNoteId: 'source:file2.ts', toNoteId: 'R004', line: 1, filePath: file2 },
      { fromClaim: 'source:file3.ts:L1', toClaim: 'R004.1.AC.03', fromNoteId: 'source:file3.ts', toNoteId: 'R004', line: 1, filePath: file3 },
    ];

    const index = makeIndex(entries, crossRefs);

    const store: VerificationStore = {
      // AC.01: stale (verified in past, file more recent)
      'R004.1.AC.01': [{
        claimId: 'R004.1.AC.01',
        date: '2020-01-01',
        actor: 'dev',
      }],
      // AC.02: no verification (unverified)
      // AC.03: current (verified in future)
      'R004.1.AC.03': [{
        claimId: 'R004.1.AC.03',
        date: '2099-01-01',
        actor: 'dev',
      }],
    };

    const results = await computeStaleness(index, store);
    expect(results).toHaveLength(3);
    expect(results[0].status).toBe('stale');
    expect(results[0].claimId).toBe('R004.1.AC.01');
    expect(results[1].status).toBe('unverified');
    expect(results[1].claimId).toBe('R004.1.AC.02');
    expect(results[2].status).toBe('current');
    expect(results[2].claimId).toBe('R004.1.AC.03');
  });

  // @validates {R005.§4.AC.03}
  it('should filter by noteId', async () => {
    const entry1 = makeEntry({ fullyQualified: 'R004.1.AC.01', noteId: 'R004' });
    const entry2 = makeEntry({ fullyQualified: 'R005.1.AC.01', noteId: 'R005' });

    const crossRefs: ClaimCrossReference[] = [
      { fromClaim: 'source:a.ts:L1', toClaim: 'R004.1.AC.01', fromNoteId: 'source:a.ts', toNoteId: 'R004', line: 1, filePath: testFilePath },
      { fromClaim: 'source:b.ts:L1', toClaim: 'R005.1.AC.01', fromNoteId: 'source:b.ts', toNoteId: 'R005', line: 1, filePath: testFilePath },
    ];

    const index = makeIndex([entry1, entry2], crossRefs);
    const store: VerificationStore = {};

    const results = await computeStaleness(index, store, { noteId: 'R004' });
    expect(results).toHaveLength(1);
    expect(results[0].claimId).toBe('R004.1.AC.01');
  });

  it('should filter by minImportance', async () => {
    const entry1 = makeEntry({ fullyQualified: 'R004.1.AC.01', noteId: 'R004', importance: 4 });
    const entry2 = makeEntry({ fullyQualified: 'R004.1.AC.02', noteId: 'R004', importance: 2 });
    const entry3 = makeEntry({ fullyQualified: 'R004.1.AC.03', noteId: 'R004' }); // no importance

    const crossRefs: ClaimCrossReference[] = [
      { fromClaim: 'source:a.ts:L1', toClaim: 'R004.1.AC.01', fromNoteId: 'source:a.ts', toNoteId: 'R004', line: 1, filePath: testFilePath },
      { fromClaim: 'source:b.ts:L1', toClaim: 'R004.1.AC.02', fromNoteId: 'source:b.ts', toNoteId: 'R004', line: 1, filePath: testFilePath },
      { fromClaim: 'source:c.ts:L1', toClaim: 'R004.1.AC.03', fromNoteId: 'source:c.ts', toNoteId: 'R004', line: 1, filePath: testFilePath },
    ];

    const index = makeIndex([entry1, entry2, entry3], crossRefs);
    const store: VerificationStore = {};

    const results = await computeStaleness(index, store, { minImportance: 3 });
    expect(results).toHaveLength(1);
    expect(results[0].claimId).toBe('R004.1.AC.01');
  });

  it('should skip files that no longer exist', async () => {
    const entry = makeEntry({
      fullyQualified: 'R004.1.AC.01',
      noteId: 'R004',
    });

    const missingFilePath = path.join(tmpDir, 'nonexistent.ts');

    const crossRefs: ClaimCrossReference[] = [
      { fromClaim: 'source:nonexistent.ts:L1', toClaim: 'R004.1.AC.01', fromNoteId: 'source:nonexistent.ts', toNoteId: 'R004', line: 1, filePath: missingFilePath },
    ];

    const index = makeIndex([entry], crossRefs);
    const store: VerificationStore = {};

    // Should not crash; should produce no results since no valid files remain
    const results = await computeStaleness(index, store);
    expect(results).toHaveLength(0);
  });

  it('should include importance in results', async () => {
    const entry = makeEntry({
      fullyQualified: 'R004.1.AC.01',
      noteId: 'R004',
      importance: 5,
    });

    const crossRef: ClaimCrossReference = {
      fromClaim: 'source:auth.ts:L10',
      toClaim: 'R004.1.AC.01',
      fromNoteId: 'source:auth.ts',
      toNoteId: 'R004',
      line: 10,
      filePath: testFilePath,
    };

    const index = makeIndex([entry], [crossRef]);
    const store: VerificationStore = {};

    const results = await computeStaleness(index, store);
    expect(results[0].importance).toBe(5);
  });
});
