/**
 * @validates {DD005.§DC.21} Thread view showing all claim relationships
 * @validates {DD005.§DC.22} Configurable depth (default 1, depth 0, depth 2)
 * @validates {DD005.§DC.24} JSON-ready tree structure
 * @validates {DD005.§DC.25} Bare note ID threads all claims in a note
 */

import { describe, it, expect } from 'vitest';
import { ClaimIndex } from '../claim-index';
import type { NoteWithContent, ClaimIndexData } from '../claim-index';
import type { VerificationStore } from '../verification-store';
import { buildClaimThread, buildClaimThreadsForNote } from '../claim-thread';
import type { ClaimThreadNode } from '../claim-thread';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Requirement note with two acceptance criteria. */
const requirementNote: NoteWithContent = {
  id: 'R010',
  type: 'Requirement',
  filePath: '_scepter/notes/requirements/R010.md',
  content: [
    '# R010 Feature Requirements',
    '',
    '### §1 Core',
    '',
    '§1.AC.01 The system MUST support widgets.',
    '',
    '§1.AC.02 The system MUST validate widget input.',
  ].join('\n'),
};

/** Design document with claims derived from R010 under section §1. */
const designNote: NoteWithContent = {
  id: 'DD010',
  type: 'DetailedDesign',
  filePath: '_scepter/notes/dd/DD010.md',
  content: [
    '# DD010 Widget Design',
    '',
    '### §1 Widget Engine',
    '',
    '§1.DC.01:derives=R010.§1.AC.01 The WidgetEngine MUST register all widget types.',
    '',
    '§1.DC.02:derives=R010.§1.AC.01 The WidgetEngine MUST emit events on registration.',
  ].join('\n'),
};

/** Spec note referencing R010 claims. */
const specNote: NoteWithContent = {
  id: 'S010',
  type: 'Specification',
  filePath: '_scepter/notes/specs/S010.md',
  content: [
    '# S010 Widget Spec',
    '',
    '### §1 API',
    '',
    '§1.API.01 Widget API per {R010.1.AC.01}.',
    '',
    '§1.API.02 Validation per {R010.1.AC.02}.',
  ].join('\n'),
};

/**
 * Build the test index from notes, optionally adding source references.
 */
function buildTestIndex(notes: NoteWithContent[]): { data: ClaimIndexData; claimIndex: ClaimIndex } {
  const claimIndex = new ClaimIndex();
  const data = claimIndex.build(notes);
  return { data, claimIndex };
}

/**
 * A verification store with an event for R010.1.AC.01.
 */
