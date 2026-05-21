/**
 * Tests for the `resolveClaimInput` thin wrapper per {DD021.§10.DC.10}
 * post-(β) disposition.
 *
 * DC.10 binds `resolveClaimInput()` to a normalize-then-resolve wrapper:
 * (1) input normalization (`$` → `§`, `§` stripping, zero-padding) per
 * {DD008.§1.DC.01} / {DD008.§1.DC.02}; (2) section-only short-circuit
 * for browse-by-section queries (e.g., `DD007.1` returns all claims in
 * §1 of DD007); (3) single-claim suffix-matching DELEGATED to the
 * shared resolver per {DD021.§10.DC.03}.
 *
 * The (β) disposition (team-lead 2026-05-21, recorded in
 * resolve-claim-id.ts:1-14 JSDoc) preserves the section-only branch at
 * THIS layer rather than DC.03's resolver layer. The original DC.10
 * wording asserted "equivalent behavior is provided by §10.DC.03," but
 * DC.03 is single-outcome by construction (`resolved | ambiguous |
 * unresolved`) and cannot return a many-entries browse result. The
 * section-only branch is conceptually a BROWSE feature, not a claim-
 * resolution operation, and lives naturally at the wrapper layer.
 *
 * Verification strategy:
 *
 *   1. **Normalization tests** — `$` → `§` replacement, `§` stripping,
 *      zero-padding preserved verbatim per {DD008.§1.DC.01-.02}.
 *   2. **Section-only short-circuit** — `DD007.1` returns all claims
 *      under §1 of DD007 (many-entries return that DC.03 cannot model).
 *      This is the (β) interpretation in action.
 *   3. **Single-claim resolution via delegation** — `DD007.§1.DC.01`
 *      flows through `resolveReference()` per DC.10. Resolver outcomes
 *      mapped to ResolveResult.matches: resolved → 1 entry; ambiguous →
 *      candidate entries; unresolved → empty.
 *   4. **Section-only with no matches falls through to resolver** — the
 *      degenerate case where the section is missing; wrapper returns
 *      empty matches via the resolver's unresolved outcome.
 *
 * @validates {DD021.§10.DC.10} normalize-then-resolve wrapper per (β) disposition
 * @validates {DD008.§1.DC.01} normalization preserved verbatim
 * @validates {DD008.§1.DC.02} zero-padding preserved verbatim
 */

import { describe, it, expect } from 'vitest';
import { resolveClaimInput } from '../resolve-claim-id';
import { ClaimIndex } from '../../../../claims/claim-index';
import type { NoteWithContent, ClaimIndexData } from '../../../../claims/claim-index';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function buildIndex(notes: NoteWithContent[]): ClaimIndexData {
  const idx = new ClaimIndex();
  return idx.build(notes);
}

const ddNote: NoteWithContent = {
  id: 'DD007',
  type: 'DetailedDesign',
  filePath: 'DD007.md',
  content: [
    '# DD007',
    '## §1 First section',
    '§1.DC.01 First claim in §1.',
    '§1.DC.02 Second claim in §1.',
    '§1.DC.03 Third claim in §1.',
    '## §3 Third section',
    '§3.DC.01 First claim in §3.',
  ].join('\n'),
};

const reqNote: NoteWithContent = {
  id: 'R042',
  type: 'Requirement',
  filePath: 'R042.md',
  content: [
    '# R042',
    '## §1 Section',
    '§1.AC.01 Active requirement claim.',
    '§1.AC.02 Another active claim.',
  ].join('\n'),
};

// A note with the same claim prefix in two different sections — exercises
// section-less ambiguity per DC.03 (cross-note section-less rule).
const ambigNote: NoteWithContent = {
  id: 'R030',
  type: 'Requirement',
  filePath: 'R030.md',
  content: [
    '# R030',
    '## §7 Section seven',
    '§7.PRI.01 Candidate A.',
    '## §9 Section nine',
    '§9.PRI.01 Candidate B.',
  ].join('\n'),
};

// ---------------------------------------------------------------------------
// DD008.§1.DC.01: normalization preserved verbatim ($ → §, § stripping)
// ---------------------------------------------------------------------------

describe('DD008.§1.DC.01: normalization ($ → §, § stripping)', () => {
  it('resolveClaimInput strips § from the input before lookup', () => {
    const data = buildIndex([ddNote]);
    // User input "DD007.§1.DC.01" with explicit § — wrapper strips it
    // and looks up against the index (which uses unprefixed keys).
    const result = resolveClaimInput('DD007.§1.DC.01', data);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].fullyQualified).toBe('DD007.1.DC.01');
  });

  it('resolveClaimInput accepts $ as a § alias and resolves the claim', () => {
    const data = buildIndex([ddNote]);
    // Per DD008.§1.DC.01, $ is interchangeable with § as a section
    // sigil. Shell users frequently type $ to avoid quoting.
    const result = resolveClaimInput('DD007.$1.DC.01', data);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].fullyQualified).toBe('DD007.1.DC.01');
  });

  it('normalized output is § -stripped and accessible in the ResolveResult', () => {
    const data = buildIndex([ddNote]);
    const result = resolveClaimInput('DD007.§1.DC.01', data);
    expect(result.normalized).not.toContain('§');
    expect(result.normalized).not.toContain('$');
    expect(result.normalized).toBe('DD007.1.DC.01');
  });
});

