/**
 * Integration tests for the lifecycle orchestrator (hard-delete and
 * rename pipelines). Builds a small fixture project and exercises the
 * orchestrator end-to-end against the real filesystem.
 *
 * Tests target:
 *   {DD020.§3.DC.07} dry-run does not mutate disk
 *   {DD020.§3.DC.08} post-rewrite index refresh
 *   {DD020.§4.DC.01,4.DC.02,4.DC.04} hard-delete: removeNoteEntry + rewriter + atomic stage
 *   {DD020.§4.DC.06,4.DC.07,4.DC.08,4.DC.09,4.DC.10} rename: fs + frontmatter + self-prefix + inbound, atomic
 *   {DD020.§7.DC.01,7.DC.02} cross-project alias spans warn-and-skip
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import fs from 'fs-extra';
import { NoteFileManager } from '../../notes/note-file-manager';
import type { NoteTypeConfig, SCEpterConfig } from '../../types/config';
import type { ConfigManager } from '../../config/config-manager';
import { runHardDelete, runRename } from './lifecycle-orchestrator';

async function createTempDirectory(): Promise<string> {
  return await fs.mkdtemp(path.join(process.env.TMPDIR || '/tmp', 'scepter-lifecycle-test-'));
}

function makeConfig(): SCEpterConfig {
  return {
    noteTypes: {
      Requirement: { folder: 'requirements', shortcode: 'R' } as NoteTypeConfig,
      Decision: { folder: 'decisions', shortcode: 'D' } as NoteTypeConfig,
    },
    paths: {
      notesRoot: '_scepter/notes',
      dataDir: '_scepter',
    },
    discoveryPaths: ['_scepter/notes'],
    sourceCodeIntegration: {
      enabled: true,
      folders: ['src'],
      exclude: [],
      extensions: ['.ts'],
    },
    timestampPrecision: 'date',
  };
}

function createConfigManager(config: SCEpterConfig): ConfigManager {
  return {
    getConfig: vi.fn().mockReturnValue(config),
    setConfig: vi.fn(),
    addNoteType: vi.fn(),
    addWorkMode: vi.fn(),
    saveConfig: vi.fn(),
    on: vi.fn(),
    emit: vi.fn(),
  } as unknown as ConfigManager;
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content);
}

describe('Lifecycle orchestrator — hard-delete pipeline', () => {
  let tempDir: string;
  let fileManager: NoteFileManager;
  let config: SCEpterConfig;

  beforeEach(async () => {
    tempDir = await createTempDirectory();
    config = makeConfig();
    const configManager = createConfigManager(config);
    fileManager = new NoteFileManager(tempDir, configManager);
  });

  afterEach(async () => {
    await fileManager.stopWatching();
    await fs.remove(tempDir);
  });

  it('dry-run does not mutate disk and surfaces planned edits', async () => {
    // Create target note R005 + a referencing note R007 that derives
    // from R005.§1.AC.01.
    const r005Path = path.join(
      tempDir,
      '_scepter/notes/requirements/R005 Target.md',
    );
    await writeFile(
      r005Path,
      `---\nid: R005\ntags: []\n---\n\n# R005 - Target\n\n§1.AC.01 First criterion\n`,
    );

    const r007Path = path.join(
      tempDir,
      '_scepter/notes/requirements/R007 Referrer.md',
    );
    await writeFile(
      r007Path,
      `---\nid: R007\ntags: []\n---\n\n# R007\n\nDerived from {R005.§1.AC.01}.\n\n§1.DC.01:derives=R005.§1.AC.01 First derived\n`,
    );

    // Make file manager aware of R005 and R007.
    await fileManager.buildIndex();

    const result = await runHardDelete({
      projectPath: tempDir,
      config,
      fileManager,
      noteId: 'R005',
      options: { dryRun: true, allowDirty: true },
    });

    expect('formatted' in result).toBe(true);
    if ('formatted' in result) {
      // Plan exists, has at least one file edit (the referrer).
      expect(result.plan.fileEdits.length).toBeGreaterThan(0);
      // Target file is queued for removal.
      expect(result.plan.removals.length).toBeGreaterThan(0);
      expect(result.formatted).toContain('REWRITE DRY-RUN');
    }

    // Disk unchanged.
    expect(await fs.pathExists(r005Path)).toBe(true);
    expect(await fs.pathExists(r007Path)).toBe(true);
    const r007After = await fs.readFile(r007Path, 'utf-8');
    expect(r007After).toContain('{R005.§1.AC.01}');
  });

  it('live hard-delete removes the target file and rewrites inbound references', async () => {
    const r005Path = path.join(
      tempDir,
      '_scepter/notes/requirements/R005 Target.md',
    );
    await writeFile(
      r005Path,
      `---\nid: R005\ntags: []\n---\n\n# R005 - Target\n\n§1.AC.01 First criterion\n`,
    );

    const r007Path = path.join(
      tempDir,
      '_scepter/notes/requirements/R007 Referrer.md',
    );
    await writeFile(
      r007Path,
      `---\nid: R007\ntags: []\n---\n\n# R007\n\nDerived from {R005.§1.AC.01}.\n\n§1.DC.01:derives=R005.§1.AC.01 First derived\n`,
    );

    await fileManager.buildIndex();

    const result = await runHardDelete({
      projectPath: tempDir,
      config,
      fileManager,
      noteId: 'R005',
      options: { allowDirty: true },
    });

    expect('formatted' in result).toBe(false);
    if (!('formatted' in result)) {
      expect(result.filesModified).toBeGreaterThan(0);
      // The R005 file is gone (hard-unlink, not relocated).
      expect(await fs.pathExists(r005Path)).toBe(false);
      // _deleted/ does not contain R005.
      const deletedDir = path.join(
        tempDir,
        '_scepter/notes/requirements/_deleted',
      );
      if (await fs.pathExists(deletedDir)) {
        const entries = await fs.readdir(deletedDir);
        expect(entries.some((e) => e.startsWith('R005'))).toBe(false);
      }
      // R007 has been rewritten — the body reference is now a marker.
      const r007Content = await fs.readFile(r007Path, 'utf-8');
      expect(r007Content).toContain('_deleted_R005_at_');
      expect(r007Content).not.toContain('{R005.§1.AC.01}');
      // The derives metadata also rewrites.
      expect(r007Content).toMatch(/:derives=_deleted_R005_at_\d{8,}\.§1\.AC\.01/);
      // The marker token contains the original ID and a timestamp.
      expect(r007Content).toMatch(/_deleted_R005_at_\d{8,}/);
      // Log entry was persisted.
      expect(result.logPath).toBeTruthy();
      expect(await fs.pathExists(result.logPath)).toBe(true);
    }
  });

  it('refuses to run when the working tree is dirty (no override)', async () => {
    // Initialize a git repo and create a tracked file with uncommitted
    // changes so the working-tree probe sees dirt.
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const exec = promisify(execFile);
    try {
      await exec('git', ['init', '-q'], { cwd: tempDir });
      await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: tempDir });
      await exec('git', ['config', 'user.name', 'test'], { cwd: tempDir });
      await fs.writeFile(path.join(tempDir, 'README.md'), 'init');
      await exec('git', ['add', 'README.md'], { cwd: tempDir });
      await exec('git', ['commit', '-q', '-m', 'init'], { cwd: tempDir });
      // Now make the working tree dirty.
      await fs.writeFile(path.join(tempDir, 'README.md'), 'modified');
    } catch {
      // Skip the test if git is unavailable in the test environment.
      return;
    }

    const r005Path = path.join(
      tempDir,
      '_scepter/notes/requirements/R005 Target.md',
    );
    await writeFile(
      r005Path,
      `---\nid: R005\ntags: []\n---\n\n# R005\n\n§1.AC.01 First\n`,
    );

    await fileManager.buildIndex();

    await expect(
      runHardDelete({
        projectPath: tempDir,
        config,
        fileManager,
        noteId: 'R005',
        options: {},
      }),
    ).rejects.toThrow(/dirty/i);
  });

  it('cross-project alias references are warned and skipped (not rewritten)', async () => {
    const r005Path = path.join(
      tempDir,
      '_scepter/notes/requirements/R005 Target.md',
    );
    await writeFile(
      r005Path,
      `---\nid: R005\ntags: []\n---\n\n# R005\n\n§1.AC.01 First\n`,
    );

    const docsPath = path.join(tempDir, 'docs/some-doc.md');
    await writeFile(
      docsPath,
      `# Vendor doc\n\nSee {vendor-lib/R005.§1.AC.01} for context.\n`,
    );

    await fileManager.buildIndex();

    const result = await runHardDelete({
      projectPath: tempDir,
      config,
      fileManager,
      noteId: 'R005',
      options: { allowDirty: true },
    });

    expect('formatted' in result).toBe(false);
    if (!('formatted' in result)) {
      // The vendor reference was NOT rewritten.
      const docsAfter = await fs.readFile(docsPath, 'utf-8');
      expect(docsAfter).toContain('{vendor-lib/R005.§1.AC.01}');
      // A warning was surfaced.
      expect(result.warningCount).toBeGreaterThan(0);
    }
  });
});

describe('Lifecycle orchestrator — rename pipeline', () => {
  let tempDir: string;
  let fileManager: NoteFileManager;
  let config: SCEpterConfig;

  beforeEach(async () => {
    tempDir = await createTempDirectory();
    config = makeConfig();
    const configManager = createConfigManager(config);
    fileManager = new NoteFileManager(tempDir, configManager);
  });

  afterEach(async () => {
    await fileManager.stopWatching();
    await fs.remove(tempDir);
  });

  it('renames a single-file note: filesystem, frontmatter id, self-prefix, and inbound refs', async () => {
    // Source note R005 — includes its own frontmatter id and a self-
    // prefixed heading-form claim.
    const r005Path = path.join(
      tempDir,
      '_scepter/notes/requirements/R005 Source.md',
    );
    await writeFile(
      r005Path,
      `---\nid: R005\ntags: []\n---\n\n# R005 - Source\n\n### R005.§1.AC.01 First criterion\n\nSome body.\n`,
    );

    // Inbound referrer R007 with a body ref and a derives metadata
    // pointing at R005.
    const r007Path = path.join(
      tempDir,
      '_scepter/notes/requirements/R007 Referrer.md',
    );
    await writeFile(
      r007Path,
      `---\nid: R007\ntags: []\n---\n\n# R007\n\nDerived from {R005.§1.AC.01}.\n\n§1.DC.01:derives=R005.§1.AC.01 First derived\n`,
    );

    await fileManager.buildIndex();

    const result = await runRename({
      projectPath: tempDir,
      config,
      fileManager,
      sourceId: 'R005',
      targetId: 'R042',
      options: { allowDirty: true },
    });

    expect('formatted' in result).toBe(false);
    if ('formatted' in result) return;

    // Old file is gone.
    expect(await fs.pathExists(r005Path)).toBe(false);
    // New file exists with renamed basename.
    const newR005Path = path.join(
      tempDir,
      '_scepter/notes/requirements/R042 Source.md',
    );
    expect(await fs.pathExists(newR005Path)).toBe(true);
    // Inside the renamed note: frontmatter id and self-prefix rewritten.
    const renamedContent = await fs.readFile(newR005Path, 'utf-8');
    expect(renamedContent).toContain('\nid: R042\n');
    expect(renamedContent).toContain('### R042.§1.AC.01 First criterion');
    expect(renamedContent).not.toContain('### R005.§1.AC.01');
    expect(renamedContent).not.toContain('id: R005');
    // Referrer R007 has been rewritten — body ref + derives metadata.
    const r007After = await fs.readFile(r007Path, 'utf-8');
    expect(r007After).toContain('{R042.§1.AC.01}');
    expect(r007After).not.toContain('{R005.§1.AC.01}');
    expect(r007After).toContain(':derives=R042.§1.AC.01');
    expect(r007After).not.toContain(':derives=R005.§1.AC.01');
  });

  it('dry-run rename does not mutate disk', async () => {
    const r005Path = path.join(
      tempDir,
      '_scepter/notes/requirements/R005 Source.md',
    );
    await writeFile(
      r005Path,
      `---\nid: R005\ntags: []\n---\n\n# R005\n\n§1.AC.01 First\n`,
    );

    const r007Path = path.join(
      tempDir,
      '_scepter/notes/requirements/R007 Referrer.md',
    );
    await writeFile(
      r007Path,
      `---\nid: R007\ntags: []\n---\n\n# R007\n\n{R005.§1.AC.01}\n`,
    );

    await fileManager.buildIndex();

    const result = await runRename({
      projectPath: tempDir,
      config,
      fileManager,
      sourceId: 'R005',
      targetId: 'R042',
      options: { allowDirty: true, dryRun: true },
    });

    expect('formatted' in result).toBe(true);
    if ('formatted' in result) {
      expect(result.plan.renames.length).toBeGreaterThan(0);
      expect(result.plan.fileEdits.length).toBeGreaterThan(0);
      expect(result.formatted).toContain('REWRITE DRY-RUN');
    }

    // Disk unchanged.
    expect(await fs.pathExists(r005Path)).toBe(true);
    expect(await fs.pathExists(r007Path)).toBe(true);
    const r007After = await fs.readFile(r007Path, 'utf-8');
    expect(r007After).toContain('{R005.§1.AC.01}');
  });
});

/**
 * Compound-case integration test for {R015.§1.AC.05}: the swap case
 * where R005 is hard-deleted (its inbound references get tombstoned to
 * `_deleted_R005_at_<date>`) and then R007 is renamed to R005 (a freed
 * live ID). Both operations MUST succeed; pre-deletion inbound refs
 * remain tombstoned (not silently re-resolved to the new R005),
 * while post-rename refs to the new R005 resolve as live.
 *
 * Covers {DD020.§4.DC.13} compound case is two primitive invocations
 * and {DD020.§4.DC.11} target permits a previously-deleted ID.
 */
