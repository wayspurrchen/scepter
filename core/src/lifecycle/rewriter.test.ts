/**
 * Tests for the rewriter engine — predicate dispatch, substitution,
 * plan construction.
 *
 * @validates {R015.§3.AC.05} cross-project alias refs warned and skipped
 * @validates {R015.§4.AC.01} delete operation substitutes inbound refs
 * @validates {R015.§4.AC.02} rename operation substitutes inbound refs
 * @validates {R015.§4.AC.03} archive operation does not invoke rewriter
 * @validates {DD020.§2.DC.01} span-substitution pipeline
 * @validates {DD020.§2.DC.04} bare-section refs are noops
 * @validates {DD020.§2.DC.05} substituter replaces only the note-ID byte range
 * @validates {DD020.§2.DC.05a} substituter preserves trailing claim path
 * @validates {DD020.§2.DC.07} alias-prefixed spans → warn-and-skip
 * @validates {DD020.§2.DC.19} renameRewritePredicate substitutes target
 * @validates {DD020.§2.DC.20} archive predicate noops
 * @validates {DD020.§2.DC.21} cross-project warnings accumulated
 * @validates {DD020.§3.DC.01} two-phase plan() — plan does not mutate
 * @validates {DD020.§7.DC.01} alias detection independent of operation
 */

import { describe, it, expect } from 'vitest';
import {
  applyActionsToContent,
  archiveRewritePredicate,
  deleteRewritePredicate,
  planRewrite,
  predicateFor,
  renameRewritePredicate,
  type DeleteOperation,
  type ReferenceSpan,
  type RenameOperation,
  type ArchiveOperation,
} from './rewriter';
import type { ClaimAddress } from '../parsers/claim/claim-parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpan(opts: {
  filePath?: string;
  surface?: ReferenceSpan['surface'];
  noteId?: string;
  aliasPrefix?: string;
  byteRange?: [number, number];
  noteIdRange?: [number, number];
  originalText?: string;
}): ReferenceSpan {
  const filePath = opts.filePath ?? '/proj/file.md';
  const surface = opts.surface ?? 'markdown-body';
  const originalText = opts.originalText ?? 'R005.§1.AC.03';
  const byteRange = opts.byteRange ?? [0, originalText.length];
  const noteIdRange =
    opts.noteIdRange ?? [byteRange[0], byteRange[0] + (opts.noteId?.length ?? 4)];
  const parsedAddress: ClaimAddress = {
    raw: originalText,
    noteId: opts.noteId,
  };
  if (opts.aliasPrefix !== undefined) {
    parsedAddress.aliasPrefix = opts.aliasPrefix;
  }
  return {
    filePath,
    surface,
    byteRange,
    noteIdRange,
    originalText,
    parsedAddress,
  };
}

const DELETE_OP: DeleteOperation = {
  kind: 'delete',
  target: 'R005',
  marker: '_deleted_R005_at_20260519',
};

const RENAME_OP: RenameOperation = {
  kind: 'rename',
  source: 'R005',
  target: 'R042',
};

const ARCHIVE_OP: ArchiveOperation = {
  kind: 'archive',
  target: 'R005',
};

// ---------------------------------------------------------------------------
// Predicate tests
// ---------------------------------------------------------------------------

describe('deleteRewritePredicate', () => {
  it('substitutes the marker for a matching note ID', () => {
    const span = makeSpan({ noteId: 'R005' });
    const action = deleteRewritePredicate(span, DELETE_OP);
    expect(action.kind).toBe('substitute');
    if (action.kind === 'substitute') {
      expect(action.replacement).toBe('_deleted_R005_at_20260519');
    }
  });

  it('noops for an unrelated note ID', () => {
    const span = makeSpan({ noteId: 'R007' });
    const action = deleteRewritePredicate(span, DELETE_OP);
    expect(action.kind).toBe('noop');
  });

  it('noops for bare-section refs (no noteId)', () => {
    const span = makeSpan({ noteId: undefined });
    const action = deleteRewritePredicate(span, DELETE_OP);
    expect(action.kind).toBe('noop');
  });

  it('warn-and-skip for cross-project alias refs even when the note ID matches', () => {
    const span = makeSpan({ noteId: 'R005', aliasPrefix: 'vendor-lib' });
    const action = deleteRewritePredicate(span, DELETE_OP);
    expect(action.kind).toBe('warn-and-skip');
    if (action.kind === 'warn-and-skip') {
      expect(action.reason).toBe('cross-project-alias');
    }
  });

  it('audit-only for source-string-literal surface', () => {
    const span = makeSpan({
      noteId: 'R005',
      surface: 'source-string-literal',
    });
    const action = deleteRewritePredicate(span, DELETE_OP);
    expect(action.kind).toBe('audit-only');
  });
});

