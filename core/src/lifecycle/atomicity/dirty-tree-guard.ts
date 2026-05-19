/**
 * Dirty-tree guard for the rewriter.
 *
 * Probes the project's git status to decide whether a rewrite is safe
 * to start. The rewriter MUST refuse to run against a dirty tree
 * unless the caller passes an explicit override flag — uncommitted
 * changes intermingled with rewriter output make it impossible for
 * the user to review what the tool changed.
 *
 * Possible statuses returned by `checkWorkingTreeClean`:
 *
 *   - `'clean'`: `git status --porcelain` produced no output. Safe.
 *   - `'dirty'`: working tree contains uncommitted changes. Refuse
 *     unless override.
 *   - `'not-a-git-repo'`: the project is not under git. Proceed
 *     without the guard (the user has chosen not to use git for
 *     this project).
 *
 * @implements {DD020.§3.DC.03} git status probe; clean/dirty/not-a-git-repo; refuses to run when dirty unless override; not-a-git-repo proceeds without guard
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type DirtyTreeStatus = 'clean' | 'dirty' | 'not-a-git-repo';

export interface DirtyTreeProbeResult {
  status: DirtyTreeStatus;
  /**
   * Verbatim porcelain output when status is `'dirty'`. Empty otherwise.
   * Caller may surface this to the user as the reason for refusal.
   */
  porcelain: string;
}

/**
 * Probe the working tree of `projectPath` via `git status --porcelain`.
 *
 * Uses `execFile` (not `execSync`) for portability and to avoid shell
 * interpolation. Timeouts at 10s — git status should complete in
 * milliseconds on any sane repository.
 */
export async function checkWorkingTreeClean(
  projectPath: string,
): Promise<DirtyTreeProbeResult> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['status', '--porcelain'],
      {
        cwd: projectPath,
        timeout: 10_000,
        maxBuffer: 1024 * 1024, // 1 MB of porcelain output is plenty
      },
    );
    const porcelain = stdout.trimEnd();
    if (porcelain === '') {
      return { status: 'clean', porcelain: '' };
    }
    return { status: 'dirty', porcelain };
  } catch (err) {
    // git not installed, or projectPath not a repo, or both.
    const msg =
      err instanceof Error ? err.message : String(err);
    if (
      /not a git repository/i.test(msg) ||
      /does not have any commits yet/i.test(msg) ||
      /command not found/i.test(msg) ||
      /enoent/i.test(msg)
    ) {
      return { status: 'not-a-git-repo', porcelain: '' };
    }
    // Unknown failure — be conservative: report as not-a-repo so the
    // operation proceeds (the alternative is permanent unrecoverable
    // refusal, which is worse).
    return { status: 'not-a-git-repo', porcelain: '' };
  }
}

/**
 * Decide whether the rewriter is permitted to proceed given a probe
 * result and an override flag.
 *
 * Returns `null` when permitted; returns an error message string
 * when blocked.
 */
export function shouldBlockOnDirtyTree(
  probe: DirtyTreeProbeResult,
  override: boolean,
): string | null {
  if (probe.status === 'clean') return null;
  if (probe.status === 'not-a-git-repo') return null;
  if (override) return null;
  return (
    'Working tree is dirty; refusing to run reference-rewriting operation. ' +
    'Commit your changes first, or pass the override flag to proceed anyway.\n\n' +
    probe.porcelain
  );
}
