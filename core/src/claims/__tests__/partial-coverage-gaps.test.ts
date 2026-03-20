import { describe, it, expect, beforeEach } from 'vitest';
import { ClaimIndex } from '../claim-index';
import type { NoteWithContent } from '../claim-index';
import { findPartialCoverageGaps } from '../traceability';
import type { SourceReference } from '../../types/reference';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Requirement note with 3 claims. */
const reqNote: NoteWithContent = {
  id: 'R004',
  type: 'Requirement',
  filePath: '_scepter/notes/requirements/R004.md',
  content: [
    '# R004 Auth Requirements',
    '',
    '### §1 Security',
    '',
    '§1.AC.01 The system MUST require authentication.',
    '',
    '§1.AC.02 The system MUST support OAuth2.',
    '',
    '### §2 Authorization',
    '',
    '§2.AC.01 The system MUST enforce RBAC.',
  ].join('\n'),
};

/** Spec note referencing 2 of 3 requirement claims. */
const specNote: NoteWithContent = {
  id: 'S001',
  type: 'Specification',
  filePath: '_scepter/notes/specs/S001.md',
  content: [
    '# S001 Auth Spec',
    '',
    '### §1 API Auth',
    '',
    '§1.IMPL.01 Implements OAuth2 per {R004.1.AC.02}.',
    '',
    '§1.IMPL.02 RBAC middleware per {R004.2.AC.01}.',
  ].join('\n'),
};

/** Design note referencing all 3 requirement claims. */
const designNote: NoteWithContent = {
  id: 'D002',
  type: 'Design',
  filePath: '_scepter/notes/designs/D002.md',
  content: [
    '# D002 Auth Design',
    '',
    '### §1 Architecture',
    '',
    '§1.DES.01 Auth gateway for {R004.1.AC.01}.',
    '',
    '§1.DES.02 OAuth2 flow per {R004.1.AC.02}.',
    '',
    '§1.DES.03 RBAC for {R004.2.AC.01}.',
  ].join('\n'),
};

/** A second requirement note with a claim that has zero coverage. */
const reqNote2: NoteWithContent = {
  id: 'R005',
  type: 'Requirement',
  filePath: '_scepter/notes/requirements/R005.md',
  content: [
    '# R005 Performance Requirements',
    '',
    '### §1 Latency',
    '',
    '§1.AC.01 The system MUST respond within 200ms.',
  ].join('\n'),
};

