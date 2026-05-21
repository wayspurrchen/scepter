/**
 * Tests for trace-rendering consumer behavior per {DD021.§10.DC.11} and
 * {DD021.§10.DC.12}.
 *
 * **DC.11** — the trace matrix MUST emit a row for every citation in the
 * input set, including unresolved ones. An `unresolved` outcome MUST NOT
 * cause the citation to be dropped from the matrix; the row MUST surface
 * the failure with a sentinel value and be visually distinguishable from
 * a `resolved` row. Verified by exercising `buildTraceabilityMatrix()`
 * against fixtures with mixed resolved/unresolved citations and asserting
 * the unresolved rows are present with `unresolved: true`.
 *
 * **DC.12** — the trace command's `Derived from:` rendering for a claim
 * with `derives=TARGET` metadata MUST render the resolver's outcome
 * explicitly. Resolved → canonical FQID. Unresolved → sentinel of the
 * form `<UNRESOLVED — code: rawTarget>`. Tombstoned → `<TOMBSTONED — ...>`.
 * **Silent omission of the `Derived from:` line for a malformed
 * `derives=` is FORBIDDEN.** Verified by calling `formatClaimTrace()`
 * with `excerpts: false` (skips file I/O) against fixtures and asserting
 * the rendered output contains the expected sentinels.
 *
 * Verification scope:
 *
 *   1. **Matrix-level (DC.11):** `buildTraceabilityMatrix()` against
 *      resolved + unresolved fixtures; rows for both kinds present;
 *      unresolved row's `unresolved: true` flag; matrix rendering via
 *      `formatTraceabilityMatrix()` reaches the unresolved row.
 *   2. **Single-claim trace (DC.12):** `formatClaimTrace()` with mixed
 *      derives= states; sentinels for unresolved + tombstoned; 3-source
 *      merge into one comma-separated line; silent-omission invariant.
 *
 * @validates {DD021.§10.DC.11} matrix surfaces unresolved row for every citation
 * @validates {DD021.§10.DC.12} Derived from: sentinel rendering per resolver outcome
 */

import { describe, it, expect } from 'vitest';
import { ClaimIndex } from '../../../../claims/claim-index';
import type { NoteWithContent } from '../../../../claims/claim-index';
import {
  buildTraceabilityMatrix,
} from '../../../../claims/traceability';
import {
  formatClaimTrace,
  formatTraceabilityMatrix,
} from '../../../formatters/claim-formatter';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function build(notes: NoteWithContent[]) {
  const index = new ClaimIndex();
  const data = index.build(notes);
  return { index, data };
}

// Strip ANSI color codes for stable string assertions. The formatter
// uses chalk; output to a tty contains escape codes that interfere with
// substring matching.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

