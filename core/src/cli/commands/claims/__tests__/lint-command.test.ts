/**
 * Tests for lint per-code message rendering per {DD021.§10.DC.13}.
 *
 * DC.13 binds the lint command: it MUST emit a distinct human-readable
 * message for each `ResolverFailureCode`. Messages MUST be specific
 * enough to direct the user to the correct remediation. The umbrella
 * `unresolved-reference` is RETAINED as a parallel-emit during the
 * transition window but MUST NOT be the sole message for any of the
 * new failure modes.
 *
 * This file is the **LINT-OUTPUT-LEVEL** complement to file #2's
 * INDEX-LEVEL DC.14 coverage (per the ISSUE 21 scope-split
 * documentation). File #2 tests the data-model invariant — the
 * cross-ref's `resolverOutcome` and the `errors[]` entries set by
 * `ClaimIndex.build()`. This file tests the end-to-end LINT OUTPUT
 * consumers actually see, including (c) consumer-synthesis paths
 * (`collectInlineRefArchiveSynthesis`, lifecycle synthesis in
 * `validateDerivationLinks`).
 *
 * Verification surfaces:
 *
 *   1. **Per-code message text per §5.1 mapping table** — each of the 9
 *      new codes carries the documented remediation hint.
 *   2. **Lifecycle parallel-emit end-to-end** — `derivation-from-removed`
 *      + `derivation-target-removed` and `derivation-from-superseded` +
 *      `derivation-target-superseded` co-emit at the LINT OUTPUT level
 *      (Q2 + Q7 ordering preserved).
 *   3. **(c) archive synthesis at lint-output level** — archived inline
 *      ref produces BOTH `unresolved-reference` + `reference-to-archived`
 *      in the resulting `errors[]` array (Q14b parallel-emit; legacy first
 *      per Q7).
 *   4. **Message-text distinctness** — no code falls back to the umbrella
 *      message; each carries its specific code-distinguishing token.
 *   5. **ISSUE 22 paired UX-distinction (hybrid (a)+(b))** —
 *      `formatTraceabilityMatrix` does NOT render `[ARCHIVED]` inline on
 *      resolved trace rows for archived-resolved citations, while
 *      lint-level `[ARCHIVED-REF]` IS the user-facing archive signal.
 *      Locks in the deferred-UX-choice per DC.11's "trace-command's
 *      choice" wording.
 *
 * @validates {DD021.§10.DC.13} distinct human-readable message per ResolverFailureCode
 * @validates {DD021.§10.DC.06} consumer-side synthesis of reference-to-archived (LINT-OUTPUT-LEVEL)
 * @validates {DD021.§10.DC.09} lifecycle parallel-emit at lint output
 */

import { describe, it, expect } from 'vitest';
import { ClaimIndex } from '../../../../claims/claim-index';
import type { NoteWithContent } from '../../../../claims/claim-index';
import {
  collectInlineRefArchiveSynthesis,
  validateDerivationLinks,
  validateFrontmatterFields,
} from '../lint-command';
import type { SCEpterConfig } from '../../../../types/config';
import { buildTraceabilityMatrix } from '../../../../claims/traceability';
import {
  formatTraceabilityMatrix,
  formatLintResults,
} from '../../../formatters/claim-formatter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function build(notes: NoteWithContent[]) {
  const index = new ClaimIndex();
  const data = index.build(notes);
  return { index, data };
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

// ---------------------------------------------------------------------------
// DC.13 — per-code message text per §5.1 mapping table
//
// Each code's message MUST carry a code-specific remediation hint that
// distinguishes it from the umbrella unresolved-reference message.
// Verified by reading errors from data.errors (the resolver-routed
// emissions at claim-index.ts) and from validateDerivationLinks (the
// consumer-side lifecycle parallel-emit).
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.13: reference-to-unknown-note message', () => {
  it('cites the unknown note ID in a "does not exist in the project" remediation phrasing', () => {
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
    const err = data.errors.find(e => e.type === 'reference-to-unknown-note');
    expect(err).toBeDefined();
    expect(err!.message).toContain('DEF999');
    expect(err!.message).toContain('does not exist');
  });
});

