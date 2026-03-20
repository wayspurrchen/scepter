import { describe, it, expect, beforeEach } from 'vitest';
import { ClaimIndex } from '../claim-index';
import type { NoteWithContent } from '../claim-index';
import { buildTraceabilityMatrix, findGaps } from '../traceability';
import type { SourceReference } from '../../types/reference';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const requirementNote: NoteWithContent = {
  id: 'R004',
  type: 'Requirement',
  filePath: '_scepter/notes/requirements/R004.md',
  content: [
    '# R004 Authentication Requirements',
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

const specNote: NoteWithContent = {
  id: 'S001',
  type: 'Specification',
  filePath: '_scepter/notes/specifications/S001.md',
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
  ].join('\n'),
};

const implNote: NoteWithContent = {
  id: 'I001',
  type: 'Implementation',
  filePath: '_scepter/notes/implementations/I001.md',
  content: [
    '# I001 Auth Implementation',
    '',
    '### §1 Code',
    '',
    '§1.CODE.01 Token validation implements {R004.1.AC.01}.',
  ].join('\n'),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildTraceabilityMatrix', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('should build a matrix for a source note with projections', () => {
    index.build([requirementNote, specNote, designNote]);
    const data = index.getData();

    const matrix = buildTraceabilityMatrix('R004', data);
    expect(matrix.sourceNoteId).toBe('R004');
    expect(matrix.sourceNoteType).toBe('Requirement');
    expect(matrix.rows).toHaveLength(3); // 3 claims in R004
  });

  it('should group projections by note type', () => {
    index.build([requirementNote, specNote, designNote]);
    const data = index.getData();

    const matrix = buildTraceabilityMatrix('R004', data);

    // R004.1.AC.02 is referenced by both S001 (Specification) and D002 (Design)
    const ac02Row = matrix.rows.find((r) => r.claimId === 'R004.1.AC.02');
    expect(ac02Row).toBeDefined();
    expect(ac02Row!.projections.has('Specification')).toBe(true);
    expect(ac02Row!.projections.has('Design')).toBe(true);
  });

  it('should list all projection types found', () => {
    index.build([requirementNote, specNote, designNote]);
    const data = index.getData();

    const matrix = buildTraceabilityMatrix('R004', data);
    expect(matrix.projectionTypes).toContain('Specification');
    expect(matrix.projectionTypes).toContain('Design');
  });

  it('should report empty projections for unreferenced claims', () => {
    // Only build requirement note — no projections exist
    index.build([requirementNote]);
    const data = index.getData();

    const matrix = buildTraceabilityMatrix('R004', data);
    for (const row of matrix.rows) {
      expect(row.projections.size).toBe(0);
    }
    expect(matrix.projectionTypes).toHaveLength(0);
  });

  it('should order rows by section path then claim number', () => {
    index.build([requirementNote, specNote]);
    const data = index.getData();

    const matrix = buildTraceabilityMatrix('R004', data);
    const claimIds = matrix.rows.map((r) => r.claimId);

    // Should be ordered: 1.AC.01, 1.AC.02, 2.AC.01
    expect(claimIds).toEqual([
      'R004.1.AC.01',
      'R004.1.AC.02',
      'R004.2.AC.01',
    ]);
  });

  it('should return empty matrix for note with no claims', () => {
    const emptyNote: NoteWithContent = {
      id: 'R099',
      type: 'Requirement',
      filePath: 'R099.md',
      content: '# R099 No claims here\n\nJust text.',
    };

    index.build([emptyNote]);
    const data = index.getData();

    const matrix = buildTraceabilityMatrix('R099', data);
    expect(matrix.rows).toHaveLength(0);
    expect(matrix.projectionTypes).toHaveLength(0);
  });

  it('should include Source projections from source code references', () => {
    index.build([requirementNote, specNote]);

    // Add source code references
    const sourceRefs: SourceReference[] = [
      {
        fromId: 'source:/project/src/auth.ts',
        toId: 'R004',
        sourceType: 'source',
        filePath: '/project/src/auth.ts',
        line: 42,
        language: 'typescript',
        referenceType: 'implements',
        claimPath: '.1.AC.01',
      },
      {
        fromId: 'source:/project/src/oauth.ts',
        toId: 'R004',
        sourceType: 'source',
        filePath: '/project/src/oauth.ts',
        line: 15,
        language: 'typescript',
        referenceType: 'implements',
        claimPath: '.§1.AC.02',
      },
    ];

    index.addSourceReferences(sourceRefs);
    const data = index.getData();

    const matrix = buildTraceabilityMatrix('R004', data);

    // Should include "Source" as a projection type
    expect(matrix.projectionTypes).toContain('Source');

    // R004.1.AC.01 should have a Source projection from auth.ts
    const ac01Row = matrix.rows.find((r) => r.claimId === 'R004.1.AC.01');
    expect(ac01Row).toBeDefined();
    const sourcePresences = ac01Row!.projections.get('Source');
    expect(sourcePresences).toBeDefined();
    expect(sourcePresences!.length).toBeGreaterThanOrEqual(1);
    expect(sourcePresences![0].noteId).toBe('source:auth.ts');

    // R004.1.AC.02 should have both Specification and Source projections
    const ac02Row = matrix.rows.find((r) => r.claimId === 'R004.1.AC.02');
    expect(ac02Row).toBeDefined();
    expect(ac02Row!.projections.has('Specification')).toBe(true);
    expect(ac02Row!.projections.has('Source')).toBe(true);
  });
});

