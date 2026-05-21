/**
 * Tests for the R011 cross-project derivation boundary post-DD021's B.8
 * routing refactor.
 *
 * Pre-DD021, alias-prefixed `derives=` targets were rejected via a direct
 * emission at claim-index.ts L443-451 / L529-539 using
 * `CROSS_PROJECT_TARGET_RE.test(target)`. DD021's B.8 SUBSUMED that
 * direct-emit path: alias-prefixed `derives=` now flows through
 * `resolveReference()` (DC.08), which detects the alias-prefix in the
 * derives= position and returns `unresolved` with
 * `code: 'derivation-target-cross-project'`. The legacy
 * `cross-project-derives` code is now emitted as a parallel companion to
 * the new code, preserving the verbatim R011-rationale message on the
 * legacy emission (Q1 caveat).
 *
 * The `superseded=` boundary at claim-index.ts L641-650 is INTENTIONALLY
 * UNTOUCHED — it is the R011.§2.AC.04 permanent-ban check, not subsumed
 * by DD021's resolver routing. The resolver only handles `derives=`-
 * position alias-prefix detection (per DC.04's `derivesPosition: true`).
 * `superseded=` is a separate metadata channel whose cross-project ban
 * remains at the dedicated check site.
 *
 * This file complements (not duplicates) the existing
 * `cross-project-rejection.test.ts` which tests the legacy
 * `cross-project-derives` emission shape. The scope here:
 *
 *   1. DC.08 routing: alias-prefixed `derives=` flows through
 *      `resolveReference()` and produces the new
 *      `derivation-target-cross-project` code (in addition to the legacy
 *      `cross-project-derives` companion).
 *   2. Structural-sentinel: the legacy direct-emit site for `derives=`
 *      alias-prefix has been REMOVED; the only emission path is via the
 *      resolver (B.8 SUBSUMES claim).
 *   3. Structural-sentinel: the L641-650 `cross-project-superseded`
 *      check stays intact — it is NOT subsumed by the resolver and
 *      operates on a different metadata channel.
 *
 * @validates {DD021.§10.DC.08} alias-prefixed derives= flows through resolveReference()
 * @validates {R011.§2.AC.03} cross-project derivation rejected (via resolver)
 * @validates {R011.§2.AC.04} cross-project superseded= rejected (preserved at L641-650)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ClaimIndex } from '../claim-index';
import type { NoteWithContent } from '../claim-index';
import { resolveReference } from '../reference-resolver';

// ---------------------------------------------------------------------------
// DC.08 routing: alias-prefixed derives= goes through resolveReference()
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.08: alias-prefixed derives= flows through resolveReference()', () => {
  it('resolveReference with derivesPosition: true detects alias-prefix and returns derivation-target-cross-project', () => {
    // Direct resolver-level invocation — alias-prefix detection MUST
    // fire inside the resolver, not at a separate consumer-side check.
    const idx = new ClaimIndex();
    const data = idx.build([]);
    const outcome = resolveReference('vendor-lib/R005.1.AC.01', data, {
      currentNoteId: 'DD100',
      derivesPosition: true,
    });
    expect(outcome.kind).toBe('unresolved');
    if (outcome.kind === 'unresolved') {
      expect(outcome.code).toBe('derivation-target-cross-project');
    }
  });

  it('integration: alias-prefixed derives= in a note produces derivation-target-cross-project on the new code surface', () => {
    // End-to-end through ClaimIndex.build() — the new code MUST appear
    // in data.errors alongside (not instead of) the legacy code.
    const dd: NoteWithContent = {
      id: 'DD100',
      type: 'DetailedDesign',
      filePath: 'DD100.md',
      content: [
        '### §1 Section',
        '',
        'DC.01:derives=vendor-lib/R005.§1.AC.01 Cross-project derivation.',
      ].join('\n'),
    };
    const idx = new ClaimIndex();
    const data = idx.build([dd]);

    const newCode = data.errors.filter(e => e.type === 'derivation-target-cross-project');
    expect(newCode).toHaveLength(1);
    expect(newCode[0].claimId).toContain('DD100');
    expect(newCode[0].noteId).toBe('DD100');
  });

  it('alias-prefixed bare-id (no claim suffix) still routes through resolver and produces derivation-target-cross-project', () => {
    // The alias-prefix detection short-circuits the bare-note-id check
    // — derives=vendor-lib/R042 (no claim suffix) yields cross-project,
    // NOT bare-note-id. This is the resolver pre-check priority order.
    const dd: NoteWithContent = {
      id: 'DD103',
      type: 'DetailedDesign',
      filePath: 'DD103.md',
      content: [
        '### §1 Section',
        '',
        'DC.01:derives=vendor-lib/R042 Cross-project bare-ID.',
      ].join('\n'),
    };
    const idx = new ClaimIndex();
    const data = idx.build([dd]);

    const crossProject = data.errors.filter(e => e.type === 'derivation-target-cross-project');
    const bareNoteId = data.errors.filter(e => e.type === 'derivation-target-bare-note-id');
    expect(crossProject.length).toBeGreaterThan(0);
    expect(bareNoteId).toHaveLength(0);
  });

  it('alias-prefixed derives= does NOT enter derivedFrom (the local derivation graph)', () => {
    // R011.§3.AC.03/.04: cross-project citations are read-only; the
    // local cross-ref graph and derivation graph MUST NOT include them.
    const dd: NoteWithContent = {
      id: 'DD102',
      type: 'DetailedDesign',
      filePath: 'DD102.md',
      content: [
        '### §1 Section',
        '',
        'DC.01:derives=vendor-lib/R005.§1.AC.01 Cross-project derivation.',
      ].join('\n'),
    };
    const idx = new ClaimIndex();
    const data = idx.build([dd]);
    const entry = data.entries.get('DD102.1.DC.01');
    expect(entry).toBeDefined();
    expect(entry!.derivedFrom).toHaveLength(0);
    expect(entry!.derivedFrom.some(d => d.startsWith('vendor-lib'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Structural-sentinel: the legacy CROSS_PROJECT_TARGET_RE direct-emit site
// for derives= has been REMOVED. The only remaining use of
// CROSS_PROJECT_TARGET_RE in claim-index.ts is for the superseded= check.
// ---------------------------------------------------------------------------

describe('B.8 SUBSUMES: legacy derives= direct-emit site removed', () => {
  it('CROSS_PROJECT_TARGET_RE has exactly ONE call site in claim-index.ts (the superseded= check)', () => {
    // Pre-B.8, the regex was tested twice: once for derives= (L443) and
    // once for superseded= (the present L641). Post-B.8, the derives=
    // test site is gone; the regex is referenced exactly once via
    // `.test(` plus its declaration.
    const src = readFileSync(
      join(__dirname, '..', 'claim-index.ts'),
      'utf-8',
    );
    // Count `.test(` invocations of the regex (not the declaration).
    const callMatches = src.match(/CROSS_PROJECT_TARGET_RE\.test\(/g) ?? [];
    expect(callMatches).toHaveLength(1);
  });

  it('the surviving CROSS_PROJECT_TARGET_RE.test() call is inside the superseded= loop, not the derives= loop', () => {
    const src = readFileSync(
      join(__dirname, '..', 'claim-index.ts'),
      'utf-8',
    );
    const lines = src.split('\n');
    const callLineIdx = lines.findIndex(l => l.includes('CROSS_PROJECT_TARGET_RE.test('));
    expect(callLineIdx).toBeGreaterThan(-1);

    // Look upward for the nearest emit-marker to confirm context. The
    // surviving site emits `cross-project-superseded`; the historical
    // derives= site emitted `cross-project-derives`.
    const window = lines.slice(callLineIdx, callLineIdx + 15).join('\n');
    expect(window).toContain('cross-project-superseded');
    expect(window).not.toContain("type: 'cross-project-derives'");
  });

  it('the B.8 SUBSUMES annotation is present at the derives= resolution route', () => {
    // The annotation is the docstring witness that the L443-451 site was
    // intentionally removed and routed through the resolver. Its presence
    // is the structural marker for the migration.
    const src = readFileSync(
      join(__dirname, '..', 'claim-index.ts'),
      'utf-8',
    );
    expect(src).toMatch(/B\.8: This route SUBSUMES the prior CROSS_PROJECT_TARGET_RE direct/);
  });
});

// ---------------------------------------------------------------------------
// Structural-sentinel: superseded= cross-project check at L641-650 is
// UNTOUCHED. R011.§2.AC.04 is a permanent ban operating on a separate
// metadata channel; DD021's resolver routing only touches derives=
// position via the derivesPosition flag.
// ---------------------------------------------------------------------------

describe('R011.§2.AC.04: cross-project-superseded check preserved (NOT subsumed)', () => {
  it('alias-prefixed superseded= still emits cross-project-superseded at index build time', () => {
    const note: NoteWithContent = {
      id: 'R201',
      type: 'Requirement',
      filePath: 'R201.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01:superseded=vendor-lib/R005.§1.AC.01 Cross-project supersession claim.',
      ].join('\n'),
    };
    const idx = new ClaimIndex();
    const data = idx.build([note]);
    const errs = data.errors.filter(e => e.type === 'cross-project-superseded');
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain('R011.§2.AC.04');
    expect(errs[0].message).toContain('permanently rejected');
  });

  it('alias-prefixed superseded= does NOT route through the new resolver code (no derivation-target-cross-project emission)', () => {
    // The resolver routing is specific to derives= position
    // (derivesPosition: true). The superseded= channel is handled by
    // the dedicated L641-650 check, which emits ONLY the legacy
    // cross-project-superseded code — no parallel new-taxonomy code.
    const note: NoteWithContent = {
      id: 'R202',
      type: 'Requirement',
      filePath: 'R202.md',
      content: [
        '### §1 Section',
        '',
        '§1.AC.01:superseded=vendor-lib/R005.§1.AC.01 Cross-project sup.',
      ].join('\n'),
    };
    const idx = new ClaimIndex();
    const data = idx.build([note]);
    const newCode = data.errors.filter(e => e.type === 'derivation-target-cross-project');
    expect(newCode).toHaveLength(0);
  });

  it('the L641-650 emit site comment cites R011.§2.AC.04 (the permanent-ban marker)', () => {
    const src = readFileSync(
      join(__dirname, '..', 'claim-index.ts'),
      'utf-8',
    );
    // The @implements annotation at the check site is the load-bearing
    // marker that this check is the R011.§2.AC.04 realization. Removing
    // it would orphan the AC trace.
    expect(src).toMatch(/@implements\s+\{R011\.§2\.AC\.04\}/);
  });
});

// ---------------------------------------------------------------------------
// End-to-end R011 boundary: alias-prefixed derives= produces the full
// transition-window parallel-emit (legacy + new). Overlaps with file #5
// Pair 5 conceptually, but here we anchor on the R011 boundary semantics
// — the verbatim R011-rationale message text, R006/R011 cross-citations,
// and the relaxation-via-future-requirement pathway.
// ---------------------------------------------------------------------------

describe('R011 boundary end-to-end: legacy verbatim + new short detail', () => {
  it('legacy cross-project-derives carries the full R011-rationale message text', () => {
    const dd: NoteWithContent = {
      id: 'DD100',
      type: 'DetailedDesign',
      filePath: 'DD100.md',
      content: [
        '### §1 Section',
        '',
        'DC.01:derives=vendor-lib/R005.§1.AC.01 Cross-project derivation.',
      ].join('\n'),
    };
    const idx = new ClaimIndex();
    const data = idx.build([dd]);
    const legacy = data.errors.find(e => e.type === 'cross-project-derives');
    expect(legacy).toBeDefined();
    // Verbatim R011-rationale tokens — these MUST be preserved on the
    // legacy emission per Q1 caveat. Today's tooling greps these tokens.
    expect(legacy!.message).toContain('cross-project derivation is rejected');
    expect(legacy!.message).toContain('R006.§Non-Goals');
    expect(legacy!.message).toContain('R011.§2.AC.03');
    expect(legacy!.message).toContain('future requirement');
    expect(legacy!.message).toContain('derives= MUST point at a local claim');
  });

  it('new derivation-target-cross-project carries a short alias-prefixed remediation hint', () => {
    const dd: NoteWithContent = {
      id: 'DD100',
      type: 'DetailedDesign',
      filePath: 'DD100.md',
      content: [
        '### §1 Section',
        '',
        'DC.01:derives=vendor-lib/R005.§1.AC.01 Cross-project derivation.',
      ].join('\n'),
    };
    const idx = new ClaimIndex();
    const data = idx.build([dd]);
    const newCode = data.errors.find(e => e.type === 'derivation-target-cross-project');
    expect(newCode).toBeDefined();
    // The new code carries a short detail per DD021.§10.DC.13's
    // message-distinction discipline. It still cites the R011 boundary
    // for traceability but omits the verbatim rationale prose.
    expect(newCode!.message).toContain('alias-prefixed');
    expect(newCode!.message).toContain('R011.§2.AC.03');
  });

  it('local (non-aliased) derives= does NOT trigger either cross-project code surface', () => {
    // Negative case: a clean local derivation must produce zero
    // cross-project emissions on either surface — confirms the
    // alias-prefix detection is sharp.
    const reqNote: NoteWithContent = {
      id: 'R005',
      type: 'Requirement',
      filePath: 'R005.md',
      content: ['### §1 Section', '', '§1.AC.01 Source.'].join('\n'),
    };
    const ddNote: NoteWithContent = {
      id: 'DD200',
      type: 'DetailedDesign',
      filePath: 'DD200.md',
      content: [
        '### §1 Section',
        '',
        'DC.01:derives=R005.§1.AC.01 Local derivation.',
      ].join('\n'),
    };
    const idx = new ClaimIndex();
    const data = idx.build([reqNote, ddNote]);

    expect(data.errors.filter(e => e.type === 'cross-project-derives')).toHaveLength(0);
    expect(data.errors.filter(e => e.type === 'derivation-target-cross-project')).toHaveLength(0);
    const entry = data.entries.get('DD200.1.DC.01');
    expect(entry).toBeDefined();
    expect(entry!.derivedFrom).toContain('R005.1.AC.01');
  });
});
