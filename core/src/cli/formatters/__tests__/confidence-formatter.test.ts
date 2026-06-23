/**
 * Confidence formatter tests. Realizes TS001 §6.AC.05, .AC.09 and the
 * apply summary/plan-table contracts in TS001 §8.
 *
 * @validates {S004.§2.AC.07}
 * @validates {S004.§2.AC.10}
 * @validates {S004.§4.AC.05}
 * @validates {S004.§4.AC.08}
 * @validates {S004.§7.AC.06} per-reviewer breakdown rendering ({R017})
 * @validates {DD017.§8.DC.42} renderScopeSection by-reviewer line + JSON carries byReviewer
 * @validates {TS001.§6.AC.05}
 * @validates {TS001.§6.AC.06}
 * @validates {TS001.§6.AC.09}
 * @validates {TS001.§8.AC.08}
 * @validates {TS001.§12.AC.09}
 */

import { describe, it, expect } from 'vitest';
import {
  formatConfidenceAudit,
  formatConfidenceAuditPaths,
  formatApplySummary,
  formatApplyPlanTable,
} from '../confidence-formatter.js';
import type { ConfidenceAuditResult } from '../../../claims/confidence/index.js';

function emptyScope() {
  return {
    total: 0,
    annotated: 0,
    unannotated: 0,
    byLevel: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    byReviewer: { '🤖': 0, '👤': 0 },
    files: [],
    unannotatedFiles: [],
  };
}

function bothPopulated(): ConfidenceAuditResult {
  return {
    total: 4,
    annotated: 2,
    unannotated: 2,
    byLevel: { 1: 0, 2: 1, 3: 0, 4: 1, 5: 0 },
    byReviewer: { '🤖': 1, '👤': 1 },
    files: [
      {
        reviewer: '🤖',
        level: 2,
        date: '2026-05-05',
        line: 1,
        filePath: 'core/src/foo.ts',
      },
      {
        reviewer: '👤',
        level: 4,
        date: '2026-05-05',
        line: 1,
        filePath: '/proj/_scepter/notes/reqs/R001.md',
      },
    ],
    unannotatedFiles: ['core/src/bar.ts', '/proj/_scepter/notes/reqs/R002.md'],
    bySource: {
      total: 2,
      annotated: 1,
      unannotated: 1,
      byLevel: { 1: 0, 2: 1, 3: 0, 4: 0, 5: 0 },
      byReviewer: { '🤖': 1, '👤': 0 },
      files: [
        {
          reviewer: '🤖',
          level: 2,
          date: '2026-05-05',
          line: 1,
          filePath: 'core/src/foo.ts',
        },
      ],
      unannotatedFiles: ['core/src/bar.ts'],
    },
    byNotes: {
      total: 2,
      annotated: 1,
      unannotated: 1,
      byLevel: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 },
      byReviewer: { '🤖': 0, '👤': 1 },
      files: [
        {
          reviewer: '👤',
          level: 4,
          date: '2026-05-05',
          line: 1,
          filePath: '/proj/_scepter/notes/reqs/R001.md',
        },
      ],
      unannotatedFiles: ['/proj/_scepter/notes/reqs/R002.md'],
    },
  };
}

describe('S004.§2.AC.07: per-scope sections + combined-totals (DC.34)', () => {
  it('emits Source and Notes sections plus combined-totals when both populated', () => {
    const out = formatConfidenceAudit(bothPopulated(), { scope: 'both' });
    expect(out).toContain('Source:');
    expect(out).toContain('Notes:');
    expect(out).toContain('Combined totals');
  });

  it('omits combined-totals when only source is populated', () => {
    const result = bothPopulated();
    result.byNotes = emptyScope();
    result.total = result.bySource.total;
    result.annotated = result.bySource.annotated;
    result.unannotated = result.bySource.unannotated;
    const out = formatConfidenceAudit(result, { scope: 'source' });
    expect(out).toContain('Source:');
    expect(out).not.toContain('Notes:');
    expect(out).not.toContain('Combined totals');
  });

  it('omits combined-totals when only notes is populated', () => {
    const result = bothPopulated();
    result.bySource = emptyScope();
    result.total = result.byNotes.total;
    result.annotated = result.byNotes.annotated;
    result.unannotated = result.byNotes.unannotated;
    const out = formatConfidenceAudit(result, { scope: 'notes' });
    expect(out).toContain('Notes:');
    expect(out).not.toContain('Source:');
    expect(out).not.toContain('Combined totals');
  });

  it('preserves the legacy json output shape via JSON.stringify', () => {
    const result = bothPopulated();
    const out = formatConfidenceAudit(result, { format: 'json' });
    const parsed = JSON.parse(out);
    expect(parsed.total).toBe(4);
    expect(parsed.bySource).toBeDefined();
    expect(parsed.byNotes).toBeDefined();
  });
});