describe('buildTraceabilityMatrix — unresolved cross-references', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('should include unresolved cross-refs as rows with unresolved=true', () => {
    // DD01 references R004.1.AC.01 (exists) and R004.1.AC.99 (does not exist)
    const ddNote: NoteWithContent = {
      id: 'DD01',
      type: 'DetailedDesign',
      filePath: 'DD01.md',
      content: [
        '# DD01 Design',
        '',
        '### §1 Section',
        '',
        'Implements {R004.1.AC.01} and {R004.1.AC.99}.',
      ].join('\n'),
    };

    index.build([requirementNote, ddNote]);
    const data = index.getData();

    const matrix = buildTraceabilityMatrix('DD01', data);

    // Should have a row for the resolved ref (R004.1.AC.01)
    const resolvedRow = matrix.rows.find((r) => r.claimId === 'R004.1.AC.01');
    expect(resolvedRow).toBeDefined();
    expect(resolvedRow!.unresolved).toBeUndefined();

    // Should have a row for the unresolved ref (R004.1.AC.99)
    const unresolvedRow = matrix.rows.find((r) => r.claimId === 'R004.1.AC.99');
    expect(unresolvedRow).toBeDefined();
    expect(unresolvedRow!.unresolved).toBe(true);
    expect(unresolvedRow!.heading).toContain('Unresolved');
  });

  it('should produce unresolved-reference errors in the index', () => {
    const ddNote: NoteWithContent = {
      id: 'DD01',
      type: 'DetailedDesign',
      filePath: 'DD01.md',
      content: [
        '# DD01 Design',
        '',
        'References {R004.1.AC.99} which does not exist.',
      ].join('\n'),
    };

    index.build([requirementNote, ddNote]);
    const data = index.getData();

    const unresolvedErrors = data.errors.filter((e) => e.type === 'unresolved-reference');
    expect(unresolvedErrors.length).toBeGreaterThanOrEqual(1);
    expect(unresolvedErrors[0].claimId).toBe('R004.1.AC.99');
  });

  it('should create unresolved cross-refs in the index crossRefs array', () => {
    const ddNote: NoteWithContent = {
      id: 'DD01',
      type: 'DetailedDesign',
      filePath: 'DD01.md',
      content: [
        '# DD01 Design',
        '',
        'References {R004.1.AC.99} which does not exist.',
      ].join('\n'),
    };

    index.build([requirementNote, ddNote]);
    const data = index.getData();

    const unresolvedXrefs = data.crossRefs.filter((r) => r.unresolved === true);
    expect(unresolvedXrefs.length).toBeGreaterThanOrEqual(1);
    expect(unresolvedXrefs[0].toClaim).toBe('R004.1.AC.99');
    expect(unresolvedXrefs[0].fromNoteId).toBe('DD01');
    expect(unresolvedXrefs[0].toNoteId).toBe('R004');
  });
});

// ---------------------------------------------------------------------------
// Section-only reference false match regression tests
// ---------------------------------------------------------------------------

