/**
 * Staging-area mechanics for atomic rewrite commits.
 *
 * The staging area is the two-phase commit primitive for
 * reference-rewriting operations. The flow is:
 *
 *   1. `prepare(stagedFiles)` — write planned post-states into
 *      `_scepter/_lifecycle-staging/<run-id>/` mirroring the project
 *      layout. Originals are not touched.
 *   2. `commit()` — atomically move staged files into their target
 *      paths (rename per file). Removals and renames are executed.
 *      If `commit` throws partway through, the caller is responsible
 *      for invoking `rollback`. The staging directory is removed on
 *      success.
 *   3. `rollback()` — drop the staging directory without touching
 *      target files.
 *
 * Interrupted runs leave the staging directory in place (a `.lock`
 * file at the run root). A subsequent invocation detects the stale
 * staging directory via `detectStaleStaging(projectPath)` and refuses
 * to proceed until the operator clears it. This is deliberate: the
 * presence of `_scepter/_lifecycle-staging/<run-id>/` is the loudest
 * possible signal that a previous run failed mid-flight and the user
 * MUST decide whether to inspect or discard it.
 *
 * @implements {DD020.§3.DC.01} two-phase plan() + apply(); apply commits or rolls back as a unit (no partial application)
 * @implements {DD020.§3.DC.02} staging directory under `_scepter/_lifecycle-staging/<run-id>/`; atomic rename on commit; refuse to start when stale staging exists
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Description of a file the staging area should write or remove or
 * rename on commit.
 */
export type StagedOperation =
  | {
      kind: 'write';
      /** Final path on commit. */
      targetPath: string;
      /** Content to write at commit. */
      content: string;
    }
  | {
      kind: 'remove';
      /** Path to unlink on commit. */
      targetPath: string;
    }
  | {
      kind: 'remove-folder';
      /** Folder path to recursively remove on commit. */
      targetPath: string;
    }
  | {
      kind: 'rename';
      /** Source path (must exist at commit time). */
      from: string;
      /** Destination path (must NOT exist at commit time). */
      to: string;
    };

/**
 * StagingArea is a single-use object: construct, prepare, then commit
 * OR rollback. Re-using the instance after commit/rollback is not
 * supported.
 */
export class StagingArea {
  /** Absolute path to the staging directory for this run. */
  readonly stagingDir: string;
  /** Unique run-ID embedded in the staging directory name. */
  readonly runId: string;

  private operations: StagedOperation[] = [];
  private state: 'fresh' | 'prepared' | 'committed' | 'rolled-back' = 'fresh';

  constructor(
    /** Absolute path to the project root. */
    private readonly projectPath: string,
    /**
     * Optional run-ID. If unset, a fresh random ID is generated. The
     * deterministic-ID form is mainly useful in tests.
     */
    runId?: string,
  ) {
    this.runId = runId ?? generateRunId();
    this.stagingDir = path.join(
      this.projectPath,
      '_scepter',
      '_lifecycle-staging',
      this.runId,
    );
  }

  /**
   * Write the planned operations into the staging directory.
   *
   * For `write` operations the content is staged at
   * `<stagingDir>/staged/<targetPath-relative>`; the actual target
   * path is recorded in the manifest so `commit` knows where to move
   * it to. `remove`, `remove-folder`, and `rename` operations are
   * recorded in the manifest but have no staged content.
   *
   * Throws if the staging directory already exists (the caller MUST
   * clear stale staging before constructing a new instance).
   */
  async prepare(operations: StagedOperation[]): Promise<void> {
    if (this.state !== 'fresh') {
      throw new Error(
        `StagingArea: cannot prepare in state '${this.state}'`,
      );
    }
    if (await fs.pathExists(this.stagingDir)) {
      throw new Error(
        `StagingArea: staging directory already exists at ${this.stagingDir}. ` +
          `A previous run may have been interrupted. Inspect or remove the directory before retrying.`,
      );
    }

    await fs.ensureDir(this.stagingDir);
    await fs.ensureDir(path.join(this.stagingDir, 'staged'));

    // Write a lock file so an external observer can distinguish
    // an in-progress run from a stale one.
    await fs.writeFile(
      path.join(this.stagingDir, '.lock'),
      JSON.stringify({
        runId: this.runId,
        startedAt: new Date().toISOString(),
      }),
    );

    this.operations = operations;

    for (const op of operations) {
      if (op.kind === 'write') {
        const stagedPath = path.join(
          this.stagingDir,
          'staged',
          encodeStagedPath(op.targetPath),
        );
        await fs.ensureDir(path.dirname(stagedPath));
        await fs.writeFile(stagedPath, op.content);
      }
    }

    // Write the manifest so we have a durable record of what
    // will happen on commit. Useful both for crash inspection and
    // for the rewrite-log writer.
    await fs.writeFile(
      path.join(this.stagingDir, 'manifest.json'),
      JSON.stringify(
        {
          runId: this.runId,
          operations: this.operations.map(serializeOp),
        },
        null,
        2,
      ),
    );

    this.state = 'prepared';
  }