describe('S004.§7.AC.06: per-reviewer breakdown rendering ({R017}, DD017.§8.DC.42)', () => {
  it('renderScopeSection emits a "By reviewer:" block with human and AI counts per scope', () => {
    const out = formatConfidenceAudit(bothPopulated(), { scope: 'both' });
    // The Source scope has one 🤖 annotation; the Notes scope has one 👤.
    expect(out).toContain('By reviewer:');
    // Both reviewer labels are surfaced.
    expect(out).toContain('Human');
    expect(out).toContain('AI');
  });

  it('json output carries the additive byReviewer field at every scope', () => {
    const out = formatConfidenceAudit(bothPopulated(), { format: 'json' });
    const parsed = JSON.parse(out);
    expect(parsed.byReviewer).toEqual({ '🤖': 1, '👤': 1 });
    expect(parsed.bySource.byReviewer).toEqual({ '🤖': 1, '👤': 0 });
    expect(parsed.byNotes.byReviewer).toEqual({ '🤖': 0, '👤': 1 });
  });
});

describe('S004.§2.AC.10: --paths breakdown is plaintext-friendly under non-TTY (DC.35)', () => {
  it('emits no ANSI escape codes when tty: false', () => {
    const out = formatConfidenceAuditPaths(bothPopulated(), { tty: false });
    expect(out).not.toMatch(/\x1b\[/);
  });

  it('emits no Unicode box-drawing characters when tty: false', () => {
    const out = formatConfidenceAuditPaths(bothPopulated(), { tty: false });
    expect(out).not.toMatch(/[─-╿]/);
  });

  it('groups files by directory, lexicographically sorted', () => {
    const out = formatConfidenceAuditPaths(bothPopulated(), { tty: false });
    const dirs = out
      .split('\n')
      .filter((l) => !l.startsWith('  ') && l.length > 0);
    const sorted = [...dirs].sort();
    expect(dirs).toEqual(sorted);
  });

  it('labels annotated files with reviewer+level+date and unannotated with literal "unannotated"', () => {
    const out = formatConfidenceAuditPaths(bothPopulated(), { tty: false });
    expect(out).toContain('🤖2 2026-05-05');
    expect(out).toContain('unannotated');
  });

  // TS001.§6.AC.06: --paths must be compatible with --source-only,
  // --notes-only. The formatter accepts a `scope` option and excludes
  // the unrequested scope's entries from the breakdown.
  it('--paths --source-only emits only source files (no notes)', () => {
    const out = formatConfidenceAuditPaths(bothPopulated(), {
      tty: false,
      scope: 'source',
    });
    expect(out).toContain('foo.ts');
    expect(out).toContain('bar.ts');
    expect(out).not.toContain('R001.md');
    expect(out).not.toContain('R002.md');
  });

  it('--paths --notes-only emits only notes (no source)', () => {
    const out = formatConfidenceAuditPaths(bothPopulated(), {
      tty: false,
      scope: 'notes',
    });
    expect(out).toContain('R001.md');
    expect(out).toContain('R002.md');
    expect(out).not.toContain('foo.ts');
    expect(out).not.toContain('bar.ts');
  });

  it('--paths default (scope=both) emits source and notes together', () => {
    const out = formatConfidenceAuditPaths(bothPopulated(), { tty: false });
    expect(out).toContain('foo.ts');
    expect(out).toContain('R001.md');
  });
});

describe('S004.§4.AC.08: applyOutcome summary (DC.36)', () => {
  it('emits five counters', () => {
    const out = formatApplySummary({
      marked: 3,
      replaced: 1,
      skippedAnnotated: 5,
      skippedUnmatched: 2,
      failed: [],
    });
    expect(out).toContain('marked:');
    expect(out).toContain('replaced:');
    expect(out).toContain('skipped-annotated:');
    expect(out).toContain('skipped-unmatched:');
    expect(out).toContain('failed:');
  });

  it('lists failure paths and messages when failed > 0', () => {
    const out = formatApplySummary({
      marked: 0,
      replaced: 0,
      skippedAnnotated: 0,
      skippedUnmatched: 0,
      failed: [{ path: 'a.md', error: 'parse error' }],
    });
    expect(out).toContain('a.md');
    expect(out).toContain('parse error');
  });
});

describe('S004.§4.AC.05: apply plan table (DC.37)', () => {
  it('renders cli-table3 with five columns', () => {
    const out = formatApplyPlanTable([
      {
        path: 'core/src/foo.ts',
        scope: 'source',
        current: '-',
        proposed: '🤖2 2026-05-05',
        action: 'mark',
      },
    ]);
    expect(out).toContain('path');
    expect(out).toContain('scope');
    expect(out).toContain('current');
    expect(out).toContain('proposed');
    expect(out).toContain('action');
    expect(out).toContain('mark');
  });
});
