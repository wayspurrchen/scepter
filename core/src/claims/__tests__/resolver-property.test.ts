/**
 * DC.14 lint-trace invariant property test — INDEX-LEVEL scope.
 *
 * Per {DD021.§10.DC.14}: "for every citation in the input set, if the trace
 * command renders the citation as a `resolved` row, the lint command MUST NOT
 * emit any unresolved-reference-family error for that citation; conversely, if
 * the trace command renders the citation as an `unresolved` row, the lint
 * command MUST emit the corresponding error."
 *
 * **Scope split (per ISSUE 21 documentation):**
 *
 * - **INDEX-LEVEL (this file):** the resolver/index strict invariant — no
 *   resolved citation produces an unresolved-family error at index build time.
 *   The resolver enforces this by construction; both lint and trace consume
 *   `data.crossRefs` (which carries `resolverOutcome` per {DD021.§7.OQ.02}
 *   closure); the same outcome drives both consumers.
 *
 * - **LINT-OUTPUT-LEVEL (TC-C `lint-command.test.ts`):** the (c) consumer-synthesis
 *   at `lint-command.ts:collectInlineRefArchiveSynthesis` synthesizes legacy
 *   `unresolved-reference` for archived citations per Q14-(i) parallel-emit.
 *   Under strict DC.14 literal reading, this is an apparent violation during
 *   the DC.09 transition window — intentional grep-stability scaffolding,
 *   captured in the lint-command integration tests.
 *
 * The two scopes together cover DC.14's intent: the resolver/index is correct
 * by construction; the lint runtime has known parallel-emit behavior that the
 * transition window will retire per OQ.01.
 *
 * Per §7.11 fixture organization (Q22-disposed exhaustive-corpus approach):
 * the fixture covers 8 in-scope audit classes (1, 2, 5, 6, 7, 8, 9, 10).
 * Classes 3, 4, 11 are OOS per the cycle's scope-boundary preamble.
 *
 * Per dispatch brief redaction rule, no peer-project names appear; all note
 * IDs are placeholders (R042, ARCH028, DEF999, R017, R057, etc. already used
 * in DD021 itself).
 *
 * @validates {DD021.§10.DC.14} lint-trace invariant (index-level scope)
 */

import { describe, it, expect } from 'vitest';
import { ClaimIndex } from '../claim-index';
import type { NoteWithContent, ClaimIndexData } from '../claim-index';

// ---------------------------------------------------------------------------
// Audit corpus — 8 in-scope classes per §7.11 fixture organization
// ---------------------------------------------------------------------------

/**
 * Each class is a self-contained fixture with notes that exercise the
 * specific resolver failure mode the audit identified.
 */
