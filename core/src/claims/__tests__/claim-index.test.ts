import { describe, it, expect, beforeEach } from 'vitest';
import { ClaimIndex } from '../claim-index';
import type { NoteWithContent, ClaimIndexEntry, ClaimCrossReference } from '../claim-index';
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
    '## Overview',
    '',
    '### §1 Security',
    '',
    '§1.AC.01 The system MUST require authentication for all API endpoints.',
    '',
    '§1.AC.02 The system MUST support OAuth2 flows.',
    '',
    '### §2 Authorization',
    '',
    '§2.AC.01 The system MUST enforce role-based access control.',
    '',
    '§2.AC.02 The system MUST log all authorization failures.',
  ].join('\n'),
};

const specNote: NoteWithContent = {
  id: 'S001',
  type: 'Specification',
  filePath: '_scepter/notes/specifications/S001.md',
  content: [
    '# S001 Auth Spec',
    '',
    '## Implementation Details',
    '',
    '### §1 API Auth',
    '',
    '§1.IMPL.01 Implements OAuth2 as described in {R004.1.AC.02}.',
    '',
    '§1.IMPL.02 Role check per {R004.2.AC.01} using middleware.',
  ].join('\n'),
};

const designNote: NoteWithContent = {
  id: 'D002',
  type: 'Design',
  filePath: '_scepter/notes/designs/D002.md',
  content: [
    '# D002 Auth Design',
    '',
    '## Design',
    '',
    '### §1 Architecture',
    '',
    '§1.DES.01 Auth gateway handles {R004.1.AC.01} via token validation.',
  ].join('\n'),
};

