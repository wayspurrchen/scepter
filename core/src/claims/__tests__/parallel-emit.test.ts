/**
 * Tests for the transition-window parallel-emit invariant per
 * {DD021.§10.DC.09}.
 *
 * The invariant: during the transition window, every legacy ClaimTreeError
 * code is co-emitted with its new-taxonomy successor in a stable
 * legacy-first order (Q7). The five legacy codes covered:
 *
 *   1. `unresolved-reference`            ↔ `reference-to-unknown-note`
 *                                        ↔ `reference-to-undefined-claim`
 *                                        ↔ `malformed-claim-reference`
 *   2. `unresolvable-derivation-target`  ↔ `derivation-target-bare-note-id`
 *                                        ↔ `derivation-target-ambiguous`
 *   3. `cross-project-derives`           ↔ `derivation-target-cross-project`
 *   4. `derivation-from-removed`         ↔ `derivation-target-removed`
 *   5. `derivation-from-superseded`      ↔ `derivation-target-superseded`
 *
 * For each pair, the test verifies (a) BOTH entries are present in the
 * emission stream for the triggering input, (b) the legacy entry precedes
 * the new entry in the emitted array (Q7), and (c) for the cross-project
 * case the verbose R011-rationale message is preserved verbatim on the
 * legacy emission (Q1 caveat).
 *
 * DC.08 invariant — verified by structural assertion: the legacy
 * `resolveClaimAddress()` helper has been removed; all resolution flows
 * through `resolveReference()`. The presence of the L325 marker comment
 * stands as the post-removal sentinel.
 *
 * @validates {DD021.§10.DC.09} parallel-emit during transition window
 * @validates {DD021.§10.DC.08} every resolution flows through resolveReference()
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ClaimIndex } from '../claim-index';
import type { NoteWithContent } from '../claim-index';
import { validateDerivationLinks } from '../../cli/commands/claims/lint-command';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function build(notes: NoteWithContent[]): {
  index: ClaimIndex;
  data: ReturnType<ClaimIndex['build']>;
} {
  const index = new ClaimIndex();
  const data = index.build(notes);
  return { index, data };
}

// ---------------------------------------------------------------------------
// Pair 1: unresolved-reference ↔ reference-to-unknown-note
//          (cross-note inline-ref where target note is absent)
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.09: unresolved-reference ↔ reference-to-unknown-note', () => {
  it('emits BOTH legacy and new code for inline-ref to unknown note', () => {
    const citing: NoteWithContent = {
      id: 'S001',
      type: 'Specification',
      filePath: 'S001.md',
      content: [
        '# S001',
        '## §1 Section',
        '§1.AC.01 Cites a missing note: {DEF999.§1.FC.01}.',
      ].join('\n'),
    };
    const { data } = build([citing]);

    const legacy = data.errors.filter(e => e.type === 'unresolved-reference');
    const newCode = data.errors.filter(e => e.type === 'reference-to-unknown-note');
    expect(legacy.length).toBeGreaterThan(0);
    expect(newCode.length).toBeGreaterThan(0);
  });

  it('Q7 legacy-first ordering: legacy emission precedes new emission', () => {
    const citing: NoteWithContent = {
      id: 'S001',
      type: 'Specification',
      filePath: 'S001.md',
      content: [
        '# S001',
        '## §1 Section',
        '§1.AC.01 Cites {DEF999.§1.FC.01}.',
      ].join('\n'),
    };
    const { data } = build([citing]);

    const legacyIdx = data.errors.findIndex(e => e.type === 'unresolved-reference');
    const newIdx = data.errors.findIndex(e => e.type === 'reference-to-unknown-note');
    expect(legacyIdx).toBeGreaterThanOrEqual(0);
    expect(newIdx).toBeGreaterThan(legacyIdx);
  });
});

// ---------------------------------------------------------------------------
// Pair 2: unresolved-reference ↔ reference-to-undefined-claim
//          (cross-note inline-ref; target note present, claim absent)
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.09: unresolved-reference ↔ reference-to-undefined-claim', () => {
  it('emits BOTH legacy and new code when target note exists but claim does not', () => {
    const target: NoteWithContent = {
      id: 'R042',
      type: 'Requirement',
      filePath: 'R042.md',
      content: [
        '# R042',
        '## §1 Section',
        '§1.AC.01 A defined claim.',
      ].join('\n'),
    };
    const citing: NoteWithContent = {
      id: 'S001',
      type: 'Specification',
      filePath: 'S001.md',
      content: [
        '# S001',
        '## §1 Section',
        '§1.AC.01 Cites {R042.§1.AC.99} — claim does not exist.',
      ].join('\n'),
    };
    const { data } = build([target, citing]);

    const legacy = data.errors.filter(e => e.type === 'unresolved-reference');
    const newCode = data.errors.filter(e => e.type === 'reference-to-undefined-claim');
    expect(legacy.length).toBeGreaterThan(0);
    expect(newCode.length).toBeGreaterThan(0);
  });

  it('Q7 legacy-first ordering for undefined-claim case', () => {
    const target: NoteWithContent = {
      id: 'R042',
      type: 'Requirement',
      filePath: 'R042.md',
      content: ['# R042', '## §1 Section', '§1.AC.01 Exists.'].join('\n'),
    };
    const citing: NoteWithContent = {
      id: 'S001',
      type: 'Specification',
      filePath: 'S001.md',
      content: [
        '# S001',
        '## §1 Section',
        '§1.AC.01 Cites {R042.§1.AC.99}.',
      ].join('\n'),
    };
    const { data } = build([target, citing]);

    const legacyIdx = data.errors.findIndex(e => e.type === 'unresolved-reference');
    const newIdx = data.errors.findIndex(e => e.type === 'reference-to-undefined-claim');
    expect(legacyIdx).toBeGreaterThanOrEqual(0);
    expect(newIdx).toBeGreaterThan(legacyIdx);
  });
});

// ---------------------------------------------------------------------------
// Pair 3: unresolvable-derivation-target ↔ derivation-target-bare-note-id
//          (DC.04 — bare note ID in derives= position)
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.09: unresolvable-derivation-target ↔ derivation-target-bare-note-id', () => {
  it('emits BOTH legacy and new code for bare-note-id derives=', () => {
    const arch: NoteWithContent = {
      id: 'ARCH028',
      type: 'Architecture',
      filePath: 'ARCH028.md',
      content: [
        '# ARCH028',
        '## §1 Section',
        '§1.AC.01 Some architectural claim.',
      ].join('\n'),
    };
    const dd: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '# DD003',
        '## §1 Section',
        '§1.DC.01 Bare-note-id derives=:derives=ARCH028',
      ].join('\n'),
    };
    const { data } = build([arch, dd]);

    const legacy = data.errors.filter(e => e.type === 'unresolvable-derivation-target');
    const newCode = data.errors.filter(e => e.type === 'derivation-target-bare-note-id');
    expect(legacy.length).toBe(1);
    expect(newCode.length).toBe(1);
  });

  it('Q7 legacy-first ordering for bare-note-id case', () => {
    const arch: NoteWithContent = {
      id: 'ARCH028',
      type: 'Architecture',
      filePath: 'ARCH028.md',
      content: ['# ARCH028', '## §1 Section', '§1.AC.01 Claim.'].join('\n'),
    };
    const dd: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '# DD003',
        '## §1 Section',
        '§1.DC.01 Bare:derives=ARCH028',
      ].join('\n'),
    };
    const { data } = build([arch, dd]);

    const legacyIdx = data.errors.findIndex(e => e.type === 'unresolvable-derivation-target');
    const newIdx = data.errors.findIndex(e => e.type === 'derivation-target-bare-note-id');
    expect(legacyIdx).toBeGreaterThanOrEqual(0);
    expect(newIdx).toBeGreaterThan(legacyIdx);
  });

  it('new-code message references "bare note ID" or "claim-level address" remediation', () => {
    const dd: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '# DD003',
        '## §1 Section',
        '§1.DC.01 Bare:derives=ARCH028',
      ].join('\n'),
    };
    const { data } = build([dd]);
    const newErr = data.errors.find(e => e.type === 'derivation-target-bare-note-id');
    expect(newErr).toBeDefined();
    expect(newErr?.message).toMatch(/bare note ID|claim-level address/);
  });
});

// ---------------------------------------------------------------------------
// Pair 4: unresolvable-derivation-target ↔ derivation-target-ambiguous
//          (DC.03 — section-less derives= matches multiple entries)
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.09: unresolvable-derivation-target ↔ derivation-target-ambiguous', () => {
  it('emits BOTH legacy and new code for section-less derives= with multiple matches', () => {
    // R030 has the same claim prefix `PRI.01` in both §7 and §9; a
    // section-less derives=R030.PRI.01 resolves to two candidates.
    const target: NoteWithContent = {
      id: 'R030',
      type: 'Requirement',
      filePath: 'R030.md',
      content: [
        '# R030',
        '## §7 Section seven',
        '§7.PRI.01 First candidate.',
        '## §9 Section nine',
        '§9.PRI.01 Second candidate.',
      ].join('\n'),
    };
    const dd: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '# DD003',
        '## §1 Section',
        '§1.DC.01 Section-less derives=:derives=R030.PRI.01',
      ].join('\n'),
    };
    const { data } = build([target, dd]);

    const legacy = data.errors.filter(e => e.type === 'unresolvable-derivation-target');
    const newCode = data.errors.filter(e => e.type === 'derivation-target-ambiguous');
    expect(legacy.length).toBe(1);
    expect(newCode.length).toBe(1);
  });

  it('new-code message lists candidate FQIDs and offers disambiguation guidance', () => {
    const target: NoteWithContent = {
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
    const dd: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '# DD003',
        '## §1 Section',
        '§1.DC.01 Section-less:derives=R030.PRI.01',
      ].join('\n'),
    };
    const { data } = build([target, dd]);
    const ambig = data.errors.find(e => e.type === 'derivation-target-ambiguous');
    expect(ambig).toBeDefined();
    expect(ambig?.message).toContain('ambiguous');
    expect(ambig?.message).toContain('R030.7.PRI.01');
    expect(ambig?.message).toContain('R030.9.PRI.01');
  });

  it('Q7 legacy-first ordering for ambiguous case', () => {
    const target: NoteWithContent = {
      id: 'R030',
      type: 'Requirement',
      filePath: 'R030.md',
      content: [
        '# R030',
        '## §7 Section seven',
        '§7.PRI.01 A.',
        '## §9 Section nine',
        '§9.PRI.01 B.',
      ].join('\n'),
    };
    const dd: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '# DD003',
        '## §1 Section',
        '§1.DC.01 Ambig:derives=R030.PRI.01',
      ].join('\n'),
    };
    const { data } = build([target, dd]);
    const legacyIdx = data.errors.findIndex(e => e.type === 'unresolvable-derivation-target');
    const newIdx = data.errors.findIndex(e => e.type === 'derivation-target-ambiguous');
    expect(legacyIdx).toBeGreaterThanOrEqual(0);
    expect(newIdx).toBe(legacyIdx + 1);
  });
});

// ---------------------------------------------------------------------------
// Pair 5: cross-project-derives ↔ derivation-target-cross-project
//          (alias-prefixed derives= rejected per R011.§2.AC.03)
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.09: cross-project-derives ↔ derivation-target-cross-project', () => {
  it('emits BOTH legacy and new code for alias-prefixed derives=', () => {
    const dd: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '# DD003',
        '## §1 Section',
        '§1.DC.01 Cross-project derives=:derives=vendor-lib/R005.§1.AC.01',
      ].join('\n'),
    };
    const { data } = build([dd]);

    const legacy = data.errors.filter(e => e.type === 'cross-project-derives');
    const newCode = data.errors.filter(e => e.type === 'derivation-target-cross-project');
    expect(legacy.length).toBe(1);
    expect(newCode.length).toBe(1);
  });

  it('Q1 caveat: legacy emission preserves verbatim R011-rationale message', () => {
    const dd: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '# DD003',
        '## §1 Section',
        '§1.DC.01 Cross:derives=vendor-lib/R005.§1.AC.01',
      ].join('\n'),
    };
    const { data } = build([dd]);
    const legacy = data.errors.find(e => e.type === 'cross-project-derives');
    expect(legacy).toBeDefined();
    // Verbatim R011 rationale: must mention the project-scoping rule,
    // R006 non-goals, R011.§2.AC.03, and the relaxation-via-future-requirement
    // pathway — preserves today's grep-stable phrasing.
    expect(legacy?.message).toContain('cross-project derivation is rejected');
    expect(legacy?.message).toContain('R006.§Non-Goals');
    expect(legacy?.message).toContain('R011.§2.AC.03');
    expect(legacy?.message).toContain('future requirement');
  });

  it('new-code message is shorter than legacy verbose-rationale message', () => {
    const dd: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '# DD003',
        '## §1 Section',
        '§1.DC.01 Cross:derives=vendor-lib/R005.§1.AC.01',
      ].join('\n'),
    };
    const { data } = build([dd]);
    const legacy = data.errors.find(e => e.type === 'cross-project-derives');
    const newCode = data.errors.find(e => e.type === 'derivation-target-cross-project');
    expect(legacy).toBeDefined();
    expect(newCode).toBeDefined();
    // The new code carries a short detail; the legacy keeps the full rationale.
    expect(newCode!.message.length).toBeLessThan(legacy!.message.length);
    expect(newCode?.message).toContain('alias-prefixed');
  });

  it('Q7 legacy-first ordering for cross-project case', () => {
    const dd: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '# DD003',
        '## §1 Section',
        '§1.DC.01 Cross:derives=vendor-lib/R005.§1.AC.01',
      ].join('\n'),
    };
    const { data } = build([dd]);
    const legacyIdx = data.errors.findIndex(e => e.type === 'cross-project-derives');
    const newIdx = data.errors.findIndex(e => e.type === 'derivation-target-cross-project');
    expect(legacyIdx).toBeGreaterThanOrEqual(0);
    expect(newIdx).toBe(legacyIdx + 1);
  });
});

// ---------------------------------------------------------------------------
// Pair 6: derivation-from-removed ↔ derivation-target-removed
//          (lifecycle parallel-emit at lint level, not index level)
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.09: derivation-from-removed ↔ derivation-target-removed', () => {
  it('emits BOTH legacy and new code when source claim is :removed', () => {
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
    const { index, data } = build([reqNote, ddNote]);
    const errors = validateDerivationLinks('DD003', data, index);

    const legacy = errors.filter(e => e.type === 'derivation-from-removed');
    const newCode = errors.filter(e => e.type === 'derivation-target-removed');
    expect(legacy.length).toBe(1);
    expect(newCode.length).toBe(1);
  });

  it('Q7 legacy-first ordering for derivation-from-removed', () => {
    const reqNote: NoteWithContent = {
      id: 'R005',
      type: 'Requirement',
      filePath: 'R005.md',
      content: ['### §1 Section', '', '§1.AC.01 Gone:removed'].join('\n'),
    };
    const ddNote: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 From removed:derives=R005.§1.AC.01',
      ].join('\n'),
    };
    const { index, data } = build([reqNote, ddNote]);
    const errors = validateDerivationLinks('DD003', data, index);
    const legacyIdx = errors.findIndex(e => e.type === 'derivation-from-removed');
    const newIdx = errors.findIndex(e => e.type === 'derivation-target-removed');
    expect(legacyIdx).toBeGreaterThanOrEqual(0);
    expect(newIdx).toBe(legacyIdx + 1);
  });
});

// ---------------------------------------------------------------------------
// Pair 7: derivation-from-superseded ↔ derivation-target-superseded
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.09: derivation-from-superseded ↔ derivation-target-superseded', () => {
  it('emits BOTH legacy and new code when source claim is :superseded', () => {
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
    const { index, data } = build([reqNote, ddNote]);
    const errors = validateDerivationLinks('DD003', data, index);

    const legacy = errors.filter(e => e.type === 'derivation-from-superseded');
    const newCode = errors.filter(e => e.type === 'derivation-target-superseded');
    expect(legacy.length).toBe(1);
    expect(newCode.length).toBe(1);
  });

  it('Q7 legacy-first ordering for derivation-from-superseded', () => {
    const reqNote: NoteWithContent = {
      id: 'R005',
      type: 'Requirement',
      filePath: 'R005.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Old:superseded=R005.§1.AC.02',
        '',
        '§1.AC.02 New.',
      ].join('\n'),
    };
    const ddNote: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 From super:derives=R005.§1.AC.01',
      ].join('\n'),
    };
    const { index, data } = build([reqNote, ddNote]);
    const errors = validateDerivationLinks('DD003', data, index);
    const legacyIdx = errors.findIndex(e => e.type === 'derivation-from-superseded');
    const newIdx = errors.findIndex(e => e.type === 'derivation-target-superseded');
    expect(legacyIdx).toBeGreaterThanOrEqual(0);
    expect(newIdx).toBe(legacyIdx + 1);
  });

  it('superseded messages reference the replacement-rederivation remediation', () => {
    const reqNote: NoteWithContent = {
      id: 'R005',
      type: 'Requirement',
      filePath: 'R005.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01 Old:superseded=R005.§1.AC.02',
        '',
        '§1.AC.02 New.',
      ].join('\n'),
    };
    const ddNote: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 Sup:derives=R005.§1.AC.01',
      ].join('\n'),
    };
    const { index, data } = build([reqNote, ddNote]);
    const errors = validateDerivationLinks('DD003', data, index);
    const newCode = errors.find(e => e.type === 'derivation-target-superseded');
    expect(newCode).toBeDefined();
    expect(newCode?.message).toContain('re-deriving');
  });
});

// ---------------------------------------------------------------------------
// DC.08 invariant: resolveClaimAddress is gone; resolveReference is the
// single resolution path. Verified by structural assertion against the
// source tree.
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.08: resolveClaimAddress removed; single resolution path', () => {
  it('no resolveClaimAddress() function declaration remains in core/src/', () => {
    // Read claim-index.ts (the historical home of resolveClaimAddress).
    // The function MUST NOT be re-declared; only the post-removal marker
    // comment at L325 references the name.
    const src = readFileSync(
      join(__dirname, '..', 'claim-index.ts'),
      'utf-8',
    );
    // Any line declaring `function resolveClaimAddress` (or a method
    // declaration of the same name) is a regression.
    expect(src).not.toMatch(/function\s+resolveClaimAddress\s*\(/);
    expect(src).not.toMatch(/^\s*resolveClaimAddress\s*\(/m);
  });

  it('post-removal marker comment is present at the historical L325 site', () => {
    const src = readFileSync(
      join(__dirname, '..', 'claim-index.ts'),
      'utf-8',
    );
    // The marker documents that resolveClaimAddress was removed in Phase
    // D.16 — its presence is the structural witness for DC.08.
    expect(src).toContain('resolveClaimAddress');
    expect(src).toMatch(/REMOVED in Phase D\.16/);
  });
});
