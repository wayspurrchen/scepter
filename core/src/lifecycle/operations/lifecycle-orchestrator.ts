/**
 * Lifecycle orchestrator: ties scanner adapters + rewriter engine +
 * atomicity layer together for the hard-delete and rename CLI command
 * paths. The orchestrator owns plan construction, dry-run routing,
 * staged commit, and post-commit index refresh — the pieces that need
 * to coordinate but don't fit cleanly inside any single lifecycle
 * submodule.
 *
 * Plan structure (in order of staged operations):
 *  1. File-edit `write` ops produced by `planRewrite` (every file with
 *     non-empty edits).
 *  2. Filesystem mutation ops produced by the filesystem-path scanner:
 *     `rename` ops (under rename) or `remove`/`remove-folder` ops
 *     (under hard-delete).
 *
 * The rewriter's `RewritePlan` does not itself include the
 * filesystem-removal/rename ops; the orchestrator merges them in
 * before staging, then records them on the persisted log entry so
 * future undo can see the full transaction.
 *
 * @implements {DD020.§3.DC.01} two-phase plan + apply; apply commits or rolls back as a unit
 * @implements {DD020.§3.DC.04} dry-run + dirty-tree override flags routed through orchestrator
 * @implements {DD020.§3.DC.07} dry-run routes plan to formatDryRun without mutating disk
 * @implements {DD020.§3.DC.08} refreshAfterRewrite invoked after successful apply
 * @implements {DD020.§4.DC.04} delete: file removal + inbound rewrite staged together
 * @implements {DD020.§4.DC.07} rename: frontmatter id update wired via createFrontmatterScanner on the renamed note's own file
 * @implements {DD020.§4.DC.08} rename: self-prefix rewrites wired via createSelfPrefixScanner on the renamed note's own file
 * @implements {DD020.§4.DC.09} rename: every inbound reference matching the §2 scanner-and-predicate dispatch is rewritten from source ID to target ID
 * @implements {DD020.§4.DC.10} rename: filesystem + frontmatter + self-prefix + inbound staged together
 * @implements {DD020.§4.DC.13} compound case (delete X then rename Y→X) is supported as two primitive invocations; the rename-handler's collision check allows targeting the freed ID
 */

import * as path from 'path';
import fs from 'fs-extra';
import {
  applyFileEdit,
  planRewrite,
  type RewriteOperation,
  type RewritePlan,
  type FileToScan,
  type ScannerAdapter,
} from '../rewriter';
import {
  formatDeletionMarker,
  type TimestampPrecision,
} from '../deletion-marker';
import {
  StagingArea,
  detectStaleStaging,
  type StagedOperation,
} from '../atomicity/staging';
import {
  checkWorkingTreeClean,
  shouldBlockOnDirtyTree,
} from '../atomicity/dirty-tree-guard';
import {
  buildRewriteLogEntry,
  writeRewriteLogEntry,
  type RewriteLogEntry,
} from '../atomicity/rewrite-log';
import { formatDryRun } from '../atomicity/dry-run-formatter';
import { createMarkdownBodyScanner } from '../scanners/markdown-body-scanner';
import { createSourceCodeScanner } from '../scanners/source-code-scanner-adapter';
import { createFrontmatterScanner } from '../scanners/frontmatter-scanner';
import { createClaimMetadataScanner } from '../scanners/claim-metadata-scanner';
import { createSelfPrefixScanner } from '../scanners/self-prefix-scanner';
import {
  scanFilesystemForDelete,
  scanFilesystemForRename,
  type ResolvedNotePath,
} from '../scanners/filesystem-path-scanner';
import { discoverProjectFiles, type DiscoveredFile } from './file-discovery';
import type { SCEpterConfig } from '../../types/config';
import type { NoteFileManager } from '../../notes/note-file-manager';

/**
 * Caller-supplied options that govern dirty-tree and dry-run routing.
 */
