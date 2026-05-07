/**
 * Unit tests for the snapshot-diff formatter.  Verifies the output
 * shapes the DD pins for both the human report and the `--json`
 * payload, plus the regression-suggestion lines for each kind.
 *
 * @validates {DD018.§3.DC.57} formatDiffHeader summary segments + regression coloring
 * @validates {DD018.§3.DC.58} formatDiffSections — six categories with explicit empty markers
 * @validates {DD018.§3.DC.60} regression marker on lost-claim findings
 * @validates {DD018.§3.DC.61} formatRegressionSuggestions lifecycle-only suggestion shape
 * @validates {DD018.§3.DC.61a} formatRegressionSuggestions per-target derived-from suggestions
 * @validates {DD018.§3.DC.62} formatDiffJson — JSON shape with summary
 */

import { describe, it, expect } from 'vitest';
import {
  formatDiffHeader,
  formatDiffSections,
  formatDiffJson,
  formatRegressionSuggestions,
} from '../snapshot-formatter';
import type { DiffReport } from '../diff-types';

function emptyReport(): DiffReport {
  return {
    lostClaims: [],
    newClaims: [],
    bodyChanged: [],
    headingOrMetadataChanged: [],
    sourceRefDrift: [],
    incomingNoteRefDrift: [],
    regressions: [],
    summary: {
      lost: 0,
      new: 0,
      bodyChanged: 0,
      headingOrMetadataChanged: 0,
      sourceRefDrift: 0,
      incomingNoteRefDrift: 0,
      regressions: 0,
    },
  };
}

// Strip ANSI escape codes for substring assertions; leaves chalk
// formatting unverified but content-asserted.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, '');
}

describe('formatDiffHeader', () => {
  it('renders all six counts plus regressions on one line', () => {
    const report = emptyReport();
    report.summary = {
      lost: 1,
      new: 2,
      bodyChanged: 3,
      headingOrMetadataChanged: 4,
      sourceRefDrift: 5,
      incomingNoteRefDrift: 6,
      regressions: 7,
    };
    const out = stripAnsi(formatDiffHeader(report, false));
    expect(out).toContain('Lost: 1');
    expect(out).toContain('New: 2');
    expect(out).toContain('Body changed: 3');
    expect(out).toContain('Heading/metadata changed: 4');
    expect(out).toContain('Source ref drift: 5');
    expect(out).toContain('Incoming note-ref drift: 6');
    expect(out).toContain('Regressions: 7');
    // Trailing blank line.
    expect(out.endsWith('\n')).toBe(true);
  });

  it('shows Regressions count even when --regressions flag is not active', () => {
    const report = emptyReport();
    const out = stripAnsi(formatDiffHeader(report, false));
    expect(out).toContain('Regressions: 0');
  });
});

describe('formatDiffSections', () => {
  it('emits all six section headers even when every category is empty', () => {
    const report = emptyReport();
    const out = stripAnsi(formatDiffSections(report, false));
    expect(out).toContain('Lost claims');
    expect(out).toContain('New claims');
    expect(out).toContain('Body changed');
    expect(out).toContain('Heading or metadata changed');
    expect(out).toContain('Source ref drift');
    expect(out).toContain('Incoming note-ref drift');
    // Empty sections must render an explicit indicator.
    const noFindingsCount = (out.match(/\(no findings\)/g) ?? []).length;
    expect(noFindingsCount).toBe(6);
  });

  it('renders the [REGRESSION] marker on lost-claim findings', () => {
    const report = emptyReport();
    report.lostClaims = [
      {
        fqid: 'R001.§1.AC.01',
        baselineHeading: 'old heading',
        baselineLifecycle: null,
        isRegression: true,
      },
    ];
    report.summary.lost = 1;
    const out = stripAnsi(formatDiffSections(report, false));
    expect(out).toContain('R001.§1.AC.01');
    expect(out).toContain('[REGRESSION]');
  });
});

describe('formatRegressionSuggestions', () => {
  it('emits empty string when no regressions', () => {
    expect(formatRegressionSuggestions(emptyReport())).toBe('');
  });

  it('emits lifecycle-only suggestion for untombstoned-loss', () => {
    const report = emptyReport();
    report.regressions = [
      {
        kind: 'untombstoned-loss',
        fqid: 'R001.§1.AC.01',
        baselineSourceRefCount: 0,
        suggestedTombstoneTag: ':removed',
        locationHint: null,
      },
    ];
    const out = stripAnsi(formatRegressionSuggestions(report));
    expect(out).toContain('scepter meta add R001.§1.AC.01 lifecycle=removed');
    expect(out).toContain('substitute lifecycle=superseded=TARGET');
  });

  it('includes location hint when present', () => {
    const report = emptyReport();
    report.regressions = [
      {
        kind: 'dangling-source-coverage',
        fqid: 'R001.§1.AC.01',
        baselineSourceRefCount: 3,
        suggestedTombstoneTag: ':removed',
        locationHint: { filePath: '/p/note.md', line: 42 },
      },
    ];
    const out = stripAnsi(formatRegressionSuggestions(report));
    expect(out).toContain('defined at /p/note.md:42');
    expect(out).toContain('baseline source refs: 3');
  });

  it('emits one suggestion line per lost target for derived-from-shrinkage', () => {
    const report = emptyReport();
    report.regressions = [
      {
        kind: 'derived-from-shrinkage',
        fqid: 'R002.§1.AC.01',
        baselineSourceRefCount: 0,
        suggestedTombstoneTag: ':removed',
        locationHint: null,
        lostDerivationTargets: ['R001.§1.AC.01', 'R001.§1.AC.02'],
      },
    ];
    const out = stripAnsi(formatRegressionSuggestions(report));
    expect(out).toContain('derives=R001.§1.AC.01');
    expect(out).toContain('derives=R001.§1.AC.02');
    expect(out).toContain('OR lifecycle=removed');
  });
});

