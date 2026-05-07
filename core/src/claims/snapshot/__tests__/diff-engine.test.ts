/**
 * Unit tests for the snapshot diff engine.  Covers every category
 * (lost, new, body-changed, heading/metadata, source-ref drift,
 * note-ref drift) plus the regression-gate stages
 * (untombstoned-loss, dangling-source-coverage,
 * derived-from-shrinkage) and the snapshot-vs-snapshot lifecycle-tag
 * fallback per §DC.53.
 *
 * Synthetic inputs only — no filesystem I/O, no real ClaimIndex.
 *
 * @validates {DD018.§3.DC.47} computeDiff entry point + four-stage pipeline
 * @validates {DD018.§3.DC.48} stage 2 set difference (lost/new)
 * @validates {DD018.§3.DC.49} stage 3 content drift (body, heading/metadata, refs)
 * @validates {DD018.§3.DC.50} stage 4 untombstoned-loss regression
 * @validates {DD018.§3.DC.51} stage 4 dangling-source-coverage regression
 * @validates {DD018.§3.DC.51a} derivedFrom shrinkage detection
 * @validates {DD018.§3.DC.51b} derived-from-shrinkage regression with tombstone exemption
 * @validates {DD018.§3.DC.53} snapshot-vs-snapshot lifecycle-tag fallback
 * @validates {DD018.§3.DC.40} LostClaimFinding shape
 * @validates {DD018.§3.DC.41} NewClaimFinding shape
 * @validates {DD018.§3.DC.42} BodyChangedFinding shape
 * @validates {DD018.§3.DC.43} HeadingMetadataFinding shape
 * @validates {DD018.§3.DC.44} SourceRefDriftFinding equality on (filePath, line, refKind)
 * @validates {DD018.§3.DC.45} NoteRefDriftFinding shape
 * @validates {DD018.§3.DC.46} RegressionFinding shape
 */

import { describe, it, expect } from 'vitest';
import { computeDiff } from '../diff-engine';
import type { SnapshotSide, TombstoneContext } from '../diff-types';
import type {
  SnapshotClaimEntry,
  SnapshotLifecycle,
  SnapshotNoteEntry,
  SnapshotSourceRef,
} from '../snapshot-types';
import type { ClaimIndexEntry } from '../../claim-index';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface ClaimOverrides {
  fqid: string;
  noteId?: string;
  noteType?: string;
  heading?: string;
  lifecycle?: SnapshotLifecycle | null;
  importance?: number | null;
  derivedFrom?: string[];
  incomingNoteRefs?: string[];
  incomingSourceRefs?: SnapshotSourceRef[];
  bodyHash?: string;
}

function claim(o: ClaimOverrides): SnapshotClaimEntry {
  return {
    fqid: o.fqid,
    noteId: o.noteId ?? o.fqid.split('.')[0],
    noteType: o.noteType ?? 'Requirement',
    heading: o.heading ?? `heading for ${o.fqid}`,
    lifecycle: o.lifecycle ?? null,
    importance: o.importance ?? null,
    derivedFrom: o.derivedFrom ?? [],
    incomingNoteRefs: o.incomingNoteRefs ?? [],
    incomingSourceRefs: o.incomingSourceRefs ?? [],
    bodyHash: o.bodyHash ?? `hash:${o.fqid}`,
  };
}

function note(noteId: string, claimFqids: string[]): SnapshotNoteEntry {
  return {
    noteId,
    noteTitle: noteId,
    claimFqids,
    noteContentHash: `noteHash:${noteId}`,
  };
}

function side(
  kind: 'snapshot' | 'live',
  claims: SnapshotClaimEntry[],
  notes: SnapshotNoteEntry[] = [],
): SnapshotSide {
  const claimMap = new Map<string, SnapshotClaimEntry>();
  for (const c of claims) claimMap.set(c.fqid, c);
  const noteMap = new Map<string, SnapshotNoteEntry>();
  for (const n of notes) noteMap.set(n.noteId, n);
  return {
    kind,
    claims: claimMap,
    notes: noteMap,
    metadata:
      kind === 'snapshot'
        ? {
            schemaVersion: 1,
            capturedAt: '2026-05-06T00:00:00.000Z',
            projectRoot: '/p',
            gitCommit: null,
          }
        : null,
  };
}

function emptyTombstoneCtx(): TombstoneContext {
  return {
    liveEntries: new Map<string, ClaimIndexEntry>(),
    bodyResolver: () => '',
    cache: new Map<string, boolean>(),
  };
}

