/**
 * Tests for the rewrite-log writer/reader.
 *
 * @validates {R015.§6.AC.03} structured RewriteLogEntry per mutating run
 * @validates {R015.§6.AC.04} schema sufficient for replay-in-reverse
 * @validates {R015.§6.AC.08} timestampPrecision governs log filename
 * @validates {DD020.§3.DC.05} per-file/per-span before/after with surface and byteRange
 * @validates {DD020.§3.DC.06} inverse-plan reconstruction from the log entry
 * @validates {DD020.§3.DC.10} log filename timestamp via formatMarkerTimestamp
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import {
  buildInverseSpans,
  buildRewriteLogEntry,
  listRewriteLogEntries,
  readRewriteLogEntry,
  writeRewriteLogEntry,
} from './rewrite-log';
import type { RewritePlan, ReferenceSpan } from '../rewriter';

let projectPath: string;

beforeEach(async () => {
  projectPath = await fs.mkdtemp(
    path.join(os.tmpdir(), 'scepter-rewritelog-test-'),
  );
});

afterEach(async () => {
  if (projectPath) {
    await fs.remove(projectPath);
  }
});

function makeSpan(): ReferenceSpan {
  return {
    filePath: '/proj/a.md',
    surface: 'markdown-body',
    byteRange: [5, 9],
    noteIdRange: [5, 9],
    originalText: 'R005',
    parsedAddress: { raw: 'R005', noteId: 'R005' },
  };
}

function makeDeletePlan(): RewritePlan {
  const span = makeSpan();
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
            span,
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

describe('buildRewriteLogEntry', () => {
  it('records target ID, marker, and operation kind for delete', () => {
    const plan = makeDeletePlan();
    const before = new Map<string, string>([['/proj/a.md', 'see {R005} ok']]);
    const after = new Map<string, string>([
      ['/proj/a.md', 'see {_deleted_R005_at_20260519} ok'],
    ]);

    const entry = buildRewriteLogEntry('run-1', plan, before, after);
    expect(entry.runId).toBe('run-1');
    expect(entry.operation).toBe('delete');
    expect(entry.target).toBe('R005');
    expect(entry.marker).toBe('_deleted_R005_at_20260519');
    expect(entry.files).toHaveLength(1);
    expect(entry.files[0].spans).toHaveLength(1);
    expect(entry.files[0].spans[0].beforeText).toBe('R005');
    expect(entry.files[0].spans[0].afterText).toBe(
      '_deleted_R005_at_20260519',
    );
    expect(entry.removals).toEqual([{ path: '/proj/r005.md' }]);
  });

  it('records renameTarget for rename operations', () => {
    const span = makeSpan();
    const plan: RewritePlan = {
      operation: { kind: 'rename', source: 'R005', target: 'R042' },
      plannedAt: '2026-05-19T14:30:00.000Z',
      fileEdits: [
        {
          filePath: '/proj/a.md',
          edits: [
            {
              span,
              action: { kind: 'substitute', replacement: 'R042' },
            },
          ],
          audits: [],
          warnings: [],
        },
      ],
      removals: [],
      renames: [{ from: '/proj/R005.md', to: '/proj/R042.md' }],
      warnings: [],
      audits: [],
    };
    const before = new Map<string, string>([['/proj/a.md', 'see {R005} ok']]);
    const after = new Map<string, string>([
      ['/proj/a.md', 'see {R042} ok'],
    ]);
    const entry = buildRewriteLogEntry('run-2', plan, before, after);
    expect(entry.operation).toBe('rename');
    expect(entry.target).toBe('R005');
    expect(entry.renameTarget).toBe('R042');
    expect(entry.renames).toEqual([
      { from: '/proj/R005.md', to: '/proj/R042.md' },
    ]);
  });
});

describe('writeRewriteLogEntry / readRewriteLogEntry', () => {
  it('writes a log entry whose filename uses date-precision timestamp', async () => {
    const plan = makeDeletePlan();
    const before = new Map<string, string>([['/proj/a.md', 'x']]);
    const after = new Map<string, string>([['/proj/a.md', 'x']]);
    const entry = buildRewriteLogEntry('run-3', plan, before, after);
    // Override timestamp for predictability.
    entry.timestamp = '2026-05-19T14:30:00.000Z';
    const logPath = await writeRewriteLogEntry(projectPath, entry, 'date');
    expect(path.basename(logPath)).toBe('20260519-run-3.json');
    const readBack = await readRewriteLogEntry(projectPath, 'run-3');
    expect(readBack).toEqual(entry);
  });

  it('writes a log entry whose filename uses datetime-precision timestamp', async () => {
    const plan = makeDeletePlan();
    const before = new Map<string, string>([['/proj/a.md', 'x']]);
    const after = new Map<string, string>([['/proj/a.md', 'x']]);
    const entry = buildRewriteLogEntry('run-4', plan, before, after);
    entry.timestamp = '2026-05-19T14:30:00.000Z';
    const logPath = await writeRewriteLogEntry(
      projectPath,
      entry,
      'datetime',
    );
    expect(path.basename(logPath)).toBe('202605191430-run-4.json');
  });

  it('readRewriteLogEntry returns null when runId not found', async () => {
    const out = await readRewriteLogEntry(projectPath, 'missing-run');
    expect(out).toBeNull();
  });
});

describe('listRewriteLogEntries', () => {
  it('lists entries sorted by timestamp ascending', async () => {
    const plan = makeDeletePlan();
    const before = new Map<string, string>([['/proj/a.md', 'x']]);
    const after = new Map<string, string>([['/proj/a.md', 'x']]);

    const e1 = buildRewriteLogEntry('run-a', plan, before, after);
    e1.timestamp = '2026-05-19T12:00:00.000Z';
    const e2 = buildRewriteLogEntry('run-b', plan, before, after);
    e2.timestamp = '2026-05-20T12:00:00.000Z';

    await writeRewriteLogEntry(projectPath, e2, 'date');
    await writeRewriteLogEntry(projectPath, e1, 'date');

    const list = await listRewriteLogEntries(projectPath);
    expect(list.map((e) => e.runId)).toEqual(['run-a', 'run-b']);
  });

  it('returns empty list when no log root exists', async () => {
    const list = await listRewriteLogEntries(projectPath);
    expect(list).toEqual([]);
  });
});

describe('buildInverseSpans — schema sufficiency for undo (DC.06)', () => {
  it('produces inverse records carrying beforeText for every modified region', () => {
    const plan = makeDeletePlan();
    // The plan's span has noteIdRange [5, 9]; the before-content must
    // contain `R005` exactly at that range. `'see {R005} ok'` has `{`
    // at 4 and `R005` at [5, 9).
    const before = new Map<string, string>([
      ['/proj/a.md', 'see {R005} ok'],
    ]);
    const after = new Map<string, string>([
      ['/proj/a.md', 'see {_deleted_R005_at_20260519} ok'],
    ]);
    const entry = buildRewriteLogEntry('run-5', plan, before, after);
    const inv = buildInverseSpans(entry);
    expect(inv).toHaveLength(1);
    expect(inv[0]).toEqual({
      filePath: '/proj/a.md',
      surface: 'markdown-body',
      noteIdRange: [5, 9],
      text: 'R005',
    });
  });
});
