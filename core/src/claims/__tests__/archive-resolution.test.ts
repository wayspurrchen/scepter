/**
 * Tests for archived-note resolution per {DD021.§10.DC.05}, {DD021.§10.DC.06},
 * and {DD021.§10.DC.17}.
 *
 * Covers the three layers of archive-aware behavior:
 *
 * 1. **Index-level (DC.17):** `ClaimIndexEntry.archived` field populated from
 *    `note.tags.includes('archived')` at entry construction.
 * 2. **Resolver-level (DC.05/.06):** `includeArchived` flag controls whether
 *    archived entries are returned as resolved or as the `reference-to-archived`
 *    discrete failure code. The dormant path (`includeArchived: false`) per
 *    §4 Revision 4 mechanical-reachability proof.
 * 3. **Consumer-synthesis (DC.06 via Q12-(c)):** `lint-command.ts`'s
 *    `collectInlineRefArchiveSynthesis()` walks `data.crossRefs` for archived
 *    inline-ref edges and synthesizes BOTH legacy `unresolved-reference` (ERROR)
 *    + new `reference-to-archived` (WARNING) per Q14-(i) parallel-emit and Q7
 *    legacy-first ordering. This is the LINT-OUTPUT-LEVEL invariant
 *    complementing the file #2 INDEX-LEVEL property test (per ISSUE 21
 *    scope-split documentation).
 *
 * @validates {DD021.§10.DC.05} includeArchived flag semantics
 * @validates {DD021.§10.DC.06} reference-to-archived discrete code + (c) synthesis
 * @validates {DD021.§10.DC.17} ClaimIndexEntry.archived field
 * @validates {R015.§1.AC.04a} archived notes stay in-index for resolution
 * @validates {R015.§1.AC.04b} lint downgrades archived-citation to warning
 */

import { describe, it, expect } from 'vitest';
import { ClaimIndex } from '../claim-index';
import type { NoteWithContent, ClaimIndexData } from '../claim-index';
import { resolveReference } from '../reference-resolver';
import { collectInlineRefArchiveSynthesis } from '../../cli/commands/claims/lint-command';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function buildIndex(notes: NoteWithContent[]): ClaimIndexData {
  const idx = new ClaimIndex();
  return idx.build(notes);
}

const archivedNote: NoteWithContent = {
  id: 'R057',
  type: 'Requirement',
  filePath: '_scepter/notes/reqs/R057.md',
  content: [
    '# R057 Archived Note',
    '## §1 Section',
    '§1.AC.08 An archived claim.',
    '§1.AC.09 Another archived claim.',
  ].join('\n'),
  tags: ['archived'],
};

const activeNote: NoteWithContent = {
  id: 'R042',
  type: 'Requirement',
  filePath: '_scepter/notes/reqs/R042.md',
  content: [
    '# R042 Active Note',
    '## §1 Section',
    '§1.AC.01 Active claim.',
  ].join('\n'),
};

const citingNote: NoteWithContent = {
  id: 'S042',
  type: 'Specification',
  filePath: '_scepter/notes/specs/S042.md',
  content: [
    '# S042 Citing Note',
    '## §1 Section',
    '§1.AC.01 Cites archived {R057.§1.AC.08} inline.',
  ].join('\n'),
};

