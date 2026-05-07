/**
 * Integration tests for the claim snapshot subsystem.
 *
 * Seeds a temporary SCEpter project on disk, runs end-to-end snapshot
 * save → modify → diff flows through the real `ProjectManager`,
 * `claimIndex`, `noteFileManager`, `sourceScanner`, snapshot writer,
 * snapshot store, diff engine, and formatter.  The CLI exit-code path
 * is exercised separately via `execFileSync` against the project's
 * `scepter` shim per §DC.74.
 *
 * Six paths covered (matching the Phase 3 dispatch brief):
 *   A. baseline → modify a claim body → diff categorizes correctly.
 *   B. baseline → delete claim w/o tombstone → --regressions exits 1
 *      with `untombstoned-loss` finding.
 *   C. baseline → mark deleted claim's lifecycle=removed → tombstone
 *      neutralizes the regression (exit 0).
 *   D. baseline → drop a `derives=` from a claim → --regressions
 *      exits 1 with `derived-from-shrinkage` finding.
 *   E. baseline → drop the only `@implements` annotation on a claim →
 *      --regressions exits 1 with `dangling-source-coverage` finding.
 *   F. baseline → cosmetic noise (whitespace) → no findings, exit 0.
 *
 * The unit tests in `diff-engine.test.ts` and `snapshot-formatter.test.ts`
 * cover stage-by-stage logic with synthetic inputs; this file is the
 * integration counterpart that pins the real-project wiring through
 * the live claim index, source scanner, and CLI exit-code flow.
 *
 * Note on FQID notation: the `ClaimIndex` keys (and therefore snapshot
 * `fqid` fields) elide the `§` token — `R001.1.AC.01`, not
 * `R001.§1.AC.01`.  The §-prefixed form is the surface syntax in
 * markdown; the parser strips the prefix for the canonical FQID.
 *
 * Note on heading vs paragraph claims: the body-hash extraction (§DC.16)
 * slices `[line+1 .. endLine]` from aggregated content.  For
 * paragraph-line claims (`§N.AC.NN ...`), the parser sets
 * `endLine === line` and the body slice is empty — meaning the body
 * hash is constant regardless of trailing prose.  These integration
 * tests use heading-style claims (`### §N.AC.NN ...`) so `endLine`
 * spans the trailing body and body-change detection is exercised.
 *
 * @validates {DD018.§3.DC.14} captureSnapshot end-to-end with real ClaimIndex
 * @validates {DD018.§3.DC.23} writeSnapshot atomic write to disk
 * @validates {DD018.§3.DC.37} loadSnapshotSide reads and indexes a snapshot file
 * @validates {DD018.§3.DC.38} liveSide captures live claim index for diff
 * @validates {DD018.§3.DC.47} computeDiff categorization through real fixture
 * @validates {DD018.§3.DC.50} untombstoned-loss regression end-to-end
 * @validates {DD018.§3.DC.51} dangling-source-coverage regression end-to-end
 * @validates {DD018.§3.DC.51b} derived-from-shrinkage regression end-to-end
 * @validates {DD018.§3.DC.74} --regressions exit-code semantics via CLI invocation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { ProjectManager } from '../../../project/project-manager.js';
import { ensureIndex, _clearEnsureIndexCacheForTest } from '../../../cli/commands/claims/ensure-index.js';
import {
  captureSnapshot,
  writeSnapshot,
  loadSnapshotSide,
  liveSide,
  computeDiff,
  snapshotPath,
  normalizeBodyForHash,
} from '../index.js';
import type { TombstoneContext, SnapshotSide } from '../diff-types.js';
import type { ClaimIndexEntry } from '../../claim-index.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const SCEPTER_BIN = path.resolve(__dirname, '../../../../../scepter');

interface Fixture {
  projectPath: string;
  pm: ProjectManager;
}

async function setupFixture(opts?: { withSourceFile?: boolean }): Promise<Fixture> {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'scepter-snapshot-it-'));

  const config: Record<string, unknown> = {
    noteTypes: {
      Requirement: {
        shortcode: 'R',
        folder: 'reqs',
        description: 'Functional requirements',
      },
    },
    paths: {
      notesRoot: '_scepter/notes',
      dataDir: '_scepter',
    },
    claims: {
      projectionTypes: ['Requirement', 'Source'],
    },
  };
  if (opts?.withSourceFile) {
    config.sourceCodeIntegration = {
      enabled: true,
      folders: ['src'],
      exclude: ['node_modules/**'],
      extensions: ['.ts'],
    };
    await fs.mkdir(path.join(projectPath, 'src'), { recursive: true });
  }

  await fs.mkdir(path.join(projectPath, '_scepter/notes/reqs'), { recursive: true });
  await fs.writeFile(
    path.join(projectPath, '_scepter/scepter.config.json'),
    JSON.stringify(config, null, 2),
  );

  return {
    projectPath,
    pm: new ProjectManager(projectPath),
  };
}

async function teardownFixture(f: Fixture | null): Promise<void> {
  if (!f) return;
  try {
    await fs.rm(f.projectPath, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

async function writeRequirementNote(
  projectPath: string,
  noteId: string,
  title: string,
  body: string,
): Promise<void> {
  const filePath = path.join(projectPath, '_scepter/notes/reqs', `${noteId} ${title}.md`);
  await fs.writeFile(filePath, body);
}

async function initialize(f: Fixture): Promise<void> {
  // The ensure-index module-level cache must be cleared on each
  // re-initialization within the same test process, otherwise the
  // post-modification index returns the pre-modification snapshot.
  _clearEnsureIndexCacheForTest();
  await f.pm.configManager.loadConfigFromFilesystem();
  await f.pm.initialize();
  await ensureIndex(f.pm, { reindex: true });
}

/**
 * Build the tombstone context against the live claim index — mirrors
 * the diff-command handler at §DC.73.
 */