describe('DD021.§10.DC.13: reference-to-undefined-claim message', () => {
  it('cites the existing-but-claim-missing distinction in the message', () => {
    const target: NoteWithContent = {
      id: 'R042',
      type: 'Requirement',
      filePath: 'R042.md',
      content: ['# R042', '## §1 Section', '§1.AC.01 Exists.'].join('\n'),
    };
    const citing: NoteWithContent = {
      id: 'S002',
      type: 'Specification',
      filePath: 'S002.md',
      content: [
        '# S002',
        '## §1 Section',
        '§1.AC.01 Cites {R042.§1.AC.99}.',
      ].join('\n'),
    };
    const { data } = build([target, citing]);
    const err = data.errors.find(e => e.type === 'reference-to-undefined-claim');
    expect(err).toBeDefined();
    // The message distinguishes "note exists but claim does not" from
    // "note doesn't exist" — load-bearing for DC.13's "specific enough
    // to direct user to correct remediation" requirement.
    expect(err!.message).toMatch(/exists.*but.*does not define/);
    expect(err!.message).toContain('R042');
  });
});

describe('DD021.§10.DC.13: reference-to-archived message', () => {
  it('cites the archived target and the rewrite-or-unarchive remediation', () => {
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
    const citing: NoteWithContent = {
      id: 'S003',
      type: 'Specification',
      filePath: 'S003.md',
      content: [
        '# S003',
        '## §1 Section',
        '§1.AC.01 Cites {R057.§1.AC.08}.',
      ].join('\n'),
    };
    const { data } = build([archivedNote, citing]);
    const errs = collectInlineRefArchiveSynthesis('S003', data);
    const archiveErr = errs.find(e => e.type === 'reference-to-archived');
    expect(archiveErr).toBeDefined();
    expect(archiveErr!.message).toContain('archived');
    expect(archiveErr!.message).toMatch(/rewriting|un-archiving/);
    expect(archiveErr!.message).toContain('R057');
  });
});

describe('DD021.§10.DC.13: derivation-target-bare-note-id message', () => {
  it('cites the bare-note-id problem and "claim address" remediation', () => {
    const dd: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '# DD003',
        '## §1 Section',
        '§1.DC.01:derives=ARCH028 Bare note ID derivation.',
      ].join('\n'),
    };
    const { data } = build([dd]);
    const err = data.errors.find(e => e.type === 'derivation-target-bare-note-id');
    expect(err).toBeDefined();
    expect(err!.message).toMatch(/bare note ID|claim-level address/);
    expect(err!.message).toContain('ARCH028');
  });
});

describe('DD021.§10.DC.13: derivation-target-cross-project message', () => {
  it('cites the alias-prefix problem and R011 boundary in a short remediation', () => {
    const dd: NoteWithContent = {
      id: 'DD004',
      type: 'DetailedDesign',
      filePath: 'DD004.md',
      content: [
        '# DD004',
        '## §1 Section',
        '§1.DC.01:derives=vendor-lib/R005.§1.AC.01 Cross-project derivation.',
      ].join('\n'),
    };
    const { data } = build([dd]);
    const err = data.errors.find(e => e.type === 'derivation-target-cross-project');
    expect(err).toBeDefined();
    expect(err!.message).toContain('alias-prefixed');
    expect(err!.message).toContain('R011.§2.AC.03');
  });
});

describe('DD021.§10.DC.13: derivation-target-ambiguous message', () => {
  it('lists the candidate FQIDs and offers disambiguation guidance', () => {
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
      id: 'DD005',
      type: 'DetailedDesign',
      filePath: 'DD005.md',
      content: [
        '# DD005',
        '## §1 Section',
        '§1.DC.01:derives=R030.PRI.01 Ambiguous derivation.',
      ].join('\n'),
    };
    const { data } = build([target, dd]);
    const err = data.errors.find(e => e.type === 'derivation-target-ambiguous');
    expect(err).toBeDefined();
    expect(err!.message).toContain('ambiguous');
    expect(err!.message).toContain('R030.7.PRI.01');
    expect(err!.message).toContain('R030.9.PRI.01');
    expect(err!.message).toMatch(/disambiguate|fully qualified/);
  });
});