// ---------------------------------------------------------------------------
// DC.11: matrix surfaces unresolved row for every citation
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.11: trace matrix surfaces unresolved rows', () => {
  it('matrix includes a row for each unresolved cross-reference (not silently dropped)', () => {
    // R042 exists as the source of resolved citations. DEF999 does NOT
    // exist — citations targeting it MUST appear in the matrix as
    // unresolved rows, not silently dropped.
    const reqNote: NoteWithContent = {
      id: 'R042',
      type: 'Requirement',
      filePath: 'R042.md',
      content: [
        '# R042',
        '## §1 Section',
        '§1.AC.01 Source claim.',
      ].join('\n'),
    };
    const ddNote: NoteWithContent = {
      id: 'DD050',
      type: 'DetailedDesign',
      filePath: 'DD050.md',
      content: [
        '# DD050',
        '## §1 Section',
        '§1.DC.01 Cites resolved {R042.§1.AC.01} and unresolved {DEF999.§1.FC.01}.',
      ].join('\n'),
    };
    const { data } = build([reqNote, ddNote]);

    const matrix = buildTraceabilityMatrix('DD050', data);
    const unresolvedRows = matrix.rows.filter(r => r.unresolved);
    const resolvedRows = matrix.rows.filter(r => !r.unresolved);
    // BOTH a resolved row (for R042.AC.01) AND an unresolved row (for
    // DEF999.AC.01) MUST be present — DC.11's "row exists for every
    // citation" invariant.
    expect(resolvedRows.length).toBeGreaterThan(0);
    expect(unresolvedRows.length).toBeGreaterThan(0);
  });

  it('unresolved row carries unresolved: true flag (distinguishable from resolved)', () => {
    const ddNote: NoteWithContent = {
      id: 'DD051',
      type: 'DetailedDesign',
      filePath: 'DD051.md',
      content: [
        '# DD051',
        '## §1 Section',
        '§1.DC.01 Cites {DEF999.§1.FC.01}.',
      ].join('\n'),
    };
    const { data } = build([ddNote]);

    const matrix = buildTraceabilityMatrix('DD051', data);
    const unresolvedRow = matrix.rows.find(r => r.unresolved);
    expect(unresolvedRow).toBeDefined();
    expect(unresolvedRow!.unresolved).toBe(true);
    // Heading carries an "Unresolved reference to" sentinel — the row's
    // visible discriminator in matrix output.
    expect(unresolvedRow!.heading).toContain('Unresolved reference to');
  });

  it('unresolved row preserves the raw citation as its claimId', () => {
    const ddNote: NoteWithContent = {
      id: 'DD052',
      type: 'DetailedDesign',
      filePath: 'DD052.md',
      content: [
        '# DD052',
        '## §1 Section',
        '§1.DC.01 Cites {DEF999.§1.FC.01}.',
      ].join('\n'),
    };
    const { data } = build([ddNote]);

    const matrix = buildTraceabilityMatrix('DD052', data);
    const unresolvedRow = matrix.rows.find(r => r.unresolved);
    expect(unresolvedRow).toBeDefined();
    // The raw citation's normalized form (DEF999.1.FC.01) is preserved
    // so authors can locate the broken citation in source.
    expect(unresolvedRow!.claimId).toContain('DEF999');
    expect(unresolvedRow!.claimId).toContain('FC.01');
  });

  it('multiple unresolved citations produce distinct rows (deduplication is per-target)', () => {
    const ddNote: NoteWithContent = {
      id: 'DD053',
      type: 'DetailedDesign',
      filePath: 'DD053.md',
      content: [
        '# DD053',
        '## §1 Section',
        '§1.DC.01 Cites two unresolved: {DEF999.§1.FC.01} and {DEF888.§1.FC.01}.',
      ].join('\n'),
    };
    const { data } = build([ddNote]);

    const matrix = buildTraceabilityMatrix('DD053', data);
    const unresolvedRows = matrix.rows.filter(r => r.unresolved);
    expect(unresolvedRows.length).toBe(2);
    const claimIds = unresolvedRows.map(r => r.claimId).sort();
    expect(claimIds[0]).toContain('DEF888');
    expect(claimIds[1]).toContain('DEF999');
  });

  it('formatTraceabilityMatrix output contains the unresolved row markers', () => {
    // Verify the matrix-formatting layer surfaces the unresolved row
    // (not just the data structure). This is the consumer-visible output.
    const ddNote: NoteWithContent = {
      id: 'DD054',
      type: 'DetailedDesign',
      filePath: 'DD054.md',
      content: [
        '# DD054',
        '## §1 Section',
        '§1.DC.01 Cites {DEF999.§1.FC.01}.',
      ].join('\n'),
    };
    const { data } = build([ddNote]);
    const matrix = buildTraceabilityMatrix('DD054', data);
    const rendered = stripAnsi(formatTraceabilityMatrix(matrix));
    expect(rendered).toContain('DEF999');
  });
});