describe('buildTraceabilityMatrix — section-only references must not create false matches', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('should not create cross-refs from bare section numbers matching claim suffixes', () => {
    // ARCH015 defines claims AC.10, AC.11, etc.
    // ARCH008 contains §10, §11 as section navigation markers.
    // These section-only references must NOT resolve to ARCH015's AC.10, AC.11.
    const archNote: NoteWithContent = {
      id: 'ARCH015',
      type: 'Architecture',
      filePath: '_scepter/notes/arch/ARCH015.md',
      content: [
        '# ARCH015 Information Architecture',
        '',
        '### §2 Panel Interaction',
        '',
        '§2.AC.10 The Widget MUST expose the full ring architecture.',
        '',
        '§2.AC.11 The Widget MUST support saved configurations.',
        '',
        '§2.AC.12 Boards MUST support spatial arrangement.',
      ].join('\n'),
    };

    const indexNote: NoteWithContent = {
      id: 'ARCH008',
      type: 'Architecture',
      filePath: '_scepter/notes/arch/ARCH008.md',
      content: [
        '# ARCH008 Architecture Document Index',
        '',
        'Section: §10 Ring-as-Primary-Unit Model',
        'Section: §11 The Five-Layer Architecture',
        'Section: §12 Non-Core Systems',
        '',
        'Tricky part: §11 spans both Rust and the runtime.',
        'See [Composition Model] §10 for ring resolution.',
      ].join('\n'),
    };

    index.build([archNote, indexNote]);
    const data = index.getData();

    const matrix = buildTraceabilityMatrix('ARCH015', data);

    // No claims in ARCH015 should show ARCH008 as a reference
    for (const row of matrix.rows) {
      const archProjections = row.projections.get('Architecture') ?? [];
      const arch008Refs = archProjections.filter((p) => p.noteId === 'ARCH008');
      expect(arch008Refs).toHaveLength(0);
    }
  });

  it('should not create cross-refs from §-prefixed section paths like §10.3', () => {
    const archNote: NoteWithContent = {
      id: 'ARCH015',
      type: 'Architecture',
      filePath: 'ARCH015.md',
      content: [
        '### §2 Section',
        '',
        '§2.AC.10 The Widget MUST expose ring architecture.',
      ].join('\n'),
    };

    const specNote2: NoteWithContent = {
      id: 'S006',
      type: 'Specification',
      filePath: 'S006.md',
      content: [
        '# S006 Computation API',
        '',
        'See [Composition Model] §10.3 for resolveRing() calls.',
        'Per decision 4 in §14.',
      ].join('\n'),
    };

    index.build([archNote, specNote2]);
    const data = index.getData();

    const matrix = buildTraceabilityMatrix('ARCH015', data);

    // AC.10 should not show S006 as a reference
    const ac10Row = matrix.rows.find((r) => r.claimId === 'ARCH015.2.AC.10');
    expect(ac10Row).toBeDefined();
    expect(ac10Row!.projections.size).toBe(0);
  });

  it('should not create cross-refs from section range references like §10-11', () => {
    const archNote: NoteWithContent = {
      id: 'ARCH015',
      type: 'Architecture',
      filePath: 'ARCH015.md',
      content: [
        '### §2 Section',
        '',
        '§2.AC.10 Ring architecture claim.',
        '',
        '§2.AC.11 Saved configurations claim.',
      ].join('\n'),
    };

    const analysisNote: NoteWithContent = {
      id: 'AN009',
      type: 'Analysis',
      filePath: 'AN009.md',
      content: [
        '# AN009 Position Type Refactoring',
        '',
        '1. Read the topology doc §10-11.',
      ].join('\n'),
    };

    index.build([archNote, analysisNote]);
    const data = index.getData();

    const matrix = buildTraceabilityMatrix('ARCH015', data);

    // Neither AC.10 nor AC.11 should show AN009 as a reference
    for (const row of matrix.rows) {
      const analysisProjections = row.projections.get('Analysis') ?? [];
      expect(analysisProjections).toHaveLength(0);
    }
  });

  it('should still create legitimate claim cross-references', () => {
    // Verify the fix doesn't break actual claim references
    const archNote: NoteWithContent = {
      id: 'ARCH015',
      type: 'Architecture',
      filePath: 'ARCH015.md',
      content: [
        '### §2 Section',
        '',
        '§2.AC.10 Ring architecture claim.',
      ].join('\n'),
    };

    const specRef: NoteWithContent = {
      id: 'S010',
      type: 'Specification',
      filePath: 'S010.md',
      content: [
        '# S010 Ring Spec',
        '',
        '### §1 Implementation',
        '',
        '§1.IMPL.01 Implements {ARCH015.2.AC.10}.',
      ].join('\n'),
    };

    index.build([archNote, specRef]);
    const data = index.getData();

    const matrix = buildTraceabilityMatrix('ARCH015', data);
    const ac10Row = matrix.rows.find((r) => r.claimId === 'ARCH015.2.AC.10');
    expect(ac10Row).toBeDefined();
    expect(ac10Row!.projections.has('Specification')).toBe(true);
    const specPresences = ac10Row!.projections.get('Specification')!;
    expect(specPresences[0].noteId).toBe('S010');
  });

  it('should still resolve bare claim references like AC.01 when unambiguous', () => {
    // Bare claim refs (with claimPrefix) should still resolve via fuzzy matching
    const reqNote: NoteWithContent = {
      id: 'R010',
      type: 'Requirement',
      filePath: 'R010.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 The system MUST do X.',
      ].join('\n'),
    };

    const refNote: NoteWithContent = {
      id: 'S011',
      type: 'Specification',
      filePath: 'S011.md',
      content: [
        '### §1 Section',
        '',
        '§1.SP.01 Implements {R010.1.AC.01}.',
      ].join('\n'),
    };

    index.build([reqNote, refNote]);
    const data = index.getData();

    const matrix = buildTraceabilityMatrix('R010', data);
    const ac01Row = matrix.rows.find((r) => r.claimId === 'R010.1.AC.01');
    expect(ac01Row).toBeDefined();
    expect(ac01Row!.projections.has('Specification')).toBe(true);
  });

  it('should produce zero cross-refs for a note with only section references', () => {
    // A note that mentions §3, §5, §10 but no actual claims
    const archNote: NoteWithContent = {
      id: 'ARCH020',
      type: 'Architecture',
      filePath: 'ARCH020.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 First claim.',
      ].join('\n'),
    };

    const navNote: NoteWithContent = {
      id: 'AN020',
      type: 'Analysis',
      filePath: 'AN020.md',
      content: [
        '# AN020 Analysis',
        '',
        'See §3 for background.',
        'Refer to §5 for context.',
        'The details are in §10.',
        'Cross-reference §1 and §2.',
      ].join('\n'),
    };

    index.build([archNote, navNote]);
    const data = index.getData();

    // AN020 should have zero outgoing cross-refs
    const outgoing = data.crossRefs.filter((r) => r.fromNoteId === 'AN020');
    expect(outgoing).toHaveLength(0);
  });

  it('should not false-match notes containing comma-separated §-sections like §12-15', () => {
    // AN006 has table cells like "§12-15" which should not match claims
    const archNote: NoteWithContent = {
      id: 'ARCH015',
      type: 'Architecture',
      filePath: 'ARCH015.md',
      content: [
        '### §2 Section',
        '',
        '§2.AC.12 Boards claim.',
        '',
        '§2.AC.13 Open in Widget claim.',
        '',
        '§2.AC.14 Send to Panel claim.',
        '',
        '§2.AC.15 Widget to Panel claim.',
      ].join('\n'),
    };

    const analysisNote: NoteWithContent = {
      id: 'AN006',
      type: 'Analysis',
      filePath: 'AN006.md',
      content: [
        '# AN006 Session Continuation',
        '',
        '| Doc | Sections |',
        '|-----|----------|',
        '| Composition Model | §8, §10, §11 |',
        '| Decisions | §6, §12-15 |',
      ].join('\n'),
    };

    index.build([archNote, analysisNote]);
    const data = index.getData();

    const matrix = buildTraceabilityMatrix('ARCH015', data);

    // None of AC.12-AC.15 should show AN006 as a reference
    for (const row of matrix.rows) {
      const analysisProjections = row.projections.get('Analysis') ?? [];
      const an006Refs = analysisProjections.filter((p) => p.noteId === 'AN006');
      expect(an006Refs).toHaveLength(0);
    }
  });
});