// ---------------------------------------------------------------------------
// DC.17: archived field on ClaimIndexEntry
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.17: ClaimIndexEntry.archived field', () => {
  it('DD021.§10.DC.17: archived note entries have entry.archived === true', () => {
    const data = buildIndex([archivedNote]);
    const entry = data.entries.get('R057.1.AC.08');
    expect(entry).toBeDefined();
    expect(entry?.archived).toBe(true);
  });

  it('DD021.§10.DC.17: non-archived note entries have entry.archived === false', () => {
    const data = buildIndex([activeNote]);
    const entry = data.entries.get('R042.1.AC.01');
    expect(entry).toBeDefined();
    expect(entry?.archived).toBe(false);
  });

  it('DD021.§10.DC.17: archived field is populated from note.tags.includes(\'archived\')', () => {
    const data = buildIndex([archivedNote, activeNote]);
    const r057_AC08 = data.entries.get('R057.1.AC.08');
    const r057_AC09 = data.entries.get('R057.1.AC.09');
    const r042_AC01 = data.entries.get('R042.1.AC.01');
    expect(r057_AC08?.archived).toBe(true);
    expect(r057_AC09?.archived).toBe(true);
    expect(r042_AC01?.archived).toBe(false);
  });

  it('R015.§1.AC.04a: archived note entries STAY IN INDEX for resolution', () => {
    // Per R015.§1.AC.04a: "the claim index MUST keep archived notes in-index
    // for resolution purposes." Verify archived note's entries are present
    // and queryable.
    const data = buildIndex([archivedNote]);
    expect(data.entries.size).toBe(2); // both R057.§1.AC.08 and R057.§1.AC.09
    expect(data.entries.has('R057.1.AC.08')).toBe(true);
    expect(data.entries.has('R057.1.AC.09')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DC.05: includeArchived flag
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.05: includeArchived flag', () => {
  it('DD021.§10.DC.05: includeArchived=true (default) on archived target returns resolved + entry.archived flag', () => {
    const data = buildIndex([archivedNote]);
    const outcome = resolveReference('R057.1.AC.08', data, { includeArchived: true });
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind === 'resolved') {
      expect(outcome.canonicalId).toBe('R057.1.AC.08');
      expect(outcome.entry.archived).toBe(true);
    }
  });

  it('DD021.§10.DC.05: includeArchived=false on archived target returns unresolved + reference-to-archived (dormant path)', () => {
    // §4 Revision 4 mechanical-reachability proof: the resolver MUST emit
    // reference-to-archived when the consumer treats archived as failure.
    // No active consumer in this cycle uses includeArchived: false (per
    // Q12-(c) disposition: consumers default true, lint synthesizes from
    // resolved-edge attribute), but the code path MUST be reachable.
    const data = buildIndex([archivedNote]);
    const outcome = resolveReference('R057.1.AC.08', data, { includeArchived: false });
    expect(outcome.kind).toBe('unresolved');
    if (outcome.kind === 'unresolved') {
      expect(outcome.code).toBe('reference-to-archived');
      expect(outcome.detail).toBe('R057.1.AC.08');
    }
  });

  it('DD021.§10.DC.05: includeArchived defaults to true', () => {
    const data = buildIndex([archivedNote]);
    // Calling with no opts at all should default includeArchived to true.
    const outcome = resolveReference('R057.1.AC.08', data);
    expect(outcome.kind).toBe('resolved');
  });

  it('DD021.§10.DC.05: includeArchived=false does NOT affect non-archived targets', () => {
    const data = buildIndex([activeNote]);
    const outcome = resolveReference('R042.1.AC.01', data, { includeArchived: false });
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind === 'resolved') {
      expect(outcome.entry.archived).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// DC.06: reference-to-archived discrete code
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.06: reference-to-archived discrete code', () => {
  it('DD021.§10.DC.06: reference-to-archived is distinct from reference-to-unknown-note', () => {
    const data = buildIndex([archivedNote]);
    // Same input shape (valid FQID), different states:
    // - R057.§1.AC.08 → archived (in index) + includeArchived: false → reference-to-archived
    // - DEF999.§1.AC.01 → unknown (not in index) + includeArchived: false → reference-to-unknown-note
    const archivedOutcome = resolveReference('R057.1.AC.08', data, { includeArchived: false });
    const unknownOutcome = resolveReference('DEF999.1.AC.01', data, { includeArchived: false });
    expect(archivedOutcome.kind).toBe('unresolved');
    expect(unknownOutcome.kind).toBe('unresolved');
    if (archivedOutcome.kind === 'unresolved' && unknownOutcome.kind === 'unresolved') {
      expect(archivedOutcome.code).toBe('reference-to-archived');
      expect(unknownOutcome.code).toBe('reference-to-unknown-note');
      expect(archivedOutcome.code).not.toBe(unknownOutcome.code);
    }
  });

  it('DD021.§10.DC.06: reference-to-archived is distinct from reference-to-undefined-claim', () => {
    const data = buildIndex([archivedNote]);
    // - R057.§1.AC.08 → archived (in index, claim exists) → reference-to-archived (with includeArchived: false)
    // - R057.§9.AC.99 → archived note exists but claim suffix not defined → reference-to-undefined-claim
    const archivedOutcome = resolveReference('R057.1.AC.08', data, { includeArchived: false });
    const undefinedOutcome = resolveReference('R057.9.AC.99', data, { includeArchived: false });
    expect(archivedOutcome.kind).toBe('unresolved');
    expect(undefinedOutcome.kind).toBe('unresolved');
    if (archivedOutcome.kind === 'unresolved' && undefinedOutcome.kind === 'unresolved') {
      expect(archivedOutcome.code).toBe('reference-to-archived');
      expect(undefinedOutcome.code).toBe('reference-to-undefined-claim');
    }
  });

  it('DD021.§10.DC.06: three codes correspond to three mechanically distinct conditions', () => {
    const data = buildIndex([archivedNote]);
    // Per §4 mechanical-distinction algorithm: archived (note retired, in index)
    // vs unknown-note (never existed) vs undefined-claim (note exists, claim doesn't).
    const archived = resolveReference('R057.1.AC.08', data, { includeArchived: false });
    const unknown = resolveReference('DEF999.1.AC.01', data, { includeArchived: false });
    const undefined_ = resolveReference('R057.9.AC.99', data, { includeArchived: false });
    const codes = [archived, unknown, undefined_]
      .filter(o => o.kind === 'unresolved')
      .map(o => o.kind === 'unresolved' ? o.code : '');
    expect(new Set(codes).size).toBe(3); // three distinct codes
    expect(codes).toContain('reference-to-archived');
    expect(codes).toContain('reference-to-unknown-note');
    expect(codes).toContain('reference-to-undefined-claim');
  });
});

// ---------------------------------------------------------------------------
// (c) consumer-synthesis at lint level — DC.06 via Q12-(c) per R015.§1.AC.04b
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.06: (c) consumer-synthesis at lint level', () => {
  it('R015.§1.AC.04b: collectInlineRefArchiveSynthesis synthesizes BOTH legacy + new code for archived inline-ref', () => {
    // Per Q14-(i) + Q12-(c) + §5.2: when an inline-ref resolves to an
    // archived-note entry, lint synthesizes parallel-emit:
    // - Legacy `unresolved-reference` (ERROR) — preserves grep stability
    // - New `reference-to-archived` (WARNING) — surfaces the discrete code
    //   per R015.§1.AC.04b's lint-downgrade-to-warning intent.
    const data = buildIndex([archivedNote, citingNote]);
    const errors = collectInlineRefArchiveSynthesis('S042', data);

    // Both codes emitted.
    const types = errors.map(e => e.type);
    expect(types).toContain('unresolved-reference');
    expect(types).toContain('reference-to-archived');
  });

  it('DD021.§10.DC.09 + Q7: legacy unresolved-reference is emitted FIRST per legacy-first ordering', () => {
    const data = buildIndex([archivedNote, citingNote]);
    const errors = collectInlineRefArchiveSynthesis('S042', data);
    // The first emission per archived inline-ref is legacy; the second is new.
    expect(errors.length).toBeGreaterThanOrEqual(2);
    const firstPair = errors.slice(0, 2);
    expect(firstPair[0].type).toBe('unresolved-reference');
    expect(firstPair[1].type).toBe('reference-to-archived');
  });

  it('DD021.§10.DC.06: does NOT synthesize for non-archived inline refs', () => {
    const data = buildIndex([activeNote, {
      id: 'S043',
      type: 'Specification',
      filePath: '_scepter/notes/specs/S043.md',
      content: [
        '# S043',
        '## §1 Section',
        '§1.AC.01 Cites {R042.§1.AC.01} (NOT archived).',
      ].join('\n'),
    }]);
    const errors = collectInlineRefArchiveSynthesis('S043', data);
    // No archived target → no synthesis emissions.
    const archiveTypes = errors.filter(e => e.type === 'reference-to-archived');
    expect(archiveTypes).toEqual([]);
  });

  it('DD021.§10.DC.06: filters to refs originating from the queried note (fromNoteId)', () => {
    // Synthesis is scoped to the lint's current note context. A cross-ref
    // from S042 → R057 only emits synthesis when linting S042, not R042 or others.
    const data = buildIndex([archivedNote, citingNote]);
    const errorsForS042 = collectInlineRefArchiveSynthesis('S042', data);
    const errorsForR042 = collectInlineRefArchiveSynthesis('R042', data);
    // S042 has the inline ref → synthesis emits.
    expect(errorsForS042.length).toBeGreaterThan(0);
    // R042 has no inline refs to archived targets → no synthesis.
    expect(errorsForR042).toEqual([]);
  });

  it('R015.§1.AC.04b: synthesis emits messages distinguishing archived from other failure modes', () => {
    const data = buildIndex([archivedNote, citingNote]);
    const errors = collectInlineRefArchiveSynthesis('S042', data);
    const archiveErr = errors.find(e => e.type === 'reference-to-archived');
    expect(archiveErr).toBeDefined();
    expect(archiveErr?.message).toContain('archived');
  });
});