function liveEntryFor(fqid: string, opts?: { lifecycle?: ClaimIndexEntry['lifecycle']; body?: string }): ClaimIndexEntry {
  const noteId = fqid.split('.')[0];
  return {
    noteId,
    claimId: 'AC.01',
    fullyQualified: fqid,
    sectionPath: [1],
    claimPrefix: 'AC',
    claimNumber: 1,
    heading: `heading for ${fqid}`,
    line: 10,
    endLine: 12,
    metadata: [],
    parsedTags: [],
    derivedFrom: [],
    noteType: 'Requirement',
    noteFilePath: `/p/_scepter/notes/${noteId}.md`,
    lifecycle: opts?.lifecycle,
  };
}

// ---------------------------------------------------------------------------
// Stage 2 — set difference
// ---------------------------------------------------------------------------

describe('computeDiff — stage 2 (set difference)', () => {
  it('lostClaims for FQIDs in baseline but not candidate', () => {
    const baseline = side('snapshot', [claim({ fqid: 'R001.§1.AC.01' }), claim({ fqid: 'R001.§1.AC.02' })]);
    const candidate = side('live', [claim({ fqid: 'R001.§1.AC.01' })]);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: null });
    expect(report.lostClaims.map((f) => f.fqid)).toEqual(['R001.§1.AC.02']);
    expect(report.lostClaims[0]!.baselineHeading).toBe('heading for R001.§1.AC.02');
    expect(report.summary.lost).toBe(1);
  });

  it('newClaims for FQIDs in candidate but not baseline', () => {
    const baseline = side('snapshot', [claim({ fqid: 'R001.§1.AC.01' })]);
    const candidate = side('live', [
      claim({ fqid: 'R001.§1.AC.01' }),
      claim({ fqid: 'R001.§1.AC.02' }),
    ]);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: null });
    expect(report.newClaims.map((f) => f.fqid)).toEqual(['R001.§1.AC.02']);
    expect(report.summary.new).toBe(1);
  });

  it('returns empty arrays when sides are identical', () => {
    const a = claim({ fqid: 'R001.§1.AC.01' });
    const baseline = side('snapshot', [a]);
    const candidate = side('live', [{ ...a }]);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: null });
    expect(report.summary).toEqual({
      lost: 0,
      new: 0,
      bodyChanged: 0,
      headingOrMetadataChanged: 0,
      sourceRefDrift: 0,
      incomingNoteRefDrift: 0,
      regressions: 0,
    });
  });

  it('lostClaims and newClaims are sorted by fqid', () => {
    const baseline = side('snapshot', [
      claim({ fqid: 'R001.§1.AC.03' }),
      claim({ fqid: 'R001.§1.AC.01' }),
    ]);
    const candidate = side('live', [
      claim({ fqid: 'R001.§1.AC.04' }),
      claim({ fqid: 'R001.§1.AC.02' }),
    ]);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: null });
    expect(report.lostClaims.map((f) => f.fqid)).toEqual(['R001.§1.AC.01', 'R001.§1.AC.03']);
    expect(report.newClaims.map((f) => f.fqid)).toEqual(['R001.§1.AC.02', 'R001.§1.AC.04']);
  });
});

// ---------------------------------------------------------------------------
// Stage 3 — body-hash drift
// ---------------------------------------------------------------------------

describe('computeDiff — stage 3 body-hash drift', () => {
  it('reports bodyChanged when bodyHash differs on a shared FQID', () => {
    const baseline = side('snapshot', [claim({ fqid: 'R001.§1.AC.01', bodyHash: 'h1' })]);
    const candidate = side('live', [claim({ fqid: 'R001.§1.AC.01', bodyHash: 'h2' })]);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: null });
    expect(report.bodyChanged).toEqual([
      { fqid: 'R001.§1.AC.01', baselineBodyHash: 'h1', candidateBodyHash: 'h2' },
    ]);
    expect(report.headingOrMetadataChanged).toHaveLength(0);
  });

  it('does not report bodyChanged when bodyHash matches', () => {
    const baseline = side('snapshot', [claim({ fqid: 'R001.§1.AC.01', bodyHash: 'h1' })]);
    const candidate = side('live', [claim({ fqid: 'R001.§1.AC.01', bodyHash: 'h1' })]);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: null });
    expect(report.bodyChanged).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Stage 3 — heading / metadata drift
// ---------------------------------------------------------------------------

