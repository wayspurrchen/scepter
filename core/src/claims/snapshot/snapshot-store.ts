/**
 * Snapshot store.  Filesystem I/O for the snapshot directory: read,
 * write, list, remove, atomic-overwrite, gitignore self-bootstrap.
 *
 * The store does NOT format output for human consumption — list/show
 * formatting lives in the snapshot-formatter module (Phase 2).  This
 * separation mirrors the rest of the claim subsystem
 * (`claim-formatter.ts` is separate from `claim-index.ts`).
 *
 * @implements {DD018.§3.DC.21} SNAPSHOT_DIR_RELATIVE = '_scepter/snapshots'
 * @implements {DD018.§3.DC.22} snapshotPath name allowlist + leading-dot rejection
 * @implements {DD018.§3.DC.23} writeSnapshot atomic temp-then-rename + force semantics
 * @implements {DD018.§3.DC.24} ensureSnapshotDir idempotent mkdir
 * @implements {DD018.§3.DC.25} listSnapshots; tolerate missing directory
 * @implements {DD018.§3.DC.26} removeSnapshot; throws SnapshotNotFoundError on missing
 * @implements {DD018.§3.DC.27} defaultSnapshotName YYYY-MM-DD-HHMM local time
 * @implements {DD018.§3.DC.28} typed errors: SnapshotExistsError, SnapshotNotFoundError
 * @implements {DD018.§3.DC.29} readSnapshot with schema-version validation
 * @implements {DD018.§3.DC.30} no human-output formatting in this module
 * @implements {DD018.§3.DC.31} .gitignore self-bootstrap with `*\n`; never rewrite
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { SCHEMA_VERSION } from './snapshot-types.js';
import type { Snapshot } from './snapshot-types.js';

/**
 * Project-relative directory in which snapshot files live.  Resolved
 * to absolute via `path.join(projectRoot, SNAPSHOT_DIR_RELATIVE)` by
 * every store function.
 *
 * @implements {DD018.§3.DC.21}
 */
export const SNAPSHOT_DIR_RELATIVE = '_scepter/snapshots';

/**
 * Allowlist regex for snapshot names per §DC.22.  Matches typical
 * filesystem-friendly naming and excludes shell metacharacters and
 * unicode at the input boundary.
 */
const SNAPSHOT_NAME_RE = /^[a-zA-Z0-9._-]+$/;

/**
 * Thrown by `writeSnapshot` when the target file already exists and
 * `options.force` is false.  Carries the absolute target path so CLI
 * handlers can include it in the user-facing message.
 *
 * @implements {DD018.§3.DC.28}
 */
export class SnapshotExistsError extends Error {
  public readonly filePath: string;
  constructor(filePath: string) {
    super(`Snapshot already exists at ${filePath}. Use --force to overwrite.`);
    this.name = 'SnapshotExistsError';
    this.filePath = filePath;
  }
}

/**
 * Thrown by `removeSnapshot` (and surfaced from CLI handlers for
 * `show`/`rm` lookups) when no snapshot file exists for the given
 * name.  Carries the name so handlers can include it in the message.
 *
 * @implements {DD018.§3.DC.28}
 */
export class SnapshotNotFoundError extends Error {
  public readonly snapshotName: string;
  constructor(name: string) {
    super(`Snapshot not found: ${name}`);
    this.name = 'SnapshotNotFoundError';
    this.snapshotName = name;
  }
}

/**
 * Thrown by `readSnapshot` when the loaded JSON's `schemaVersion`
 * field is missing, non-numeric, or exceeds `SCHEMA_VERSION` with no
 * shim available.  The `version` field carries the offending value
 * (or `null` when missing/non-numeric).
 *
 * @implements {DD018.§3.DC.13}
 * @implements {DD018.§3.DC.29}
 */
export class SnapshotSchemaError extends Error {
  public readonly filePath: string;
  public readonly version: number | null;
  constructor(filePath: string, version: number | null) {
    super(
      version === null
        ? `Snapshot at ${filePath} is missing or has a non-numeric schemaVersion field; cannot load.`
        : `Snapshot at ${filePath} was captured by a newer version of scepter ` +
            `(schema v${version}). Upgrade scepter or use a compatible binary.`,
    );
    this.name = 'SnapshotSchemaError';
    this.filePath = filePath;
    this.version = version;
  }
}