function liveTombstoneCtx(f: Fixture): TombstoneContext {
  const aggregatedByNoteId = new Map<string, string>();
  return {
    liveEntries: new Map(f.pm.claimIndex.getData().entries.entries()),
    bodyResolver: (entry: ClaimIndexEntry): string => {
      let aggregated = aggregatedByNoteId.get(entry.noteId);
      if (aggregated === undefined) {
        try {
          aggregated = f.pm.noteFileManager.getAggregatedContentsSync(entry.noteId) ?? '';
        } catch {
          aggregated = '';
        }
        aggregatedByNoteId.set(entry.noteId, aggregated);
      }
      const lines = aggregated.split('\n');
      const slice = lines.slice(entry.line, entry.endLine);
      return normalizeBodyForHash(slice.join('\n'));
    },
    cache: new Map(),
  };
}

async function captureLiveSide(f: Fixture): Promise<SnapshotSide> {
  return liveSide({
    claimIndex: f.pm.claimIndex,
    noteFileManager: f.pm.noteFileManager,
    noteManager: f.pm.noteManager ?? undefined,
    sourceScanner: f.pm.sourceScanner,
    projectRoot: f.projectPath,
  });
}

async function saveBaseline(f: Fixture, name: string): Promise<void> {
  const snap = await captureSnapshot({
    claimIndex: f.pm.claimIndex,
    noteFileManager: f.pm.noteFileManager,
    noteManager: f.pm.noteManager ?? undefined,
    sourceScanner: f.pm.sourceScanner,
    projectRoot: f.projectPath,
  });
  await writeSnapshot(f.projectPath, name, snap, { force: true });
}

// ---------------------------------------------------------------------------
// Path A — body modification categorization
// ---------------------------------------------------------------------------