describe('DD021.§10.DC.13: derivation-target-removed message', () => {
  it('cites the :removed lifecycle and the source claim FQID', () => {
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
      id: 'DD006',
      type: 'DetailedDesign',
      filePath: 'DD006.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 From removed:derives=R005.§1.AC.01',
      ].join('\n'),
    };
    const { index, data } = build([reqNote, ddNote]);
    const errs = validateDerivationLinks('DD006', data, index);
    const err = errs.find(e => e.type === 'derivation-target-removed');
    expect(err).toBeDefined();
    expect(err!.message).toContain(':removed');
    // Source claim FQID rendered in canonical form (no `§` sigil) per
    // the index's normalized key shape.
    expect(err!.message).toContain('R005.1.AC.01');
  });
});

describe('DD021.§10.DC.13: derivation-target-superseded message', () => {
  it('cites the :superseded lifecycle and the "re-deriving from the replacement" remediation per §5.5', () => {
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
      id: 'DD007',
      type: 'DetailedDesign',
      filePath: 'DD007.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 From sup:derives=R005.§1.AC.01',
      ].join('\n'),
    };
    const { index, data } = build([reqNote, ddNote]);
    const errs = validateDerivationLinks('DD007', data, index);
    const err = errs.find(e => e.type === 'derivation-target-superseded');
    expect(err).toBeDefined();
    expect(err!.message).toContain(':superseded');
    expect(err!.message).toContain('re-deriving');
    expect(err!.message).toContain('R005.1.AC.01');
  });
});

// ---------------------------------------------------------------------------
// (c) archive synthesis at LINT-OUTPUT level — cross-coverage with file #4
// helper-level test. File #4 tests the helper directly; this file tests
// the end-to-end errors[] array result through the synthesis path that
// the lint command's action handler actually runs.
// ---------------------------------------------------------------------------

describe('(c) archive synthesis at lint-output level: end-to-end errors[] array', () => {
  it('archived inline-ref produces BOTH legacy + new code in resulting errors array, legacy first (Q7)', () => {
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
    const citing: NoteWithContent = {
      id: 'S100',
      type: 'Specification',
      filePath: 'S100.md',
      content: [
        '# S100',
        '## §1 Section',
        '§1.AC.01 Cites archived {R057.§1.AC.08} inline.',
      ].join('\n'),
    };
    const { data } = build([archivedNote, citing]);
    const errs = collectInlineRefArchiveSynthesis('S100', data);

    // Both kinds present.
    const legacy = errs.filter(e => e.type === 'unresolved-reference');
    const newCode = errs.filter(e => e.type === 'reference-to-archived');
    expect(legacy.length).toBeGreaterThan(0);
    expect(newCode.length).toBeGreaterThan(0);

    // Q7 legacy-first ordering: the legacy emission precedes the new
    // emission in the resulting array.
    const firstLegacyIdx = errs.findIndex(e => e.type === 'unresolved-reference');
    const firstNewIdx = errs.findIndex(e => e.type === 'reference-to-archived');
    expect(firstLegacyIdx).toBeGreaterThanOrEqual(0);
    expect(firstNewIdx).toBe(firstLegacyIdx + 1);
  });

  it('end-to-end: formatLintResults renders BOTH codes with distinct chalk markers', () => {
    const archivedNote: NoteWithContent = {
      id: 'R057',
      type: 'Requirement',
      filePath: 'R057.md',
      content: ['# R057', '## §1 Section', '§1.AC.08 Archived.'].join('\n'),
      tags: ['archived'],
    };
    const citing: NoteWithContent = {
      id: 'S101',
      type: 'Specification',
      filePath: 'S101.md',
      content: [
        '# S101',
        '## §1 Section',
        '§1.AC.01 Cites archived {R057.§1.AC.08}.',
      ].join('\n'),
    };
    const { data } = build([archivedNote, citing]);
    const errs = collectInlineRefArchiveSynthesis('S101', data);
    const rendered = stripAnsi(formatLintResults(errs));
    // formatLintResults shows the legacy [UNRESOLVED] AND new
    // [ARCHIVED-REF] sentinels for the parallel-emit pair.
    expect(rendered).toContain('[UNRESOLVED]');
    expect(rendered).toContain('[ARCHIVED-REF]');
  });
});