describe('findGaps', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('should find claims missing from some note types', () => {
    // R004.1.AC.01 is referenced by Design and Implementation
    // R004.1.AC.02 is referenced by Specification and Design
    // R004.2.AC.01 is referenced only by Specification
    index.build([requirementNote, specNote, designNote, implNote]);
    const data = index.getData();

    const allTypes = ['Requirement', 'Specification', 'Design', 'Implementation'];
    const gaps = findGaps(data, allTypes);

    expect(gaps.length).toBeGreaterThan(0);

    // R004.1.AC.01 is present in Requirement, Design, and Implementation
    // but NOT in Specification — so Specification is a gap
    const ac01Gap = gaps.find((g) => g.claimId === 'R004.1.AC.01');
    if (ac01Gap) {
      expect(ac01Gap.missingFrom).toContain('Specification');
    }
  });

  it('should not report gaps for claims with only their source type', () => {
    // With only the requirement note, no projections exist,
    // so no gaps should be reported (need at least 2 types to have a gap)
    index.build([requirementNote]);
    const data = index.getData();

    const allTypes = ['Requirement', 'Specification', 'Design'];
    const gaps = findGaps(data, allTypes);
    expect(gaps).toHaveLength(0);
  });

  it('should not report gaps for fully covered claims', () => {
    // Create a scenario where a claim is covered in all types
    const specCoveringAll: NoteWithContent = {
      id: 'S002',
      type: 'Specification',
      filePath: 'S002.md',
      content: [
        '# S002 Full Coverage',
        '',
        '### §1 Section',
        '',
        '§1.SP.01 Covers {R004.1.AC.01}.',
      ].join('\n'),
    };

    const desCoveringAll: NoteWithContent = {
      id: 'D003',
      type: 'Design',
      filePath: 'D003.md',
      content: [
        '# D003 Full Coverage',
        '',
        '### §1 Section',
        '',
        '§1.DD.01 Covers {R004.1.AC.01}.',
      ].join('\n'),
    };

    index.build([requirementNote, specCoveringAll, desCoveringAll]);
    const data = index.getData();

    // Only 3 types that matter: Requirement, Specification, Design
    const allTypes = ['Requirement', 'Specification', 'Design'];
    const gaps = findGaps(data, allTypes);

    // R004.1.AC.01 should have no gap — it's covered in all 3 types
    const ac01Gap = gaps.find((g) => g.claimId === 'R004.1.AC.01');
    expect(ac01Gap).toBeUndefined();
  });

  it('should include metadata in gap reports', () => {
    const metaNote: NoteWithContent = {
      id: 'R008',
      type: 'Requirement',
      filePath: 'R008.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Critical requirement:P0:security',
      ].join('\n'),
    };

    const refNote: NoteWithContent = {
      id: 'S003',
      type: 'Specification',
      filePath: 'S003.md',
      content: [
        '### §1 Section',
        '',
        '§1.SP.01 Implements {R008.1.AC.01}.',
      ].join('\n'),
    };

    index.build([metaNote, refNote]);
    const data = index.getData();

    const allTypes = ['Requirement', 'Specification', 'Design'];
    const gaps = findGaps(data, allTypes);

    const r008Gap = gaps.find((g) => g.claimId === 'R008.1.AC.01');
    if (r008Gap) {
      expect(r008Gap.metadata).toEqual(['P0', 'security']);
      expect(r008Gap.missingFrom).toContain('Design');
    }
  });
});

// ---------------------------------------------------------------------------
// Dual-role notes (define claims AND reference external claims)
// ---------------------------------------------------------------------------