describe('renameRewritePredicate', () => {
  it('substitutes the target ID for a matching source note ID', () => {
    const span = makeSpan({ noteId: 'R005' });
    const action = renameRewritePredicate(span, RENAME_OP);
    expect(action.kind).toBe('substitute');
    if (action.kind === 'substitute') {
      expect(action.replacement).toBe('R042');
    }
  });

  it('noops for an unrelated note ID', () => {
    const span = makeSpan({ noteId: 'R007' });
    const action = renameRewritePredicate(span, RENAME_OP);
    expect(action.kind).toBe('noop');
  });

  it('noops for bare-section refs (no noteId)', () => {
    const span = makeSpan({ noteId: undefined });
    const action = renameRewritePredicate(span, RENAME_OP);
    expect(action.kind).toBe('noop');
  });

  it('warn-and-skip for cross-project alias refs', () => {
    const span = makeSpan({ noteId: 'R005', aliasPrefix: 'vendor-lib' });
    const action = renameRewritePredicate(span, RENAME_OP);
    expect(action.kind).toBe('warn-and-skip');
  });

  it('audit-only for source-string-literal surface', () => {
    const span = makeSpan({
      noteId: 'R005',
      surface: 'source-string-literal',
    });
    const action = renameRewritePredicate(span, RENAME_OP);
    expect(action.kind).toBe('audit-only');
  });
});

describe('archiveRewritePredicate', () => {
  it('noops for every span — archive never rewrites', () => {
    const matching = makeSpan({ noteId: 'R005' });
    const unrelated = makeSpan({ noteId: 'R007' });
    const alias = makeSpan({ noteId: 'R005', aliasPrefix: 'vendor-lib' });
    for (const span of [matching, unrelated, alias]) {
      expect(archiveRewritePredicate(span, ARCHIVE_OP).kind).toBe('noop');
    }
  });
});

describe('predicateFor', () => {
  it('routes to the correct predicate by operation kind', () => {
    const span = makeSpan({ noteId: 'R005' });
    expect(predicateFor(DELETE_OP)(span).kind).toBe('substitute');
    expect(predicateFor(RENAME_OP)(span).kind).toBe('substitute');
    expect(predicateFor(ARCHIVE_OP)(span).kind).toBe('noop');
  });
});

// ---------------------------------------------------------------------------
// Substituter tests
// ---------------------------------------------------------------------------