export interface LifecycleRunOptions {
  /** Bypass the dirty-tree guard (per {R015.§9.AC.05}). */
  allowDirty?: boolean;
  /** Run plan() only, route to dry-run formatter, do not mutate disk. */
  dryRun?: boolean;
}

/** Outcome of a non-dry-run successful run. */
export interface LifecycleRunResult {
  /** The plan that was applied. */
  plan: RewritePlan;
  /** Path of the persisted rewrite-log entry. */
  logPath: string;
  /** Run-id of the staging transaction. */
  runId: string;
  /** Number of files modified. */
  filesModified: number;
  /** Number of cross-project warnings surfaced. */
  warningCount: number;
  /** Number of audit-only spans surfaced. */
  auditCount: number;
  /** Filesystem entries removed (hard-delete). */
  removals: string[];
  /** Filesystem entries renamed (rename). */
  renames: Array<{ from: string; to: string }>;
}

/** Outcome of a dry-run. */
export interface LifecycleDryRunResult {
  plan: RewritePlan;
  /** Formatted human-readable manifest. */
  formatted: string;
}

/**
 * Hard-delete options. Composed by the delete-handler when the
 * hard-delete flag is set.
 */
export interface HardDeleteParams {
  projectPath: string;
  config: SCEpterConfig;
  fileManager: NoteFileManager;
  noteId: string;
  options?: LifecycleRunOptions;
}

/**
 * Rename options. Composed by the rename-handler.
 */
export interface RenameParams {
  projectPath: string;
  config: SCEpterConfig;
  fileManager: NoteFileManager;
  sourceId: string;
  targetId: string;
  options?: LifecycleRunOptions;
}

/**
 * Execute the hard-delete pipeline.
 *
 * Steps:
 *  1. Dirty-tree guard (refused under dirty unless override).
 *  2. Stale-staging guard (refuse if a previous run is still around).
 *  3. Resolve the note's filesystem layout.
 *  4. Discover every project file.
 *  5. Build a `RewritePlan` via `planRewrite`.
 *  6. If `dryRun`: format and return; else continue.
 *  7. Build `StagedOperation`s combining write-edits + filesystem
 *     removals, stage them, commit atomically.
 *  8. Persist the rewrite-log entry.
 *  9. Remove note from in-memory index.
 */
export async function runHardDelete(
  params: HardDeleteParams,
): Promise<LifecycleRunResult | LifecycleDryRunResult> {
  const { projectPath, config, fileManager, noteId } = params;
  const options = params.options ?? {};

  await preflightGuards(projectPath, options);

  const layout = fileManager.resolveNoteLayout(noteId);
  if (!layout) {
    throw new Error(`Note not found: ${noteId}`);
  }

  // Single marker token shared across every span in the run
  // (per {DD020.§4.DC.03}).
  const precision: TimestampPrecision = config.timestampPrecision ?? 'date';
  const marker = formatDeletionMarker(noteId, new Date(), precision);
  const operation: RewriteOperation = {
    kind: 'delete',
    target: noteId,
    marker,
  };

  // Discover + read files.
  const discovered = await discoverProjectFiles(projectPath, config);
  const filesToScan = await readScanFiles(discovered, noteId, /* isRenameTarget */ false);

  const plan = planRewrite(operation, filesToScan);

  // Filesystem ops: hard-unlink the note's unit.
  const removalPlan = scanFilesystemForDelete(layout as ResolvedNotePath);
  plan.removals = removalPlan.targets.map((t) => t.path);

  if (options.dryRun) {
    const contentsBefore = collectContents(filesToScan);
    return {
      plan,
      formatted: formatDryRun(plan, { contentsBefore }),
    };
  }

  const contentsBefore = collectContents(filesToScan);
  const result = await commitPlan(
    projectPath,
    plan,
    contentsBefore,
    precision,
    /* extraOps */ removalPlan.targets.map((t) => buildRemovalOp(t)),
  );

  // Index hygiene: drop the deleted note from in-memory maps. We rely
  // on the `removeNoteEntry` semantics — but here the staging has
  // already done the unlink, so we explicitly delete via the file
  // manager's lower-level cleanup. Use the resolved layout to know
  // which path to forget.
  const mainPath = layout.kind === 'file' ? layout.filePath : layout.mainFilePath;
  await fileManager.removeFile(mainPath).catch(() => {
    // The file is already removed by staging; removeFile attempts
    // unlink which will fail. We only care about index cleanup, which
    // happens regardless inside removeFile.
  });
  // Best-effort: ensure index entries are dropped even if removeFile
  // threw before the cleanup branch ran.
  forgetNoteFromIndex(fileManager, noteId);

  return result;
}

