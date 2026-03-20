/**
 * Tests for multi-claim and range trace functionality in trace-command.ts.
 *
 * These tests verify the claim reference resolution and merged matrix
 * building that supports DC.19 (claim references in trace input) and
 * DC.20 (cross-note merged projection columns).
 *
 * @validates {DD005.§DC.19} Trace accepts single, range, and comma-separated claim references
 * @validates {DD005.§DC.20} Cross-note claim traces merge projection columns
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ClaimIndex } from '../../../../claims/claim-index';
import type { NoteWithContent, ClaimIndexData } from '../../../../claims/claim-index';
import { resolveClaimRef, buildMergedClaimMatrix } from '../trace-command';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const requirementNote: NoteWithContent = {
  id: 'ARCH017',
  type: 'Requirement',
  filePath: '_scepter/notes/requirements/ARCH017.md',
  content: [
    '# ARCH017 Schema Registration',
    '',
    '### §4 Auto-wiring',
    '',
    '§4.AC.17 The system MUST auto-wire migrations.',
    '',
    '§4.AC.18 The system MUST validate wiring order.',
    '',
    '§4.AC.19 The system MUST support manual overrides.',
    '',
    '§4.AC.20 The system MUST log wiring decisions.',
    '',
    '### §6 Config',
    '',
    '§6.AC.31 The config MUST support env-based overrides.',
  ].join('\n'),
};

const designNote: NoteWithContent = {
  id: 'DD001',
  type: 'DetailedDesign',
  filePath: '_scepter/notes/dd/DD001.md',
  content: [
    '# DD001 Migration Design',
    '',
    '### §1 Wiring',
    '',
    '§DC.19b:derives=ARCH017.§4.AC.19 Auto-wire discovery during bind().',
    '',
    '§DC.20b Override mechanism via config injection.',
  ].join('\n'),
};

const specNote: NoteWithContent = {
  id: 'S024',
  type: 'Specification',
  filePath: '_scepter/notes/specs/S024.md',
  content: [
    '# S024 Migration Spec',
    '',
    '### §1 API',
    '',
    '§1.API.01 Wiring API per {ARCH017.4.AC.18}.',
    '',
    '§1.API.02 Override API per {ARCH017.4.AC.19}.',
    '',
    '§1.API.03 Config override per {ARCH017.6.AC.31}.',
  ].join('\n'),
};

const implNote: NoteWithContent = {
  id: 'I010',
  type: 'Implementation',
  filePath: '_scepter/notes/impl/I010.md',
  content: [
    '# I010 Migration Impl',
    '',
    '### §1 Code',
    '',
    '§1.CODE.01 Auto-wire implementation for {ARCH017.4.AC.17}.',
  ].join('\n'),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveClaimRef', () => {
  let index: ClaimIndex;
  let data: ClaimIndexData;

  beforeEach(() => {
    index = new ClaimIndex();
    index.build([requirementNote, designNote, specNote, implNote]);
    data = index.getData();
  });

  // @validates {DD005.§DC.19} single claim resolution
  it('resolves a single fully-qualified claim', () => {
    const result = resolveClaimRef('ARCH017.§4.AC.18', data);
    expect(result.found).toHaveLength(1);
    expect(result.found[0].fqid).toBe('ARCH017.4.AC.18');
    expect(result.notFound).toHaveLength(0);
  });

  // @validates {DD005.§DC.19} single claim without § resolves
  it('resolves a single claim without § symbol', () => {
    const result = resolveClaimRef('ARCH017.4.AC.18', data);
    expect(result.found).toHaveLength(1);
    expect(result.found[0].fqid).toBe('ARCH017.4.AC.18');
  });

  // @validates {DD005.§DC.19} range expansion
  it('resolves a range reference into multiple claims', () => {
    const result = resolveClaimRef('ARCH017.§4.AC.17-20', data);
    // ARCH017 has AC.17, AC.18, AC.19, AC.20 in §4
    expect(result.found).toHaveLength(4);
    const fqids = result.found.map((f) => f.fqid);
    expect(fqids).toContain('ARCH017.4.AC.17');
    expect(fqids).toContain('ARCH017.4.AC.18');
    expect(fqids).toContain('ARCH017.4.AC.19');
    expect(fqids).toContain('ARCH017.4.AC.20');
    expect(result.notFound).toHaveLength(0);
  });

  // @validates {DD005.§DC.19} range with missing claims
  it('reports not-found claims in a range that partially matches', () => {
    // AC.17 through AC.22: AC.21 and AC.22 don't exist
    const result = resolveClaimRef('ARCH017.§4.AC.17-22', data);
    expect(result.found).toHaveLength(4); // 17, 18, 19, 20
    expect(result.notFound).toHaveLength(2); // 21, 22
  });

  it('returns notFound for a non-existent single claim', () => {
    const result = resolveClaimRef('ARCH017.§4.AC.99', data);
    expect(result.found).toHaveLength(0);
    expect(result.notFound).toHaveLength(1);
    expect(result.notFound[0]).toBe('ARCH017.§4.AC.99');
  });

  it('handles a claim from a different note', () => {
    const result = resolveClaimRef('ARCH017.§6.AC.31', data);
    expect(result.found).toHaveLength(1);
    expect(result.found[0].fqid).toBe('ARCH017.6.AC.31');
  });
});

describe('buildMergedClaimMatrix', () => {
  let index: ClaimIndex;
  let data: ClaimIndexData;

  beforeEach(() => {
    index = new ClaimIndex();
    index.build([requirementNote, designNote, specNote, implNote]);
    data = index.getData();
  });

  // @validates {DD005.§DC.20} merged matrix from single note
  it('builds a matrix for claims from a single note', () => {
    const entries = [
      data.entries.get('ARCH017.4.AC.18')!,
      data.entries.get('ARCH017.4.AC.19')!,
    ];

    const matrix = buildMergedClaimMatrix(entries, data);

    expect(matrix.sourceNoteId).toBe('ARCH017');
    expect(matrix.rows).toHaveLength(2);
    expect(matrix.rows[0].claimId).toBe('ARCH017.4.AC.18');
    expect(matrix.rows[1].claimId).toBe('ARCH017.4.AC.19');
  });

  // @validates {DD005.§DC.20} merged projection columns across notes
  it('builds a matrix with merged projections from claims across different notes', () => {
    // ARCH017.4.AC.18 is referenced by S024 (Specification)
    // DD001.1.DC.19b is referenced by nobody explicitly (but it derives from ARCH017)
    const arch18 = data.entries.get('ARCH017.4.AC.18')!;
    const arch31 = data.entries.get('ARCH017.6.AC.31')!;

    const matrix = buildMergedClaimMatrix([arch18, arch31], data);

    expect(matrix.sourceNoteId).toBe('ARCH017');
    expect(matrix.rows).toHaveLength(2);
    // Both should appear in the matrix
    const claimIds = matrix.rows.map((r) => r.claimId);
    expect(claimIds).toContain('ARCH017.4.AC.18');
    expect(claimIds).toContain('ARCH017.6.AC.31');

    // Projection types should include Specification (from S024 references)
    expect(matrix.projectionTypes).toContain('Specification');
  });

  // @validates {DD005.§DC.20} cross-note source label
  it('labels the matrix with multiple note IDs when claims span notes', () => {
    const arch18 = data.entries.get('ARCH017.4.AC.18')!;
    const dd19b = data.entries.get('DD001.1.DC.19b')!;

    const matrix = buildMergedClaimMatrix([arch18, dd19b], data);

    // Source note label should show both notes
    expect(matrix.sourceNoteId).toContain('ARCH017');
    expect(matrix.sourceNoteId).toContain('DD001');
    expect(matrix.sourceNoteType).toBe('(multiple)');
  });

  // @validates {DD005.§DC.20} unified projection set
  it('unifies projection columns from claims referenced by different note types', () => {
    // AC.17 is referenced by I010 (Implementation)
    // AC.18 is referenced by S024 (Specification)
    const ac17 = data.entries.get('ARCH017.4.AC.17')!;
    const ac18 = data.entries.get('ARCH017.4.AC.18')!;

    const matrix = buildMergedClaimMatrix([ac17, ac18], data);

    // The projection types should include both Implementation and Specification
    expect(matrix.projectionTypes).toContain('Implementation');
    expect(matrix.projectionTypes).toContain('Specification');
  });

  it('returns an empty matrix for an empty entries array', () => {
    const matrix = buildMergedClaimMatrix([], data);
    expect(matrix.rows).toHaveLength(0);
    expect(matrix.projectionTypes).toHaveLength(0);
  });

  it('preserves importance and lifecycle on merged rows', () => {
    const entry = data.entries.get('ARCH017.4.AC.18')!;
    const matrix = buildMergedClaimMatrix([entry], data);

    expect(matrix.rows).toHaveLength(1);
    // These won't have importance since the fixture doesn't set it,
    // but the field should pass through
    expect(matrix.rows[0].importance).toBeUndefined();
  });

  it('preserves derivedFrom on merged rows', () => {
    const dc19b = data.entries.get('DD001.1.DC.19b')!;
    const matrix = buildMergedClaimMatrix([dc19b], data);

    expect(matrix.rows).toHaveLength(1);
    expect(matrix.rows[0].derivedFrom).toContain('ARCH017.4.AC.19');
  });
});

describe('multi-claim trace detection helpers', () => {
  // These test the detection functions indirectly via the exported helpers.
  // The actual isMultiClaimInput and isRangeInput are not exported, but we
  // test the overall behavior through resolveClaimRef which handles both.

  let index: ClaimIndex;
  let data: ClaimIndexData;

  beforeEach(() => {
    index = new ClaimIndex();
    index.build([requirementNote, specNote]);
    data = index.getData();
  });

  // @validates {DD005.§DC.19} range expansion produces correct count
  it('resolves range AC.17-20 to exactly 4 claims', () => {
    const result = resolveClaimRef('ARCH017.§4.AC.17-20', data);
    expect(result.found).toHaveLength(4);
    // Verify ordering
    expect(result.found[0].fqid).toBe('ARCH017.4.AC.17');
    expect(result.found[1].fqid).toBe('ARCH017.4.AC.18');
    expect(result.found[2].fqid).toBe('ARCH017.4.AC.19');
    expect(result.found[3].fqid).toBe('ARCH017.4.AC.20');
  });

  // @validates {DD005.§DC.19} range with start == end is invalid (empty)
  it('returns nothing for invalid range where start >= end', () => {
    const result = resolveClaimRef('ARCH017.§4.AC.20-17', data);
    // parseRangeSuffix returns null because the regex requires start < end
    // in the digit portion. The string then falls through to parseClaimAddress
    // which also returns null (the "-17" makes it unparseable as a single claim).
    // Both arrays are empty because the input is not a valid reference at all.
    expect(result.found).toHaveLength(0);
    expect(result.notFound).toHaveLength(0);
  });
});