/**
 * Compute the absolute filesystem path for a named snapshot.
 *
 * The `name` argument MUST match the allowlist regex
 * `/^[a-zA-Z0-9._-]+$/` AND MUST NOT begin with a leading dot (`.`);
 * the function throws otherwise.  The leading-dot rejection blocks
 * invisible-dotfile snapshots that would be silently filtered out by
 * `listSnapshots`'s `.json` glob.
 *
 * @implements {DD018.§3.DC.22}
 */
export function snapshotPath(projectRoot: string, name: string): string {
  if (!SNAPSHOT_NAME_RE.test(name) || name.startsWith('.')) {
    throw new Error(
      `Snapshot name must match /^[a-zA-Z0-9._-]+$/ and not start with a dot. Reject: ${name}.`,
    );
  }
  return path.join(projectRoot, SNAPSHOT_DIR_RELATIVE, `${name}.json`);
}

/**
 * Default snapshot name in `YYYY-MM-DD-HHMM` local-time format.
 * Production callers pass nothing (uses `new Date()`); tests pass a
 * fixed Date.
 *
 * @implements {DD018.§3.DC.27}
 */
export function defaultSnapshotName(now?: Date): string {
  const d = now ?? new Date();
  const year = d.getFullYear().toString().padStart(4, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  const hour = d.getHours().toString().padStart(2, '0');
  const minute = d.getMinutes().toString().padStart(2, '0');
  return `${year}-${month}-${day}-${hour}${minute}`;
}

/**
 * Idempotent `mkdir` of `_scepter/snapshots/` AND idempotent
 * gitignore self-bootstrap per §DC.31.  After the directory is
 * created, the function attempts to access `.gitignore`; if absent it
 * writes `*\n`, else it leaves the existing file untouched.  This
 * preserves any user customization and is idempotent across saves.
 *
 * @implements {DD018.§3.DC.24}
 * @implements {DD018.§3.DC.31}
 */
export async function ensureSnapshotDir(projectRoot: string): Promise<void> {
  const dir = path.join(projectRoot, SNAPSHOT_DIR_RELATIVE);
  await fs.mkdir(dir, { recursive: true });

  const gitignorePath = path.join(dir, '.gitignore');
  try {
    await fs.access(gitignorePath);
    // Already present — do NOT rewrite.
  } catch {
    // ENOENT (or any access error) → write the default.
    await fs.writeFile(gitignorePath, '*\n', 'utf8');
  }
}

/**
 * Atomic-write a snapshot to `<projectRoot>/<SNAPSHOT_DIR_RELATIVE>/<name>.json`.
 *
 * Behavior:
 *   1. Validate the name and compute the target path.
 *   2. Ensure the directory + gitignore exist (`ensureSnapshotDir`).
 *   3. When `options.force === false` and the target exists, throw
 *      `SnapshotExistsError`.
 *   4. Write to a sibling temp file `<filePath>.tmp`, then `fs.rename`
 *      to the target.  Same-filesystem rename semantics are required;
 *      `_scepter/snapshots/` lives inside the project so temp + target
 *      are guaranteed to share a filesystem.
 *
 * Returns the absolute target path on success.
 *
 * @implements {DD018.§3.DC.23}
 */
export async function writeSnapshot(
  projectRoot: string,
  name: string,
  snapshot: Snapshot,
  options: { force: boolean },
): Promise<{ filePath: string }> {
  const filePath = snapshotPath(projectRoot, name);
  await ensureSnapshotDir(projectRoot);

  if (!options.force) {
    try {
      await fs.access(filePath);
      throw new SnapshotExistsError(filePath);
    } catch (err) {
      if (err instanceof SnapshotExistsError) throw err;
      // ENOENT — proceed to write.
    }
  }

  const tempPath = `${filePath}.tmp`;
  const json = JSON.stringify(snapshot, null, 2);
  await fs.writeFile(tempPath, json, 'utf8');
  await fs.rename(tempPath, filePath);

  return { filePath };
}

/**
 * Per-row summary returned by `listSnapshots`.  The CLI list handler
 * passes these rows to the snapshot-formatter (Phase 2) for table
 * rendering.
 *
 * `claimCount` is the number of claim entries inside the snapshot;
 * `fileSize` is the byte size on disk; `capturedAt` is the verbatim
 * ISO timestamp from the snapshot's metadata block.
 */
export interface SnapshotListRow {
  name: string;
  filePath: string;
  capturedAt: string;
  claimCount: number;
  fileSize: number;
}

/**
 * List every snapshot in the project's snapshot directory.  Returns
 * the empty array when the directory does not exist (per §DC.25 the
 * directory is created on first save; no save means no list — not an
 * error).
 *
 * Each row includes the byte size from `fs.stat` and a small read of
 * the file's metadata + claims length.  The full `claims` array is
 * parsed because `JSON.parse` is the simplest reliable way to extract
 * `claims.length` from a snapshot whose schema is the simple object
 * shape this DD pins.  A streaming/partial parser would add risk
 * without measurable gain at the file sizes the §8 contract expects.
 *
 * @implements {DD018.§3.DC.25}
 */
export async function listSnapshots(projectRoot: string): Promise<SnapshotListRow[]> {
  const dir = path.join(projectRoot, SNAPSHOT_DIR_RELATIVE);
  let dirents: string[];
  try {
    dirents = await fs.readdir(dir);
  } catch (err) {
    if (isENOENT(err)) return [];
    throw err;
  }

  const jsonFiles = dirents.filter((f) => f.endsWith('.json'));
  const rows: SnapshotListRow[] = [];

  for (const file of jsonFiles) {
    const name = file.slice(0, -'.json'.length);
    if (!SNAPSHOT_NAME_RE.test(name) || name.startsWith('.')) {
      // Out-of-policy filename — skip rather than crash.  A user
      // could have manually dropped a file into the directory; the
      // listing is robust to it.
      continue;
    }
    const filePath = path.join(dir, file);
    try {
      const stat = await fs.stat(filePath);
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Snapshot;
      rows.push({
        name,
        filePath,
        capturedAt: parsed.metadata?.capturedAt ?? '',
        claimCount: Array.isArray(parsed.claims) ? parsed.claims.length : 0,
        fileSize: stat.size,
      });
    } catch {
      // Unreadable / unparsable file — skip rather than crash.  The
      // listing is best-effort summary data; a corrupt file shouldn't
      // block the user from seeing the rest.
    }
  }

  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return rows;
}

/**
 * Delete a saved snapshot by name.  Throws `SnapshotNotFoundError`
 * when no file exists per §DC.26 (so CLI handlers can map the error
 * to the {R014.§3.AC.03} not-found exit shape).
 *
 * @implements {DD018.§3.DC.26}
 */
export async function removeSnapshot(projectRoot: string, name: string): Promise<void> {
  const filePath = snapshotPath(projectRoot, name);
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (isENOENT(err)) {
      throw new SnapshotNotFoundError(name);
    }
    throw err;
  }
}