// ---------------------------------------------------------------------------
// DC.12: Derived from: sentinel rendering for derives= metadata
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.12: Derived from: sentinel rendering', () => {
  it('renders resolved derives= as the canonical FQID', async () => {
    const reqNote: NoteWithContent = {
      id: 'R042',
      type: 'Requirement',
      filePath: 'R042.md',
      content: ['# R042', '## §1 Section', '§1.AC.01 Source claim.'].join('\n'),
    };
    const ddNote: NoteWithContent = {
      id: 'DD060',
      type: 'DetailedDesign',
      filePath: 'DD060.md',
      content: [
        '# DD060',
        '## §1 Section',
        '§1.DC.01:derives=R042.§1.AC.01 Resolved derivation.',
      ].join('\n'),
    };
    const { data } = build([reqNote, ddNote]);
    const entry = data.entries.get('DD060.1.DC.01');
    expect(entry).toBeDefined();

    const rendered = stripAnsi(
      await formatClaimTrace(entry!, [], data.noteTypes, { excerpts: false }),
    );
    expect(rendered).toContain('Derived from:');
    expect(rendered).toContain('R042.1.AC.01');
  });

  it('renders unresolved derives= as <UNRESOLVED — code: rawTarget> sentinel', async () => {
    // Bare-note-id derives= → resolver code 'derivation-target-bare-note-id'
    // → DC.12 sentinel renders the code + the raw target.
    const ddNote: NoteWithContent = {
      id: 'DD061',
      type: 'DetailedDesign',
      filePath: 'DD061.md',
      content: [
        '# DD061',
        '## §1 Section',
        '§1.DC.01:derives=ARCH028 Bare-note-id derivation.',
      ].join('\n'),
    };
    const { data } = build([ddNote]);
    const entry = data.entries.get('DD061.1.DC.01');
    expect(entry).toBeDefined();

    const rendered = stripAnsi(
      await formatClaimTrace(entry!, [], data.noteTypes, { excerpts: false }),
    );
    expect(rendered).toContain('Derived from:');
    expect(rendered).toContain('<UNRESOLVED');
    expect(rendered).toContain('derivation-target-bare-note-id');
    expect(rendered).toContain('ARCH028');
  });

  it('renders tombstoned derives= as <TOMBSTONED — ...> sentinel', async () => {
    const ddNote: NoteWithContent = {
      id: 'DD062',
      type: 'DetailedDesign',
      filePath: 'DD062.md',
      content: [
        '# DD062',
        '## §1 Section',
        '§1.DC.01:derives=_deleted_R005_at_20260519.§1.AC.03 Tombstoned derivation.',
      ].join('\n'),
    };
    const { data } = build([ddNote]);
    const entry = data.entries.get('DD062.1.DC.01');
    expect(entry).toBeDefined();

    const rendered = stripAnsi(
      await formatClaimTrace(entry!, [], data.noteTypes, { excerpts: false }),
    );
    expect(rendered).toContain('Derived from:');
    expect(rendered).toContain('<TOMBSTONED');
    expect(rendered).toContain('_deleted_R005_at_20260519');
  });

  it('SILENT OMISSION FORBIDDEN: claim with malformed derives= MUST produce a Derived from: line with sentinel', async () => {
    // The load-bearing DC.12 invariant: any authored `derives=` MUST
    // surface in the output, even when malformed/unresolved. The
    // silent-omission failure mode (drop the `Derived from:` line
    // entirely on resolution failure) is FORBIDDEN.
    const ddNote: NoteWithContent = {
      id: 'DD063',
      type: 'DetailedDesign',
      filePath: 'DD063.md',
      content: [
        '# DD063',
        '## §1 Section',
        '§1.DC.01:derives=NOTEXIST.§1.AC.99 Unresolved derivation.',
      ].join('\n'),
    };
    const { data } = build([ddNote]);
    const entry = data.entries.get('DD063.1.DC.01');
    expect(entry).toBeDefined();

    const rendered = stripAnsi(
      await formatClaimTrace(entry!, [], data.noteTypes, { excerpts: false }),
    );
    // The "Derived from:" line MUST appear. If a future regression
    // drops the line on resolution failure, this test fires.
    expect(rendered).toContain('Derived from:');
    expect(rendered).toContain('<UNRESOLVED');
    expect(rendered).toContain('NOTEXIST');
  });

  it('merges resolved + unresolved + tombstoned derives into ONE comma-separated Derived from: line', async () => {
    // Per the C.11 implementation comment (claim-formatter.ts:597-617):
    // the three source kinds merge into one line. Verify all three
    // sentinels appear in a single "Derived from:" line, comma-separated.
    const reqNote: NoteWithContent = {
      id: 'R042',
      type: 'Requirement',
      filePath: 'R042.md',
      content: ['# R042', '## §1 Section', '§1.AC.01 Resolved source.'].join('\n'),
    };
    // A claim with three derives= sources: resolved, unresolved (bare
    // note ID), tombstoned. The claim-tree parser supports multiple
    // derives= via repeated metadata; use line-suffix metadata.
    const ddNote: NoteWithContent = {
      id: 'DD064',
      type: 'DetailedDesign',
      filePath: 'DD064.md',
      content: [
        '# DD064',
        '## §1 Section',
        '§1.DC.01 Three sources:derives=R042.§1.AC.01:derives=ARCH028:derives=_deleted_R005_at_20260519.§1.AC.03',
      ].join('\n'),
    };
    const { data } = build([reqNote, ddNote]);
    const entry = data.entries.get('DD064.1.DC.01');
    expect(entry).toBeDefined();

    const rendered = stripAnsi(
      await formatClaimTrace(entry!, [], data.noteTypes, { excerpts: false }),
    );
    // Locate the single Derived-from: line and assert all three
    // sentinels appear within it.
    const derivedFromLines = rendered.split('\n').filter(l => l.includes('Derived from:'));
    expect(derivedFromLines).toHaveLength(1);
    const derivedFromLine = derivedFromLines[0];
    expect(derivedFromLine).toContain('R042.1.AC.01');
    expect(derivedFromLine).toContain('<UNRESOLVED');
    expect(derivedFromLine).toContain('ARCH028');
    expect(derivedFromLine).toContain('<TOMBSTONED');
    expect(derivedFromLine).toContain('_deleted_R005_at_20260519');
    // Comma-separated.
    expect(derivedFromLine.split(',').length).toBeGreaterThanOrEqual(3);
  });

  it('claim with NO derives= produces no Derived from: line (legitimate absence vs forbidden silent omission)', async () => {
    // The DC.12 invariant is about silent-omission on FAILED resolution,
    // not on the absence of authored metadata. A claim with no derives=
    // metadata legitimately produces no line. This test guards against
    // an over-correction where the renderer always emits the line.
    const ddNote: NoteWithContent = {
      id: 'DD065',
      type: 'DetailedDesign',
      filePath: 'DD065.md',
      content: [
        '# DD065',
        '## §1 Section',
        '§1.DC.01 A claim with no derives= metadata.',
      ].join('\n'),
    };
    const { data } = build([ddNote]);
    const entry = data.entries.get('DD065.1.DC.01');
    expect(entry).toBeDefined();

    const rendered = stripAnsi(
      await formatClaimTrace(entry!, [], data.noteTypes, { excerpts: false }),
    );
    expect(rendered).not.toContain('Derived from:');
  });
});