describe('computeDiff — stage 3 heading/metadata drift', () => {
  it('reports heading change as a single field-level entry', () => {
    const baseline = side('snapshot', [claim({ fqid: 'R001.§1.AC.01', heading: 'old' })]);
    const candidate = side('live', [claim({ fqid: 'R001.§1.AC.01', heading: 'new' })]);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: null });
    expect(report.headingOrMetadataChanged).toHaveLength(1);
    expect(report.headingOrMetadataChanged[0]!.changes).toEqual([
      { field: 'heading', baseline: 'old', candidate: 'new' },
    ]);
  });

  it('reports lifecycle change with deep-equality on object', () => {
    const baseline = side('snapshot', [claim({ fqid: 'R001.§1.AC.01', lifecycle: null })]);
    const candidate = side('live', [
      claim({ fqid: 'R001.§1.AC.01', lifecycle: { type: 'removed' } }),
    ]);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: null });
    expect(report.headingOrMetadataChanged[0]!.changes).toEqual([
      { field: 'lifecycle', baseline: null, candidate: { type: 'removed' } },
    ]);
  });

  it('reports importance change', () => {
    const baseline = side('snapshot', [claim({ fqid: 'R001.§1.AC.01', importance: 3 })]);
    const candidate = side('live', [claim({ fqid: 'R001.§1.AC.01', importance: 5 })]);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: null });
    expect(report.headingOrMetadataChanged[0]!.changes).toEqual([
      { field: 'importance', baseline: 3, candidate: 5 },
    ]);
  });

  it('reports derivedFrom set change with order-insensitive equality', () => {
    const baseline = side('snapshot', [claim({ fqid: 'R002.§1.AC.01', derivedFrom: ['R001.§1.AC.01', 'R001.§1.AC.02'] })]);
    const candidate = side('live', [
      claim({ fqid: 'R002.§1.AC.01', derivedFrom: ['R001.§1.AC.02', 'R001.§1.AC.01'] }),
    ]);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: null });
    expect(report.headingOrMetadataChanged).toHaveLength(0);
  });

  it('reports derivedFrom growth as a heading-or-metadata change (not a regression input)', () => {
    const baseline = side('snapshot', [claim({ fqid: 'R002.§1.AC.01', derivedFrom: ['R001.§1.AC.01'] })]);
    const candidate = side('live', [
      claim({ fqid: 'R002.§1.AC.01', derivedFrom: ['R001.§1.AC.01', 'R001.§1.AC.02'] }),
    ]);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: emptyTombstoneCtx() });
    expect(report.headingOrMetadataChanged).toHaveLength(1);
    expect(report.regressions).toHaveLength(0);
  });

  it('aggregates multiple field changes on the same claim into one finding', () => {
    const baseline = side('snapshot', [
      claim({ fqid: 'R001.§1.AC.01', heading: 'old', importance: 3 }),
    ]);
    const candidate = side('live', [
      claim({ fqid: 'R001.§1.AC.01', heading: 'new', importance: 5 }),
    ]);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: null });
    expect(report.headingOrMetadataChanged).toHaveLength(1);
    expect(report.headingOrMetadataChanged[0]!.changes.map((c) => c.field).sort()).toEqual(['heading', 'importance']);
  });
});

// ---------------------------------------------------------------------------
// Stage 3 — source-ref drift
// ---------------------------------------------------------------------------

describe('computeDiff — stage 3 source-ref drift', () => {
  function srcRef(filePath: string, line: number, refKind = 'implements'): SnapshotSourceRef {
    return { filePath, line, refKind };
  }

  it('reports lost source-refs', () => {
    const baseline = side('snapshot', [
      claim({ fqid: 'R001.§1.AC.01', incomingSourceRefs: [srcRef('a.ts', 10), srcRef('b.ts', 20)] }),
    ]);
    const candidate = side('live', [
      claim({ fqid: 'R001.§1.AC.01', incomingSourceRefs: [srcRef('a.ts', 10)] }),
    ]);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: null });
    expect(report.sourceRefDrift).toHaveLength(1);
    expect(report.sourceRefDrift[0]!.lost).toEqual([srcRef('b.ts', 20)]);
    expect(report.sourceRefDrift[0]!.gained).toEqual([]);
  });

  it('reports gained source-refs', () => {
    const baseline = side('snapshot', [
      claim({ fqid: 'R001.§1.AC.01', incomingSourceRefs: [srcRef('a.ts', 10)] }),
    ]);
    const candidate = side('live', [
      claim({ fqid: 'R001.§1.AC.01', incomingSourceRefs: [srcRef('a.ts', 10), srcRef('c.ts', 30)] }),
    ]);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: null });
    expect(report.sourceRefDrift[0]!.gained).toEqual([srcRef('c.ts', 30)]);
  });

  it('treats line-only differences as one lost + one gained (not "moved")', () => {
    const baseline = side('snapshot', [
      claim({ fqid: 'R001.§1.AC.01', incomingSourceRefs: [srcRef('a.ts', 10)] }),
    ]);
    const candidate = side('live', [
      claim({ fqid: 'R001.§1.AC.01', incomingSourceRefs: [srcRef('a.ts', 11)] }),
    ]);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: null });
    expect(report.sourceRefDrift[0]!.lost).toEqual([srcRef('a.ts', 10)]);
    expect(report.sourceRefDrift[0]!.gained).toEqual([srcRef('a.ts', 11)]);
  });

  it('treats refKind-only differences as one lost + one gained', () => {
    const baseline = side('snapshot', [
      claim({ fqid: 'R001.§1.AC.01', incomingSourceRefs: [srcRef('a.ts', 10, 'implements')] }),
    ]);
    const candidate = side('live', [
      claim({ fqid: 'R001.§1.AC.01', incomingSourceRefs: [srcRef('a.ts', 10, 'see')] }),
    ]);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: null });
    expect(report.sourceRefDrift[0]!.lost).toEqual([srcRef('a.ts', 10, 'implements')]);
    expect(report.sourceRefDrift[0]!.gained).toEqual([srcRef('a.ts', 10, 'see')]);
  });

  it('does not emit a finding when source-refs are identical', () => {
    const refs = [srcRef('a.ts', 10), srcRef('b.ts', 20)];
    const baseline = side('snapshot', [claim({ fqid: 'R001.§1.AC.01', incomingSourceRefs: refs })]);
    const candidate = side('live', [claim({ fqid: 'R001.§1.AC.01', incomingSourceRefs: [...refs] })]);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: null });
    expect(report.sourceRefDrift).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Stage 3 — note-ref drift