/** A note with lifecycle metadata. */
const closedNote: NoteWithContent = {
  id: 'R006',
  type: 'Requirement',
  filePath: '_scepter/notes/requirements/R006.md',
  content: [
    '# R006 Deprecated Requirements',
    '',
    '### §1 Old',
    '',
    '§1.AC.01:closed The system MUST use SOAP.',
  ].join('\n'),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('findPartialCoverageGaps', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  // @validates {DD005.§DC.01} Partial coverage filtering
  it('should return only partially-covered claims', () => {
    // R004.1.AC.01 is referenced by D002 only → partial (has Design, missing Spec)
    // R004.1.AC.02 is referenced by S001 and D002 → full coverage across Spec+Design
    // R004.2.AC.01 is referenced by S001 and D002 → full coverage across Spec+Design
    index.build([reqNote, specNote, designNote]);
    const data = index.getData();

    const result = findPartialCoverageGaps(data);

    // Only R004.1.AC.01 should appear as a gap among R004 claims.
    // S001 and D002 claims are defined in their own notes — we need to check them too.
    // S001.1.IMPL.01 and S001.1.IMPL.02 have zero coverage (no one references them) → excluded
    // D002.1.DES.01, DES.02, DES.03 also zero coverage → excluded
    const r004Gaps = result.rows.filter(r => r.claimId.startsWith('R004.'));
    expect(r004Gaps).toHaveLength(1);
    expect(r004Gaps[0].claimId).toBe('R004.1.AC.01');
  });

  // @validates {DD005.§DC.02} Aggregate across all notes
  it('should aggregate across multiple claim-defining notes', () => {
    // Add a spec that references R005.1.AC.01 and also a design that doesn't
    const spec2: NoteWithContent = {
      id: 'S002',
      type: 'Specification',
      filePath: '_scepter/notes/specs/S002.md',
      content: [
        '# S002 Perf Spec',
        '',
        '§1.PERF.01 Latency per {R005.1.AC.01}.',
      ].join('\n'),
    };

    index.build([reqNote, specNote, designNote, reqNote2, spec2]);
    const data = index.getData();

    const result = findPartialCoverageGaps(data);

    // R004.1.AC.01: Design but not Spec → partial gap
    // R005.1.AC.01: Spec but not Design → partial gap
    const claimIds = result.rows.map(r => r.claimId).sort();
    expect(claimIds).toContain('R004.1.AC.01');
    expect(claimIds).toContain('R005.1.AC.01');
  });

  // @validates {DD005.§DC.03} Dynamic projection type discovery
  it('should discover projection types from actual cross-references', () => {
    index.build([reqNote, specNote, designNote]);
    const data = index.getData();

    const result = findPartialCoverageGaps(data);

    // Should discover Specification, Design, and Requirement as projection types
    // (Requirement because S001 and D002 reference R004 claims, and their note types
    // appear as fromType for those cross-refs)
    expect(result.projectionTypes).toContain('Specification');
    expect(result.projectionTypes).toContain('Design');
  });

  // @validates {DD005.§DC.15} Exclude zero-coverage by default
  it('should exclude claims with zero coverage by default', () => {
    // R005 has no references from any other note
    index.build([reqNote, specNote, designNote, reqNote2]);
    const data = index.getData();

    const result = findPartialCoverageGaps(data);

    // R005.1.AC.01 has zero coverage — should be excluded
    const claimIds = result.rows.map(r => r.claimId);
    expect(claimIds).not.toContain('R005.1.AC.01');
  });

  // @validates {DD005.§DC.10} --include-zero shows zero-coverage claims
  it('should include zero-coverage claims when includeZeroCoverage is true', () => {
    index.build([reqNote, specNote, designNote, reqNote2]);
    const data = index.getData();

    const result = findPartialCoverageGaps(data, { includeZeroCoverage: true });

    const claimIds = result.rows.map(r => r.claimId);
    expect(claimIds).toContain('R005.1.AC.01');
  });

  // @validates {DD005.§DC.16} Exclude full-coverage claims
  it('should exclude claims with full coverage', () => {
    index.build([reqNote, specNote, designNote]);
    const data = index.getData();

    const result = findPartialCoverageGaps(data);

    // R004.1.AC.02 has both Spec and Design → full coverage among non-self types
    // R004.2.AC.01 has both Spec and Design → full coverage
    const r004ClaimIds = result.rows.filter(r => r.claimId.startsWith('R004.')).map(r => r.claimId);
    expect(r004ClaimIds).not.toContain('R004.1.AC.02');
    expect(r004ClaimIds).not.toContain('R004.2.AC.01');
  });

  // @validates {DD005.§DC.07} --note scopes to a single note
  it('should scope to a single note when noteId is provided', () => {
    const spec2: NoteWithContent = {
      id: 'S002',
      type: 'Specification',
      filePath: '_scepter/notes/specs/S002.md',
      content: [
        '# S002 Perf Spec',
        '',
        '§1.PERF.01 Latency per {R005.1.AC.01}.',
      ].join('\n'),
    };

    index.build([reqNote, specNote, designNote, reqNote2, spec2]);
    const data = index.getData();

    const result = findPartialCoverageGaps(data, { noteId: 'R004' });

    // Should only contain claims from R004
    for (const row of result.rows) {
      expect(row.claimId).toMatch(/^R004\./);
    }
  });

  // @validates {DD005.§DC.09} --projection restricts columns
  it('should restrict to specified projection types', () => {
    index.build([reqNote, specNote, designNote]);
    const data = index.getData();

    // Only check against Specification — with projectionFilter, DC.17 bypass applies
    const result = findPartialCoverageGaps(data, {
      projectionFilter: ['Specification'],
      includeZeroCoverage: true,
    });

    expect(result.projectionTypes).toEqual(['Specification']);

    // R004.1.AC.01 has no Specification reference → gap (zero-coverage, included via flag)
    const claimIds = result.rows.map(r => r.claimId);
    expect(claimIds).toContain('R004.1.AC.01');
  });

  // @validates {DD005.§DC.11} Lifecycle filtering
  it('should exclude closed claims by default', () => {
    const specWithClosed: NoteWithContent = {
      id: 'S003',
      type: 'Specification',
      filePath: '_scepter/notes/specs/S003.md',
      content: [
        '# S003 Old Spec',
        '',
        '§1.IMPL.01 SOAP per {R006.1.AC.01}.',
      ].join('\n'),
    };

    index.build([closedNote, specWithClosed, reqNote, specNote, designNote]);
    const data = index.getData();

    const result = findPartialCoverageGaps(data);

    // R006.1.AC.01 is closed → should be excluded
    const claimIds = result.rows.map(r => r.claimId);
    expect(claimIds).not.toContain('R006.1.AC.01');
  });

  it('should include closed claims when excludeClosed is false', () => {
    const specWithClosed: NoteWithContent = {
      id: 'S003',
      type: 'Specification',
      filePath: '_scepter/notes/specs/S003.md',
      content: [
        '# S003 Old Spec',
        '',
        '§1.IMPL.01 SOAP per {R006.1.AC.01}.',
      ].join('\n'),
    };

    index.build([closedNote, specWithClosed, reqNote, specNote, designNote]);
    const data = index.getData();

    // With closed included: R006.1.AC.01 has Specification but not Design → partial
    const result = findPartialCoverageGaps(data, { excludeClosed: false });
    const claimIds = result.rows.map(r => r.claimId);
    expect(claimIds).toContain('R006.1.AC.01');
  });

  // @validates {DD005.§DC.17} Single-projection handling
  it('should not report single-projection claims as gaps without explicit filter', () => {
    // Only one non-self projection type exists (Specification)
    // R004 is Requirement type; S001 references R004 claims as Specification
    // There's only one non-self projection type, so no gap can exist
    index.build([reqNote, specNote]);
    const data = index.getData();

    const result = findPartialCoverageGaps(data);

    // With only one non-self projection type, can't determine partial coverage
    // R004.1.AC.01 has no Spec ref, but that's zero-coverage not partial
    // R004.1.AC.02 has Spec ref → full coverage (1 out of 1)
    // R004.2.AC.01 has Spec ref → full coverage (1 out of 1)
    const r004Gaps = result.rows.filter(r => r.claimId.startsWith('R004.'));
    expect(r004Gaps).toHaveLength(0);
  });

  it('should report claims as gaps when projectionFilter has multiple types', () => {
    // projectionFilter explicitly indicates we expect both Specification and Design
    index.build([reqNote, specNote, designNote]);
    const data = index.getData();

    const result = findPartialCoverageGaps(data, {
      projectionFilter: ['Specification', 'Design'],
    });

    // R004.1.AC.01 has Design but not Spec → partial gap
    const claimIds = result.rows.map(r => r.claimId);
    expect(claimIds).toContain('R004.1.AC.01');

    // R004.1.AC.02 has both → full coverage → excluded
    expect(claimIds).not.toContain('R004.1.AC.02');
  });

  it('should include Source projections from source code references', () => {
    index.build([reqNote, specNote, designNote]);

    // Add source ref for AC.02 but not AC.01
    const sourceRefs: SourceReference[] = [{
      fromId: 'source:auth.ts',
      toId: 'R004',
      sourceType: 'source',
      filePath: '/project/src/auth.ts',
      line: 42,
      language: 'typescript',
      referenceType: 'implements',
      claimPath: '.1.AC.02',
    }];
    index.addSourceReferences(sourceRefs);
    const data = index.getData();

    const result = findPartialCoverageGaps(data);

    // Now we have 3 projection types: Specification, Design, Source
    expect(result.projectionTypes).toContain('Source');

    // R004.1.AC.01: Design only → missing Spec and Source → partial
    // R004.1.AC.02: Spec + Design + Source → full coverage → excluded
    // R004.2.AC.01: Spec + Design → missing Source → partial
    const r004ClaimIds = result.rows.filter(r => r.claimId.startsWith('R004.')).map(r => r.claimId);
    expect(r004ClaimIds).toContain('R004.1.AC.01');
    expect(r004ClaimIds).toContain('R004.2.AC.01');
    expect(r004ClaimIds).not.toContain('R004.1.AC.02');
  });

  it('should return correct sourceNoteId for scoped queries', () => {
    index.build([reqNote, specNote, designNote]);
    const data = index.getData();

    const scoped = findPartialCoverageGaps(data, { noteId: 'R004' });
    expect(scoped.sourceNoteId).toBe('R004');
    expect(scoped.sourceNoteType).toBe('Requirement');

    const all = findPartialCoverageGaps(data);
    expect(all.sourceNoteId).toBe('(all)');
  });

  it('should handle empty index gracefully', () => {
    index.build([]);
    const data = index.getData();

    const result = findPartialCoverageGaps(data);
    expect(result.rows).toHaveLength(0);
    expect(result.projectionTypes).toHaveLength(0);
  });
});