// ---------------------------------------------------------------------------
// DD008.§1.DC.02: zero-padding preserved verbatim
// ---------------------------------------------------------------------------

describe('DD008.§1.DC.02: zero-padding preserved verbatim', () => {
  it('zero-pads note ID shortcode digits to the index width', () => {
    // R042 in the index — input "R42.1.AC.01" pads R42 → R042.
    const data = buildIndex([reqNote]);
    const result = resolveClaimInput('R42.1.AC.01', data);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].fullyQualified).toBe('R042.1.AC.01');
  });

  it('zero-pads claim numbers to 2 digits', () => {
    // Claim number always pads to 2 digits per the wrapper's invariant.
    const data = buildIndex([reqNote]);
    const result = resolveClaimInput('R042.1.AC.1', data);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].fullyQualified).toBe('R042.1.AC.01');
  });

  it('combined: pads BOTH note ID and claim number simultaneously', () => {
    const data = buildIndex([reqNote]);
    const result = resolveClaimInput('R42.1.AC.1', data);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].fullyQualified).toBe('R042.1.AC.01');
  });

  it('strips leading zeros from section path segments (not claim numbers)', () => {
    // "R042.01.AC.02" → "R042.1.AC.02" (section is unpadded, claim
    // number stays padded). Verifies the asymmetric padding rule.
    const data = buildIndex([reqNote]);
    const result = resolveClaimInput('R042.01.AC.02', data);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].fullyQualified).toBe('R042.1.AC.02');
    expect(result.normalized).toBe('R042.1.AC.02');
  });

  it('preserves the sub-letter on claim numbers (e.g., 01a)', () => {
    const subNote: NoteWithContent = {
      id: 'R050',
      type: 'Requirement',
      filePath: 'R050.md',
      content: [
        '# R050',
        '## §1 Section',
        '§1.AC.01a A claim with a sub-letter.',
      ].join('\n'),
    };
    const data = buildIndex([subNote]);
    const result = resolveClaimInput('R050.1.AC.1a', data);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].fullyQualified).toBe('R050.1.AC.01a');
  });
});