describe('Lifecycle orchestrator — compound swap (delete X then rename Y→X)', () => {
  let tempDir: string;
  let fileManager: NoteFileManager;
  let config: SCEpterConfig;

  beforeEach(async () => {
    tempDir = await createTempDirectory();
    config = makeConfig();
    const configManager = createConfigManager(config);
    fileManager = new NoteFileManager(tempDir, configManager);
  });

  afterEach(async () => {
    await fileManager.stopWatching();
    await fs.remove(tempDir);
  });

  it('R015.§1.AC.05: delete R005 then rename R007→R005; pre-deletion refs stay tombstoned, post-rename refs resolve as live', async () => {
    // Pre-state:
    //   R005 — target of hard-delete
    //   R007 — referrer that cites R005, will later be renamed to R005
    //   R042 — third-party referrer that cites R005 first, then will be
    //          told to cite the new R005 (the renamed-from-R007)
    const r005Path = path.join(tempDir, '_scepter/notes/requirements/R005 Target.md');
    await writeFile(
      r005Path,
      `---\nid: R005\ntags: []\n---\n\n# R005 - Target\n\n§1.AC.01 First criterion\n`,
    );

    const r007Path = path.join(tempDir, '_scepter/notes/requirements/R007 Future-R005.md');
    await writeFile(
      r007Path,
      `---\nid: R007\ntags: []\n---\n\n# R007\n\n§1.AC.01 Future first criterion\n`,
    );

    // R042 cites the original R005 — this citation should become tombstoned
    // after hard-delete and STAY tombstoned after the subsequent rename.
    const r042Path = path.join(tempDir, '_scepter/notes/requirements/R042 Referrer.md');
    await writeFile(
      r042Path,
      `---\nid: R042\ntags: []\n---\n\n# R042\n\nPre-deletion citation: {R005.§1.AC.01}.\n`,
    );

    await fileManager.buildIndex();

    // Step 1: hard-delete R005. R042's reference becomes tombstoned.
    const deleteResult = await runHardDelete({
      projectPath: tempDir,
      config,
      fileManager,
      noteId: 'R005',
      options: { allowDirty: true },
    });
    expect('formatted' in deleteResult).toBe(false);

    // R005 file is gone.
    expect(await fs.pathExists(r005Path)).toBe(false);
    // R042's reference is now tombstoned.
    let r042Content = await fs.readFile(r042Path, 'utf-8');
    expect(r042Content).toMatch(/\{_deleted_R005_at_\d{8,}\.§1\.AC\.01\}/);
    expect(r042Content).not.toContain('{R005.§1.AC.01}');

    // Step 2: rename R007 → R005. The previously-freed ID is now reusable.
    // R042's tombstoned ref MUST NOT be re-resolved to point at the new R005
    // (the marker substitution is permanent; rename does not unwind it).
    const renameResult = await runRename({
      projectPath: tempDir,
      config,
      fileManager,
      sourceId: 'R007',
      targetId: 'R005',
      options: { allowDirty: true },
    });
    expect('formatted' in renameResult).toBe(false);

    // R007 file is gone; new R005 file exists at renamed path.
    expect(await fs.pathExists(r007Path)).toBe(false);
    const newR005Path = path.join(
      tempDir,
      '_scepter/notes/requirements/R005 Future-R005.md',
    );
    expect(await fs.pathExists(newR005Path)).toBe(true);
    const newR005Content = await fs.readFile(newR005Path, 'utf-8');
    expect(newR005Content).toContain('\nid: R005\n');

    // The tombstoned reference in R042 is UNCHANGED by the rename.
    // Tombstones are permanent — they are NOT incidentally re-resolved
    // when a freed ID gets reused by a renamed note.
    r042Content = await fs.readFile(r042Path, 'utf-8');
    expect(r042Content).toMatch(/\{_deleted_R005_at_\d{8,}\.§1\.AC\.01\}/);
    // Specifically, R042 does NOT now have a live {R005.§1.AC.01} reference
    // from the rename (R042 cited R005 originally, not R007).
    expect(r042Content).not.toContain('{R005.§1.AC.01}');
  });
});