const testVerificationStore: VerificationStore = {
  'R010.1.AC.01': [
    {
      claimId: 'R010.1.AC.01',
      date: '2026-03-18',
      actor: 'developer',
      method: 'code-review',
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests: buildClaimThread
// ---------------------------------------------------------------------------

describe('buildClaimThread', () => {
  it('returns null for a non-existent claim', () => {
    const { data, claimIndex } = buildTestIndex([requirementNote]);
    const result = buildClaimThread(
      'R010.1.AC.99',
      data,
      claimIndex.getDerivatives.bind(claimIndex),
    );
    expect(result).toBeNull();
  });

  it('builds a root node with correct claim and title', () => {
    const { data, claimIndex } = buildTestIndex([requirementNote]);
    const result = buildClaimThread(
      'R010.1.AC.01',
      data,
      claimIndex.getDerivatives.bind(claimIndex),
    );

    expect(result).not.toBeNull();
    expect(result!.claim).toBe('R010.1.AC.01');
    expect(result!.relationship).toBe('root');
    expect(result!.title).toContain('widgets');
  });

  // @validates {DD005.§DC.22} depth 0 shows only claim metadata
  it('at depth 0, shows only the claim with no relationship children', () => {
    const { data, claimIndex } = buildTestIndex([requirementNote, designNote, specNote]);
    const result = buildClaimThread(
      'R010.1.AC.01',
      data,
      claimIndex.getDerivatives.bind(claimIndex),
      { depth: 0 },
    );

    expect(result).not.toBeNull();
    expect(result!.children).toHaveLength(0);
  });

  // @validates {DD005.§DC.21} Shows derives-into relationships
  it('shows derives-into children for a claim with derivatives', () => {
    const { data, claimIndex } = buildTestIndex([requirementNote, designNote]);
    const result = buildClaimThread(
      'R010.1.AC.01',
      data,
      claimIndex.getDerivatives.bind(claimIndex),
      { depth: 1 },
    );

    expect(result).not.toBeNull();
    const derivesInto = result!.children.filter((c) => c.relationship === 'derives-into');
    expect(derivesInto).toHaveLength(2);
    expect(derivesInto.map((d) => d.claim)).toContain('DD010.1.DC.01');
    expect(derivesInto.map((d) => d.claim)).toContain('DD010.1.DC.02');
  });

  // @validates {DD005.§DC.21} Shows derives-from (upward) relationships
  it('shows derives-from for a derived claim', () => {
    const { data, claimIndex } = buildTestIndex([requirementNote, designNote]);
    const result = buildClaimThread(
      'DD010.1.DC.01',
      data,
      claimIndex.getDerivatives.bind(claimIndex),
      { depth: 1 },
    );

    expect(result).not.toBeNull();
    const derivesFrom = result!.children.filter((c) => c.relationship === 'derives-from');
    expect(derivesFrom).toHaveLength(1);
    expect(derivesFrom[0].claim).toBe('R010.1.AC.01');
  });

  // @validates {DD005.§DC.21} Shows referenced-by (notes) relationships
  it('shows referenced-by for claims with note cross-references', () => {
    const { data, claimIndex } = buildTestIndex([requirementNote, specNote]);
    const result = buildClaimThread(
      'R010.1.AC.01',
      data,
      claimIndex.getDerivatives.bind(claimIndex),
      { depth: 1 },
    );

    expect(result).not.toBeNull();
    const referencedBy = result!.children.filter((c) => c.relationship === 'referenced-by');
    expect(referencedBy.length).toBeGreaterThanOrEqual(1);
    expect(referencedBy.some((r) => r.noteId === 'S010')).toBe(true);
  });

  // @validates {DD005.§DC.21} Shows verified events
  it('shows verification events when store is provided', () => {
    const { data, claimIndex } = buildTestIndex([requirementNote]);
    const result = buildClaimThread(
      'R010.1.AC.01',
      data,
      claimIndex.getDerivatives.bind(claimIndex),
      { depth: 1 },
      testVerificationStore,
    );

    expect(result).not.toBeNull();
    const verified = result!.children.filter((c) => c.relationship === 'verified');
    expect(verified).toHaveLength(1);
    expect(verified[0].actor).toBe('developer');
    expect(verified[0].method).toBe('code-review');
    expect(verified[0].date).toContain('2026-03-18');
  });

  it('does not show verification when store has no events for claim', () => {
    const { data, claimIndex } = buildTestIndex([requirementNote]);
    const result = buildClaimThread(
      'R010.1.AC.02',
      data,
      claimIndex.getDerivatives.bind(claimIndex),
      { depth: 1 },
      testVerificationStore,
    );

    expect(result).not.toBeNull();
    const verified = result!.children.filter((c) => c.relationship === 'verified');
    expect(verified).toHaveLength(0);
  });

  // @validates {DD005.§DC.22} depth 2 recurses into derivative relationships
  it('at depth 2, recurses into derivatives to show their relationships', () => {
    const { data, claimIndex } = buildTestIndex([requirementNote, designNote, specNote]);
    const result = buildClaimThread(
      'R010.1.AC.01',
      data,
      claimIndex.getDerivatives.bind(claimIndex),
      { depth: 2 },
    );

    expect(result).not.toBeNull();
    const derivesInto = result!.children.filter((c) => c.relationship === 'derives-into');
    expect(derivesInto.length).toBeGreaterThan(0);

    // At depth 2, derivative nodes should have their own children populated
    // (e.g., derives-from back to the source claim)
    const firstDerivative = derivesInto[0];
    expect(firstDerivative.children.length).toBeGreaterThan(0);
    // The derivative should show a derives-from back to R010.1.AC.01
    const derivesFromInChild = firstDerivative.children.filter(
      (c) => c.relationship === 'derives-from',
    );
    expect(derivesFromInChild).toHaveLength(1);
    expect(derivesFromInChild[0].claim).toBe('R010.1.AC.01');
  });
});

// ---------------------------------------------------------------------------
// Tests: buildClaimThreadsForNote
// ---------------------------------------------------------------------------

describe('buildClaimThreadsForNote', () => {
  // @validates {DD005.§DC.25} Note-level threading
  it('returns threads for all claims in a note', () => {
    const { data, claimIndex } = buildTestIndex([requirementNote, designNote, specNote]);
    const nodes = buildClaimThreadsForNote(
      'R010',
      data,
      claimIndex.getDerivatives.bind(claimIndex),
      { depth: 1 },
    );

    expect(nodes).toHaveLength(2);
    expect(nodes[0].claim).toBe('R010.1.AC.01');
    expect(nodes[1].claim).toBe('R010.1.AC.02');
  });

  it('returns empty array for a note with no claims', () => {
    const emptyNote: NoteWithContent = {
      id: 'N001',
      type: 'Note',
      filePath: '_scepter/notes/N001.md',
      content: '# N001 Just a Note\n\nSome text without any claims.',
    };
    const { data, claimIndex } = buildTestIndex([emptyNote]);
    const nodes = buildClaimThreadsForNote(
      'N001',
      data,
      claimIndex.getDerivatives.bind(claimIndex),
    );

    expect(nodes).toHaveLength(0);
  });

  it('returns claims sorted by section path and claim number', () => {
    const multiSectionNote: NoteWithContent = {
      id: 'R020',
      type: 'Requirement',
      filePath: '_scepter/notes/requirements/R020.md',
      content: [
        '# R020 Multi-Section',
        '',
        '### §2 Later',
        '',
        '§2.AC.01 Second section claim.',
        '',
        '### §1 First',
        '',
        '§1.AC.01 First section claim.',
        '',
        '§1.AC.02 Another first section claim.',
      ].join('\n'),
    };
    const { data, claimIndex } = buildTestIndex([multiSectionNote]);
    const nodes = buildClaimThreadsForNote(
      'R020',
      data,
      claimIndex.getDerivatives.bind(claimIndex),
    );

    expect(nodes).toHaveLength(3);
    expect(nodes[0].claim).toBe('R020.1.AC.01');
    expect(nodes[1].claim).toBe('R020.1.AC.02');
    expect(nodes[2].claim).toBe('R020.2.AC.01');
  });
});

// ---------------------------------------------------------------------------
// Tests: JSON structure
// ---------------------------------------------------------------------------

describe('claim thread JSON structure', () => {
  // @validates {DD005.§DC.24} JSON tree with required fields
  it('produces nodes with claim, relationship, and children fields', () => {
    const { data, claimIndex } = buildTestIndex([requirementNote, designNote]);
    const result = buildClaimThread(
      'R010.1.AC.01',
      data,
      claimIndex.getDerivatives.bind(claimIndex),
      { depth: 1 },
    );

    expect(result).not.toBeNull();
    expect(result!.claim).toBeDefined();
    expect(result!.relationship).toBeDefined();
    expect(Array.isArray(result!.children)).toBe(true);

    // Check a derivative child has the expected fields
    const derivChild = result!.children.find((c) => c.relationship === 'derives-into');
    expect(derivChild).toBeDefined();
    expect(derivChild!.claim).toBeDefined();
    expect(derivChild!.relationship).toBe('derives-into');
    expect(Array.isArray(derivChild!.children)).toBe(true);
  });

  it('referenced-by nodes include noteId', () => {
    const { data, claimIndex } = buildTestIndex([requirementNote, specNote]);
    const result = buildClaimThread(
      'R010.1.AC.01',
      data,
      claimIndex.getDerivatives.bind(claimIndex),
      { depth: 1 },
    );

    const refNode = result!.children.find((c) => c.relationship === 'referenced-by');
    expect(refNode).toBeDefined();
    expect(refNode!.noteId).toBe('S010');
  });

  it('verified nodes include date, actor, and method', () => {
    const { data, claimIndex } = buildTestIndex([requirementNote]);
    const result = buildClaimThread(
      'R010.1.AC.01',
      data,
      claimIndex.getDerivatives.bind(claimIndex),
      { depth: 1 },
      testVerificationStore,
    );

    const verifiedNode = result!.children.find((c) => c.relationship === 'verified');
    expect(verifiedNode).toBeDefined();
    expect(verifiedNode!.date).toBe('2026-03-18');
    expect(verifiedNode!.actor).toBe('developer');
    expect(verifiedNode!.method).toBe('code-review');
  });
});