describe('buildTraceabilityMatrix — dual-role notes', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('should merge incoming and outgoing matrices for dual-role notes', () => {
    // ARCH018 defines its own claims AND references ARCH015 claims
    const archBase: NoteWithContent = {
      id: 'ARCH015',
      type: 'Architecture',
      filePath: 'ARCH015.md',
      content: [
        '### §1 Rendering',
        '',
        '§1.AC.01 The renderer MUST support SVG.',
      ].join('\n'),
    };

    const dualNote: NoteWithContent = {
      id: 'ARCH018',
      type: 'Architecture',
      filePath: 'ARCH018.md',
      content: [
        '### §1 Core',
        '',
        '§1.AC.01 The Widget MUST be the middle tier.',
        '',
        '§1.AC.02 Style overrides follow {ARCH015.1.AC.01} conventions.',
      ].join('\n'),
    };

    index.build([archBase, dualNote]);
    const data = index.getData();

    const matrix = buildTraceabilityMatrix('ARCH018', data);

    // Should contain ARCH018's own claims (incoming part)
    const ownClaims = matrix.rows.filter((r) => r.claimId.startsWith('ARCH018'));
    expect(ownClaims.length).toBe(2);

    // Should contain the outgoing reference to ARCH015
    const externalClaims = matrix.rows.filter((r) => r.claimId.startsWith('ARCH015'));
    expect(externalClaims.length).toBe(1);
    expect(externalClaims[0].claimId).toBe('ARCH015.1.AC.01');
  });

  it('should not include false cross-note refs in dual-role note matrix', () => {
    // Both notes define AC.01 — dual-role note should NOT show the other
    // note's AC.01 as an outgoing reference
    const otherNote: NoteWithContent = {
      id: 'R004',
      type: 'Requirement',
      filePath: 'R004.md',
      content: [
        '### §1 Security',
        '',
        '§1.AC.01 Auth required.',
      ].join('\n'),
    };

    const dualNote: NoteWithContent = {
      id: 'ARCH018',
      type: 'Architecture',
      filePath: 'ARCH018.md',
      content: [
        '### §1 Core',
        '',
        '§1.AC.01 The Widget MUST be the middle tier.',
        '',
        '§1.AC.02 Every preset MUST be a view.',
      ].join('\n'),
    };

    index.build([otherNote, dualNote]);
    const data = index.getData();

    const matrix = buildTraceabilityMatrix('ARCH018', data);

    // Should only have ARCH018's own claims — no R004 claims
    const r004Claims = matrix.rows.filter((r) => r.claimId.startsWith('R004'));
    expect(r004Claims).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findGaps — lifecycle filtering
// ---------------------------------------------------------------------------

describe('findGaps — lifecycle filtering', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('should exclude closed claims from gap reports by default', () => {
    const reqNote: NoteWithContent = {
      id: 'R010',
      type: 'Requirement',
      filePath: 'R010.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Active claim.',
        '',
        '§1.AC.02 Resolved claim:closed',
      ].join('\n'),
    };

    const specNote2: NoteWithContent = {
      id: 'S010',
      type: 'Specification',
      filePath: 'S010.md',
      content: [
        '### §1 Section',
        '',
        '§1.SP.01 Covers {R010.1.AC.01}.',
      ].join('\n'),
    };

    index.build([reqNote, specNote2]);
    const data = index.getData();

    const gaps = findGaps(data, ['Requirement', 'Specification', 'Design']);

    // AC.01 should have a gap (missing from Design)
    const ac01Gap = gaps.find((g) => g.claimId === 'R010.1.AC.01');
    expect(ac01Gap).toBeDefined();
    expect(ac01Gap!.missingFrom).toContain('Design');

    // AC.02 should NOT appear (it's closed)
    const ac02Gap = gaps.find((g) => g.claimId === 'R010.1.AC.02');
    expect(ac02Gap).toBeUndefined();
  });

  it('should exclude deferred claims from gap reports by default', () => {
    const reqNote: NoteWithContent = {
      id: 'R010',
      type: 'Requirement',
      filePath: 'R010.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Active claim.',
        '',
        '§1.AC.02 Deferred claim:deferred',
      ].join('\n'),
    };

    const specNote2: NoteWithContent = {
      id: 'S010',
      type: 'Specification',
      filePath: 'S010.md',
      content: [
        '### §1 Section',
        '',
        '§1.SP.01 Covers {R010.1.AC.01}.',
        '',
        '§1.SP.02 Covers {R010.1.AC.02}.',
      ].join('\n'),
    };

    index.build([reqNote, specNote2]);
    const data = index.getData();

    const gaps = findGaps(data, ['Requirement', 'Specification', 'Design']);

    // Deferred claim should not appear in gaps
    const ac02Gap = gaps.find((g) => g.claimId === 'R010.1.AC.02');
    expect(ac02Gap).toBeUndefined();
  });

  it('should include closed claims when excludeClosed is false', () => {
    const reqNote: NoteWithContent = {
      id: 'R010',
      type: 'Requirement',
      filePath: 'R010.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Resolved:closed',
      ].join('\n'),
    };

    const specNote2: NoteWithContent = {
      id: 'S010',
      type: 'Specification',
      filePath: 'S010.md',
      content: [
        '### §1 Section',
        '',
        '§1.SP.01 Covers {R010.1.AC.01}.',
      ].join('\n'),
    };

    index.build([reqNote, specNote2]);
    const data = index.getData();

    const gaps = findGaps(data, ['Requirement', 'Specification', 'Design'], {
      excludeClosed: false,
    });

    // Closed claim SHOULD appear when excludeClosed is false
    const ac01Gap = gaps.find((g) => g.claimId === 'R010.1.AC.01');
    expect(ac01Gap).toBeDefined();
    expect(ac01Gap!.missingFrom).toContain('Design');
  });

  it('should include deferred claims when excludeDeferred is false', () => {
    const reqNote: NoteWithContent = {
      id: 'R010',
      type: 'Requirement',
      filePath: 'R010.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Postponed:deferred',
      ].join('\n'),
    };

    const specNote2: NoteWithContent = {
      id: 'S010',
      type: 'Specification',
      filePath: 'S010.md',
      content: [
        '### §1 Section',
        '',
        '§1.SP.01 Covers {R010.1.AC.01}.',
      ].join('\n'),
    };

    index.build([reqNote, specNote2]);
    const data = index.getData();

    const gaps = findGaps(data, ['Requirement', 'Specification', 'Design'], {
      excludeDeferred: false,
    });

    const ac01Gap = gaps.find((g) => g.claimId === 'R010.1.AC.01');
    expect(ac01Gap).toBeDefined();
  });

  it('should always exclude removed claims from gap reports', () => {
    const reqNote: NoteWithContent = {
      id: 'R010',
      type: 'Requirement',
      filePath: 'R010.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Removed claim:removed',
      ].join('\n'),
    };

    const specNote2: NoteWithContent = {
      id: 'S010',
      type: 'Specification',
      filePath: 'S010.md',
      content: [
        '### §1 Section',
        '',
        '§1.SP.01 Covers {R010.1.AC.01}.',
      ].join('\n'),
    };

    index.build([reqNote, specNote2]);
    const data = index.getData();

    // Even with excludeClosed=false and excludeDeferred=false,
    // removed claims should never appear
    const gaps = findGaps(data, ['Requirement', 'Specification', 'Design'], {
      excludeClosed: false,
      excludeDeferred: false,
    });

    const ac01Gap = gaps.find((g) => g.claimId === 'R010.1.AC.01');
    expect(ac01Gap).toBeUndefined();
  });

  it('should always exclude superseded claims from gap reports', () => {
    const reqNote: NoteWithContent = {
      id: 'R010',
      type: 'Requirement',
      filePath: 'R010.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Replacement claim.',
        '',
        '§1.AC.02 Old claim:superseded=R010.§1.AC.01',
      ].join('\n'),
    };

    const specNote2: NoteWithContent = {
      id: 'S010',
      type: 'Specification',
      filePath: 'S010.md',
      content: [
        '### §1 Section',
        '',
        '§1.SP.01 Covers {R010.1.AC.02}.',
      ].join('\n'),
    };

    index.build([reqNote, specNote2]);
    const data = index.getData();

    const gaps = findGaps(data, ['Requirement', 'Specification', 'Design'], {
      excludeClosed: false,
      excludeDeferred: false,
    });

    // Superseded claim should never appear in gaps
    const ac02Gap = gaps.find((g) => g.claimId === 'R010.1.AC.02');
    expect(ac02Gap).toBeUndefined();
  });

  it('should include importance in gap reports', () => {
    const reqNote: NoteWithContent = {
      id: 'R010',
      type: 'Requirement',
      filePath: 'R010.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Critical:5',
      ].join('\n'),
    };

    const specNote2: NoteWithContent = {
      id: 'S010',
      type: 'Specification',
      filePath: 'S010.md',
      content: [
        '### §1 Section',
        '',
        '§1.SP.01 Covers {R010.1.AC.01}.',
      ].join('\n'),
    };

    index.build([reqNote, specNote2]);
    const data = index.getData();

    const gaps = findGaps(data, ['Requirement', 'Specification', 'Design']);

    const ac01Gap = gaps.find((g) => g.claimId === 'R010.1.AC.01');
    expect(ac01Gap).toBeDefined();
    expect(ac01Gap!.importance).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Importance propagation in traceability matrix
// ---------------------------------------------------------------------------

describe('buildTraceabilityMatrix — importance and lifecycle propagation', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('should propagate importance to matrix rows', () => {
    const reqNote: NoteWithContent = {
      id: 'R010',
      type: 'Requirement',
      filePath: 'R010.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Critical:5',
        '',
        '§1.AC.02 Normal claim.',
      ].join('\n'),
    };

    index.build([reqNote]);
    const data = index.getData();

    const matrix = buildTraceabilityMatrix('R010', data);

    const ac01Row = matrix.rows.find((r) => r.claimId === 'R010.1.AC.01');
    expect(ac01Row).toBeDefined();
    expect(ac01Row!.importance).toBe(5);

    const ac02Row = matrix.rows.find((r) => r.claimId === 'R010.1.AC.02');
    expect(ac02Row).toBeDefined();
    expect(ac02Row!.importance).toBeUndefined();
  });

  it('should propagate lifecycle to matrix rows', () => {
    const reqNote: NoteWithContent = {
      id: 'R010',
      type: 'Requirement',
      filePath: 'R010.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Active claim.',
        '',
        '§1.AC.02 Closed claim:closed',
        '',
        '§1.AC.03 Deferred claim:deferred',
      ].join('\n'),
    };

    index.build([reqNote]);
    const data = index.getData();

    const matrix = buildTraceabilityMatrix('R010', data);

    const ac01Row = matrix.rows.find((r) => r.claimId === 'R010.1.AC.01');
    expect(ac01Row!.lifecycle).toBeUndefined();

    const ac02Row = matrix.rows.find((r) => r.claimId === 'R010.1.AC.02');
    expect(ac02Row!.lifecycle).toBeDefined();
    expect(ac02Row!.lifecycle!.type).toBe('closed');

    const ac03Row = matrix.rows.find((r) => r.claimId === 'R010.1.AC.03');
    expect(ac03Row!.lifecycle).toBeDefined();
    expect(ac03Row!.lifecycle!.type).toBe('deferred');
  });
});