/**
 * Read a snapshot file from disk and validate its `schemaVersion`.
 *
 * The function MUST NOT load any claim body content as a side effect
 * — snapshots don't carry body text, and §DC.29 reaffirms the
 * boundary explicitly.
 *
 * Throws `SnapshotNotFoundError` on ENOENT; throws
 * `SnapshotSchemaError` when the loaded schema version is missing,
 * non-numeric, or newer than `SCHEMA_VERSION`.  Other errors (JSON
 * parse, permission) are propagated.
 *
 * @implements {DD018.§3.DC.29}
 */
export async function readSnapshot(filePath: string): Promise<Snapshot> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (isENOENT(err)) {
      // Recover the name from the path for SnapshotNotFoundError.
      const base = path.basename(filePath, '.json');
      throw new SnapshotNotFoundError(base);
    }
    throw err;
  }

  const parsed = JSON.parse(raw) as Snapshot;
  const version = parsed?.metadata?.schemaVersion;

  if (typeof version !== 'number') {
    throw new SnapshotSchemaError(filePath, null);
  }
  if (version > SCHEMA_VERSION) {
    throw new SnapshotSchemaError(filePath, version);
  }
  // Older versions: Phase 1 has no shims to apply (initial schema).
  // Phase 2/3 may introduce a switch on the version here.
  return parsed;
}

/**
 * Narrow a thrown filesystem error to ENOENT shape.  Used by the
 * store to translate fs failures into typed errors / empty results.
 */
function isENOENT(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  );
}