/**
 * Folder-form × hard-delete integration test: hard-delete on a
 * folder-form note with companion files removes the entire folder unit
 * atomically, with no companion files left behind.
 *
 * Covers {DD020.§3.DC.12} folder-unit atomicity and {DD020.§3.DC.13}
 * folder-unit-aware staging.
 */
describe('Lifecycle orchestrator — folder-form hard-delete', () => {
  let tempDir: string;
  let fileManager: NoteFileManager;
  let config: SCEpterConfig;

  beforeEach(async () => {
    tempDir = await createTempDirectory();
    config = makeConfig();
    const configManager = createConfigManager(config);
    fileManager = new NoteFileManager(tempDir, configManager);
  });

  afterEach(async () => {
    await fileManager.stopWatching();
    await fs.remove(tempDir);
  });

  it('hard-deletes a folder-form note: main file + companions removed atomically', async () => {
    // Folder-form note: R005 lives as a folder containing the main file
    // plus companion sub-files.
    const folderPath = path.join(tempDir, '_scepter/notes/requirements/R005 FolderNote');
    const mainPath = path.join(folderPath, 'R005 FolderNote.md');
    const companion1Path = path.join(folderPath, 'R005 Sub-Detail.md');
    const companion2Path = path.join(folderPath, 'R005 More-Detail.md');

    await writeFile(
      mainPath,
      `---\nid: R005\ntags: []\n---\n\n# R005 - FolderNote\n\n§1.AC.01 Main criterion\n`,
    );
    await writeFile(
      companion1Path,
      `# R005 sub-detail\n\nMore on §1.AC.01.\n`,
    );
    await writeFile(
      companion2Path,
      `# R005 more detail\n\nEven more on §1.AC.01.\n`,
    );

    // Inbound referrer.
    const r007Path = path.join(tempDir, '_scepter/notes/requirements/R007 Referrer.md');
    await writeFile(
      r007Path,
      `---\nid: R007\ntags: []\n---\n\n# R007\n\nCites {R005.§1.AC.01}.\n`,
    );

    await fileManager.buildIndex();

    const result = await runHardDelete({
      projectPath: tempDir,
      config,
      fileManager,
      noteId: 'R005',
      options: { allowDirty: true },
    });

    expect('formatted' in result).toBe(false);
    if ('formatted' in result) return;

    // The entire folder is gone, including every companion.
    expect(await fs.pathExists(folderPath)).toBe(false);
    expect(await fs.pathExists(mainPath)).toBe(false);
    expect(await fs.pathExists(companion1Path)).toBe(false);
    expect(await fs.pathExists(companion2Path)).toBe(false);

    // Inbound reference rewritten to tombstone.
    const r007Content = await fs.readFile(r007Path, 'utf-8');
    expect(r007Content).toMatch(/_deleted_R005_at_\d{8,}/);
    expect(r007Content).not.toContain('{R005.§1.AC.01}');
  });
});