describe('snapshot integration — Path A (body change categorization)', () => {
  let f: Fixture | null = null;
  beforeEach(async () => {
    f = await setupFixture();
  });
  afterEach(async () => {
    await teardownFixture(f);
    f = null;
  });

  it('modifying a claim body yields a body-changed finding, not a heading-change', async () => {
    await writeRequirementNote(
      f!.projectPath,
      'R001',
      'Auth System',
      [
        '# R001 Auth System',
        '',
        '## §1 Login',
        '',
        '### §1.AC.01 The system MUST allow login',
        '',
        'The login flow goes through OAuth.',
        '',
      ].join('\n'),
    );
    await initialize(f!);
    await saveBaseline(f!, 'base');

    // Modify the BODY beneath the claim heading — heading is unchanged.
    await writeRequirementNote(
      f!.projectPath,
      'R001',
      'Auth System',
      [
        '# R001 Auth System',
        '',
        '## §1 Login',
        '',
        '### §1.AC.01 The system MUST allow login',
        '',
        'The login flow goes through OAuth and SAML.',
        '',
      ].join('\n'),
    );
    await initialize(f!);

    const baseline = await loadSnapshotSide(snapshotPath(f!.projectPath, 'base'));
    const candidate = await captureLiveSide(f!);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: liveTombstoneCtx(f!) });

    expect(report.bodyChanged).toHaveLength(1);
    expect(report.bodyChanged[0]!.fqid).toBe('R001.1.AC.01');
    expect(report.headingOrMetadataChanged).toHaveLength(0);
    expect(report.lostClaims).toHaveLength(0);
    expect(report.newClaims).toHaveLength(0);
    expect(report.regressions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Path B — untombstoned deletion is a regression (exit 1)
// ---------------------------------------------------------------------------

describe('snapshot integration — Path B (untombstoned-loss regression)', () => {
  let f: Fixture | null = null;
  beforeEach(async () => {
    f = await setupFixture();
  });
  afterEach(async () => {
    await teardownFixture(f);
    f = null;
  });

  it('deleting a claim without a tombstone produces an untombstoned-loss finding and exit 1 under --regressions', async () => {
    await writeRequirementNote(
      f!.projectPath,
      'R001',
      'Auth',
      [
        '# R001 Auth',
        '',
        '## §1 Login',
        '',
        '### §1.AC.01 First claim',
        '',
        'Body for AC.01.',
        '',
        '### §1.AC.02 Second claim',
        '',
        'Body for AC.02.',
        '',
      ].join('\n'),
    );
    await initialize(f!);
    await saveBaseline(f!, 'base');

    // Drop AC.02 entirely — no tombstone.
    await writeRequirementNote(
      f!.projectPath,
      'R001',
      'Auth',
      [
        '# R001 Auth',
        '',
        '## §1 Login',
        '',
        '### §1.AC.01 First claim',
        '',
        'Body for AC.01.',
        '',
      ].join('\n'),
    );
    await initialize(f!);

    const baseline = await loadSnapshotSide(snapshotPath(f!.projectPath, 'base'));
    const candidate = await captureLiveSide(f!);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: liveTombstoneCtx(f!) });

    expect(report.lostClaims.map((c) => c.fqid)).toContain('R001.1.AC.02');
    const untombstoned = report.regressions.filter((r) => r.kind === 'untombstoned-loss');
    expect(untombstoned).toHaveLength(1);
    expect(untombstoned[0]!.fqid).toBe('R001.1.AC.02');

    const exitCode = runScepterAndCaptureExit(f!.projectPath, ['snapshot', 'diff', 'base', '--regressions']);
    expect(exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Path C — :removed lifecycle tag neutralizes the regression
// ---------------------------------------------------------------------------

describe('snapshot integration — Path C (tombstone neutralizes regression)', () => {
  let f: Fixture | null = null;
  beforeEach(async () => {
    f = await setupFixture();
  });
  afterEach(async () => {
    await teardownFixture(f);
    f = null;
  });

  it('marking the claim with :removed lifecycle exempts it from --regressions (exit 0)', async () => {
    await writeRequirementNote(
      f!.projectPath,
      'R001',
      'Auth',
      [
        '# R001 Auth',
        '',
        '## §1 Login',
        '',
        '### §1.AC.01 First claim',
        '',
        'Body for AC.01.',
        '',
        '### §1.AC.02 Second claim',
        '',
        'Body for AC.02.',
        '',
      ].join('\n'),
    );
    await initialize(f!);
    await saveBaseline(f!, 'base');

    // Tombstone AC.02 in place via the `:removed` lifecycle suffix.
    // The claim is still PRESENT in candidate (lifecycle=removed is a
    // tombstone marker, not a deletion) — the canonical pattern §7
    // contemplates.
    await writeRequirementNote(
      f!.projectPath,
      'R001',
      'Auth',
      [
        '# R001 Auth',
        '',
        '## §1 Login',
        '',
        '### §1.AC.01 First claim',
        '',
        'Body for AC.01.',
        '',
        '### §1.AC.02:removed Second claim',
        '',
        'Removed.',
        '',
      ].join('\n'),
    );
    await initialize(f!);

    const baseline = await loadSnapshotSide(snapshotPath(f!.projectPath, 'base'));
    const candidate = await captureLiveSide(f!);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: liveTombstoneCtx(f!) });

    expect(report.lostClaims).toHaveLength(0);
    expect(report.regressions.filter((r) => r.kind === 'untombstoned-loss')).toHaveLength(0);
    expect(report.regressions).toHaveLength(0);

    const exitCode = runScepterAndCaptureExit(f!.projectPath, ['snapshot', 'diff', 'base', '--regressions']);
    expect(exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Path D — derived-from-shrinkage regression
// ---------------------------------------------------------------------------

describe('snapshot integration — Path D (derived-from-shrinkage regression)', () => {
  let f: Fixture | null = null;
  beforeEach(async () => {
    f = await setupFixture();
  });
  afterEach(async () => {
    await teardownFixture(f);
    f = null;
  });

  it('removing a derives= annotation produces a derived-from-shrinkage finding and exit 1 under --regressions', async () => {
    // Two notes: R001 has a claim that R002.§1.AC.01 derives from.
    await writeRequirementNote(
      f!.projectPath,
      'R001',
      'Upstream',
      [
        '# R001 Upstream',
        '',
        '## §1 Upstream',
        '',
        '### §1.AC.01 Upstream claim',
        '',
        'Body for upstream claim.',
        '',
      ].join('\n'),
    );
    await writeRequirementNote(
      f!.projectPath,
      'R002',
      'Downstream',
      [
        '# R002 Downstream',
        '',
        '## §1 Derived',
        '',
        '### §1.AC.01:derives=R001.§1.AC.01 Derived claim',
        '',
        'Body for derived claim.',
        '',
      ].join('\n'),
    );
    await initialize(f!);
    await saveBaseline(f!, 'base');

    // Drop the derives= annotation.
    await writeRequirementNote(
      f!.projectPath,
      'R002',
      'Downstream',
      [
        '# R002 Downstream',
        '',
        '## §1 Derived',
        '',
        '### §1.AC.01 Derived claim',
        '',
        'Body for derived claim.',
        '',
      ].join('\n'),
    );
    await initialize(f!);

    const baseline = await loadSnapshotSide(snapshotPath(f!.projectPath, 'base'));
    const candidate = await captureLiveSide(f!);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: liveTombstoneCtx(f!) });

    const shrinkage = report.regressions.filter((r) => r.kind === 'derived-from-shrinkage');
    expect(shrinkage).toHaveLength(1);
    expect(shrinkage[0]!.fqid).toBe('R002.1.AC.01');
    expect(shrinkage[0]!.lostDerivationTargets).toEqual(['R001.1.AC.01']);

    const exitCode = runScepterAndCaptureExit(f!.projectPath, ['snapshot', 'diff', 'base', '--regressions']);
    expect(exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Path E — dangling-source-coverage regression
// ---------------------------------------------------------------------------

describe('snapshot integration — Path E (dangling-source-coverage regression)', () => {
  let f: Fixture | null = null;
  beforeEach(async () => {
    f = await setupFixture({ withSourceFile: true });
  });
  afterEach(async () => {
    await teardownFixture(f);
    f = null;
  });

  it('dropping the only @implements annotation on a claim produces a dangling-source-coverage finding under --regressions', async () => {
    await writeRequirementNote(
      f!.projectPath,
      'R001',
      'Auth',
      [
        '# R001 Auth',
        '',
        '## §1 Login',
        '',
        '### §1.AC.01 Login claim',
        '',
        'Body for login claim.',
        '',
      ].join('\n'),
    );
    // Source file with the sole @implements annotation pointing at
    // R001.§1.AC.01.
    const srcFile = path.join(f!.projectPath, 'src/auth.ts');
    await fs.writeFile(
      srcFile,
      ['// @implements {R001.§1.AC.01}', 'export function login() {', '  return true;', '}', ''].join('\n'),
    );
    await initialize(f!);
    await saveBaseline(f!, 'base');

    // Strip the @implements annotation — claim is intact, source
    // coverage drops to zero.
    await fs.writeFile(srcFile, ['export function login() {', '  return true;', '}', ''].join('\n'));
    await initialize(f!);

    const baseline = await loadSnapshotSide(snapshotPath(f!.projectPath, 'base'));
    const candidate = await captureLiveSide(f!);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: liveTombstoneCtx(f!) });

    const dangling = report.regressions.filter((r) => r.kind === 'dangling-source-coverage');
    expect(dangling).toHaveLength(1);
    expect(dangling[0]!.fqid).toBe('R001.1.AC.01');
    expect(dangling[0]!.baselineSourceRefCount).toBe(1);

    const exitCode = runScepterAndCaptureExit(f!.projectPath, ['snapshot', 'diff', 'base', '--regressions']);
    expect(exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Path F — cosmetic noise → no regressions
// ---------------------------------------------------------------------------

describe('snapshot integration — Path F (cosmetic noise → no regressions)', () => {
  let f: Fixture | null = null;
  beforeEach(async () => {
    f = await setupFixture();
  });
  afterEach(async () => {
    await teardownFixture(f);
    f = null;
  });

  it('whitespace-only changes that survive normalization do not produce regressions', async () => {
    // The body-hash normalization (§DC.13) trims trailing whitespace.
    // Re-writing the file with extra trailing blank lines is normalized
    // away — a no-op signal.
    await writeRequirementNote(
      f!.projectPath,
      'R001',
      'Auth',
      [
        '# R001 Auth',
        '',
        '## §1 Login',
        '',
        '### §1.AC.01 Login claim',
        '',
        'Body paragraph.',
        '',
      ].join('\n'),
    );
    await initialize(f!);
    await saveBaseline(f!, 'base');

    await writeRequirementNote(
      f!.projectPath,
      'R001',
      'Auth',
      [
        '# R001 Auth',
        '',
        '## §1 Login',
        '',
        '### §1.AC.01 Login claim',
        '',
        'Body paragraph.',
        '',
        '',
        '',
      ].join('\n'),
    );
    await initialize(f!);

    const baseline = await loadSnapshotSide(snapshotPath(f!.projectPath, 'base'));
    const candidate = await captureLiveSide(f!);
    const report = computeDiff({ baseline, candidate, tombstoneCtx: liveTombstoneCtx(f!) });

    expect(report.regressions).toHaveLength(0);
    expect(report.lostClaims).toHaveLength(0);
    expect(report.newClaims).toHaveLength(0);

    const exitCode = runScepterAndCaptureExit(f!.projectPath, ['snapshot', 'diff', 'base', '--regressions']);
    expect(exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CLI subprocess helper
// ---------------------------------------------------------------------------

/**
 * Run the project's `scepter` shim against a temp project directory
 * and return the resulting exit code (0 on success, non-zero on
 * regression-gate failure).  stdout/stderr are captured and silenced;
 * a failed exec throws which we catch to read the status.
 *
 * Uses `execFileSync` (not `execSync`) to avoid shell interpretation
 * of arguments — the scepter shim is invoked directly.
 */
function runScepterAndCaptureExit(projectPath: string, args: string[]): number {
  try {
    execFileSync(SCEPTER_BIN, ['--project-dir', projectPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return 0;
  } catch (err) {
    const e = err as { status?: number };
    return typeof e.status === 'number' ? e.status : 1;
  }
}