// ---------------------------------------------------------------------------
// Sentinel format invariants — the precise sentinel text is the UX choice
// per DC.12, but the structural shape (code + rawTarget) MUST be present.
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.12: sentinel format carries code + rawTarget', () => {
  it('unresolved sentinel format includes the resolver failure code', async () => {
    const ddNote: NoteWithContent = {
      id: 'DD070',
      type: 'DetailedDesign',
      filePath: 'DD070.md',
      content: [
        '# DD070',
        '## §1 Section',
        '§1.DC.01:derives=vendor-lib/R005.§1.AC.01 Cross-project derivation.',
      ].join('\n'),
    };
    const { data } = build([ddNote]);
    const entry = data.entries.get('DD070.1.DC.01');
    expect(entry).toBeDefined();

    const rendered = stripAnsi(
      await formatClaimTrace(entry!, [], data.noteTypes, { excerpts: false }),
    );
    // Cross-project derivation → resolver code 'derivation-target-cross-project'
    // → sentinel includes the code text.
    expect(rendered).toContain('<UNRESOLVED');
    expect(rendered).toContain('derivation-target-cross-project');
    // The raw target text is preserved (alias prefix + claim address)
    // so the author can correlate the diagnostic to the source line.
    expect(rendered).toContain('vendor-lib/R005');
  });

  it('different unresolved codes produce visually distinct sentinels', async () => {
    // Each failure mode produces a sentinel with its own code; the codes
    // are what makes the diagnostic actionable. Two different unresolved
    // codes on different claims of the same note → two distinct sentinels.
    const ddNote: NoteWithContent = {
      id: 'DD071',
      type: 'DetailedDesign',
      filePath: 'DD071.md',
      content: [
        '# DD071',
        '## §1 Section',
        '§1.DC.01:derives=ARCH028 Bare note ID.',
        '§1.DC.02:derives=vendor-lib/R005.§1.AC.01 Cross-project.',
      ].join('\n'),
    };
    const { data } = build([ddNote]);
    const entryA = data.entries.get('DD071.1.DC.01');
    const entryB = data.entries.get('DD071.1.DC.02');
    expect(entryA).toBeDefined();
    expect(entryB).toBeDefined();

    const renderedA = stripAnsi(
      await formatClaimTrace(entryA!, [], data.noteTypes, { excerpts: false }),
    );
    const renderedB = stripAnsi(
      await formatClaimTrace(entryB!, [], data.noteTypes, { excerpts: false }),
    );
    expect(renderedA).toContain('derivation-target-bare-note-id');
    expect(renderedB).toContain('derivation-target-cross-project');
    // The two diagnostics MUST carry different codes so the consumer
    // sees a different problem statement.
    expect(renderedA).not.toContain('derivation-target-cross-project');
    expect(renderedB).not.toContain('derivation-target-bare-note-id');
  });
});
