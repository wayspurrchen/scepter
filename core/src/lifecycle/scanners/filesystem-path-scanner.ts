/**
 * Filesystem-path scanner for the rewriter engine.
 *
 * Unlike the content scanners (markdown body, source code, frontmatter,
 * etc.), this scanner does not emit `ReferenceSpan` records over file
 * content. It produces a **plan** for the file or folder mutation that
 * accompanies a delete or rename operation:
 *
 *   - Under `delete` (hard-delete): a `FilesystemRemovalPlan`
 *     describing the file or folder unit to unlink.
 *   - Under `rename`: a `FilesystemRenamePlan` describing the
 *     file-rename (for file-based notes) or the folder-rename
 *     (for folder-based notes per {R008}) plus the inner main-file
 *     rename. Companion files move with the folder as a unit.
 *
 * This scanner is decoupled from `NoteFileManager` to keep the
 * lifecycle module testable. Callers pass in a `pathResolver`
 * callback that knows how to find the note's filesystem entry. The
 * orchestrator wires `NoteFileManager.getFilePath` (or equivalent)
 * to this.
 *
 * @implements {DD020.§2.DC.16} filesystem-path scanner emits FilesystemRenamePlan; folder-form moves companion files as a unit
 * @implements {DD020.§2.DC.17} filesystem-path scanner emits FilesystemRemovalPlan under hard-delete; folder-form removes companions
 */

import * as path from 'path';

/**
 * The note's filesystem layout — output of `pathResolver`.
 *
 * `kind: 'file'` → single-file note at `filePath`.
 * `kind: 'folder'` → folder-form note. `folderPath` holds the folder;
 *   `mainFilePath` is the inner main `.md` file
 *   (`<folderPath>/<NOTE_ID>.md` or `<folderPath>/<NOTE_ID> Title.md`).
 *   Companion files are not enumerated here — they move with the
 *   folder by being inside it.
 */
export type ResolvedNotePath =
  | { kind: 'file'; filePath: string }
  | {
      kind: 'folder';
      folderPath: string;
      mainFilePath: string;
    };

/** Output of `scanFilesystemForDelete`. */
export interface FilesystemRemovalPlan {
  /**
   * Path(s) to remove. For file-based notes this is a single file;
   * for folder-based notes this is the folder (recursive removal is
   * the caller's responsibility).
   */
  targets: Array<{ kind: 'file' | 'folder'; path: string }>;
}

/** Output of `scanFilesystemForRename`. */
export interface FilesystemRenamePlan {
  /**
   * Rename operations to perform. For file-based notes a single
   * file-rename; for folder-based notes the folder rename plus the
   * inner main-file rename (companions move with the folder
   * automatically).
   */
  operations: Array<{ kind: 'file' | 'folder'; from: string; to: string }>;
}

/**
 * Plan the filesystem mutations for a hard-delete.
 *
 * Pure function — no filesystem I/O.
 */
export function scanFilesystemForDelete(
  resolved: ResolvedNotePath,
): FilesystemRemovalPlan {
  if (resolved.kind === 'file') {
    return {
      targets: [{ kind: 'file', path: resolved.filePath }],
    };
  }
  // Folder-form: remove the folder (which carries companions).
  return {
    targets: [{ kind: 'folder', path: resolved.folderPath }],
  };
}

/**
 * Plan the filesystem mutations for a rename.
 *
 * For a file-based note `R005 Title.md` renamed to `R042`:
 *   `R005 Title.md` → `R042 Title.md`
 *
 * For a folder-based note `R005 Title/R005.md` renamed to `R042`:
 *   folder: `R005 Title/` → `R042 Title/`
 *   inner main: `<new folder>/R005.md` → `<new folder>/R042.md`
 *
 * Note that the inner-main-file rename operates on the post-folder-rename
 * path (the `from` for the file step lives inside the renamed folder).
 * The atomicity layer is responsible for sequencing.
 *
 * The function returns operations in commit-friendly order: folder
 * rename first, then any inner-file rename. Callers committing
 * staged copies (rather than in-place renames) may iterate this order
 * for correctness.
 *
 * Pure function — no filesystem I/O.
 */
export function scanFilesystemForRename(
  sourceId: string,
  targetId: string,
  resolved: ResolvedNotePath,
): FilesystemRenamePlan {
  if (resolved.kind === 'file') {
    const newPath = replaceIdInBasename(resolved.filePath, sourceId, targetId);
    return {
      operations: [
        { kind: 'file', from: resolved.filePath, to: newPath },
      ],
    };
  }

  // Folder-form.
  const newFolderPath = replaceIdInBasename(
    resolved.folderPath,
    sourceId,
    targetId,
  );
  const oldMainBasename = path.basename(resolved.mainFilePath);
  const newMainBasename = replaceIdInBasename(
    oldMainBasename,
    sourceId,
    targetId,
  );
  const newMainFilePath = path.join(newFolderPath, newMainBasename);

  return {
    operations: [
      { kind: 'folder', from: resolved.folderPath, to: newFolderPath },
      // The "from" of the inner-file rename references its new
      // location after the folder rename — see function-level docs.
      {
        kind: 'file',
        from: path.join(newFolderPath, oldMainBasename),
        to: newMainFilePath,
      },
    ],
  };
}

/**
 * Replace the leading `<sourceId>` in a filename's basename with
 * `<targetId>`, preserving directory and trailing parts.
 *
 * Examples:
 *   `R005 Title.md` → `R042 Title.md`
 *   `R005.md`       → `R042.md`
 *   `R005`          → `R042` (folder name with no extension)
 *   `/path/R005 X.md` → `/path/R042 X.md`
 *
 * Returns the input unchanged if the basename does not start with
 * `<sourceId>`.
 */
function replaceIdInBasename(
  filePath: string,
  sourceId: string,
  targetId: string,
): string {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);

  if (!base.startsWith(sourceId)) {
    return filePath;
  }

  // The basename must either equal sourceId exactly, OR be followed
  // by a non-alphanumeric boundary (` `, `.`, `-`, `_`) to avoid
  // replacing inside a longer ID-shaped substring.
  if (base.length > sourceId.length) {
    const boundary = base[sourceId.length];
    if (/[A-Za-z0-9]/.test(boundary)) {
      return filePath;
    }
  }

  const replaced = targetId + base.slice(sourceId.length);
  // Preserve `dir === '.'` as-is when input had no directory.
  if (dir === '.' || dir === '') {
    return replaced;
  }
  return path.join(dir, replaced);
}