  /**
   * Commit the staged operations.
   *
   * On success the staging directory is removed. On failure (anything
   * throwing during the commit loop) the staging directory is left in
   * place and the error propagates; callers may invoke `rollback`
   * after handling the error.
   */
  async commit(): Promise<void> {
    if (this.state !== 'prepared') {
      throw new Error(
        `StagingArea: cannot commit in state '${this.state}'`,
      );
    }

    for (const op of this.operations) {
      switch (op.kind) {
        case 'write': {
          const stagedPath = path.join(
            this.stagingDir,
            'staged',
            encodeStagedPath(op.targetPath),
          );
          await fs.ensureDir(path.dirname(op.targetPath));
          await fs.move(stagedPath, op.targetPath, { overwrite: true });
          break;
        }
        case 'remove': {
          if (await fs.pathExists(op.targetPath)) {
            await fs.unlink(op.targetPath);
          }
          break;
        }
        case 'remove-folder': {
          if (await fs.pathExists(op.targetPath)) {
            await fs.remove(op.targetPath);
          }
          break;
        }
        case 'rename': {
          await fs.ensureDir(path.dirname(op.to));
          await fs.move(op.from, op.to, { overwrite: false });
          break;
        }
      }
    }

    // Done — remove staging.
    await fs.remove(this.stagingDir);
    this.state = 'committed';
  }

  /**
   * Roll back the staging directory.
   *
   * Removes the staging directory without touching any target files.
   * Safe to call from any state (`fresh`, `prepared`, or after a
   * commit failure).
   */
  async rollback(): Promise<void> {
    if (this.state === 'committed') {
      throw new Error(
        'StagingArea: cannot rollback after a successful commit',
      );
    }
    if (await fs.pathExists(this.stagingDir)) {
      await fs.remove(this.stagingDir);
    }
    this.state = 'rolled-back';
  }

  /** Inspection accessor — current operation count. */
  get operationCount(): number {
    return this.operations.length;
  }
}

/**
 * Detect stale staging directories under `_scepter/_lifecycle-staging/`.
 *
 * Returns the list of absolute paths to stale staging directories
 * (empty list if none). Callers should refuse to start a new run
 * when this returns a non-empty list, instructing the operator to
 * inspect and clear them.
 */
export async function detectStaleStaging(
  projectPath: string,
): Promise<string[]> {
  const root = path.join(projectPath, '_scepter', '_lifecycle-staging');
  if (!(await fs.pathExists(root))) {
    return [];
  }
  const entries = await fs.readdir(root);
  const stale: string[] = [];
  for (const entry of entries) {
    const full = path.join(root, entry);
    const stat = await fs.stat(full);
    if (stat.isDirectory()) {
      stale.push(full);
    }
  }
  return stale;
}

/**
 * Encode an absolute target path into a relative path inside the
 * staging directory's `staged/` subfolder.
 *
 * Strategy: hash the absolute path + preserve the basename for
 * human-readability. Avoids OS-specific quirks (path length, char
 * restrictions) without losing identifiability.
 */
function encodeStagedPath(targetPath: string): string {
  const hash = crypto
    .createHash('sha1')
    .update(targetPath)
    .digest('hex')
    .slice(0, 16);
  const basename = path.basename(targetPath);
  return `${hash}-${basename}`;
}

/**
 * Generate a fresh run-ID. Used when the caller does not supply one.
 * Format: timestamp + 8 hex chars (collision-resistant for this domain).
 */
function generateRunId(): string {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString('hex');
  return `run-${ts}-${rand}`;
}

/** Helper for manifest serialization (purely for debugging / replay). */
function serializeOp(op: StagedOperation): Record<string, unknown> {
  switch (op.kind) {
    case 'write':
      return {
        kind: 'write',
        targetPath: op.targetPath,
        contentLength: op.content.length,
      };
    case 'remove':
      return { kind: 'remove', targetPath: op.targetPath };
    case 'remove-folder':
      return { kind: 'remove-folder', targetPath: op.targetPath };
    case 'rename':
      return { kind: 'rename', from: op.from, to: op.to };
  }
}