// ---------------------------------------------------------------------------

describe('computeDiff — stage 3 incoming-note-ref drift', () => {
  it('reports lost and gained note-refs', () => {
    const baseline = side('snapshot', [
      claim({ fqid: 'R001.§1.AC.01', incomingNoteRefs: ['DD001.§1.DC.01', 'DD002.§1.DC.01'] }),
    ]);
    const candidate = side('live', [
      claim({ fqid: 'R001.§1.AC.01', incomingNoteRefs: ['DD002.§1.DC.01', 'DD003.§1.DC.01'] }),
    ]);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: null });
    expect(report.incomingNoteRefDrift).toHaveLength(1);
    expect(report.incomingNoteRefDrift[0]!.lost).toEqual(['DD001.§1.DC.01']);
    expect(report.incomingNoteRefDrift[0]!.gained).toEqual(['DD003.§1.DC.01']);
  });

  it('does not emit a finding when note-refs are identical regardless of order', () => {
    const baseline = side('snapshot', [
      claim({ fqid: 'R001.§1.AC.01', incomingNoteRefs: ['DD001.§1.DC.01', 'DD002.§1.DC.01'] }),
    ]);
    const candidate = side('live', [
      claim({ fqid: 'R001.§1.AC.01', incomingNoteRefs: ['DD002.§1.DC.01', 'DD001.§1.DC.01'] }),
    ]);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: null });
    expect(report.incomingNoteRefDrift).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Stage 4 — regression gate
// ---------------------------------------------------------------------------