// ---------------------------------------------------------------------------
// Three-way conjunction lifecycle decoration end-to-end
// ---------------------------------------------------------------------------

describe('lifecycle parallel-emit at lint output (DD021.§10.DC.09): legacy + new co-emit', () => {
  it('removed source → both derivation-from-removed (legacy) and derivation-target-removed (new) in errors', () => {
    const reqNote: NoteWithContent = {
      id: 'R005',
      type: 'Requirement',
      filePath: 'R005.md',
      content: ['### §1 Section', '', '§1.AC.01 Gone:removed'].join('\n'),
    };
    const ddNote: NoteWithContent = {
      id: 'DD200',
      type: 'DetailedDesign',
      filePath: 'DD200.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 From removed:derives=R005.§1.AC.01',
      ].join('\n'),
    };
    const { index, data } = build([reqNote, ddNote]);
    const errs = validateDerivationLinks('DD200', data, index);
    const legacyIdx = errs.findIndex(e => e.type === 'derivation-from-removed');
    const newIdx = errs.findIndex(e => e.type === 'derivation-target-removed');
    expect(legacyIdx).toBeGreaterThanOrEqual(0);
    expect(newIdx).toBe(legacyIdx + 1);
  });

  it('superseded source → both derivation-from-superseded (legacy) and derivation-target-superseded (new) in errors', () => {
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
      id: 'DD201',
      type: 'DetailedDesign',
      filePath: 'DD201.md',
      content: [
        '### §1 Section',
        '',
        '§1.DC.01 From sup:derives=R005.§1.AC.01',
      ].join('\n'),
    };
    const { index, data } = build([reqNote, ddNote]);
    const errs = validateDerivationLinks('DD201', data, index);
    const legacyIdx = errs.findIndex(e => e.type === 'derivation-from-superseded');
    const newIdx = errs.findIndex(e => e.type === 'derivation-target-superseded');
    expect(legacyIdx).toBeGreaterThanOrEqual(0);
    expect(newIdx).toBe(legacyIdx + 1);
  });
});

// ---------------------------------------------------------------------------
// Message-text distinctness — DC.13 invariant: no new code falls back to
// the umbrella unresolved-reference message text.
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.13: message-text distinctness', () => {
  it('each new code emits a message NOT equal to the umbrella "Unresolved claim reference" text', () => {
    const reqNote: NoteWithContent = {
      id: 'R042',
      type: 'Requirement',
      filePath: 'R042.md',
      content: ['# R042', '## §1 Section', '§1.AC.01 Exists.'].join('\n'),
    };
    const citing: NoteWithContent = {
      id: 'S300',
      type: 'Specification',
      filePath: 'S300.md',
      content: [
        '# S300',
        '## §1 Section',
        '§1.AC.01 Unknown {DEF999.§1.FC.01} and undefined {R042.§1.AC.99}.',
      ].join('\n'),
    };
    const { data } = build([reqNote, citing]);

    // For each new code in data.errors, the message MUST NOT be byte-
    // equal to the legacy umbrella "Unresolved claim reference ..." text.
    // The new code's text MUST carry its own remediation hint.
    const newCodeTypes = [
      'reference-to-unknown-note',
      'reference-to-undefined-claim',
    ];
    for (const t of newCodeTypes) {
      const err = data.errors.find(e => e.type === t);
      expect(err, `expected new-code emission for ${t}`).toBeDefined();
      expect(err!.message).not.toMatch(/^Unresolved claim reference/);
    }
  });

  it('legacy umbrella message text is still present as parallel-emit (per Q7) — distinctness is per-code, not umbrella removal', () => {
    // DC.13: "The umbrella `unresolved-reference` is RETAINED as a
    // parallel-emit during transition but MUST NOT be the sole message
    // for any of the new failure modes." This test confirms BOTH halves:
    // (a) the umbrella message DOES still appear (Q7 parallel-emit), and
    // (b) the new codes ALSO appear with distinct messages.
    const citing: NoteWithContent = {
      id: 'S301',
      type: 'Specification',
      filePath: 'S301.md',
      content: [
        '# S301',
        '## §1 Section',
        '§1.AC.01 Cites {DEF999.§1.FC.01}.',
      ].join('\n'),
    };
    const { data } = build([citing]);
    const umbrella = data.errors.find(e => e.type === 'unresolved-reference');
    const newCode = data.errors.find(e => e.type === 'reference-to-unknown-note');
    expect(umbrella).toBeDefined();
    expect(newCode).toBeDefined();
    // Both messages exist and differ — DC.13 satisfied.
    expect(umbrella!.message).not.toBe(newCode!.message);
  });
});