describe('formatDiffJson', () => {
  it('emits a JSON object with summary and per-category arrays', () => {
    const report = emptyReport();
    report.summary.lost = 1;
    report.lostClaims = [
      {
        fqid: 'R001.§1.AC.01',
        baselineHeading: 'h',
        baselineLifecycle: null,
        isRegression: false,
      },
    ];
    const json = formatDiffJson(report, true);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.summary).toEqual(report.summary);
    expect(parsed.regressionsActive).toBe(true);
    expect(Array.isArray(parsed.lostClaims)).toBe(true);
    expect((parsed.lostClaims as unknown[]).length).toBe(1);
    expect(Array.isArray(parsed.newClaims)).toBe(true);
    expect(Array.isArray(parsed.regressions)).toBe(true);
  });

  it('JSON output contains no chalk escape sequences', () => {
    const report = emptyReport();
    const json = formatDiffJson(report, false);
    // eslint-disable-next-line no-control-regex
    expect(/\[/.test(json)).toBe(false);
  });

  it('regressionsActive flag is reflected in the payload', () => {
    const report = emptyReport();
    expect(JSON.parse(formatDiffJson(report, false)).regressionsActive).toBe(false);
    expect(JSON.parse(formatDiffJson(report, true)).regressionsActive).toBe(true);
  });

  it('JSON payload preserves derived-from-shrinkage finding kind and lostDerivationTargets', () => {
    // §DC.62 + §DC.46: machine consumers MUST be able to filter
    // regressions by `kind === 'derived-from-shrinkage'` and read the
    // `lostDerivationTargets` array verbatim from the JSON output.
    const report = emptyReport();
    report.regressions = [
      {
        kind: 'derived-from-shrinkage',
        fqid: 'R002.§1.AC.01',
        baselineSourceRefCount: 0,
        suggestedTombstoneTag: ':removed',
        locationHint: { filePath: '/p/note.md', line: 7 },
        lostDerivationTargets: ['R001.§1.AC.01', 'R001.§1.AC.02'],
      },
    ];
    report.summary.regressions = 1;
    const parsed = JSON.parse(formatDiffJson(report, true)) as Record<string, unknown>;
    const regressions = parsed.regressions as Array<Record<string, unknown>>;
    expect(regressions).toHaveLength(1);
    expect(regressions[0]!.kind).toBe('derived-from-shrinkage');
    expect(regressions[0]!.lostDerivationTargets).toEqual(['R001.§1.AC.01', 'R001.§1.AC.02']);
  });
});

describe('formatRegressionSuggestions — derived-from-shrinkage shape', () => {
  it('emits the two-option phrasing with both restoration and tombstone paths inline', () => {
    // §DC.61a: the suggestion MUST present BOTH the restoration path
    // (derives=<lost-target>) AND the tombstone path inline so neither
    // is hidden behind a substitute hint.
    const report = emptyReport();
    report.regressions = [
      {
        kind: 'derived-from-shrinkage',
        fqid: 'R002.§1.AC.01',
        baselineSourceRefCount: 2,
        suggestedTombstoneTag: ':removed',
        locationHint: { filePath: '/p/n.md', line: 9 },
        lostDerivationTargets: ['R001.§1.AC.01'],
      },
    ];
    const out = stripAnsi(formatRegressionSuggestions(report));
    expect(out).toContain('scepter meta add R002.§1.AC.01 derives=R001.§1.AC.01');
    expect(out).toContain('OR lifecycle=removed');
    expect(out).toContain('lifecycle=superseded=TARGET');
    expect(out).toContain('defined at /p/n.md:9');
  });

  it('omits location hint clause when locationHint is null', () => {
    const report = emptyReport();
    report.regressions = [
      {
        kind: 'derived-from-shrinkage',
        fqid: 'R002.§1.AC.01',
        baselineSourceRefCount: 0,
        suggestedTombstoneTag: ':removed',
        locationHint: null,
        lostDerivationTargets: ['R001.§1.AC.01'],
      },
    ];
    const out = stripAnsi(formatRegressionSuggestions(report));
    expect(out).toContain('scepter meta add R002.§1.AC.01 derives=R001.§1.AC.01');
    expect(out).not.toContain('defined at');
  });
});