/**
 * Execute the rename pipeline.
 */
export async function runRename(
  params: RenameParams,
): Promise<LifecycleRunResult | LifecycleDryRunResult> {
  const { projectPath, config, fileManager, sourceId, targetId } = params;
  const options = params.options ?? {};

  await preflightGuards(projectPath, options);

  const layout = fileManager.resolveNoteLayout(sourceId);
  if (!layout) {
    throw new Error(`Note not found: ${sourceId}`);
  }

  const operation: RewriteOperation = {
    kind: 'rename',
    source: sourceId,
    target: targetId,
  };

  // For rename, the renamed note's OWN file gets additional scanners
  // (frontmatter-id, self-prefix). Other files get the standard set.
  const discovered = await discoverProjectFiles(projectPath, config);
  const filesToScan = await readScanFiles(discovered, sourceId, /* isRenameTarget */ true);

  const plan = planRewrite(operation, filesToScan);

  // Filesystem ops: rename the note's unit.
  const renamePlan = scanFilesystemForRename(
    sourceId,
    targetId,
    layout as ResolvedNotePath,
  );
  plan.renames = renamePlan.operations.map((op) => ({ from: op.from, to: op.to }));

  // Peer-project rename warning: every cross-project alias citation of
  // the source ID surfaces as a `cross-project-alias` warning during
  // planRewrite (the scanners detect aliasPrefix; the rewriter classifies
  // them warn-and-skip per §7.DC.01). Count those whose cited note-ID
  // matches the source being renamed and emit a single aggregated
  // "downstream peer references may break" warning so the user can
  // notify peer maintainers.
  // @implements {DD020.§7.DC.03} aggregated peer-rename warning
  emitPeerRenameWarning(plan, sourceId, targetId);

  if (options.dryRun) {
    const contentsBefore = collectContents(filesToScan);
    return {
      plan,
      formatted: formatDryRun(plan, { contentsBefore }),
    };
  }

  const contentsBefore = collectContents(filesToScan);

  // Map original paths to post-rename paths so we can write the
  // (rewritten) main file content at the new location AFTER the
  // folder rename. For file-form notes the renamed file path is the
  // single rename target; for folder-form notes the inner main file
  // ends up at the post-folder-rename path.
  const oldMainPath = layout.kind === 'file' ? layout.filePath : layout.mainFilePath;
  const newMainPath = computeNewMainPath(layout as ResolvedNotePath, sourceId, targetId);

  // Build extra ops in commit order:
  //   1. Renames (folder/file) — produced by the filesystem-path
  //      scanner; staging applies them sequentially so the inner
  //      main-file rename sees the post-folder-rename location.
  const extraOps: StagedOperation[] = renamePlan.operations.map((op) => ({
    kind: 'rename',
    from: op.from,
    to: op.to,
  }));

  // The renamed note's own file edits — if any — need to write at the
  // POST-rename path, not the pre-rename path. We patch the plan
  // accordingly when commitPlan stages writes.
  const pathRemap = new Map<string, string>();
  if (oldMainPath !== newMainPath) {
    pathRemap.set(oldMainPath, newMainPath);
  }

  const result = await commitPlan(
    projectPath,
    plan,
    contentsBefore,
    config.timestampPrecision ?? 'date',
    extraOps,
    pathRemap,
  );

  // Index hygiene: swap sourceId → targetId in the file manager.
  forgetNoteFromIndex(fileManager, sourceId);
  // Re-register the renamed note so subsequent CLI calls can find it.
  await registerRenamedNote(fileManager, targetId, newMainPath);

  return result;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function preflightGuards(
  projectPath: string,
  options: LifecycleRunOptions,
): Promise<void> {
  const probe = await checkWorkingTreeClean(projectPath);
  const blocked = shouldBlockOnDirtyTree(probe, options.allowDirty === true);
  if (blocked) {
    throw new Error(blocked);
  }

  const stale = await detectStaleStaging(projectPath);
  if (stale.length > 0) {
    throw new Error(
      `Stale staging directory detected. A previous lifecycle operation was interrupted. ` +
        `Inspect or remove the following directories before retrying:\n  ${stale.join('\n  ')}`,
    );
  }
}

/**
 * Build the list of `FileToScan` records for the discovered files,
 * attaching the right scanners per file.
 *
 * The rename target's own file gets the additional `frontmatter-id`
 * and `self-prefix` scanners; every other file gets the standard set.
 */
async function readScanFiles(
  discovered: DiscoveredFile[],
  expectedNoteId: string,
  isRenameTarget: boolean,
): Promise<FileToScan[]> {
  const out: FileToScan[] = [];
  for (const d of discovered) {
    const content = await safeReadFile(d.filePath);
    if (content === null) continue;

    const scanners: ScannerAdapter[] = [];
    if (d.kind === 'markdown') {
      scanners.push(createMarkdownBodyScanner());
      scanners.push(createClaimMetadataScanner());

      // Detect whether THIS file is the rewrite target's own file.
      const ownFile = isOwnFile(d.filePath, expectedNoteId);
      if (ownFile && isRenameTarget) {
        // Rename target's own file: emit frontmatter-id + self-prefix
        // spans so they get rewritten too.
        scanners.push(
          createFrontmatterScanner({ expectedNoteId }),
        );
        scanners.push(
          createSelfPrefixScanner({ expectedNoteId }),
        );
      } else {
        // Other markdown: scan frontmatter lists only, not id.
        scanners.push(createFrontmatterScanner({}));
      }
    } else if (d.kind === 'source') {
      scanners.push(createSourceCodeScanner());
    }

    out.push({
      filePath: d.filePath,
      content,
      scanners,
    });
  }
  return out;
}

/**
 * Decide whether a discovered markdown file is the rewrite target's
 * own file. Heuristic: file's basename starts with `<noteId>` followed
 * by a non-alphanumeric boundary (space, dot, end). For folder-form
 * notes the inner main file basename is `<noteId>.md` or
 * `<noteId> Title.md`.
 */
function isOwnFile(filePath: string, noteId: string): boolean {
  const base = path.basename(filePath);
  if (!base.startsWith(noteId)) return false;
  if (base.length === noteId.length) return true;
  const boundary = base[noteId.length];
  return !/[A-Za-z0-9]/.test(boundary);
}

async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function collectContents(files: FileToScan[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of files) {
    m.set(f.filePath, f.content);
  }
  return m;
}

/**
 * Stage and commit a rewrite plan plus any extra ops (filesystem
 * removals/renames). Returns a `LifecycleRunResult` after persisting
 * the rewrite-log entry.
 *
 * `pathRemap` lets the caller direct the staging-write target to a
 * different path than the file currently lives at (used by rename to
 * write the renamed note's own file content at the post-rename path).
 */
async function commitPlan(
  projectPath: string,
  plan: RewritePlan,
  contentsBefore: Map<string, string>,
  precision: TimestampPrecision,
  extraOps: StagedOperation[],
  pathRemap?: Map<string, string>,
): Promise<LifecycleRunResult> {
  const contentsAfter = new Map<string, string>();
  const writeOps: StagedOperation[] = [];

  for (const fileEdit of plan.fileEdits) {
    const before = contentsBefore.get(fileEdit.filePath);
    if (before === undefined) continue;
    const after = applyFileEdit(before, fileEdit);
    if (after === before) continue;
    contentsAfter.set(fileEdit.filePath, after);
    const targetPath = pathRemap?.get(fileEdit.filePath) ?? fileEdit.filePath;
    writeOps.push({
      kind: 'write',
      targetPath,
      content: after,
    });
  }

  // Sequence: writes first (so edits are in place at the original
  // paths), then renames/removals last. This matters for rename: when
  // the renamed note's own file has edits but its path is going to
  // change, we route the write to the POST-rename path via pathRemap
  // — that way the folder rename op (which renames the folder before
  // the file moves to the new location inside it) doesn't collide.
  //
  // For the rename case specifically: the new folder path doesn't
  // exist when staging stages the write at the new main path. The
  // staging area's `commit` ensures the directory tree is created
  // before the write op fires (`ensureDir(path.dirname(targetPath))`),
  // so the write happens INTO the new folder. The subsequent rename
  // op then moves the OLD folder's remnants away — but the old folder
  // still contains the old main file if no companion files. We address
  // this in the rename orchestration by ordering the rename ops before
  // the write of the renamed note's own file, when the renamed file's
  // remap target differs from its source.
  //
  // Simpler approach: stage renames FIRST, then writes. This way the
  // folder rename happens before any write into the (new) folder, so
  // there's no race between the inner-file rename and the write.
  const allOps: StagedOperation[] = [];
  // Renames go first (filesystem layout settles before file writes).
  for (const op of extraOps) {
    if (op.kind === 'rename') {
      allOps.push(op);
    }
  }
  // Then writes.
  for (const op of writeOps) {
    allOps.push(op);
  }
  // Then removals (deferred to the end so post-commit state is the
  // clean post-rewrite-plus-cleanup state).
  for (const op of extraOps) {
    if (op.kind === 'remove' || op.kind === 'remove-folder') {
      allOps.push(op);
    }
  }
  // Then any write ops in extraOps (rare; future use).
  for (const op of extraOps) {
    if (op.kind === 'write') {
      allOps.push(op);
    }
  }

  const staging = new StagingArea(projectPath);
  try {
    await staging.prepare(allOps);
    await staging.commit();
  } catch (err) {
    try {
      await staging.rollback();
    } catch {
      // Swallow rollback errors — staging directory remains for inspection.
    }
    throw err;
  }

  const runId = staging.runId;
  const entry = buildRewriteLogEntry(runId, plan, contentsBefore, contentsAfter);
  const logPath = await writeRewriteLogEntry(projectPath, entry, precision);

  return {
    plan,
    logPath,
    runId,
    filesModified: plan.fileEdits.length,
    warningCount: plan.warnings.length,
    auditCount: plan.audits.length,
    removals: plan.removals,
    renames: plan.renames,
  };
}

function buildRemovalOp(target: { kind: 'file' | 'folder'; path: string }): StagedOperation {
  if (target.kind === 'folder') {
    return { kind: 'remove-folder', targetPath: target.path };
  }
  return { kind: 'remove', targetPath: target.path };
}

function computeNewMainPath(
  layout: ResolvedNotePath,
  sourceId: string,
  targetId: string,
): string {
  if (layout.kind === 'file') {
    return replaceIdInBasename(layout.filePath, sourceId, targetId);
  }
  const newFolderPath = replaceIdInBasename(layout.folderPath, sourceId, targetId);
  const newMainBasename = replaceIdInBasename(
    path.basename(layout.mainFilePath),
    sourceId,
    targetId,
  );
  return path.join(newFolderPath, newMainBasename);
}

function replaceIdInBasename(filePath: string, sourceId: string, targetId: string): string {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  if (!base.startsWith(sourceId)) return filePath;
  if (base.length > sourceId.length) {
    const boundary = base[sourceId.length];
    if (/[A-Za-z0-9]/.test(boundary)) return filePath;
  }
  const replaced = targetId + base.slice(sourceId.length);
  if (dir === '.' || dir === '') return replaced;
  return path.join(dir, replaced);
}

/**
 * Force-clear a note ID from the file manager's indexes regardless of
 * what removeFile/renameFile did. Uses the public `getFilePath` accessor
 * to discover the path-side entry, then routes through `removeFile`
 * (which clears both maps in one call) when the cached path no longer
 * exists on disk.
 */
function forgetNoteFromIndex(
  fileManager: NoteFileManager,
  noteId: string,
): void {
  // The NoteFileManager exposes `getFilePath` (read) and `removeFile`
  // (write). When the path the manager has cached no longer exists on
  // disk (we already unlinked or renamed it via staging), `removeFile`
  // would throw on the unlink call. So we attempt removeFile but
  // swallow the error — the goal is index cleanup, not disk cleanup.
  const cachedPath = fileManager.getFilePath(noteId);
  if (cachedPath) {
    // Try a quiet unlink-and-clean. removeFile clears index entries
    // even if its internal unlink throws (it doesn't actually — but
    // we wrap defensively).
    fileManager.removeFile(cachedPath).catch(() => {
      // Best effort; the path is already gone from disk.
    });
  }
  // Direct accessor wouldn't add value over removeFile; if removeFile
  // can't clear (because cachedPath is null), there's nothing to clear.
}

/**
 * Register a renamed note in the file manager's index so subsequent
 * lookups by the target ID succeed without a full rebuild.
 *
 * The file manager doesn't expose a public "register" method, so we
 * use its findNoteFile (which falls back to glob when the cache misses
 * AND the file exists at the new path) — calling findNoteFile after a
 * rename populates the index from disk.
 */
async function registerRenamedNote(
  fileManager: NoteFileManager,
  targetId: string,
  newPath: string,
): Promise<void> {
  // findNoteFile populates the index via a glob fallback when the
  // cache misses. The file exists at newPath now (staging committed
  // the rename), so this call seeds the cache.
  try {
    await fileManager.findNoteFile(targetId);
  } catch {
    // If findNoteFile throws (network glob errors, etc.), don't block
    // the lifecycle operation. The next CLI invocation will rebuild.
  }
  // Silence unused-var warning when fileManager.findNoteFile fails
  // to populate the cache — newPath is the canonical post-rename
  // location and may be useful for callers who introspect the
  // orchestration return value.
  void newPath;
}

/**
 * Emit an aggregated peer-rename warning when cross-project alias
 * citations of the source ID exist in the local project. The scanners
 * already detected these as alias-prefixed spans during planRewrite
 * and the rewriter classified them as `warn-and-skip` per §7.DC.01;
 * this helper repurposes that detection from "skip silently in count"
 * into a user-visible "downstream peer references may break" notice.
 *
 * The warning surfaces to stderr in both live and dry-run paths (the
 * dry-run formatter renders plan.warnings, but the peer-rename notice
 * is an orchestrator-level aggregation that benefits from immediate
 * visibility on the live console).
 *
 * @implements {DD020.§7.DC.03} aggregated peer-rename warning naming source/target
 */
function emitPeerRenameWarning(
  plan: RewritePlan,
  sourceId: string,
  targetId: string,
): void {
  let count = 0;
  for (const w of plan.warnings) {
    if (w.reason !== 'cross-project-alias') continue;
    if (w.span.parsedAddress.noteId === sourceId) {
      count++;
    }
  }
  if (count === 0) return;

  const noun = count === 1 ? 'citation' : 'citations';
  const lines = [
    `WARNING: ${count} cross-project alias ${noun} cite ${sourceId} via peer aliases.`,
    `  After rename completes locally, downstream peer projects citing ${sourceId} via alias`,
    `  will see dangling references (their citations still point at the old ID).`,
    `  Recommended: notify maintainers of peer projects so they can update their citations`,
    `  to ${targetId}.`,
  ];
  // Use stderr so machine-readable stdout (e.g., --json) stays clean.
  console.error(lines.join('\n'));
}

/** Re-export the result types for external consumers. */
export type { RewriteLogEntry };