// ---------------------------------------------------------------------------
// ISSUE 22 — paired UX-distinction observation per reviewer's hybrid
// (a)+(b) disposition. Lock in the deferred-UX-choice: lint shows
// [ARCHIVED-REF]; trace matrix does NOT decorate archived-resolved
// rows with [ARCHIVED] inline. The trace-command's UX choice per DC.11.
// ---------------------------------------------------------------------------

describe('ISSUE 22: paired UX-distinction — lint surfaces [ARCHIVED-REF]; trace does NOT decorate resolved rows', () => {
  it('lint output renders [ARCHIVED-REF] for archived inline-ref (the user-facing archive signal)', () => {
    const archivedNote: NoteWithContent = {
      id: 'R057',
      type: 'Requirement',
      filePath: 'R057.md',
      content: ['# R057', '## §1 Section', '§1.AC.08 Archived.'].join('\n'),
      tags: ['archived'],
    };
    const citing: NoteWithContent = {
      id: 'S400',
      type: 'Specification',
      filePath: 'S400.md',
      content: [
        '# S400',
        '## §1 Section',
        '§1.AC.01 Cites {R057.§1.AC.08}.',
      ].join('\n'),
    };
    const { data } = build([archivedNote, citing]);
    const errs = collectInlineRefArchiveSynthesis('S400', data);
    const rendered = stripAnsi(formatLintResults(errs));
    expect(rendered).toContain('[ARCHIVED-REF]');
  });

  it('trace matrix does NOT inline-render [ARCHIVED] decoration on resolved trace rows (deferred UX choice per DC.11)', () => {
    // ISSUE 22 negative regression — lock in the current deferred-UX-
    // choice. DC.11's "the exact rendering ... is the trace-command's
    // choice" authorizes deferring an archived-flag UI on the matrix.
    // The lint surface IS the user-facing archive signal; the trace
    // matrix is silent on archive state for resolved rows.
    //
    // If a future cycle adds archived rendering at the matrix level,
    // this test fires red and triggers re-design of TraceabilityRow's
    // archived flag + formatTraceabilityMatrix rendering. That's the
    // "intended absence locked in" pattern.
    const archivedNote: NoteWithContent = {
      id: 'R057',
      type: 'Requirement',
      filePath: 'R057.md',
      content: ['# R057', '## §1 Section', '§1.AC.08 Archived.'].join('\n'),
      tags: ['archived'],
    };
    const citing: NoteWithContent = {
      id: 'S401',
      type: 'Specification',
      filePath: 'S401.md',
      content: [
        '# S401',
        '## §1 Section',
        '§1.AC.01 Cites {R057.§1.AC.08}.',
      ].join('\n'),
    };
    const { data } = build([archivedNote, citing]);
    const matrix = buildTraceabilityMatrix('S401', data);
    const rendered = stripAnsi(formatTraceabilityMatrix(matrix));
    // The resolved row is present for R057.AC.08 (archived-but-
    // resolvable per file #4 DC.17 + DC.05).
    expect(rendered).toContain('R057');
    // But it carries NO `[ARCHIVED]` inline decoration. This is the
    // load-bearing negative assertion.
    expect(rendered).not.toContain('[ARCHIVED]');
  });
});

// ---------------------------------------------------------------------------
// Declared per-type frontmatter field validation. Mirrors the allowedStatuses
// enforce/suggest validation, generalized to a declared field set:
// missing-required-field and invalid-field-value.
//
// @validates {R018.§3.AC.01-04} Lint-time validation of declared frontmatter fields
// ---------------------------------------------------------------------------