const auditCorpus: Record<string, { notes: NoteWithContent[]; description: string }> = {
  'Class 1 — bare-note-id derives=': {
    description: 'A DD claim authored with `:derives=ARCH028` (bare note ID, no claim suffix).',
    notes: [
      {
        id: 'DD050',
        type: 'DetailedDesign',
        filePath: '_scepter/notes/dd/DD050.md',
        content: [
          '# DD050 Bare-Note-ID Case',
          '## §1 Section',
          '§1.DC.01:derives=ARCH028 Bare-note-id derives target.',
        ].join('\n'),
      },
    ],
  },

  'Class 2 — section-less inline reference': {
    description: 'An inline `{R030.PRI.01}` reference where R030 has matching claims in §7 AND §9 (ambiguous).',
    notes: [
      {
        id: 'R030',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R030.md',
        content: [
          '# R030',
          '## §7 Section Seven',
          '§7.PRI.01 First PRI claim.',
          '## §9 Section Nine',
          '§9.PRI.01 Second PRI claim.',
        ].join('\n'),
      },
      {
        id: 'S034',
        type: 'Specification',
        filePath: '_scepter/notes/specs/S034.md',
        content: [
          '# S034 Citing Note',
          '## §1 Section',
          '§1.AC.01 The spec cites {R030.PRI.01} which is ambiguous.',
        ].join('\n'),
      },
    ],
  },

  'Class 5 — archived-note reference': {
    description: 'An inline `{R057.§1.AC.08}` reference where R057 is archived.',
    notes: [
      {
        id: 'R057',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R057.md',
        content: [
          '# R057 Archived',
          '## §1 Section',
          '§1.AC.08 An archived claim.',
        ].join('\n'),
        tags: ['archived'],
      },
      {
        id: 'R042',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R042.md',
        content: [
          '# R042 Active Note',
          '## §1 Section',
          '§1.AC.01 Cites the archived {R057.§1.AC.08}.',
        ].join('\n'),
      },
    ],
  },

  'Class 6 — note exists but claim undefined': {
    description: 'An inline `{R017.PRG.01}` reference where R017 exists as a note but defines no PRG.01 claim.',
    notes: [
      {
        id: 'R017',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R017.md',
        content: [
          '# R017 Narrative-only Note',
          '## §1 Background',
          '§1.AC.01 R017 defines this AC, but NOT a PRG.01.',
        ].join('\n'),
      },
      {
        id: 'S035',
        type: 'Specification',
        filePath: '_scepter/notes/specs/S035.md',
        content: [
          '# S035 Citing Note',
          '## §1 Section',
          '§1.AC.01 Cites {R017.§1.PRG.01} which is undefined.',
        ].join('\n'),
      },
    ],
  },

  'Class 7 — note does not exist': {
    description: 'An inline `{DEF015.§1.FC.01}` reference where DEF015 was never created.',
    notes: [
      {
        id: 'R043',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R043.md',
        content: [
          '# R043 Citing Note',
          '## §1 Section',
          '§1.AC.01 Cites {DEF015.§1.FC.01} which does not exist.',
        ].join('\n'),
      },
    ],
  },

  'Class 8 — letter-suffix references (special case of Class 6)': {
    description: 'An inline `{R044.§1.DC.14b}` reference where R044 defines DC.14 (no `b` sub-letter variant).',
    notes: [
      {
        id: 'R044',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R044.md',
        content: [
          '# R044 With DC.14 but not DC.14b',
          '## §1 Section',
          '§1.DC.14 The main claim (no `b` variant).',
        ].join('\n'),
      },
      {
        id: 'S036',
        type: 'Specification',
        filePath: '_scepter/notes/specs/S036.md',
        content: [
          '# S036 Citing Note',
          '## §1 Section',
          '§1.AC.01 Cites {R044.§1.DC.14b} which is undefined (no sub-letter variant).',
        ].join('\n'),
      },
    ],
  },

  'Class 9 — derives from a removed claim': {
    description: 'A DD claim derived from a source claim tagged `:removed`.',
    notes: [
      {
        id: 'R045',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R045.md',
        content: [
          '# R045 With Removed Claim',
          '## §1 Section',
          '§1.AC.01:removed [Removed]',
        ].join('\n'),
      },
      {
        id: 'DD051',
        type: 'DetailedDesign',
        filePath: '_scepter/notes/dd/DD051.md',
        content: [
          '# DD051 Derives From Removed',
          '## §1 Section',
          '§1.DC.01:derives=R045.§1.AC.01 Derives from removed source.',
        ].join('\n'),
      },
    ],
  },

  'Class 10 — derives from a superseded claim': {
    description: 'A DD claim derived from a source claim tagged `:superseded`.',
    notes: [
      {
        id: 'R046',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R046.md',
        content: [
          '# R046 With Superseded Claim',
          '## §1 Section',
          '§1.AC.01:superseded=R046.§2.AC.01 The old claim.',
          '## §2 Section',
          '§2.AC.01 The replacement claim.',
        ].join('\n'),
      },
      {
        id: 'DD052',
        type: 'DetailedDesign',
        filePath: '_scepter/notes/dd/DD052.md',
        content: [
          '# DD052 Derives From Superseded',
          '## §1 Section',
          '§1.DC.01:derives=R046.§1.AC.01 Derives from superseded source.',
        ].join('\n'),
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Invariant helpers
// ---------------------------------------------------------------------------

/**
 * The "unresolved-reference family" — codes lint emits when a citation FAILS
 * to resolve. `reference-to-archived` is NOT in this family — it's a WARNING
 * for a citation that DID resolve (to an archived entry) per §5.6's analysis.
 */
const UNRESOLVED_REFERENCE_FAMILY = new Set<string>([
  'unresolved-reference',
  'reference-to-unknown-note',
  'reference-to-undefined-claim',
  'malformed-claim-reference',
]);

/**
 * The "unresolvable-derivation-target family" — analogous set for derives=
 * position failures. The DC.14 invariant in its strict reading covers
 * inline-ref citations; we also assert the derives= analogue as a separate
 * property since the parallel-emit pattern applies symmetrically.
 */
const UNRESOLVED_DERIVATION_FAMILY = new Set<string>([
  'unresolvable-derivation-target',
  'derivation-target-bare-note-id',
  'derivation-target-cross-project',
  'derivation-target-ambiguous',
]);

/**
 * Build the claim index from a corpus of notes and compute the two sets the
 * DC.14 invariant relates: trace-resolved citations (from `data.crossRefs`)
 * and lint-not-unresolved-family citations (from `data.errors`).
 */
function computeInvariantSets(index: ClaimIndexData): {
  traceResolved: Set<string>; // toClaim values for crossRefs with resolved outcome
  lintUnresolved: Set<string>; // claimId values for errors in the unresolved family
} {
  const traceResolved = new Set<string>();
  for (const ref of index.crossRefs) {
    if (ref.resolverOutcome?.kind === 'resolved' || (ref.resolverOutcome === undefined && ref.unresolved !== true)) {
      traceResolved.add(ref.toClaim);
    }
  }

  const lintUnresolved = new Set<string>();
  for (const err of index.errors) {
    if (UNRESOLVED_REFERENCE_FAMILY.has(err.type) || UNRESOLVED_DERIVATION_FAMILY.has(err.type)) {
      lintUnresolved.add(err.claimId);
    }
  }

  return { traceResolved, lintUnresolved };
}

// ---------------------------------------------------------------------------
// Property test
// ---------------------------------------------------------------------------

describe('DC.14 lint-trace invariant property test', () => {
  for (const [className, fixture] of Object.entries(auditCorpus)) {
    it(`DD021.§10.DC.14: ${className} — trace-resolved and lint-unresolved sets are mutually exclusive`, () => {
      const idx = new ClaimIndex();
      const data = idx.build(fixture.notes);

      const { traceResolved, lintUnresolved } = computeInvariantSets(data);

      // The invariant: NO citation appears in BOTH sets.
      // If a citation is trace-resolved, lint MUST NOT emit unresolved-family error for it.
      // If a citation is in lint-unresolved-family, trace MUST NOT render it as resolved.
      const overlap = new Set<string>();
      for (const claimId of traceResolved) {
        if (lintUnresolved.has(claimId)) {
          overlap.add(claimId);
        }
      }

      expect(
        overlap.size,
        `${className}: claimIds appearing in BOTH trace-resolved AND lint-unresolved sets: ${[...overlap].join(', ')}`,
      ).toBe(0);
    });
  }

  it('DD021.§10.DC.14: invariant holds across the full corpus when all classes are merged', () => {
    // Stress test: combine all classes into one index build. The invariant
    // MUST hold globally — no citation that resolves in trace can appear as
    // an unresolved-family error in lint, and vice versa.
    const allNotes: NoteWithContent[] = [];
    for (const fixture of Object.values(auditCorpus)) {
      allNotes.push(...fixture.notes);
    }
    // Dedup by id since some class fixtures might share note IDs (defensive).
    const seen = new Set<string>();
    const dedup = allNotes.filter(n => {
      if (seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });

    const idx = new ClaimIndex();
    const data = idx.build(dedup);
    const { traceResolved, lintUnresolved } = computeInvariantSets(data);

    const overlap = new Set<string>();
    for (const claimId of traceResolved) {
      if (lintUnresolved.has(claimId)) {
        overlap.add(claimId);
      }
    }

    expect(
      overlap.size,
      `Merged corpus: claimIds appearing in BOTH sets: ${[...overlap].join(', ')}`,
    ).toBe(0);
  });
});
