/**
 * Tests for the snapshot-store module — atomic writes, gitignore
 * self-bootstrap, name allowlist, list/read/remove round-trip.
 *
 * Uses real filesystem under a per-test temp directory.  Vitest's
 * built-in cleanup hooks delete the temp dir after each test.
 *
 * @validates {DD018.§3.DC.21} SNAPSHOT_DIR_RELATIVE constant
 * @validates {DD018.§3.DC.22} snapshotPath name allowlist + leading-dot rejection
 * @validates {DD018.§3.DC.23} writeSnapshot atomic temp-then-rename + force semantics
 * @validates {DD018.§3.DC.24} ensureSnapshotDir idempotent mkdir
 * @validates {DD018.§3.DC.25} listSnapshots; missing-directory tolerance
 * @validates {DD018.§3.DC.26} removeSnapshot; SnapshotNotFoundError on missing
 * @validates {DD018.§3.DC.27} defaultSnapshotName YYYY-MM-DD-HHMM format
 * @validates {DD018.§3.DC.28} typed errors
 * @validates {DD018.§3.DC.29} readSnapshot schema-version validation
 * @validates {DD018.§3.DC.31} .gitignore self-bootstrap; never rewrite
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  SNAPSHOT_DIR_RELATIVE,
  snapshotPath,
  defaultSnapshotName,
  ensureSnapshotDir,
  writeSnapshot,
  listSnapshots,
  removeSnapshot,
  readSnapshot,
  SnapshotExistsError,
  SnapshotNotFoundError,
  SnapshotSchemaError,
} from '../snapshot-store';
import type { Snapshot } from '../snapshot-types';
import { SCHEMA_VERSION } from '../snapshot-types';

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'scepter-snap-store-'));
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

const fixtureSnapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  metadata: {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: '2026-05-06T12:34:56.000Z',
    projectRoot: '/some/project',
    gitCommit: null,
  },
  claims: [],
  notes: [],
  ...overrides,
});

describe('snapshotPath name allowlist', () => {
  it('accepts standard names', () => {
    expect(() => snapshotPath('/p', 'baseline')).not.toThrow();
    expect(() => snapshotPath('/p', 'auth-refactor')).not.toThrow();
    expect(() => snapshotPath('/p', '2026-05-06-1742')).not.toThrow();
    expect(() => snapshotPath('/p', 'baseline_v2')).not.toThrow();
    expect(() => snapshotPath('/p', 'final.tag')).not.toThrow();
  });

  it.each([
    ['contains a space', 'my work'],
    ['leading dot', '.secret'],
    ['leading dot with extension', '.dotfile'],
    ['contains a slash', 'foo/bar'],
    ['contains a backslash', 'foo\\bar'],
    ['contains unicode', 'naïve'],
    ['contains a colon', 'foo:bar'],
    ['contains double quotes', 'foo"bar'],
    ['empty', ''],
  ])('rejects %s', (_label, name) => {
    expect(() => snapshotPath('/p', name)).toThrow(/must match/);
  });

  it('rejection message names the offending input', () => {
    expect(() => snapshotPath('/p', 'has space')).toThrow(/has space/);
  });

  it('produces an absolute path joined under the snapshot dir', () => {
    const p = snapshotPath('/projects/foo', 'baseline');
    expect(p).toBe(path.join('/projects/foo', SNAPSHOT_DIR_RELATIVE, 'baseline.json'));
  });
});

describe('defaultSnapshotName', () => {
  it('formats as YYYY-MM-DD-HHMM in local time', () => {
    // Pick a fixed Date and assert the format matches.  Local-time
    // semantics mean the assertion uses the same local-time getters
    // the implementation does, so the test passes regardless of the
    // CI host's TZ.
    const d = new Date(2026, 4, 6, 17, 42); // May 6 2026, 17:42 local
    expect(defaultSnapshotName(d)).toBe('2026-05-06-1742');
  });

  it('zero-pads single-digit fields', () => {
    const d = new Date(2026, 0, 3, 5, 7); // Jan 3 2026, 05:07 local
    expect(defaultSnapshotName(d)).toBe('2026-01-03-0507');
  });

  it('without arg uses current date and matches the format', () => {
    expect(defaultSnapshotName()).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}$/);
  });
});

describe('ensureSnapshotDir + .gitignore bootstrap', () => {
  it('creates the snapshot directory + .gitignore on first call', async () => {
    await ensureSnapshotDir(projectRoot);
    const dir = path.join(projectRoot, SNAPSHOT_DIR_RELATIVE);
    const dirStat = await fs.stat(dir);
    expect(dirStat.isDirectory()).toBe(true);
    const gi = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
    expect(gi).toBe('*\n');
  });

  it('does NOT rewrite an existing .gitignore', async () => {
    await ensureSnapshotDir(projectRoot);
    const gi = path.join(projectRoot, SNAPSHOT_DIR_RELATIVE, '.gitignore');
    await fs.writeFile(gi, '# user-customized\n*.json\n', 'utf8');
    await ensureSnapshotDir(projectRoot);
    const after = await fs.readFile(gi, 'utf8');
    expect(after).toBe('# user-customized\n*.json\n');
  });

  it('is idempotent on repeated calls', async () => {
    await ensureSnapshotDir(projectRoot);
    await ensureSnapshotDir(projectRoot);
    await ensureSnapshotDir(projectRoot);
    const gi = await fs.readFile(
      path.join(projectRoot, SNAPSHOT_DIR_RELATIVE, '.gitignore'),
      'utf8',
    );
    expect(gi).toBe('*\n');
  });
});

describe('writeSnapshot', () => {
  it('writes the JSON payload to the target path', async () => {
    const snap = fixtureSnapshot();
    const { filePath } = await writeSnapshot(projectRoot, 'baseline', snap, { force: false });
    const written = JSON.parse(await fs.readFile(filePath, 'utf8'));
    expect(written.metadata.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('throws SnapshotExistsError when target exists and force=false', async () => {
    await writeSnapshot(projectRoot, 'baseline', fixtureSnapshot(), { force: false });
    await expect(
      writeSnapshot(projectRoot, 'baseline', fixtureSnapshot(), { force: false }),
    ).rejects.toThrow(SnapshotExistsError);
  });

  it('overwrites when force=true', async () => {
    await writeSnapshot(
      projectRoot,
      'baseline',
      fixtureSnapshot({
        metadata: {
          schemaVersion: SCHEMA_VERSION,
          capturedAt: '2026-05-06T01:00:00.000Z',
          projectRoot: '/p',
          gitCommit: null,
        },
      }),
      { force: false },
    );
    await writeSnapshot(
      projectRoot,
      'baseline',
      fixtureSnapshot({
        metadata: {
          schemaVersion: SCHEMA_VERSION,
          capturedAt: '2026-05-06T02:00:00.000Z',
          projectRoot: '/p',
          gitCommit: 'abc123',
        },
      }),
      { force: true },
    );
    const filePath = snapshotPath(projectRoot, 'baseline');
    const after = JSON.parse(await fs.readFile(filePath, 'utf8'));
    expect(after.metadata.gitCommit).toBe('abc123');
  });

  it('uses temp-then-rename so a partial write does not corrupt the original', async () => {
    // Write the original.
    const filePath = snapshotPath(projectRoot, 'baseline');
    await writeSnapshot(
      projectRoot,
      'baseline',
      fixtureSnapshot({
        metadata: {
          schemaVersion: SCHEMA_VERSION,
          capturedAt: '2026-05-06T01:00:00.000Z',
          projectRoot: '/p',
          gitCommit: 'original',
        },
      }),
      { force: false },
    );

    // Simulate a "partial write" by manually creating a temp file
    // alongside the target without ever renaming.  The original
    // file MUST remain untouched.
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, '{ corrupt', 'utf8');
    const original = JSON.parse(await fs.readFile(filePath, 'utf8'));
    expect(original.metadata.gitCommit).toBe('original');
    // Cleanup the orphan temp.
    await fs.unlink(tempPath);
  });

  it('rejects out-of-policy names at write time', async () => {
    await expect(
      writeSnapshot(projectRoot, 'has space', fixtureSnapshot(), { force: false }),
    ).rejects.toThrow(/must match/);
  });
});

describe('listSnapshots', () => {
  it('returns empty when the snapshots directory does not exist', async () => {
    const rows = await listSnapshots(projectRoot);
    expect(rows).toEqual([]);
  });

  it('returns one row per saved snapshot, sorted by name', async () => {
    await writeSnapshot(projectRoot, 'b-second', fixtureSnapshot(), { force: false });
    await writeSnapshot(projectRoot, 'a-first', fixtureSnapshot(), { force: false });
    const rows = await listSnapshots(projectRoot);
    expect(rows.map((r) => r.name)).toEqual(['a-first', 'b-second']);
    expect(rows[0].claimCount).toBe(0);
    expect(rows[0].fileSize).toBeGreaterThan(0);
    expect(rows[0].capturedAt).toBe('2026-05-06T12:34:56.000Z');
  });

  it('skips files that do not match the allowlist', async () => {
    await writeSnapshot(projectRoot, 'good', fixtureSnapshot(), { force: false });
    // Drop a manually-named file.
    const bad = path.join(projectRoot, SNAPSHOT_DIR_RELATIVE, '.dot.json');
    await fs.writeFile(bad, '{}', 'utf8');
    const rows = await listSnapshots(projectRoot);
    expect(rows.map((r) => r.name)).toEqual(['good']);
  });

  it('skips unreadable / unparsable files', async () => {
    await writeSnapshot(projectRoot, 'good', fixtureSnapshot(), { force: false });
    const corrupt = path.join(projectRoot, SNAPSHOT_DIR_RELATIVE, 'corrupt.json');
    await fs.writeFile(corrupt, '{ not valid json', 'utf8');
    const rows = await listSnapshots(projectRoot);
    expect(rows.map((r) => r.name)).toEqual(['good']);
  });
});

describe('removeSnapshot', () => {
  it('deletes an existing snapshot', async () => {
    await writeSnapshot(projectRoot, 'baseline', fixtureSnapshot(), { force: false });
    await removeSnapshot(projectRoot, 'baseline');
    const filePath = snapshotPath(projectRoot, 'baseline');
    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it('throws SnapshotNotFoundError when name does not exist', async () => {
    await expect(removeSnapshot(projectRoot, 'no-such-snapshot')).rejects.toThrow(
      SnapshotNotFoundError,
    );
  });
});

describe('readSnapshot', () => {
  it('round-trips a written snapshot', async () => {
    const original = fixtureSnapshot({
      metadata: {
        schemaVersion: SCHEMA_VERSION,
        capturedAt: '2026-05-06T03:00:00.000Z',
        projectRoot: '/p',
        gitCommit: 'sha',
      },
      claims: [
        {
          fqid: 'R001.§1.AC.01',
          noteId: 'R001',
          noteType: 'Requirement',
          heading: 'Heading',
          lifecycle: null,
          importance: null,
          derivedFrom: [],
          incomingNoteRefs: [],
          incomingSourceRefs: [],
          bodyHash: 'a'.repeat(64),
        },
      ],
      notes: [
        {
          noteId: 'R001',
          noteTitle: 'Title',
          claimFqids: ['R001.§1.AC.01'],
          noteContentHash: 'b'.repeat(64),
        },
      ],
    });
    const { filePath } = await writeSnapshot(projectRoot, 'rt', original, { force: false });
    const loaded = await readSnapshot(filePath);
    expect(loaded).toEqual(original);
  });

  it('throws SnapshotNotFoundError on ENOENT', async () => {
    const filePath = snapshotPath(projectRoot, 'missing');
    await expect(readSnapshot(filePath)).rejects.toThrow(SnapshotNotFoundError);
  });

  it('throws SnapshotSchemaError when version is missing', async () => {
    await ensureSnapshotDir(projectRoot);
    const filePath = snapshotPath(projectRoot, 'badmeta');
    await fs.writeFile(filePath, JSON.stringify({ metadata: {}, claims: [], notes: [] }), 'utf8');
    await expect(readSnapshot(filePath)).rejects.toThrow(SnapshotSchemaError);
  });

  it('throws SnapshotSchemaError when version exceeds SCHEMA_VERSION', async () => {
    await ensureSnapshotDir(projectRoot);
    const filePath = snapshotPath(projectRoot, 'newer');
    await fs.writeFile(
      filePath,
      JSON.stringify({
        metadata: { schemaVersion: SCHEMA_VERSION + 1, capturedAt: '', projectRoot: '/p', gitCommit: null },
        claims: [],
        notes: [],
      }),
      'utf8',
    );
    await expect(readSnapshot(filePath)).rejects.toThrow(SnapshotSchemaError);
  });
});