describe('validateFrontmatterFields', () => {
  const fmt = (frontmatter: string) => `---\n${frontmatter}\n---\n\n# S001 - Spec\n\nbody`;

  const configWith = (fields: SCEpterConfig['noteTypes'][string]['fields']): SCEpterConfig => ({
    noteTypes: {
      Specification: { folder: 'specs', shortcode: 'S', fields },
    },
  });

  it('a type with no fields declaration produces no errors (backward-compat)', () => {
    const config: SCEpterConfig = {
      noteTypes: { Specification: { folder: 'specs', shortcode: 'S' } },
    };
    const errs = validateFrontmatterFields('S001', fmt('tags: []'), 'Specification', config);
    expect(errs).toHaveLength(0);
  });

  it('an unknown / undefined type produces no errors', () => {
    const config = configWith([{ name: 'version', required: true }]);
    expect(validateFrontmatterFields('S001', fmt('tags: []'), undefined, config)).toHaveLength(0);
    expect(validateFrontmatterFields('S001', fmt('tags: []'), 'Nonexistent', config)).toHaveLength(0);
  });

  it('flags a missing required field', () => {
    const config = configWith([{ name: 'version', required: true }]);
    const errs = validateFrontmatterFields('S001', fmt('tags: []'), 'Specification', config);
    expect(errs).toHaveLength(1);
    expect(errs[0].type).toBe('missing-required-field');
    expect(errs[0].message).toContain('version');
    expect(errs[0].noteId).toBe('S001');
  });

  it('flags an empty required field as missing', () => {
    const config = configWith([{ name: 'version', required: true }]);
    const errs = validateFrontmatterFields('S001', fmt('version: \ntags: []'), 'Specification', config);
    expect(errs.some((e) => e.type === 'missing-required-field')).toBe(true);
  });

  it('does not flag a present required field', () => {
    const config = configWith([{ name: 'version', required: true }]);
    const errs = validateFrontmatterFields('S001', fmt('version: 1.0.0\ntags: []'), 'Specification', config);
    expect(errs).toHaveLength(0);
  });

  it('does not flag a missing optional field', () => {
    const config = configWith([{ name: 'owner' }]);
    const errs = validateFrontmatterFields('S001', fmt('tags: []'), 'Specification', config);
    expect(errs).toHaveLength(0);
  });

  it('flags a value outside the allowed set', () => {
    const config = configWith([{ name: 'lifecycle', allowed: ['draft', 'active'] }]);
    const errs = validateFrontmatterFields('S001', fmt('lifecycle: retired\ntags: []'), 'Specification', config);
    expect(errs).toHaveLength(1);
    expect(errs[0].type).toBe('invalid-field-value');
    expect(errs[0].message).toContain('retired');
    expect(errs[0].message).toContain('draft, active');
  });

  it('does not flag an in-set value', () => {
    const config = configWith([{ name: 'lifecycle', allowed: ['draft', 'active'] }]);
    const errs = validateFrontmatterFields('S001', fmt('lifecycle: active\ntags: []'), 'Specification', config);
    expect(errs).toHaveLength(0);
  });

  it('does not flag an absent optional allowed field (only present values are checked)', () => {
    const config = configWith([{ name: 'lifecycle', allowed: ['draft', 'active'] }]);
    const errs = validateFrontmatterFields('S001', fmt('tags: []'), 'Specification', config);
    expect(errs).toHaveLength(0);
  });

  it('emits both missing-required and invalid-value across multiple fields', () => {
    const config = configWith([
      { name: 'version', required: true },
      { name: 'lifecycle', allowed: ['draft', 'active'] },
    ]);
    const errs = validateFrontmatterFields('S001', fmt('lifecycle: retired\ntags: []'), 'Specification', config);
    expect(errs.some((e) => e.type === 'missing-required-field' && e.claimId === 'S001.version')).toBe(true);
    expect(errs.some((e) => e.type === 'invalid-field-value' && e.claimId === 'S001.lifecycle')).toBe(true);
  });
});