describe('applyActionsToContent', () => {
  it('replaces only the note-ID byte range, preserving the trailing path', () => {
    const content = 'See {R005.§1.AC.03} for details.';
    const span = makeSpan({
      noteId: 'R005',
      byteRange: [5, 18],
      noteIdRange: [5, 9],
      originalText: 'R005.§1.AC.03',
    });
    const result = applyActionsToContent(content, [
      {
        span,
        action: { kind: 'substitute', replacement: '_deleted_R005_at_20260519' },
      },
    ]);
    expect(result).toBe(
      'See {_deleted_R005_at_20260519.§1.AC.03} for details.',
    );
  });

  it('preserves trailing inline metadata after the closing brace', () => {
    const content = '{R005.§1.AC.03} [inherent]';
    const span = makeSpan({
      noteId: 'R005',
      byteRange: [1, 14],
      noteIdRange: [1, 5],
      originalText: 'R005.§1.AC.03',
    });
    const result = applyActionsToContent(content, [
      {
        span,
        action: { kind: 'substitute', replacement: '_deleted_R005_at_20260519' },
      },
    ]);
    expect(result).toBe(
      '{_deleted_R005_at_20260519.§1.AC.03} [inherent]',
    );
  });

  it('applies multiple edits without offset drift (right-to-left ordering)', () => {
    const content = 'A:{R005} B:{R005.§1.AC.01} C:{R005.§2}';
    // Compute positions defensively so the test does not encode raw byte
    // arithmetic incorrectly. Each `{R005` occurrence's note-ID starts
    // one char after the `{`.
    const idx0 = content.indexOf('{R005');
    const idx1 = content.indexOf('{R005', idx0 + 1);
    const idx2 = content.indexOf('{R005', idx1 + 1);
    const edits = [
      {
        span: makeSpan({
          noteId: 'R005',
          byteRange: [idx0 + 1, idx0 + 5],
          noteIdRange: [idx0 + 1, idx0 + 5],
          originalText: 'R005',
        }),
        action: { kind: 'substitute' as const, replacement: 'XXXXX' },
      },
      {
        span: makeSpan({
          noteId: 'R005',
          byteRange: [idx1 + 1, idx1 + 14],
          noteIdRange: [idx1 + 1, idx1 + 5],
          originalText: 'R005.§1.AC.01',
        }),
        action: { kind: 'substitute' as const, replacement: 'XXXXX' },
      },
      {
        span: makeSpan({
          noteId: 'R005',
          byteRange: [idx2 + 1, idx2 + 8],
          noteIdRange: [idx2 + 1, idx2 + 5],
          originalText: 'R005.§2',
        }),
        action: { kind: 'substitute' as const, replacement: 'XXXXX' },
      },
    ];
    const result = applyActionsToContent(content, edits);
    expect(result).toBe('A:{XXXXX} B:{XXXXX.§1.AC.01} C:{XXXXX.§2}');
  });

  it('returns content unchanged when there are no edits', () => {
    const content = 'No refs here.';
    expect(applyActionsToContent(content, [])).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// Plan construction tests
// ---------------------------------------------------------------------------

describe('planRewrite', () => {
  it('produces edits for matching spans under delete', () => {
    const file = {
      filePath: '/proj/a.md',
      content: '{R005.§1.AC.03}',
      scanners: [
        () => [
          makeSpan({
            noteId: 'R005',
            byteRange: [1, 14],
            noteIdRange: [1, 5],
            originalText: 'R005.§1.AC.03',
            filePath: '/proj/a.md',
          }),
        ],
      ],
    };
    const plan = planRewrite(DELETE_OP, [file]);
    expect(plan.fileEdits).toHaveLength(1);
    expect(plan.fileEdits[0].edits).toHaveLength(1);
    expect(plan.fileEdits[0].edits[0].action.replacement).toBe(
      '_deleted_R005_at_20260519',
    );
  });

  it('accumulates cross-project warnings on the plan', () => {
    const file = {
      filePath: '/proj/a.md',
      content: '{vendor-lib/R005}',
      scanners: [
        () => [
          makeSpan({
            noteId: 'R005',
            aliasPrefix: 'vendor-lib',
            filePath: '/proj/a.md',
          }),
        ],
      ],
    };
    const plan = planRewrite(DELETE_OP, [file]);
    expect(plan.fileEdits[0].edits).toHaveLength(0);
    expect(plan.fileEdits[0].warnings).toHaveLength(1);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0].reason).toBe('cross-project-alias');
  });

  it('accumulates audits for test-name-embed surface (defensive — Phase 6 wires the scanner)', () => {
    const file = {
      filePath: '/proj/a.test.ts',
      content: 'it("R005.§1.AC.03 works", ...)',
      scanners: [
        () => [
          makeSpan({
            noteId: 'R005',
            surface: 'source-string-literal',
            filePath: '/proj/a.test.ts',
          }),
        ],
      ],
    };
    const plan = planRewrite(DELETE_OP, [file]);
    expect(plan.fileEdits[0].edits).toHaveLength(0);
    expect(plan.fileEdits[0].audits).toHaveLength(1);
    expect(plan.audits).toHaveLength(1);
  });

  it('drops files with no recorded actions', () => {
    const file = {
      filePath: '/proj/a.md',
      content: '{R007}',
      scanners: [
        () => [
          makeSpan({
            noteId: 'R007',
            filePath: '/proj/a.md',
          }),
        ],
      ],
    };
    const plan = planRewrite(DELETE_OP, [file]);
    expect(plan.fileEdits).toHaveLength(0);
  });

  it('is pure: same input produces same fileEdits regardless of invocation count', () => {
    const file = {
      filePath: '/proj/a.md',
      content: '{R005}',
      scanners: [
        () => [
          makeSpan({
            noteId: 'R005',
            filePath: '/proj/a.md',
          }),
        ],
      ],
    };
    const a = planRewrite(DELETE_OP, [file]);
    const b = planRewrite(DELETE_OP, [file]);
    expect(a.fileEdits).toEqual(b.fileEdits);
    expect(a.warnings).toEqual(b.warnings);
    expect(a.audits).toEqual(b.audits);
  });

  it('archive operation never produces edits', () => {
    const file = {
      filePath: '/proj/a.md',
      content: '{R005}',
      scanners: [
        () => [
          makeSpan({
            noteId: 'R005',
            filePath: '/proj/a.md',
          }),
        ],
      ],
    };
    const plan = planRewrite(ARCHIVE_OP, [file]);
    expect(plan.fileEdits).toHaveLength(0);
  });
});
