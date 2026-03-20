/**
 * Tests for derivation validation logic.
 *
 * Tests validateDerivationLinks() which checks 8 derivation-related error/warning types.
 * Uses real ClaimIndex builds to create realistic index states for validation.
 *
 * @validates {R006.§5.AC.01} invalid-derivation-target detection, self-derivation
 * @validates {R006.§5.AC.02} deep-derivation-chain, circular-derivation detection
 * @validates {R006.§5.AC.03} partial-derivation-coverage detection
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ClaimIndex } from '../claim-index';
import type { NoteWithContent } from '../claim-index';
import type { SourceReference } from '../../types/reference';
import { validateDerivationLinks } from '../../cli/commands/claims/lint-command';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSourceRef(toId: string, filePath: string, claimPath: string, line: number = 10): SourceReference {
  return {
    fromId: `source:${filePath}`,
    toId,
    sourceType: 'source',
    filePath: `/project/src/${filePath}`,
    line,
    language: 'typescript',
    referenceType: 'implements',
    claimPath,
  };
}

// ---------------------------------------------------------------------------
// Check 1: invalid-derivation-target
// @validates {R006.§5.AC.01}
// ---------------------------------------------------------------------------

describe('validateDerivationLinks — invalid-derivation-target', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('should produce no derivation errors for valid derivation', () => {
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
        '§1.DC.01 Valid derivation:derives=R005.§1.AC.01',
      ].join('\n'),
    };

    const data = index.build([reqNote, ddNote]);
    const errors = validateDerivationLinks('DD003', data, index);

    const derivationErrors = errors.filter((e) =>
      e.type === 'invalid-derivation-target' ||
      e.type === 'self-derivation' ||
      e.type === 'circular-derivation' ||
      e.type === 'derives-superseded-conflict',
    );
    expect(derivationErrors).toHaveLength(0);
  });

  it('should report error for unresolvable derivation target', () => {
    // The index builder already catches unresolvable targets and clears derivedFrom,
    // so the lint check sees an empty derivedFrom. This test verifies the index-level
    // error is produced.
    const ddNote: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 Bad derivation:derives=R999.§1.AC.99',
      ].join('\n'),
    };

    const data = index.build([ddNote]);

    // The index builder produces unresolvable-derivation-target errors
    const indexErrors = data.errors.filter((e) => e.type === 'unresolvable-derivation-target');
    expect(indexErrors).toHaveLength(1);
    expect(indexErrors[0].claimId).toBe('DD003.1.DC.01');
  });
});

// ---------------------------------------------------------------------------
// Check 5: self-derivation
// @validates {R006.§5.AC.01}
// ---------------------------------------------------------------------------

describe('validateDerivationLinks — self-derivation', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('should detect self-derivation', () => {
    // A claim that derives from itself. Since the target resolves to the same FQID,
    // the lint check catches it.
    const note: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 Self-referential:derives=DD003.§1.DC.01',
      ].join('\n'),
    };

    const data = index.build([note]);
    const errors = validateDerivationLinks('DD003', data, index);

    const selfErrors = errors.filter((e) => e.type === 'self-derivation');
    expect(selfErrors).toHaveLength(1);
    expect(selfErrors[0].claimId).toBe('DD003.1.DC.01');
  });
});

// ---------------------------------------------------------------------------
// Check 6: derives-superseded-conflict
// @validates {R006.§5.AC.01}
// ---------------------------------------------------------------------------

describe('validateDerivationLinks — derives-superseded-conflict', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('should detect derives + superseded on same claim', () => {
    const reqNote: NoteWithContent = {
      id: 'R005',
      type: 'Requirement',
      filePath: 'R005.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Source.',
        '',
        '§1.AC.02 Replacement.',
      ].join('\n'),
    };

    const ddNote: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '### §1 Section',
        '',
        // Both derives and superseded on same claim
        '§1.DC.01 Conflict:derives=R005.§1.AC.01:superseded=R005.§1.AC.02',
      ].join('\n'),
    };

    const data = index.build([reqNote, ddNote]);
    const errors = validateDerivationLinks('DD003', data, index);

    const conflictErrors = errors.filter((e) => e.type === 'derives-superseded-conflict');
    expect(conflictErrors).toHaveLength(1);
    expect(conflictErrors[0].claimId).toBe('DD003.1.DC.01');
  });

  it('should not flag derives without superseded', () => {
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
        '§1.DC.01 Just derives:derives=R005.§1.AC.01',
      ].join('\n'),
    };

    const data = index.build([reqNote, ddNote]);
    const errors = validateDerivationLinks('DD003', data, index);

    const conflictErrors = errors.filter((e) => e.type === 'derives-superseded-conflict');
    expect(conflictErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Check 7: derivation-from-removed
// @validates {R006.§5.AC.01}
// ---------------------------------------------------------------------------

describe('validateDerivationLinks — derivation-from-removed', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('should warn when deriving from a :removed claim', () => {
    const reqNote: NoteWithContent = {
      id: 'R005',
      type: 'Requirement',
      filePath: 'R005.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Removed source:removed',
      ].join('\n'),
    };

    const ddNote: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 Derives from removed:derives=R005.§1.AC.01',
      ].join('\n'),
    };

    const data = index.build([reqNote, ddNote]);
    const errors = validateDerivationLinks('DD003', data, index);

    const removedErrors = errors.filter((e) => e.type === 'derivation-from-removed');
    expect(removedErrors).toHaveLength(1);
    expect(removedErrors[0].message).toContain(':removed');
  });
});

// ---------------------------------------------------------------------------
// Check 8: derivation-from-superseded
// @validates {R006.§5.AC.01}
// ---------------------------------------------------------------------------

describe('validateDerivationLinks — derivation-from-superseded', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('should warn when deriving from a :superseded claim', () => {
    const reqNote: NoteWithContent = {
      id: 'R005',
      type: 'Requirement',
      filePath: 'R005.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Superseded source:superseded=R005.§1.AC.02',
        '',
        '§1.AC.02 Replacement.',
      ].join('\n'),
    };

    const ddNote: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 Derives from superseded:derives=R005.§1.AC.01',
      ].join('\n'),
    };

    const data = index.build([reqNote, ddNote]);
    const errors = validateDerivationLinks('DD003', data, index);

    const supersededErrors = errors.filter((e) => e.type === 'derivation-from-superseded');
    expect(supersededErrors).toHaveLength(1);
    expect(supersededErrors[0].message).toContain(':superseded');
    expect(supersededErrors[0].message).toContain('re-deriving');
  });
});

// ---------------------------------------------------------------------------
// Check 2: deep-derivation-chain
// @validates {R006.§5.AC.02}
// ---------------------------------------------------------------------------

describe('validateDerivationLinks — deep-derivation-chain', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('should not warn for 1-hop derivation chain (ok)', () => {
    // A → B (1 hop)
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
        '§1.DC.01 One hop:derives=R005.§1.AC.01',
      ].join('\n'),
    };

    const data = index.build([reqNote, ddNote]);
    const errors = validateDerivationLinks('DD003', data, index);

    const deepErrors = errors.filter((e) => e.type === 'deep-derivation-chain');
    expect(deepErrors).toHaveLength(0);
  });

  it('should not warn for 2-hop derivation chain (ok)', () => {
    // A → B → C (2 hops from C's perspective)
    const reqNote: NoteWithContent = {
      id: 'R005',
      type: 'Requirement',
      filePath: 'R005.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Root source.',
      ].join('\n'),
    };

    const ddNote: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 Mid-level:derives=R005.§1.AC.01',
      ].join('\n'),
    };

    const implNote: NoteWithContent = {
      id: 'DD004',
      type: 'DetailedDesign',
      filePath: 'DD004.md',
      content: [
        '### §1 Section',
        '',
        '§1.IC.01 Leaf:derives=DD003.§1.DC.01',
      ].join('\n'),
    };

    const data = index.build([reqNote, ddNote, implNote]);
    const errors = validateDerivationLinks('DD004', data, index);

    const deepErrors = errors.filter((e) => e.type === 'deep-derivation-chain');
    expect(deepErrors).toHaveLength(0);
  });

  it('should warn for 3-hop derivation chain (>2 hops)', () => {
    // A → B → C → D (3 hops from D's perspective)
    const noteA: NoteWithContent = {
      id: 'R005',
      type: 'Requirement',
      filePath: 'R005.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Root.',
      ].join('\n'),
    };

    const noteB: NoteWithContent = {
      id: 'DD001',
      type: 'DetailedDesign',
      filePath: 'DD001.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 Level 1:derives=R005.§1.AC.01',
      ].join('\n'),
    };

    const noteC: NoteWithContent = {
      id: 'DD002',
      type: 'DetailedDesign',
      filePath: 'DD002.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 Level 2:derives=DD001.§1.DC.01',
      ].join('\n'),
    };

    const noteD: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 Level 3:derives=DD002.§1.DC.01',
      ].join('\n'),
    };

    const data = index.build([noteA, noteB, noteC, noteD]);
    const errors = validateDerivationLinks('DD003', data, index);

    const deepErrors = errors.filter((e) => e.type === 'deep-derivation-chain');
    expect(deepErrors).toHaveLength(1);
    expect(deepErrors[0].claimId).toBe('DD003.1.DC.01');
    expect(deepErrors[0].message).toContain('deeper than 2 hops');
  });
});

// ---------------------------------------------------------------------------
// Check 4: circular-derivation
// @validates {R006.§5.AC.02}
// ---------------------------------------------------------------------------

describe('validateDerivationLinks — circular-derivation', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('should detect A→B→A cycle', () => {
    // A derives from B, B derives from A
    const noteA: NoteWithContent = {
      id: 'DD001',
      type: 'DetailedDesign',
      filePath: 'DD001.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 Circular A:derives=DD002.§1.DC.01',
      ].join('\n'),
    };

    const noteB: NoteWithContent = {
      id: 'DD002',
      type: 'DetailedDesign',
      filePath: 'DD002.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 Circular B:derives=DD001.§1.DC.01',
      ].join('\n'),
    };

    const data = index.build([noteA, noteB]);

    // Check from DD001's perspective
    const errorsA = validateDerivationLinks('DD001', data, index);
    const circularA = errorsA.filter((e) => e.type === 'circular-derivation');
    expect(circularA).toHaveLength(1);
    expect(circularA[0].message).toContain('circular derivation chain');

    // Check from DD002's perspective too
    const errorsB = validateDerivationLinks('DD002', data, index);
    const circularB = errorsB.filter((e) => e.type === 'circular-derivation');
    expect(circularB).toHaveLength(1);
  });

  it('should detect A→B→C→A cycle (reported as deep-chain since depth > 2)', () => {
    // A 3-node cycle has depth 3, which triggers the deep-chain check before
    // the circular check fires. This is correct: the chain walker hits depth > 2
    // at the same point where it would detect the cycle.
    const noteA: NoteWithContent = {
      id: 'DD001',
      type: 'DetailedDesign',
      filePath: 'DD001.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 Chain A:derives=DD003.§1.DC.01',
      ].join('\n'),
    };

    const noteB: NoteWithContent = {
      id: 'DD002',
      type: 'DetailedDesign',
      filePath: 'DD002.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 Chain B:derives=DD001.§1.DC.01',
      ].join('\n'),
    };

    const noteC: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 Chain C:derives=DD002.§1.DC.01',
      ].join('\n'),
    };

    const data = index.build([noteA, noteB, noteC]);

    // Each note in the cycle sees a chain depth > 2, reported as deep-chain
    const errorsA = validateDerivationLinks('DD001', data, index);
    const chainOrCircular = errorsA.filter((e) =>
      e.type === 'deep-derivation-chain' || e.type === 'circular-derivation',
    );
    expect(chainOrCircular).toHaveLength(1);
    expect(chainOrCircular[0].type).toBe('deep-derivation-chain');

    const errorsC = validateDerivationLinks('DD003', data, index);
    const chainOrCircularC = errorsC.filter((e) =>
      e.type === 'deep-derivation-chain' || e.type === 'circular-derivation',
    );
    expect(chainOrCircularC).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Check 3: partial-derivation-coverage
// @validates {R006.§5.AC.03}
// ---------------------------------------------------------------------------

describe('validateDerivationLinks — partial-derivation-coverage', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('should warn when some but not all derivatives have Source coverage', () => {
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
        '§1.DC.01 Covered derivative:derives=R005.§1.AC.01',
        '',
        '§1.DC.02 Uncovered derivative:derives=R005.§1.AC.01',
        '',
        'References {R005.§1.AC.01} for context.',
      ].join('\n'),
    };

    index.build([reqNote, ddNote]);

    // Only DC.01 has Source coverage
    index.addSourceReferences([
      makeSourceRef('DD003', 'impl.ts', '.1.DC.01'),
    ]);

    const data = index.getData();
    const errors = validateDerivationLinks('R005', data, index);

    const partialErrors = errors.filter((e) => e.type === 'partial-derivation-coverage');
    expect(partialErrors).toHaveLength(1);
    expect(partialErrors[0].claimId).toBe('R005.1.AC.01');
    expect(partialErrors[0].message).toContain('2 derivatives');
    expect(partialErrors[0].message).toContain('only 1');
    expect(partialErrors[0].message).toContain('DD003.1.DC.02');
  });

  it('should not warn when all derivatives have Source coverage', () => {
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
        '§1.DC.01 Derivative A:derives=R005.§1.AC.01',
        '',
        '§1.DC.02 Derivative B:derives=R005.§1.AC.01',
        '',
        'References {R005.§1.AC.01}.',
      ].join('\n'),
    };

    index.build([reqNote, ddNote]);

    // Both have Source coverage
    index.addSourceReferences([
      makeSourceRef('DD003', 'a.ts', '.1.DC.01'),
      makeSourceRef('DD003', 'b.ts', '.1.DC.02'),
    ]);

    const data = index.getData();
    const errors = validateDerivationLinks('R005', data, index);

    const partialErrors = errors.filter((e) => e.type === 'partial-derivation-coverage');
    expect(partialErrors).toHaveLength(0);
  });

  it('should not warn when no derivatives have Source coverage (zero covered is not partial)', () => {
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
        '§1.DC.01 Derivative:derives=R005.§1.AC.01',
        '',
        'References {R005.§1.AC.01}.',
      ].join('\n'),
    };

    index.build([reqNote, ddNote]);
    // No source references at all

    const data = index.getData();
    const errors = validateDerivationLinks('R005', data, index);

    const partialErrors = errors.filter((e) => e.type === 'partial-derivation-coverage');
    expect(partialErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Regression: no false positives for claims without derivation
// ---------------------------------------------------------------------------

describe('validateDerivationLinks — regression: no false positives', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('should produce no derivation errors for non-derived claims', () => {
    const reqNote: NoteWithContent = {
      id: 'R005',
      type: 'Requirement',
      filePath: 'R005.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Normal claim.',
        '',
        '§1.AC.02 Another normal claim:5',
        '',
        '§1.AC.03 Closed claim:closed',
      ].join('\n'),
    };

    const data = index.build([reqNote]);
    const errors = validateDerivationLinks('R005', data, index);

    // Filter to only derivation-related errors
    const derivationTypes = [
      'invalid-derivation-target',
      'deep-derivation-chain',
      'partial-derivation-coverage',
      'circular-derivation',
      'self-derivation',
      'derives-superseded-conflict',
      'derivation-from-removed',
      'derivation-from-superseded',
    ];
    const derivErrors = errors.filter((e) => derivationTypes.includes(e.type));
    expect(derivErrors).toHaveLength(0);
  });
});