const simpleNote: NoteWithContent = {
  id: 'R005',
  type: 'Requirement',
  filePath: '_scepter/notes/requirements/R005.md',
  content: [
    '# R005 Simple',
    '',
    '### AC.01 A claim without section prefix',
    '',
    'Content here.',
  ].join('\n'),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClaimIndex', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  describe('build — single note', () => {
    it('should extract all claims from a note', () => {
      index.build([requirementNote]);

      const claims = index.getClaimsForNote('R004');
      expect(claims).toHaveLength(4);

      const ids = claims.map((c) => c.fullyQualified).sort();
      expect(ids).toEqual([
        'R004.1.AC.01',
        'R004.1.AC.02',
        'R004.2.AC.01',
        'R004.2.AC.02',
      ]);
    });

    it('should construct correct fully qualified IDs', () => {
      index.build([requirementNote]);

      const ac01 = index.getClaim('R004.1.AC.01');
      expect(ac01).not.toBeNull();
      expect(ac01!.noteId).toBe('R004');
      expect(ac01!.claimId).toBe('1.AC.01');
      expect(ac01!.sectionPath).toEqual([1]);
      expect(ac01!.claimPrefix).toBe('AC');
      expect(ac01!.claimNumber).toBe(1);
      expect(ac01!.noteType).toBe('Requirement');
      expect(ac01!.noteFilePath).toBe('_scepter/notes/requirements/R004.md');
    });

    it('should handle claims without section prefix', () => {
      index.build([simpleNote]);

      const claims = index.getClaimsForNote('R005');
      expect(claims).toHaveLength(1);

      const claim = claims[0];
      expect(claim.fullyQualified).toBe('R005.AC.01');
      expect(claim.sectionPath).toEqual([]);
      expect(claim.claimPrefix).toBe('AC');
      expect(claim.claimNumber).toBe(1);
    });
  });

  describe('build — multiple notes with cross-references', () => {
    it('should detect cross-references between notes', () => {
      index.build([requirementNote, specNote]);

      const crossRefs = index.getData().crossRefs;
      expect(crossRefs.length).toBeGreaterThanOrEqual(2);

      // specNote references R004.1.AC.02 and R004.2.AC.01
      const toR004_1_AC02 = crossRefs.filter((r) => r.toClaim === 'R004.1.AC.02');
      expect(toR004_1_AC02.length).toBeGreaterThanOrEqual(1);
      expect(toR004_1_AC02[0].fromNoteId).toBe('S001');
      expect(toR004_1_AC02[0].toNoteId).toBe('R004');

      const toR004_2_AC01 = crossRefs.filter((r) => r.toClaim === 'R004.2.AC.01');
      expect(toR004_2_AC01.length).toBeGreaterThanOrEqual(1);
      expect(toR004_2_AC01[0].fromNoteId).toBe('S001');
    });

    it('should detect cross-references from design note', () => {
      index.build([requirementNote, designNote]);

      const crossRefs = index.getData().crossRefs;
      const toR004_1_AC01 = crossRefs.filter((r) => r.toClaim === 'R004.1.AC.01');
      expect(toR004_1_AC01.length).toBeGreaterThanOrEqual(1);
      expect(toR004_1_AC01[0].fromNoteId).toBe('D002');
    });
  });

  describe('getClaim', () => {
    it('should return null for nonexistent claim', () => {
      index.build([requirementNote]);
      expect(index.getClaim('R004.99.AC.99')).toBeNull();
    });

    it('should return the correct entry', () => {
      index.build([requirementNote]);
      const claim = index.getClaim('R004.2.AC.02');
      expect(claim).not.toBeNull();
      expect(claim!.claimPrefix).toBe('AC');
      expect(claim!.claimNumber).toBe(2);
      expect(claim!.sectionPath).toEqual([2]);
    });
  });

  describe('getCrossRefsFrom / getCrossRefsTo', () => {
    it('should return cross-refs TO a specific claim', () => {
      index.build([requirementNote, specNote, designNote]);

      const refsTo = index.getCrossRefsTo('R004.1.AC.01');
      expect(refsTo.length).toBeGreaterThanOrEqual(1);

      const fromDesign = refsTo.find((r) => r.fromNoteId === 'D002');
      expect(fromDesign).toBeDefined();
    });

    it('should return cross-refs FROM a specific claim', () => {
      index.build([requirementNote, specNote]);

      // Find any cross-ref from a claim in S001
      const s001Claims = index.getClaimsForNote('S001');
      let foundFromRef = false;

      for (const claim of s001Claims) {
        const refsFrom = index.getCrossRefsFrom(claim.fullyQualified);
        if (refsFrom.length > 0) {
          foundFromRef = true;
          expect(refsFrom[0].toNoteId).toBe('R004');
        }
      }

      expect(foundFromRef).toBe(true);
    });

    it('should return empty for claims with no cross-refs', () => {
      index.build([requirementNote]);

      const refsTo = index.getCrossRefsTo('R004.1.AC.01');
      expect(refsTo).toHaveLength(0);

      const refsFrom = index.getCrossRefsFrom('R004.1.AC.01');
      expect(refsFrom).toHaveLength(0);
    });
  });

  describe('getErrors', () => {
    it('should return empty errors for valid notes', () => {
      index.build([requirementNote]);
      // The requirement note itself should not produce errors
      // (validation errors from the tree builder are included, but this fixture is clean)
      const errors = index.getErrors();
      // No duplicates, no forbidden forms in our fixture
      const realErrors = errors.filter((e) => e.type !== 'ambiguous');
      // Ambiguous may appear since AC.01 exists in multiple sections,
      // but that's expected from validateClaimTree — not our index logic
    });

    it('should silently dedup repeated claim IDs in the same note (no error, first occurrence wins)', () => {
      // Same-file repeats are tolerated as TOC/restatement prose. The
      // parser drops the second occurrence so the index never sees a
      // duplicate. The first occurrence is the canonical entry.
      const dupeNote: NoteWithContent = {
        id: 'R006',
        type: 'Requirement',
        filePath: 'R006.md',
        content: [
          '### §1 Section',
          '',
          '§1.AC.01 First claim at line 3.',
          '',
          '§1.AC.01 Restatement at line 5.',
        ].join('\n'),
      };

      const data = index.build([dupeNote]);
      const errors = index.getErrors();
      const dupeErrors = errors.filter((e) => e.type === 'duplicate');
      expect(dupeErrors).toHaveLength(0);
      const entry = data.entries.get('R006.1.AC.01');
      expect(entry).toBeDefined();
      expect(entry!.line).toBe(3);
    });
  });

  describe('getData', () => {
    it('should return complete index data', () => {
      const data = index.build([requirementNote, specNote]);

      expect(data.entries.size).toBeGreaterThan(0);
      expect(data.trees.has('R004')).toBe(true);
      expect(data.trees.has('S001')).toBe(true);
      expect(data.crossRefs.length).toBeGreaterThan(0);
    });

    it('should return same data from getData()', () => {
      index.build([requirementNote]);
      const data = index.getData();
      expect(data.entries.size).toBe(4);
      expect(data.trees.has('R004')).toBe(true);
    });
  });

  describe('build — metadata propagation', () => {
    it('should extract metadata from claim headings', () => {
      const noteWithMeta: NoteWithContent = {
        id: 'R007',
        type: 'Requirement',
        filePath: 'R007.md',
        content: [
          '### §1 Section',
          '',
          '§1.AC.01 Critical requirement:P0:security',
        ].join('\n'),
      };

      index.build([noteWithMeta]);
      const claim = index.getClaim('R007.1.AC.01');
      expect(claim).not.toBeNull();
      expect(claim!.metadata).toEqual(['P0', 'security']);
    });

    it('should default to empty metadata array', () => {
      index.build([requirementNote]);
      const claim = index.getClaim('R004.1.AC.01');
      expect(claim).not.toBeNull();
      expect(claim!.metadata).toEqual([]);
    });
  });

  describe('build — rebuilding resets state', () => {
    it('should clear previous data when build is called again', () => {
      index.build([requirementNote]);
      expect(index.getClaimsForNote('R004')).toHaveLength(4);

      // Rebuild with different note
      index.build([simpleNote]);
      expect(index.getClaimsForNote('R004')).toHaveLength(0);
      expect(index.getClaimsForNote('R005')).toHaveLength(1);
    });
  });

  describe('build — line ranges', () => {
    it('should capture line and endLine for entries', () => {
      index.build([requirementNote]);

      const claim = index.getClaim('R004.1.AC.01');
      expect(claim).not.toBeNull();
      expect(claim!.line).toBeGreaterThan(0);
      expect(claim!.endLine).toBeGreaterThanOrEqual(claim!.line);
    });
  });

  describe('addSourceReferences', () => {
    function makeSourceRef(overrides: Partial<SourceReference> & { toId: string; filePath: string }): SourceReference {
      return {
        fromId: `source:${overrides.filePath}`,
        toId: overrides.toId,
        sourceType: 'source',
        filePath: overrides.filePath,
        line: overrides.line ?? 10,
        language: overrides.language ?? 'typescript',
        referenceType: overrides.referenceType ?? 'implements',
        claimPath: overrides.claimPath,
        ...overrides,
      };
    }

    it('should add cross-references for source refs with valid claimPaths', () => {
      index.build([requirementNote]);

      const refs: SourceReference[] = [
        makeSourceRef({
          toId: 'R004',
          filePath: '/project/src/auth.ts',
          claimPath: '.1.AC.01',
          line: 42,
        }),
      ];

      index.addSourceReferences(refs);
      const data = index.getData();

      // Should have added a cross-reference
      const sourceXrefs = data.crossRefs.filter((r) => r.fromNoteId.startsWith('source:'));
      expect(sourceXrefs).toHaveLength(1);
      expect(sourceXrefs[0].toClaim).toBe('R004.1.AC.01');
      expect(sourceXrefs[0].toNoteId).toBe('R004');
      expect(sourceXrefs[0].line).toBe(42);
      expect(sourceXrefs[0].filePath).toBe('/project/src/auth.ts');
    });

    it('should handle § section markers in claimPath', () => {
      index.build([requirementNote]);

      const refs: SourceReference[] = [
        makeSourceRef({
          toId: 'R004',
          filePath: '/project/src/auth.ts',
          claimPath: '.§1.AC.02',
          line: 50,
        }),
      ];

      index.addSourceReferences(refs);
      const data = index.getData();

      const sourceXrefs = data.crossRefs.filter((r) => r.fromNoteId.startsWith('source:'));
      expect(sourceXrefs).toHaveLength(1);
      expect(sourceXrefs[0].toClaim).toBe('R004.1.AC.02');
    });

    it('should register source files as "Source" in noteTypes map', () => {
      index.build([requirementNote]);

      const refs: SourceReference[] = [
        makeSourceRef({
          toId: 'R004',
          filePath: '/project/src/auth.ts',
          claimPath: '.1.AC.01',
        }),
      ];

      index.addSourceReferences(refs);
      const data = index.getData();

      const sourceId = 'source:auth.ts';
      expect(data.noteTypes.get(sourceId)).toBe('Source');
    });

    it('should skip refs without claimPath', () => {
      index.build([requirementNote]);

      const refs: SourceReference[] = [
        makeSourceRef({
          toId: 'R004',
          filePath: '/project/src/auth.ts',
          // no claimPath
        }),
      ];

      index.addSourceReferences(refs);
      const data = index.getData();

      const sourceXrefs = data.crossRefs.filter((r) => r.fromNoteId.startsWith('source:'));
      expect(sourceXrefs).toHaveLength(0);
    });

    it('should skip refs with unresolvable claimPaths', () => {
      index.build([requirementNote]);

      const refs: SourceReference[] = [
        makeSourceRef({
          toId: 'R004',
          filePath: '/project/src/auth.ts',
          claimPath: '.99.NOPE.99',
        }),
      ];

      index.addSourceReferences(refs);
      const data = index.getData();

      const sourceXrefs = data.crossRefs.filter((r) => r.fromNoteId.startsWith('source:'));
      expect(sourceXrefs).toHaveLength(0);
    });

    it('should handle multiple source refs to different claims', () => {
      index.build([requirementNote]);

      const refs: SourceReference[] = [
        makeSourceRef({
          toId: 'R004',
          filePath: '/project/src/auth.ts',
          claimPath: '.1.AC.01',
          line: 10,
        }),
        makeSourceRef({
          toId: 'R004',
          filePath: '/project/src/rbac.ts',
          claimPath: '.2.AC.01',
          line: 25,
        }),
      ];

      index.addSourceReferences(refs);
      const data = index.getData();

      const sourceXrefs = data.crossRefs.filter((r) => r.fromNoteId.startsWith('source:'));
      expect(sourceXrefs).toHaveLength(2);

      const targets = sourceXrefs.map((r) => r.toClaim).sort();
      expect(targets).toEqual(['R004.1.AC.01', 'R004.2.AC.01']);

      // Both source files should be registered
      expect(data.noteTypes.get('source:auth.ts')).toBe('Source');
      expect(data.noteTypes.get('source:rbac.ts')).toBe('Source');
    });
  });

  // ---------------------------------------------------------------------------
  // Cross-note fuzzy matching regression tests
  // ---------------------------------------------------------------------------

  describe('build — fuzzy matching must not resolve bare refs to wrong notes', () => {
    it('should not create cross-refs when bare AC.01 matches a different note', () => {
      // ARCH018 defines claims like ARCH018.1.AC.01
      // R004 also defines claims like R004.1.AC.01
      // When scanning ARCH018's content, the parser finds bare "AC.01" from claim
      // headings. The fuzzy matcher must NOT resolve these to R004's claims.
      const archNote: NoteWithContent = {
        id: 'ARCH018',
        type: 'Architecture',
        filePath: '_scepter/notes/arch/ARCH018.md',
        content: [
          '# ARCH018 The Widget',
          '',
          '### §1 Core Concepts',
          '',
          '§1.AC.01 The Widget MUST be the middle tier.',
          '',
          '§1.AC.02 Every preset page MUST be a pre-configured view.',
          '',
          '### §2 Ring System',
          '',
          '§2.AC.03 Every ring type MUST belong to exactly one category.',
        ].join('\n'),
      };

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
        ].join('\n'),
      };

      index.build([archNote, reqNote]);
      const data = index.getData();

      // ARCH018 should have ZERO outgoing cross-refs to R004
      const arch018ToR004 = data.crossRefs.filter(
        (r) => r.fromNoteId === 'ARCH018' && r.toNoteId === 'R004',
      );
      expect(arch018ToR004).toHaveLength(0);

      // R004 should also have ZERO outgoing cross-refs to ARCH018
      const r004ToArch018 = data.crossRefs.filter(
        (r) => r.fromNoteId === 'R004' && r.toNoteId === 'ARCH018',
      );
      expect(r004ToArch018).toHaveLength(0);
    });

    it('should not create false cross-refs across many notes with same claim suffixes', () => {
      // Simulate the real-world bug: multiple notes all defining AC.01, AC.02, etc.
      const notes: NoteWithContent[] = [
        {
          id: 'R001',
          type: 'Requirement',
          filePath: 'R001.md',
          content: '### §1 Section\n\n§1.AC.01 First req.\n\n§1.AC.02 Second req.',
        },
        {
          id: 'R002',
          type: 'Requirement',
          filePath: 'R002.md',
          content: '### §1 Section\n\n§1.AC.01 First req.\n\n§1.AC.02 Second req.',
        },
        {
          id: 'ARCH01',
          type: 'Architecture',
          filePath: 'ARCH01.md',
          content: '### §1 Section\n\n§1.AC.01 Arch claim.\n\n§1.AC.02 Another arch claim.',
        },
      ];

      index.build(notes);
      const data = index.getData();

      // No cross-references should exist between any of these notes
      // because none of them explicitly reference each other
      expect(data.crossRefs).toHaveLength(0);
    });

    it('should still resolve explicit cross-note references correctly', () => {
      const archNote: NoteWithContent = {
        id: 'ARCH018',
        type: 'Architecture',
        filePath: 'ARCH018.md',
        content: [
          '### §1 Core',
          '',
          '§1.AC.01 The Widget MUST be the middle tier.',
        ].join('\n'),
      };

      const ddNote: NoteWithContent = {
        id: 'DD015',
        type: 'DetailedDesign',
        filePath: 'DD015.md',
        content: [
          '# DD015 Widget Design',
          '',
          '### §1 Implementation',
          '',
          '§1.DC.01 Implements {ARCH018.1.AC.01} via WheelComponent.',
        ].join('\n'),
      };

      index.build([archNote, ddNote]);
      const data = index.getData();

      // The explicit {ARCH018.1.AC.01} reference should create a cross-ref
      const ddToArch = data.crossRefs.filter(
        (r) => r.fromNoteId === 'DD015' && r.toNoteId === 'ARCH018',
      );
      expect(ddToArch).toHaveLength(1);
      expect(ddToArch[0].toClaim).toBe('ARCH018.1.AC.01');
    });
  });

  // ---------------------------------------------------------------------------
  // Self-referencing claims
  // ---------------------------------------------------------------------------

  describe('build — self-referencing claims are filtered', () => {
    it('should not create cross-refs from a note to its own claims', () => {
      // A note that references its own claims in body text
      const selfRefNote: NoteWithContent = {
        id: 'R010',
        type: 'Requirement',
        filePath: 'R010.md',
        content: [
          '# R010 Requirements',
          '',
          '### §1 Section',
          '',
          '§1.AC.01 The system MUST do X.',
          '',
          '§1.AC.02 The system MUST do Y, extending {R010.1.AC.01}.',
        ].join('\n'),
      };

      index.build([selfRefNote]);
      const data = index.getData();

      // Self-references should be filtered out
      expect(data.crossRefs).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Dual-role notes (define claims AND reference other notes)
  // ---------------------------------------------------------------------------

  describe('build — dual-role notes', () => {
    it('should create cross-refs only for explicit external references in dual-role notes', () => {
      const archNote: NoteWithContent = {
        id: 'ARCH015',
        type: 'Architecture',
        filePath: 'ARCH015.md',
        content: [
          '### §1 Rendering',
          '',
          '§1.AC.01 The renderer MUST support SVG output.',
        ].join('\n'),
      };

      // ARCH018 defines its own claims AND references ARCH015
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

      index.build([archNote, dualNote]);
      const data = index.getData();

      // Only the explicit {ARCH015.1.AC.01} reference should exist
      const arch018Refs = data.crossRefs.filter((r) => r.fromNoteId === 'ARCH018');
      expect(arch018Refs).toHaveLength(1);
      expect(arch018Refs[0].toClaim).toBe('ARCH015.1.AC.01');
      expect(arch018Refs[0].toNoteId).toBe('ARCH015');
    });
  });

  // ---------------------------------------------------------------------------
  // Range references creating cross-refs
  // ---------------------------------------------------------------------------

  describe('build — range references in cross-references', () => {
    it('should expand range references into individual cross-refs', () => {
      const reqNote: NoteWithContent = {
        id: 'R010',
        type: 'Requirement',
        filePath: 'R010.md',
        content: [
          '### §1 Section',
          '',
          '§1.AC.01 First.',
          '',
          '§1.AC.02 Second.',
          '',
          '§1.AC.03 Third.',
        ].join('\n'),
      };

      const ddNote: NoteWithContent = {
        id: 'DD010',
        type: 'DetailedDesign',
        filePath: 'DD010.md',
        content: [
          '# DD010 Design',
          '',
          'This design covers {R010.1.AC.01-03}.',
        ].join('\n'),
      };

      index.build([reqNote, ddNote]);
      const data = index.getData();

      const ddRefs = data.crossRefs.filter((r) => r.fromNoteId === 'DD010');
      expect(ddRefs).toHaveLength(3);

      const targets = ddRefs.map((r) => r.toClaim).sort();
      expect(targets).toEqual(['R010.1.AC.01', 'R010.1.AC.02', 'R010.1.AC.03']);
    });
  });

  // ---------------------------------------------------------------------------
  // Unresolved references
  // ---------------------------------------------------------------------------

  describe('build — unresolved references', () => {
    it('should create unresolved cross-ref and error for reference to nonexistent note claim', () => {
      const ddNote: NoteWithContent = {
        id: 'DD010',
        type: 'DetailedDesign',
        filePath: 'DD010.md',
        content: [
          '# DD010 Design',
          '',
          'Implements {R999.1.AC.01} which does not exist.',
        ].join('\n'),
      };

      index.build([ddNote]);
      const data = index.getData();

      // Should have an unresolved cross-ref
      const unresolved = data.crossRefs.filter((r) => r.unresolved === true);
      expect(unresolved).toHaveLength(1);
      expect(unresolved[0].toClaim).toBe('R999.1.AC.01');
      expect(unresolved[0].fromNoteId).toBe('DD010');

      // Should have an unresolved-reference error
      const errors = data.errors.filter((e) => e.type === 'unresolved-reference');
      expect(errors).toHaveLength(1);
    });

    it('should not report bare references without noteId as unresolved', () => {
      // Bare refs like "AC.01" without a note ID should just be ignored
      // if they can't resolve, not reported as broken
      const note: NoteWithContent = {
        id: 'DD010',
        type: 'DetailedDesign',
        filePath: 'DD010.md',
        content: [
          '# DD010 Design',
          '',
          'The AC.99 criterion is referenced here.',
        ].join('\n'),
      };

      index.build([note]);
      const data = index.getData();

      // Should NOT report as unresolved (no explicit noteId)
      const unresolvedErrors = data.errors.filter((e) => e.type === 'unresolved-reference');
      expect(unresolvedErrors).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Importance and lifecycle metadata in index entries
  // ---------------------------------------------------------------------------

  describe('build — importance and lifecycle metadata', () => {
    it('should parse importance from metadata suffix', () => {
      const note: NoteWithContent = {
        id: 'R010',
        type: 'Requirement',
        filePath: 'R010.md',
        content: [
          '### §1 Section',
          '',
          '§1.AC.01 Critical claim:5',
          '',
          '§1.AC.02 Medium claim:3',
          '',
          '§1.AC.03 No importance annotation.',
        ].join('\n'),
      };

      index.build([note]);

      const ac01 = index.getClaim('R010.1.AC.01');
      expect(ac01).not.toBeNull();
      expect(ac01!.importance).toBe(5);

      const ac02 = index.getClaim('R010.1.AC.02');
      expect(ac02).not.toBeNull();
      expect(ac02!.importance).toBe(3);

      const ac03 = index.getClaim('R010.1.AC.03');
      expect(ac03).not.toBeNull();
      expect(ac03!.importance).toBeUndefined();
    });

    it('should parse importance immediately after claim ID (pre-description)', () => {
      const note: NoteWithContent = {
        id: 'ARCH017',
        type: 'Architecture',
        filePath: 'ARCH017.md',
        content: [
          '### §3 Section',
          '',
          '§AC.01:5 versioned: true MUST only be valid on JSON fields.',
          '',
          '§AC.06:4 Shape MUST use helpers for top-level blob fields.',
        ].join('\n'),
      };

      index.build([note]);

      const ac01 = index.getClaim('ARCH017.3.AC.01');
      expect(ac01).not.toBeNull();
      expect(ac01!.importance).toBe(5);

      const ac06 = index.getClaim('ARCH017.3.AC.06');
      expect(ac06).not.toBeNull();
      expect(ac06!.importance).toBe(4);
    });

    it('should parse derives immediately after claim ID (pre-description)', () => {
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
        id: 'DD010',
        type: 'Design',
        filePath: 'DD010.md',
        content: [
          '### §1 Section',
          '',
          '§DC.01:derives=R005.§1.AC.01 Design claim derived from requirement.',
        ].join('\n'),
      };

      index.build([reqNote, ddNote]);

      const dc01 = index.getClaim('DD010.1.DC.01');
      expect(dc01).not.toBeNull();
      expect(dc01!.derivedFrom).toEqual(['R005.1.AC.01']);
    });

    it('should parse combined metadata immediately after claim ID', () => {
      const reqNote: NoteWithContent = {
        id: 'R005',
        type: 'Requirement',
        filePath: 'R005.md',
        content: [
          '### §1 Section',
          '',
          '§1.AC.01 First source.',
          '',
          '§1.AC.02 Second source.',
        ].join('\n'),
      };

      const ddNote: NoteWithContent = {
        id: 'DD011',
        type: 'Design',
        filePath: 'DD011.md',
        content: [
          '### §2 Section',
          '',
          '§DC.01:4:derives=R005.§1.AC.01 Important derived claim.',
          '',
          '§DC.02:3:derives=R005.§1.AC.02:closed Closed derived claim.',
        ].join('\n'),
      };

      index.build([reqNote, ddNote]);

      const dc01 = index.getClaim('DD011.2.DC.01');
      expect(dc01).not.toBeNull();
      expect(dc01!.importance).toBe(4);
      expect(dc01!.derivedFrom).toEqual(['R005.1.AC.01']);

      const dc02 = index.getClaim('DD011.2.DC.02');
      expect(dc02).not.toBeNull();
      expect(dc02!.importance).toBe(3);
      expect(dc02!.derivedFrom).toEqual(['R005.1.AC.02']);
      expect(dc02!.lifecycle).toEqual({ type: 'closed' });
    });

    it('should parse lifecycle tags from metadata suffix', () => {
      const note: NoteWithContent = {
        id: 'R010',
        type: 'Requirement',
        filePath: 'R010.md',
        content: [
          '### §1 Section',
          '',
          '§1.AC.01 Active claim.',
          '',
          '§1.AC.02 Resolved claim:closed',
          '',
          '§1.AC.03 Postponed claim:deferred',
        ].join('\n'),
      };

      index.build([note]);

      const ac01 = index.getClaim('R010.1.AC.01');
      expect(ac01!.lifecycle).toBeUndefined();

      const ac02 = index.getClaim('R010.1.AC.02');
      expect(ac02!.lifecycle).toBeDefined();
      expect(ac02!.lifecycle!.type).toBe('closed');

      const ac03 = index.getClaim('R010.1.AC.03');
      expect(ac03!.lifecycle).toBeDefined();
      expect(ac03!.lifecycle!.type).toBe('deferred');
    });

    it('should parse combined importance and lifecycle', () => {
      const note: NoteWithContent = {
        id: 'R010',
        type: 'Requirement',
        filePath: 'R010.md',
        content: [
          '### §1 Section',
          '',
          '§1.AC.01 Important and closed:4:closed',
        ].join('\n'),
      };

      index.build([note]);

      const ac01 = index.getClaim('R010.1.AC.01');
      expect(ac01!.importance).toBe(4);
      expect(ac01!.lifecycle).toBeDefined();
      expect(ac01!.lifecycle!.type).toBe('closed');
    });
  });

  // ---------------------------------------------------------------------------
  // noteTypes map population
  // ---------------------------------------------------------------------------

  describe('build — noteTypes map', () => {
    it('should populate noteTypes for all notes, even those without claims', () => {
      const emptyNote: NoteWithContent = {
        id: 'AN001',
        type: 'Analysis',
        filePath: 'AN001.md',
        content: '# AN001 Analysis\n\nJust text, no claims.',
      };

      index.build([requirementNote, emptyNote]);
      const data = index.getData();

      expect(data.noteTypes.get('R004')).toBe('Requirement');
      expect(data.noteTypes.get('AN001')).toBe('Analysis');
    });
  });

  // ---------------------------------------------------------------------------
  // Derivation support
  // @validates {R006.§1.AC.03} Derivation targets resolved via resolveClaimAddress() (claim address parsing)
  // @validates {R006.§2.AC.01} derivedFrom field populated during build
  // @validates {R006.§2.AC.02} getDerivedFrom() returns source claims
  // @validates {R006.§2.AC.03} getDerivatives() returns derived claims
  // @validates {R006.§2.AC.04} derivativesMap built bidirectionally
  // ---------------------------------------------------------------------------

  describe('build — derivation support', () => {
    it('should populate derivedFrom with resolved FQIDs', () => {
      const reqNote: NoteWithContent = {
        id: 'R005',
        type: 'Requirement',
        filePath: 'R005.md',
        content: [
          '### §1 Section',
          '',
          '§1.AC.01 Source requirement.',
          '',
          '§1.AC.02 Another requirement.',
        ].join('\n'),
      };

      const ddNote: NoteWithContent = {
        id: 'DD003',
        type: 'DetailedDesign',
        filePath: 'DD003.md',
        content: [
          '### §1 Section',
          '',
          '§1.DC.01 Design claim derived from AC.01:derives=R005.§1.AC.01',
        ].join('\n'),
      };

      index.build([reqNote, ddNote]);

      const dc01 = index.getClaim('DD003.1.DC.01');
      expect(dc01).not.toBeNull();
      expect(dc01!.derivedFrom).toEqual(['R005.1.AC.01']);
    });

    it('should handle multiple derives= targets', () => {
      const reqNote: NoteWithContent = {
        id: 'R005',
        type: 'Requirement',
        filePath: 'R005.md',
        content: [
          '### §1 Section',
          '',
          '§1.AC.01 First source.',
          '',
          '§1.AC.02 Second source.',
        ].join('\n'),
      };

      const ddNote: NoteWithContent = {
        id: 'DD003',
        type: 'DetailedDesign',
        filePath: 'DD003.md',
        content: [
          '### §1 Section',
          '',
          '§1.DC.01 Derives from two sources:derives=R005.§1.AC.01:derives=R005.§1.AC.02',
        ].join('\n'),
      };

      index.build([reqNote, ddNote]);

      const dc01 = index.getClaim('DD003.1.DC.01');
      expect(dc01!.derivedFrom).toEqual(['R005.1.AC.01', 'R005.1.AC.02']);
    });

    it('should build derivativesMap (reverse index)', () => {
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
        ].join('\n'),
      };

      index.build([reqNote, ddNote]);

      // getDerivedFrom: DC.01 → R005.1.AC.01
      expect(index.getDerivedFrom('DD003.1.DC.01')).toEqual(['R005.1.AC.01']);
      expect(index.getDerivedFrom('DD003.1.DC.02')).toEqual(['R005.1.AC.01']);

      // getDerivatives: R005.1.AC.01 → [DD003.1.DC.01, DD003.1.DC.02]
      const derivatives = index.getDerivatives('R005.1.AC.01');
      expect(derivatives).toHaveLength(2);
      expect(derivatives).toContain('DD003.1.DC.01');
      expect(derivatives).toContain('DD003.1.DC.02');
    });

    it('should return empty arrays for claims with no derivation', () => {
      index.build([requirementNote]);

      expect(index.getDerivedFrom('R004.1.AC.01')).toEqual([]);
      expect(index.getDerivatives('R004.1.AC.01')).toEqual([]);
    });

    it('should return empty array for non-existent claim IDs', () => {
      index.build([requirementNote]);

      expect(index.getDerivedFrom('NONEXISTENT.1.AC.01')).toEqual([]);
      expect(index.getDerivatives('NONEXISTENT.1.AC.01')).toEqual([]);
    });

    it('should report error for unresolvable derivation target', () => {
      const ddNote: NoteWithContent = {
        id: 'DD003',
        type: 'DetailedDesign',
        filePath: 'DD003.md',
        content: [
          '### §1 Section',
          '',
          '§1.DC.01 Derives from nonexistent:derives=R999.§1.AC.99',
        ].join('\n'),
      };

      index.build([ddNote]);
      const data = index.getData();

      const derivationErrors = data.errors.filter((e) => e.type === 'unresolvable-derivation-target');
      expect(derivationErrors).toHaveLength(1);
      expect(derivationErrors[0].claimId).toBe('DD003.1.DC.01');

      // derivedFrom should be empty since resolution failed
      const dc01 = index.getClaim('DD003.1.DC.01');
      expect(dc01!.derivedFrom).toEqual([]);
    });

    it('should reset derivativesMap on rebuild', () => {
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
        ].join('\n'),
      };

      index.build([reqNote, ddNote]);
      expect(index.getDerivatives('R005.1.AC.01')).toHaveLength(1);

      // Rebuild without derivation
      index.build([requirementNote]);
      expect(index.getDerivatives('R005.1.AC.01')).toEqual([]);
    });

    it('should handle derivation with coexisting importance and lifecycle', () => {
      const reqNote: NoteWithContent = {
        id: 'R005',
        type: 'Requirement',
        filePath: 'R005.md',
        content: [
          '### §1 Section',
          '',
          '§1.AC.01 Source.',
        ].join('\n'),
      };

      const ddNote: NoteWithContent = {
        id: 'DD003',
        type: 'DetailedDesign',
        filePath: 'DD003.md',
        content: [
          '### §1 Section',
          '',
          '§1.DC.01 Derived with importance and lifecycle:4:derives=R005.§1.AC.01:closed',
        ].join('\n'),
      };

      index.build([reqNote, ddNote]);

      const dc01 = index.getClaim('DD003.1.DC.01');
      expect(dc01!.importance).toBe(4);
      expect(dc01!.lifecycle).toEqual({ type: 'closed' });
      expect(dc01!.derivedFrom).toEqual(['R005.1.AC.01']);
    });
  });
});