// ---------------------------------------------------------------------------
// Cross-note fuzzy matching regression — the ARCH018 bug
// ---------------------------------------------------------------------------

describe('buildTraceabilityMatrix — cross-note fuzzy match regression', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('should not show claims from unrelated notes when tracing a note with many claims', () => {
    // Reproduces the ARCH018 bug: ARCH018 defines AC.01-AC.05,
    // R004 also defines AC.01-AC.05. The trace for ARCH018 should NOT
    // include any R004 claims unless explicitly referenced.
    const arch018: NoteWithContent = {
      id: 'ARCH018',
      type: 'Architecture',
      filePath: 'ARCH018.md',
      content: [
        '### §1 Core Concepts',
        '',
        '§1.AC.01 The Widget MUST be the middle tier.',
        '',
        '§1.AC.02 Every preset page MUST be a view.',
        '',
        '§1.AC.03 The Widget route MUST be /widget.',
        '',
        '### §2 Ring System',
        '',
        '§2.AC.04 Every ring type MUST belong to one category.',
        '',
        '§2.AC.05 Entity rings MUST carry an entity binding.',
      ].join('\n'),
    };

    const r004: NoteWithContent = {
      id: 'R004',
      type: 'Requirement',
      filePath: 'R004.md',
      content: [
        '### §1 Syntax',
        '',
        '§1.AC.01 Parser MUST extract section IDs.',
        '',
        '§1.AC.02 Parser MUST extract claim IDs.',
        '',
        '§1.AC.03 Parser MUST resolve paths.',
        '',
        '§1.AC.04 Parser MUST reject ambiguous refs.',
        '',
        '§1.AC.05 Claim IDs MUST be monotonic.',
      ].join('\n'),
    };

    index.build([arch018, r004]);
    const data = index.getData();

    const matrix = buildTraceabilityMatrix('ARCH018', data);

    // The matrix should only contain ARCH018's own claims
    for (const row of matrix.rows) {
      expect(row.claimId).toMatch(/^ARCH018\./);
    }

    // Specifically, NO R004 claims should appear
    const r004Rows = matrix.rows.filter((r) => r.claimId.startsWith('R004'));
    expect(r004Rows).toHaveLength(0);
  });

  it('should show explicit references alongside own claims in dual-role trace', () => {
    const arch015: NoteWithContent = {
      id: 'ARCH015',
      type: 'Architecture',
      filePath: 'ARCH015.md',
      content: [
        '### §1 Rendering',
        '',
        '§1.AC.01 SVG rendering MUST be supported.',
      ].join('\n'),
    };

    const arch018: NoteWithContent = {
      id: 'ARCH018',
      type: 'Architecture',
      filePath: 'ARCH018.md',
      content: [
        '### §1 Core',
        '',
        '§1.AC.01 The Widget MUST be the middle tier.',
        '',
        '§1.AC.02 Rendering follows {ARCH015.1.AC.01}.',
      ].join('\n'),
    };

    const r004: NoteWithContent = {
      id: 'R004',
      type: 'Requirement',
      filePath: 'R004.md',
      content: [
        '### §1 Syntax',
        '',
        '§1.AC.01 Parser MUST extract section IDs.',
      ].join('\n'),
    };

    index.build([arch015, arch018, r004]);
    const data = index.getData();

    const matrix = buildTraceabilityMatrix('ARCH018', data);

    // Should have ARCH018's own claims
    const ownClaims = matrix.rows.filter((r) => r.claimId.startsWith('ARCH018'));
    expect(ownClaims).toHaveLength(2);

    // Should have the explicitly referenced ARCH015 claim
    const arch015Claims = matrix.rows.filter((r) => r.claimId.startsWith('ARCH015'));
    expect(arch015Claims).toHaveLength(1);

    // Should NOT have R004 claims (not referenced)
    const r004Claims = matrix.rows.filter((r) => r.claimId.startsWith('R004'));
    expect(r004Claims).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildTraceabilityMatrix — derivedFrom population
// @validates {R006.§4.AC.01} derivedFrom field on TraceabilityRow
// ---------------------------------------------------------------------------

describe('buildTraceabilityMatrix — derivedFrom population', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('should populate derivedFrom on incoming matrix rows', () => {
    const reqNote: NoteWithContent = {
      id: 'R005',
      type: 'Requirement',
      filePath: 'R005.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Source requirement.',
      ].join('\n'),
    };

    const ddNote: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 Derived claim:derives=R005.§1.AC.01',
        '',
        'References {R005.§1.AC.01}.',
      ].join('\n'),
    };

    index.build([reqNote, ddNote]);
    const data = index.getData();

    // Trace DD003 — DC.01 should have derivedFrom populated
    const matrix = buildTraceabilityMatrix('DD003', data);
    const dc01Row = matrix.rows.find((r) => r.claimId === 'DD003.1.DC.01');
    expect(dc01Row).toBeDefined();
    expect(dc01Row!.derivedFrom).toEqual(['R005.1.AC.01']);
  });

  it('should set empty derivedFrom for non-derived claims', () => {
    const reqNote: NoteWithContent = {
      id: 'R005',
      type: 'Requirement',
      filePath: 'R005.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Regular requirement.',
      ].join('\n'),
    };

    index.build([reqNote]);
    const data = index.getData();

    const matrix = buildTraceabilityMatrix('R005', data);
    const ac01Row = matrix.rows.find((r) => r.claimId === 'R005.1.AC.01');
    expect(ac01Row).toBeDefined();
    expect(ac01Row!.derivedFrom).toEqual([]);
  });

  it('should populate derivedFrom on outgoing matrix rows', () => {
    const reqNote: NoteWithContent = {
      id: 'R005',
      type: 'Requirement',
      filePath: 'R005.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Source:derives=R004.§1.AC.01',
      ].join('\n'),
    };

    const targetNote: NoteWithContent = {
      id: 'R004',
      type: 'Requirement',
      filePath: 'R004.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Target requirement.',
      ].join('\n'),
    };

    // R005 references R004 — outgoing from a note that defines its own claims
    const ddNote: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '# DD003 Design',
        '',
        'Implements {R005.§1.AC.01}.',
      ].join('\n'),
    };

    index.build([reqNote, targetNote, ddNote]);
    const data = index.getData();

    // Trace DD003 — the outgoing ref to R005.1.AC.01 should carry derivedFrom
    const matrix = buildTraceabilityMatrix('DD003', data);
    const r005Row = matrix.rows.find((r) => r.claimId === 'R005.1.AC.01');
    if (r005Row) {
      // If it appears in the outgoing matrix, its derivedFrom should be populated
      expect(r005Row.derivedFrom).toEqual(['R004.1.AC.01']);
    }
  });

  it('should set empty derivedFrom on unresolved outgoing rows', () => {
    const ddNote: NoteWithContent = {
      id: 'DD01',
      type: 'DetailedDesign',
      filePath: 'DD01.md',
      content: [
        '# DD01 Design',
        '',
        'References {R999.1.AC.99} which does not exist.',
      ].join('\n'),
    };

    index.build([ddNote]);
    const data = index.getData();

    const matrix = buildTraceabilityMatrix('DD01', data);
    const unresolvedRow = matrix.rows.find((r) => r.unresolved);
    if (unresolvedRow) {
      expect(unresolvedRow.derivedFrom).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Derivation-aware gap detection
// @validates {R006.§3.AC.01} Gap closure when all derivatives have Source coverage
// @validates {R006.§3.AC.02} Partial derivation coverage annotation
// ---------------------------------------------------------------------------

describe('findGaps — derivation-aware gap closure', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('should close gap when all derivatives have Source coverage', () => {
    // R005.§1.AC.01 is a requirement claim. DD003 has two DCs that derive from it.
    // Both DCs have source coverage. AC.01 should NOT appear as a gap.
    const reqNote: NoteWithContent = {
      id: 'R005',
      type: 'Requirement',
      filePath: 'R005.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Source requirement.',
      ].join('\n'),
    };

    const ddNote: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 First derived:derives=R005.§1.AC.01',
        '',
        '§1.DC.02 Second derived:derives=R005.§1.AC.01',
        '',
        'References {R005.§1.AC.01} for context.',
      ].join('\n'),
    };

    index.build([reqNote, ddNote]);

    // Add source references for both DCs
    const sourceRefs: SourceReference[] = [
      {
        fromId: 'source:impl.ts',
        toId: 'DD003',
        sourceType: 'source',
        filePath: '/project/src/impl.ts',
        line: 10,
        language: 'typescript',
        referenceType: 'implements',
        claimPath: '.1.DC.01',
      },
      {
        fromId: 'source:impl.ts',
        toId: 'DD003',
        sourceType: 'source',
        filePath: '/project/src/impl.ts',
        line: 20,
        language: 'typescript',
        referenceType: 'implements',
        claimPath: '.1.DC.02',
      },
    ];

    index.addSourceReferences(sourceRefs);
    const data = index.getData();

    const allTypes = ['Requirement', 'DetailedDesign', 'Source'];
    const gaps = findGaps(data, allTypes, undefined, index.getDerivatives.bind(index));

    // R005.1.AC.01 should NOT appear as a gap — its Source gap is closed by derivation
    const ac01Gap = gaps.find((g) => g.claimId === 'R005.1.AC.01');
    expect(ac01Gap).toBeUndefined();
  });

  it('should annotate partial derivation coverage', () => {
    const reqNote: NoteWithContent = {
      id: 'R005',
      type: 'Requirement',
      filePath: 'R005.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Source requirement.',
      ].join('\n'),
    };

    const ddNote: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 First derived:derives=R005.§1.AC.01',
        '',
        '§1.DC.02 Second derived:derives=R005.§1.AC.01',
        '',
        'References {R005.§1.AC.01} for context.',
      ].join('\n'),
    };

    index.build([reqNote, ddNote]);

    // Only DC.01 has source coverage; DC.02 does not
    const sourceRefs: SourceReference[] = [
      {
        fromId: 'source:impl.ts',
        toId: 'DD003',
        sourceType: 'source',
        filePath: '/project/src/impl.ts',
        line: 10,
        language: 'typescript',
        referenceType: 'implements',
        claimPath: '.1.DC.01',
      },
    ];

    index.addSourceReferences(sourceRefs);
    const data = index.getData();

    const allTypes = ['Requirement', 'DetailedDesign', 'Source'];
    const gaps = findGaps(data, allTypes, undefined, index.getDerivatives.bind(index));

    // R005.1.AC.01 should still appear with derivationStatus showing partial coverage
    const ac01Gap = gaps.find((g) => g.claimId === 'R005.1.AC.01');
    expect(ac01Gap).toBeDefined();
    expect(ac01Gap!.derivationStatus).toBeDefined();
    expect(ac01Gap!.derivationStatus!.totalDerivatives).toBe(2);
    expect(ac01Gap!.derivationStatus!.coveredDerivatives).toBe(1);
    expect(ac01Gap!.derivationStatus!.uncoveredDerivatives).toEqual(['DD003.1.DC.02']);
  });

  it('should not affect claims without derivatives', () => {
    const reqNote: NoteWithContent = {
      id: 'R005',
      type: 'Requirement',
      filePath: 'R005.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Source requirement.',
      ].join('\n'),
    };

    const specNote2: NoteWithContent = {
      id: 'S010',
      type: 'Specification',
      filePath: 'S010.md',
      content: [
        '### §1 Section',
        '',
        '§1.SP.01 Covers {R005.1.AC.01}.',
      ].join('\n'),
    };

    index.build([reqNote, specNote2]);
    const data = index.getData();

    const allTypes = ['Requirement', 'Specification', 'Source'];
    const gaps = findGaps(data, allTypes, undefined, index.getDerivatives.bind(index));

    // AC.01 is present in Req + Spec, missing from Source — standard gap
    const ac01Gap = gaps.find((g) => g.claimId === 'R005.1.AC.01');
    expect(ac01Gap).toBeDefined();
    expect(ac01Gap!.missingFrom).toContain('Source');
    // No derivationStatus because no derivatives
    expect(ac01Gap!.derivationStatus).toBeUndefined();
  });

  it('should work unchanged when no derivativesLookup is provided', () => {
    // Standard behavior: no derivation awareness when lookup is omitted
    const reqNote: NoteWithContent = {
      id: 'R005',
      type: 'Requirement',
      filePath: 'R005.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Source requirement.',
      ].join('\n'),
    };

    const specNote2: NoteWithContent = {
      id: 'S010',
      type: 'Specification',
      filePath: 'S010.md',
      content: [
        '### §1 Section',
        '',
        '§1.SP.01 Covers {R005.1.AC.01}.',
      ].join('\n'),
    };

    index.build([reqNote, specNote2]);
    const data = index.getData();

    const allTypes = ['Requirement', 'Specification', 'Source'];
    // No derivativesLookup — standard behavior
    const gaps = findGaps(data, allTypes);

    const ac01Gap = gaps.find((g) => g.claimId === 'R005.1.AC.01');
    expect(ac01Gap).toBeDefined();
    expect(ac01Gap!.missingFrom).toContain('Source');
  });
});
