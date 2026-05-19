/**
 * Tests for the dry-run formatter.
 *
 * @validates {R015.§6.AC.05} dry-run flag emits manifest, no mutation
 * @validates {R015.§6.AC.07} dry-run output includes warnings and audits
 * @validates {DD020.§3.DC.09} dry-run is per-file/per-span before/after + warnings + audits
 */

import { describe, it, expect } from 'vitest';
import { formatDryRun } from './dry-run-formatter';
import type { RewritePlan, ReferenceSpan } from '../rewriter';

function makeSpan(opts: {
  filePath?: string;
  surface?: ReferenceSpan['surface'];
  byteRange?: [number, number];
  noteIdRange?: [number, number];
  originalText?: string;
  noteId?: string;
  aliasPrefix?: string;
}): ReferenceSpan {
  return {
    filePath: opts.filePath ?? '/proj/a.md',
    surface: opts.surface ?? 'markdown-body',
    byteRange: opts.byteRange ?? [0, 4],
    noteIdRange: opts.noteIdRange ?? [0, 4],
    originalText: opts.originalText ?? 'R005',
    parsedAddress: {
      raw: opts.originalText ?? 'R005',
      noteId: opts.noteId,
      aliasPrefix: opts.aliasPrefix,
    },
  };
}

function makeDeletePlan(): RewritePlan {
  return {
    operation: {
      kind: 'delete',
      target: 'R005',
      marker: '_deleted_R005_at_20260519',
    },
    plannedAt: '2026-05-19T14:30:00.000Z',
    fileEdits: [
      {
        filePath: '/proj/a.md',
        edits: [
          {
            span: makeSpan({
              filePath: '/proj/a.md',
              noteId: 'R005',
              noteIdRange: [4, 8],
              byteRange: [4, 8],
              originalText: 'R005',
            }),
            action: {
              kind: 'substitute',
              replacement: '_deleted_R005_at_20260519',
            },
          },
        ],
        audits: [],
        warnings: [],
      },
    ],
    removals: ['/proj/r005.md'],
    renames: [],
    warnings: [],
    audits: [],
  };
}

describe('formatDryRun — basic shape', () => {
  it('includes operation kind, target, marker, and planned-at header', () => {
    const out = formatDryRun(makeDeletePlan());
    expect(out).toContain('REWRITE DRY-RUN');
    expect(out).toContain('Operation: delete');
    expect(out).toContain('Target: R005');
    expect(out).toContain('Marker: _deleted_R005_at_20260519');
    expect(out).toContain('Planned at: 2026-05-19');
  });

  it('shows file blocks with byte ranges and after-text', () => {
    const out = formatDryRun(makeDeletePlan());
    expect(out).toContain('/proj/a.md');
    expect(out).toContain('markdown-body');
    expect(out).toContain('bytes 4..8');
    expect(out).toContain('_deleted_R005_at_20260519');
  });

  it('shows before-text when contentsBefore is provided', () => {
    const before = new Map<string, string>([['/proj/a.md', 'See R005 here']]);
    const out = formatDryRun(makeDeletePlan(), { contentsBefore: before });
    expect(out).toContain('before:');
    expect(out).toContain('R005');
  });

  it('shows removals and trailing summary', () => {
    const out = formatDryRun(makeDeletePlan());
    expect(out).toContain('Removals: 1');
    expect(out).toContain('/proj/r005.md');
    expect(out).toContain('1 file(s) to modify');
    expect(out).toContain('1 removal(s)');
  });
});

describe('formatDryRun — warnings and audits', () => {
  it('renders aggregate warnings', () => {
    const plan = makeDeletePlan();
    plan.warnings.push({
      span: makeSpan({
        filePath: '/proj/b.md',
        originalText: 'vendor-lib/R005',
        aliasPrefix: 'vendor-lib',
        noteId: 'R005',
      }),
      reason: 'cross-project-alias',
    });
    const out = formatDryRun(plan);
    expect(out).toContain('Aggregate warnings: 1');
    expect(out).toContain('cross-project-alias');
    expect(out).toContain('/proj/b.md');
  });

  it('renders aggregate audits', () => {
    const plan = makeDeletePlan();
    plan.audits.push({
      span: makeSpan({
        filePath: '/proj/a.test.ts',
        surface: 'source-string-literal',
        originalText: 'R005.§1.AC.03',
        noteId: 'R005',
      }),
      reason: 'test-name-embed',
    });
    const out = formatDryRun(plan);
    expect(out).toContain('Aggregate audits: 1');
    expect(out).toContain('test-name-embed');
    expect(out).toContain('/proj/a.test.ts');
  });
});

describe('formatDryRun — rename operation', () => {
  it('emits a rename header and rename section', () => {
    const plan: RewritePlan = {
      operation: { kind: 'rename', source: 'R005', target: 'R042' },
      plannedAt: '2026-05-19T14:30:00.000Z',
      fileEdits: [],
      removals: [],
      renames: [{ from: '/proj/R005.md', to: '/proj/R042.md' }],
      warnings: [],
      audits: [],
    };
    const out = formatDryRun(plan);
    expect(out).toContain('Operation: rename');
    expect(out).toContain('Source: R005');
    expect(out).toContain('Target: R042');
    expect(out).toContain('Renames: 1');
    expect(out).toContain('/proj/R005.md → /proj/R042.md');
  });
});

describe('formatDryRun — empty plan', () => {
  it('renders cleanly for a plan with no edits', () => {
    const plan: RewritePlan = {
      operation: { kind: 'archive', target: 'R005' },
      plannedAt: '2026-05-19T14:30:00.000Z',
      fileEdits: [],
      removals: [],
      renames: [],
      warnings: [],
      audits: [],
    };
    const out = formatDryRun(plan);
    expect(out).toContain('Operation: archive');
    expect(out).toContain('No file edits planned.');
    expect(out).toContain('0 file(s) to modify');
  });
});