// ---------------------------------------------------------------------------
// (β) interpretation: section-only branch preserved at wrapper layer
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.10 (β): section-only short-circuit preserved at wrapper layer', () => {
  it('section-only input (e.g., DD007.1) returns ALL claims under §1 — many-entries return DC.03 cannot model', () => {
    const data = buildIndex([ddNote]);
    const result = resolveClaimInput('DD007.1', data);
    // §1 of DD007 has three claims; wrapper returns all of them.
    // DC.03's outcome model (resolved | ambiguous | unresolved) cannot
    // represent this many-entries browse result — which is why the
    // section-only branch lives at the wrapper layer per (β).
    expect(result.matches).toHaveLength(3);
    const fqids = result.matches.map(e => e.fullyQualified).sort();
    expect(fqids).toEqual([
      'DD007.1.DC.01',
      'DD007.1.DC.02',
      'DD007.1.DC.03',
    ]);
  });

  it('section-only result is sorted by FQID', () => {
    const data = buildIndex([ddNote]);
    const result = resolveClaimInput('DD007.1', data);
    const fqids = result.matches.map(e => e.fullyQualified);
    const sorted = [...fqids].sort();
    expect(fqids).toEqual(sorted);
  });

  it('section-only with § prefix (e.g., DD007.§1) works the same as DD007.1', () => {
    const data = buildIndex([ddNote]);
    const withSigil = resolveClaimInput('DD007.§1', data);
    const withoutSigil = resolveClaimInput('DD007.1', data);
    expect(withSigil.matches.map(e => e.fullyQualified))
      .toEqual(withoutSigil.matches.map(e => e.fullyQualified));
  });

  it('section-only on a section with one claim returns that one claim', () => {
    const data = buildIndex([ddNote]);
    const result = resolveClaimInput('DD007.3', data);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].fullyQualified).toBe('DD007.3.DC.01');
  });

  it('section-only with no matches falls through to resolver and returns empty matches', () => {
    // The degenerate case documented at resolve-claim-id.ts:79-81 —
    // section-only input that finds no entries falls through to the
    // resolver, which returns unresolved; wrapper maps to empty matches.
    const data = buildIndex([ddNote]);
    const result = resolveClaimInput('DD007.99', data);
    expect(result.matches).toHaveLength(0);
  });

  it('section-only does NOT match cross-note claims (NOTEID scoping is strict)', () => {
    // A section-only browse query is scoped to its own note ID; it
    // MUST NOT return claims from a different note that happen to live
    // in §1 of that other note.
    const data = buildIndex([ddNote, reqNote]);
    const result = resolveClaimInput('DD007.1', data);
    // All matches must originate from DD007, not R042.
    const noteIds = new Set(result.matches.map(e => e.noteId));
    expect(noteIds.size).toBe(1);
    expect(noteIds.has('DD007')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Single-claim delegation to resolveReference() per DC.10
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.10: single-claim resolution delegates to resolveReference()', () => {
  it('fully-qualified input → resolved outcome → single match', () => {
    const data = buildIndex([ddNote]);
    const result = resolveClaimInput('DD007.1.DC.01', data);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].fullyQualified).toBe('DD007.1.DC.01');
  });

  it('section-less input (NOTEID.PREFIX.NN) with unique match → resolved via DC.03 section-less rule', () => {
    // R042 has only one §1.AC.01; section-less "R042.AC.01" resolves
    // uniquely via the resolver's section-less rule (DC.03).
    const data = buildIndex([reqNote]);
    const result = resolveClaimInput('R042.AC.01', data);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].fullyQualified).toBe('R042.1.AC.01');
  });

  it('section-less input with MULTIPLE matches → ambiguous outcome → all candidate entries returned', () => {
    // R030.PRI.01 is ambiguous between §7 and §9 per DC.03's
    // cross-note section-less ambiguity case. The wrapper maps the
    // ambiguous outcome to the candidate entries (sorted by FQID) so
    // the consumer can render a disambiguation prompt.
    const data = buildIndex([ambigNote]);
    const result = resolveClaimInput('R030.PRI.01', data);
    expect(result.matches).toHaveLength(2);
    const fqids = result.matches.map(e => e.fullyQualified).sort();
    expect(fqids).toEqual(['R030.7.PRI.01', 'R030.9.PRI.01']);
  });

  it('unresolved input (no such note) → empty matches', () => {
    const data = buildIndex([reqNote]);
    const result = resolveClaimInput('DEF999.1.FC.01', data);
    expect(result.matches).toHaveLength(0);
  });

  it('unresolved input (note exists, claim does not) → empty matches', () => {
    // R042 exists but does not define §1.AC.99 — resolver returns
    // unresolved with reference-to-undefined-claim; wrapper maps to
    // empty matches without exposing the failure code (DC.10 wrapper
    // only surfaces matches; the failure code is a resolver-layer
    // signal for the lint/trace consumers).
    const data = buildIndex([reqNote]);
    const result = resolveClaimInput('R042.1.AC.99', data);
    expect(result.matches).toHaveLength(0);
  });

  it('includeArchived defaults to true at the wrapper layer (user-facing lookup sees archived)', () => {
    // Per resolve-claim-id.ts:84-85 comment + §4 per-consumer defaults:
    // user-facing lookup MUST see archived entries (the user typed the
    // ID; they get the entry). Verifies the wrapper's `includeArchived:
    // true` is honored end-to-end.
    const archivedNote: NoteWithContent = {
      id: 'R057',
      type: 'Requirement',
      filePath: 'R057.md',
      content: [
        '# R057',
        '## §1 Section',
        '§1.AC.08 Archived claim.',
      ].join('\n'),
      tags: ['archived'],
    };
    const data = buildIndex([archivedNote]);
    const result = resolveClaimInput('R057.1.AC.08', data);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].fullyQualified).toBe('R057.1.AC.08');
    expect(result.matches[0].archived).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Combined: normalization + delegation chain
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.10: normalization + delegation end-to-end', () => {
  it('combined: $-aliased, unpadded input → normalized → delegated → resolved', () => {
    // Full chain: "R42.$1.AC.1" → normalize to "R042.1.AC.01" → delegate
    // to resolver → resolved outcome → single match.
    const data = buildIndex([reqNote]);
    const result = resolveClaimInput('R42.$1.AC.1', data);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].fullyQualified).toBe('R042.1.AC.01');
    expect(result.normalized).toBe('R042.1.AC.01');
  });

  it('combined: section-only with unpadded shortcode is normalized then short-circuited', () => {
    // "DD7.1" → normalize to "DD007.1" → section-only short-circuit →
    // many-entries return for §1 of DD007.
    const data = buildIndex([ddNote]);
    const result = resolveClaimInput('DD7.1', data);
    expect(result.matches).toHaveLength(3);
    expect(result.normalized).toBe('DD007.1');
  });
});