describe('computeDiff — stage 4 regression gate (untombstoned-loss)', () => {
  it('marks lost claim as regression when no live tombstone', () => {
    const baseline = side('snapshot', [claim({ fqid: 'R001.§1.AC.01' })]);
    const candidate = side('live', []);
    // No live entry — claim is gone; gate treats as regression.
    const report = computeDiff({
      baseline,
      candidate,
      tombstoneCtx: emptyTombstoneCtx(),
    });
    expect(report.lostClaims).toHaveLength(1);
    expect(report.lostClaims[0]!.isRegression).toBe(true);
    expect(report.regressions).toHaveLength(1);
    expect(report.regressions[0]!.kind).toBe('untombstoned-loss');
    expect(report.regressions[0]!.fqid).toBe('R001.§1.AC.01');
  });

  it('does NOT mark lost claim as regression when live entry has lifecycle=removed', () => {
    const baseline = side('snapshot', [claim({ fqid: 'R001.§1.AC.01' })]);
    const candidate = side('live', []);
    const ctx: TombstoneContext = {
      liveEntries: new Map([
        ['R001.§1.AC.01', liveEntryFor('R001.§1.AC.01', { lifecycle: { type: 'removed' } })],
      ]),
      bodyResolver: () => 'body content',
      cache: new Map(),
    };
    const report = computeDiff({ baseline, candidate, tombstoneCtx: ctx });
    expect(report.lostClaims[0]!.isRegression).toBe(false);
    expect(report.regressions).toHaveLength(0);
  });

  it('does NOT mark lost claim as regression when live entry has lifecycle=superseded', () => {
    const baseline = side('snapshot', [claim({ fqid: 'R001.§1.AC.01' })]);
    const candidate = side('live', []);
    const ctx: TombstoneContext = {
      liveEntries: new Map([
        [
          'R001.§1.AC.01',
          liveEntryFor('R001.§1.AC.01', {
            lifecycle: { type: 'superseded', target: 'R002.§1.AC.01' },
          }),
        ],
      ]),
      bodyResolver: () => '',
      cache: new Map(),
    };
    const report = computeDiff({ baseline, candidate, tombstoneCtx: ctx });
    expect(report.regressions).toHaveLength(0);
  });

  it('falls through to bodyResolver and matches "Removed."', () => {
    const baseline = side('snapshot', [claim({ fqid: 'R001.§1.AC.01' })]);
    const candidate = side('live', []);
    const ctx: TombstoneContext = {
      liveEntries: new Map([['R001.§1.AC.01', liveEntryFor('R001.§1.AC.01')]]),
      bodyResolver: () => 'Removed.',
      cache: new Map(),
    };
    const report = computeDiff({ baseline, candidate, tombstoneCtx: ctx });
    expect(report.regressions).toHaveLength(0);
  });

  it('regression when live entry exists but body is not a tombstone', () => {
    const baseline = side('snapshot', [claim({ fqid: 'R001.§1.AC.01' })]);
    const candidate = side('live', []);
    const ctx: TombstoneContext = {
      liveEntries: new Map([['R001.§1.AC.01', liveEntryFor('R001.§1.AC.01')]]),
      bodyResolver: () => 'normal body content',
      cache: new Map(),
    };
    const report = computeDiff({ baseline, candidate, tombstoneCtx: ctx });
    expect(report.regressions).toHaveLength(1);
  });

  it('does not run regression gate when tombstoneCtx is null', () => {
    const baseline = side('snapshot', [claim({ fqid: 'R001.§1.AC.01' })]);
    const candidate = side('live', []);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: null });
    expect(report.lostClaims[0]!.isRegression).toBe(false);
    expect(report.regressions).toHaveLength(0);
  });
});

describe('computeDiff — stage 4 regression gate (dangling-source-coverage)', () => {
  function srcRef(p: string, line: number): SnapshotSourceRef {
    return { filePath: p, line, refKind: 'implements' };
  }

  it('emits dangling-source-coverage when refs go from >0 to 0', () => {
    const baseline = side('snapshot', [
      claim({ fqid: 'R001.§1.AC.01', incomingSourceRefs: [srcRef('a.ts', 10)] }),
    ]);
    const candidate = side('live', [
      claim({ fqid: 'R001.§1.AC.01', incomingSourceRefs: [] }),
    ]);
    const ctx: TombstoneContext = {
      liveEntries: new Map([['R001.§1.AC.01', liveEntryFor('R001.§1.AC.01')]]),
      bodyResolver: () => 'normal body',
      cache: new Map(),
    };
    const report = computeDiff({ baseline, candidate, tombstoneCtx: ctx });
    expect(report.regressions).toHaveLength(1);
    expect(report.regressions[0]!.kind).toBe('dangling-source-coverage');
    expect(report.regressions[0]!.baselineSourceRefCount).toBe(1);
    expect(report.regressions[0]!.locationHint).toEqual({
      filePath: '/p/_scepter/notes/R001.md',
      line: 10,
    });
  });

  it('does NOT emit dangling-source-coverage when claim is tombstoned', () => {
    const baseline = side('snapshot', [
      claim({ fqid: 'R001.§1.AC.01', incomingSourceRefs: [srcRef('a.ts', 10)] }),
    ]);
    const candidate = side('live', [claim({ fqid: 'R001.§1.AC.01', incomingSourceRefs: [] })]);
    const ctx: TombstoneContext = {
      liveEntries: new Map([
        ['R001.§1.AC.01', liveEntryFor('R001.§1.AC.01', { lifecycle: { type: 'removed' } })],
      ]),
      bodyResolver: () => '',
      cache: new Map(),
    };
    const report = computeDiff({ baseline, candidate, tombstoneCtx: ctx });
    expect(report.regressions).toHaveLength(0);
  });

  it('does NOT emit when ref count went from 0 to 0', () => {
    const baseline = side('snapshot', [claim({ fqid: 'R001.§1.AC.01', incomingSourceRefs: [] })]);
    const candidate = side('live', [claim({ fqid: 'R001.§1.AC.01', incomingSourceRefs: [] })]);
    const ctx: TombstoneContext = {
      liveEntries: new Map([['R001.§1.AC.01', liveEntryFor('R001.§1.AC.01')]]),
      bodyResolver: () => '',
      cache: new Map(),
    };
    const report = computeDiff({ baseline, candidate, tombstoneCtx: ctx });
    expect(report.regressions).toHaveLength(0);
  });
});

describe('computeDiff — stage 4 regression gate (derived-from-shrinkage)', () => {
  it('detects strict shrinkage as a regression when not tombstoned', () => {
    const baseline = side('snapshot', [
      claim({ fqid: 'R002.§1.AC.01', derivedFrom: ['R001.§1.AC.01', 'R001.§1.AC.02'] }),
    ]);
    const candidate = side('live', [
      claim({ fqid: 'R002.§1.AC.01', derivedFrom: ['R001.§1.AC.01'] }),
    ]);
    const ctx: TombstoneContext = {
      liveEntries: new Map([['R002.§1.AC.01', liveEntryFor('R002.§1.AC.01')]]),
      bodyResolver: () => 'normal',
      cache: new Map(),
    };
    const report = computeDiff({ baseline, candidate, tombstoneCtx: ctx });
    const shrinkage = report.regressions.filter((r) => r.kind === 'derived-from-shrinkage');
    expect(shrinkage).toHaveLength(1);
    expect(shrinkage[0]!.lostDerivationTargets).toEqual(['R001.§1.AC.02']);
    expect(shrinkage[0]!.fqid).toBe('R002.§1.AC.01');
  });

  it('does NOT regress on growth (candidate adds new derives=)', () => {
    const baseline = side('snapshot', [claim({ fqid: 'R002.§1.AC.01', derivedFrom: ['R001.§1.AC.01'] })]);
    const candidate = side('live', [
      claim({ fqid: 'R002.§1.AC.01', derivedFrom: ['R001.§1.AC.01', 'R001.§1.AC.02'] }),
    ]);
    const ctx: TombstoneContext = {
      liveEntries: new Map([['R002.§1.AC.01', liveEntryFor('R002.§1.AC.01')]]),
      bodyResolver: () => '',
      cache: new Map(),
    };
    const report = computeDiff({ baseline, candidate, tombstoneCtx: ctx });
    expect(report.regressions.filter((r) => r.kind === 'derived-from-shrinkage')).toHaveLength(0);
  });

  it('does NOT regress when claim is tombstoned in live index', () => {
    const baseline = side('snapshot', [
      claim({ fqid: 'R002.§1.AC.01', derivedFrom: ['R001.§1.AC.01', 'R001.§1.AC.02'] }),
    ]);
    const candidate = side('live', [claim({ fqid: 'R002.§1.AC.01', derivedFrom: ['R001.§1.AC.01'] })]);
    const ctx: TombstoneContext = {
      liveEntries: new Map([
        ['R002.§1.AC.01', liveEntryFor('R002.§1.AC.01', { lifecycle: { type: 'removed' } })],
      ]),
      bodyResolver: () => '',
      cache: new Map(),
    };
    const report = computeDiff({ baseline, candidate, tombstoneCtx: ctx });
    expect(report.regressions.filter((r) => r.kind === 'derived-from-shrinkage')).toHaveLength(0);
  });

  it('emits multiple lost-targets in a single regression finding (formatter splits per target)', () => {
    const baseline = side('snapshot', [
      claim({ fqid: 'R002.§1.AC.01', derivedFrom: ['R001.§1.AC.01', 'R001.§1.AC.02', 'R001.§1.AC.03'] }),
    ]);
    const candidate = side('live', [claim({ fqid: 'R002.§1.AC.01', derivedFrom: ['R001.§1.AC.01'] })]);
    const ctx: TombstoneContext = {
      liveEntries: new Map([['R002.§1.AC.01', liveEntryFor('R002.§1.AC.01')]]),
      bodyResolver: () => '',
      cache: new Map(),
    };
    const report = computeDiff({ baseline, candidate, tombstoneCtx: ctx });
    const shrinkage = report.regressions.filter((r) => r.kind === 'derived-from-shrinkage');
    expect(shrinkage).toHaveLength(1);
    expect(shrinkage[0]!.lostDerivationTargets!.sort()).toEqual(['R001.§1.AC.02', 'R001.§1.AC.03']);
  });

  it('produces zero shrinkage findings when sets are reordered but equal', () => {
    const baseline = side('snapshot', [
      claim({ fqid: 'R002.§1.AC.01', derivedFrom: ['R001.§1.AC.01', 'R001.§1.AC.02'] }),
    ]);
    const candidate = side('live', [
      claim({ fqid: 'R002.§1.AC.01', derivedFrom: ['R001.§1.AC.02', 'R001.§1.AC.01'] }),
    ]);
    const ctx: TombstoneContext = {
      liveEntries: new Map([['R002.§1.AC.01', liveEntryFor('R002.§1.AC.01')]]),
      bodyResolver: () => '',
      cache: new Map(),
    };
    const report = computeDiff({ baseline, candidate, tombstoneCtx: ctx });
    expect(report.regressions.filter((r) => r.kind === 'derived-from-shrinkage')).toHaveLength(0);
    expect(report.headingOrMetadataChanged).toHaveLength(0);
  });

  it('a claim added in next with empty derivedFrom produces a "new" finding, not a derivedFrom finding', () => {
    // Brief sub-case: `derivedFrom`-shrinkage detection must only consider
    // shared-FQID claims.  An added claim is captured under `newClaims`
    // and contributes nothing to `regressions[kind=derived-from-shrinkage]`.
    const baseline = side('snapshot', []);
    const candidate = side('live', [claim({ fqid: 'R002.§1.AC.01', derivedFrom: [] })]);
    const ctx: TombstoneContext = {
      liveEntries: new Map([['R002.§1.AC.01', liveEntryFor('R002.§1.AC.01')]]),
      bodyResolver: () => '',
      cache: new Map(),
    };
    const report = computeDiff({ baseline, candidate, tombstoneCtx: ctx });
    expect(report.newClaims).toHaveLength(1);
    expect(report.newClaims[0]!.fqid).toBe('R002.§1.AC.01');
    expect(report.regressions.filter((r) => r.kind === 'derived-from-shrinkage')).toHaveLength(0);
  });

  it('a claim removed in next does NOT also produce a derivedFrom-shrinkage finding (no double-count)', () => {
    // Brief sub-case: when the claim is gone from candidate, the loss is
    // categorized as `untombstoned-loss` per §DC.50; the shrinkage gate
    // (§DC.51b) operates only on shared-FQID pairs and MUST NOT also
    // emit a derived-from-shrinkage entry for the same FQID.
    const baseline = side('snapshot', [
      claim({ fqid: 'R002.§1.AC.01', derivedFrom: ['R001.§1.AC.01', 'R001.§1.AC.02'] }),
    ]);
    const candidate = side('live', []);
    const ctx: TombstoneContext = {
      liveEntries: new Map([['R002.§1.AC.01', liveEntryFor('R002.§1.AC.01')]]),
      bodyResolver: () => '',
      cache: new Map(),
    };
    const report = computeDiff({ baseline, candidate, tombstoneCtx: ctx });
    expect(report.regressions).toHaveLength(1);
    expect(report.regressions[0]!.kind).toBe('untombstoned-loss');
    expect(report.regressions.filter((r) => r.kind === 'derived-from-shrinkage')).toHaveLength(0);
  });

  it('emits derivedFrom-shrinkage finding alongside the headingOrMetadataChanged drift entry (separate categories)', () => {
    // §DC.49 + §DC.51b: shrinkage flows BOTH to the drift category
    // (heading/metadata change with field='derivedFrom') AND to the
    // regression-gate stage as `derived-from-shrinkage`.  This pins
    // the dual-emit contract — the engine does not collapse them.
    const baseline = side('snapshot', [
      claim({ fqid: 'R002.§1.AC.01', derivedFrom: ['R001.§1.AC.01', 'R001.§1.AC.02'] }),
    ]);
    const candidate = side('live', [claim({ fqid: 'R002.§1.AC.01', derivedFrom: ['R001.§1.AC.01'] })]);
    const ctx: TombstoneContext = {
      liveEntries: new Map([['R002.§1.AC.01', liveEntryFor('R002.§1.AC.01')]]),
      bodyResolver: () => '',
      cache: new Map(),
    };
    const report = computeDiff({ baseline, candidate, tombstoneCtx: ctx });
    expect(report.headingOrMetadataChanged).toHaveLength(1);
    expect(report.headingOrMetadataChanged[0]!.changes[0]!.field).toBe('derivedFrom');
    expect(report.regressions.filter((r) => r.kind === 'derived-from-shrinkage')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Snapshot-vs-snapshot lifecycle-tag fallback
// ---------------------------------------------------------------------------

describe('computeDiff — snapshot-vs-snapshot fallback (§DC.53)', () => {
  it('treats lost claim as regression when candidate-side lifecycle is not a tombstone', () => {
    const baseline = side('snapshot', [claim({ fqid: 'R001.§1.AC.01' })]);
    const candidate = side('snapshot', []);
    const report = computeDiff({
      baseline,
      candidate,
      // empty liveEntries triggers the §DC.53 fallback for tombstone status
      tombstoneCtx: emptyTombstoneCtx(),
    });
    expect(report.regressions).toHaveLength(1);
    expect(report.regressions[0]!.kind).toBe('untombstoned-loss');
  });

  it('respects candidate-side lifecycle=removed in snapshot-vs-snapshot mode', () => {
    const baseline = side('snapshot', [
      claim({ fqid: 'R001.§1.AC.01', incomingSourceRefs: [{ filePath: 'a.ts', line: 1, refKind: 'implements' }] }),
    ]);
    const candidate = side('snapshot', [
      claim({ fqid: 'R001.§1.AC.01', incomingSourceRefs: [], lifecycle: { type: 'removed' } }),
    ]);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: emptyTombstoneCtx() });
    // Source coverage went from 1 → 0; candidate-side lifecycle=removed
    // suppresses the regression per §DC.53.
    expect(report.regressions).toHaveLength(0);
  });

  it('respects candidate-side lifecycle=superseded= in snapshot-vs-snapshot mode', () => {
    const baseline = side('snapshot', [
      claim({ fqid: 'R001.§1.AC.01', derivedFrom: ['R000.§1.AC.01', 'R000.§1.AC.02'] }),
    ]);
    const candidate = side('snapshot', [
      claim({
        fqid: 'R001.§1.AC.01',
        derivedFrom: ['R000.§1.AC.01'],
        lifecycle: { type: 'superseded', supersedes: 'R002.§1.AC.01' },
      }),
    ]);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: emptyTombstoneCtx() });
    expect(report.regressions.filter((r) => r.kind === 'derived-from-shrinkage')).toHaveLength(0);
  });

  it('falls back without invoking bodyResolver when liveEntries is empty', () => {
    let resolverCalled = false;
    const baseline = side('snapshot', [claim({ fqid: 'R001.§1.AC.01' })]);
    const candidate = side('snapshot', [
      claim({ fqid: 'R001.§1.AC.01', lifecycle: { type: 'removed' } }),
    ]);
    const ctx: TombstoneContext = {
      liveEntries: new Map(),
      bodyResolver: () => {
        resolverCalled = true;
        return '';
      },
      cache: new Map(),
    };
    // No source-ref drop, no derivedFrom shrinkage, but the engine
    // walks the gate paths regardless — the lifecycle on the
    // candidate-side suppresses any regression without bodyResolver.
    computeDiff({ baseline, candidate, tombstoneCtx: ctx });
    expect(resolverCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cache sharing across gate stages
// ---------------------------------------------------------------------------

describe('computeDiff — tombstone cache is shared across gate stages', () => {
  it('computes tombstone status at most once per FQID per diff run', () => {
    let resolverCallCount = 0;
    const baseline = side('snapshot', [
      claim({
        fqid: 'R001.§1.AC.01',
        derivedFrom: ['R000.§1.AC.01'],
        incomingSourceRefs: [{ filePath: 'a.ts', line: 1, refKind: 'implements' }],
      }),
    ]);
    const candidate = side('live', [
      claim({ fqid: 'R001.§1.AC.01', derivedFrom: [], incomingSourceRefs: [] }),
    ]);
    // Live entry exists but lifecycle is plain — bodyResolver will
    // fire, and we can count how many times it does so.
    const ctx: TombstoneContext = {
      liveEntries: new Map([['R001.§1.AC.01', liveEntryFor('R001.§1.AC.01')]]),
      bodyResolver: () => {
        resolverCallCount++;
        return 'Removed.';
      },
      cache: new Map(),
    };
    computeDiff({ baseline, candidate, tombstoneCtx: ctx });
    // Both gate paths (dangling-source-coverage AND
    // derived-from-shrinkage) ask about the same FQID; cache MUST
    // collapse to one bodyResolver invocation.
    expect(resolverCallCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Summary counts
// ---------------------------------------------------------------------------

describe('computeDiff — summary counts', () => {
  it('summary fields match array lengths', () => {
    const baseline = side('snapshot', [
      claim({ fqid: 'R001.§1.AC.01', bodyHash: 'h1' }),
      claim({ fqid: 'R001.§1.AC.02' }),
    ]);
    const candidate = side('live', [
      claim({ fqid: 'R001.§1.AC.01', bodyHash: 'h2' }),
      claim({ fqid: 'R001.§1.AC.03' }),
    ]);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: null });
    expect(report.summary.lost).toBe(report.lostClaims.length);
    expect(report.summary.new).toBe(report.newClaims.length);
    expect(report.summary.bodyChanged).toBe(report.bodyChanged.length);
    expect(report.summary.headingOrMetadataChanged).toBe(report.headingOrMetadataChanged.length);
    expect(report.summary.sourceRefDrift).toBe(report.sourceRefDrift.length);
    expect(report.summary.incomingNoteRefDrift).toBe(report.incomingNoteRefDrift.length);
    expect(report.summary.regressions).toBe(report.regressions.length);
  });
});
