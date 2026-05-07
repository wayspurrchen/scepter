/**
 * Filter resolver for the confidence audit and apply commands.
 *
 * Single entry point: `resolveFiles(pm, spec)` returns a list of
 * `ResolvedFile` tuples, each tagged with `scope: 'source' | 'notes'`.
 * Adapter dispatch is the caller's responsibility — this module does
 * not call `getAdapter`.
 *
 * @implements {S004.§1.AC.01}
 * @implements {S004.§1.AC.02}
 * @implements {S004.§1.AC.03}
 * @implements {S004.§1.AC.04}
 * @implements {S004.§1.AC.05}
 * @implements {S004.§1.AC.06}
 * @implements {DD017.DC.01}
 * @implements {DD017.DC.02}
 * @implements {DD017.DC.03}
 * @implements {DD017.DC.04}
 */

import * as path from 'path';
import { glob } from 'glob';
import { minimatch } from 'minimatch';
import type { ProjectManager } from '../../project/project-manager.js';

/**
 * Filter inputs supplied by `apply` (and, in restricted form, by `audit`'s
 * scope toggles). The four note-only categories are AND-across, OR-within;
 * `glob` is the only category that can reach source files.
 *
 * @implements {DD017.DC.01}
 */
export interface FilterSpec {
  types?: string[];
  tags?: string[];
  ids?: string[];
  glob?: string;
}

/**
 * Resolved file tuple. `scope` tags the originating root: a file under
 * `sourceCodeIntegration.folders` is `'source'`; a file under
 * `discoveryPaths` is `'notes'`. When a path matches both, `'notes'` wins.
 *
 * @implements {DD017.DC.02}
 */
export interface ResolvedFile {
  filePath: string;
  scope: 'source' | 'notes';
}

/**
 * Raised when a note-only filter category (`types`, `tags`, `ids`) is
 * combined with a glob that targets only source files. The message names
 * both contributing filters.
 *
 * @implements {S004.§1.AC.04}
 * @implements {DD017.DC.04}
 */
export class FilterContradictionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FilterContradictionError';
  }
}

/**
 * Note-only categories — these MUST NOT match source files.
 */
function hasNoteOnlyFilters(spec: FilterSpec): boolean {
  return (
    (spec.types !== undefined && spec.types.length > 0) ||
    (spec.tags !== undefined && spec.tags.length > 0) ||
    (spec.ids !== undefined && spec.ids.length > 0)
  );
}

/**
 * Default glob excludes — same set as UnifiedDiscovery. Applied as glob
 * `ignore` patterns when scanning the project root.
 */
const DEFAULT_GLOB_EXCLUDES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.turbo/**',
  '**/.cache/**',
  '**/.vscode/**',
  '**/.idea/**',
];

/**
 * Resolve `discoveryExclude` patterns to glob ignore form. The config
 * stores bare directory names (e.g. `_archive`); convert to recursive
 * patterns so `glob` matches them at any depth.
 */
function expandDiscoveryExcludes(patterns: string[] | undefined): string[] {
  if (!patterns) return [];
  return patterns.map((p) => (p.includes('/') || p.includes('*') ? p : `**/${p}/**`));
}

/**
 * Check whether a project-relative path lies under any configured root.
 * Roots may be directory names (`_scepter`, `core/src`, `.`) or relative
 * paths; comparison is structural (path-segment prefix).
 */
function isUnderRoot(relativePath: string, roots: string[]): boolean {
  for (const root of roots) {
    if (root === '.' || root === '') return true;
    const normalizedRoot = root.replace(/\/$/, '');
    if (relativePath === normalizedRoot) return true;
    if (relativePath.startsWith(normalizedRoot + path.sep)) return true;
    if (relativePath.startsWith(normalizedRoot + '/')) return true;
  }
  return false;
}

/**
 * Classify a project-relative path against the project's source and
 * discovery roots. Notes win the overlap per DC.02.
 */
function classifyScope(
  relativePath: string,
  discoveryPaths: string[],
  sourceFolders: string[],
  sourceExtensions: string[],
): 'notes' | 'source' | null {
  const underNotes = isUnderRoot(relativePath, discoveryPaths);
  const underSource = isUnderRoot(relativePath, sourceFolders);
  if (underNotes) return 'notes';
  if (underSource) {
    if (sourceExtensions.some((ext) => relativePath.endsWith(ext))) {
      return 'source';
    }
    return null;
  }
  return null;
}

/**
 * Resolve a `FilterSpec` to the list of files (notes + source) that
 * match. AND-across categories, OR-within. `glob` is the only category
 * that can reach source files. Note-only category filters combined with
 * a source-only glob raise `FilterContradictionError`.
 *
 * @implements {S004.§1.AC.02}
 * @implements {S004.§1.AC.06}
 * @implements {DD017.DC.03}
 */
export async function resolveFiles(
  pm: ProjectManager,
  spec: FilterSpec,
): Promise<ResolvedFile[]> {
  const config = pm.configManager.getConfig();
  const projectPath = pm.projectPath;
  const discoveryPaths = config.discoveryPaths || ['_scepter'];
  const sourceFolders = config.sourceCodeIntegration?.folders || [];
  const sourceExtensions = config.sourceCodeIntegration?.extensions || [];
  const sourceExcludes = config.sourceCodeIntegration?.exclude || [];
  const discoveryExcludes = expandDiscoveryExcludes(config.discoveryExclude);

  const noteOnly = hasNoteOnlyFilters(spec);

  // ----- Note-only candidate set ------------------------------------------
  // When any of types/tags/ids is supplied, query the note manager for
  // candidate notes. AND-across categories: applying multiple categories
  // narrows the set. OR-within: multiple values within one category are
  // unioned by the underlying NoteQuery semantics.
  let noteCandidates: ResolvedFile[] | null = null;
  if (noteOnly) {
    const result = await pm.noteManager.getNotes({
      types: spec.types,
      tags: spec.tags,
      ids: spec.ids,
    });
    noteCandidates = [];
    for (const note of result.notes) {
      if (!note.filePath) continue;
      const absolute = path.isAbsolute(note.filePath)
        ? note.filePath
        : path.resolve(projectPath, note.filePath);
      noteCandidates.push({ filePath: absolute, scope: 'notes' });
    }
  }

  // ----- Glob candidate set -----------------------------------------------
  // When `--glob` is supplied, evaluate it from the project root with all
  // configured excludes applied. Each result is classified by scope; a
  // file matching neither root is dropped silently.
  let globCandidates: ResolvedFile[] | null = null;
  if (spec.glob) {
    const ignore = [
      ...DEFAULT_GLOB_EXCLUDES,
      ...sourceExcludes,
      ...discoveryExcludes,
    ];
    const matches = await glob(spec.glob, {
      cwd: projectPath,
      ignore,
      nodir: true,
      dot: false,
    });
    globCandidates = [];
    for (const rel of matches) {
      const scope = classifyScope(rel, discoveryPaths, sourceFolders, sourceExtensions);
      if (!scope) continue;
      globCandidates.push({
        filePath: path.resolve(projectPath, rel),
        scope,
      });
    }
  }

  // ----- Contradiction detection ------------------------------------------
  // A note-only filter combined with a glob that reaches zero notes is
  // a structural contradiction: the AND can never produce results, and
  // the user almost certainly intended one or the other.
  if (noteOnly && globCandidates) {
    const reachesNote = globCandidates.some((f) => f.scope === 'notes');
    if (!reachesNote) {
      const noteOnlyDescription = describeNoteOnlyFilters(spec);
      throw new FilterContradictionError(
        `filter contradiction: ${noteOnlyDescription} matches notes only, ` +
          `but --glob '${spec.glob}' targets source files only — the AND across ` +
          `these filters can never produce a result. Drop one of the two filters.`,
      );
    }
  }

  // ----- Compose final set -------------------------------------------------
  // AND-across: a file passes only when it matches every supplied filter.
  // - noteOnly only:     return noteCandidates
  // - glob only:         return globCandidates
  // - both supplied:     intersect on absolute path
  if (noteCandidates && globCandidates) {
    const globPaths = new Set(globCandidates.map((f) => f.filePath));
    return dedupeByPath(noteCandidates.filter((f) => globPaths.has(f.filePath)));
  }
  if (noteCandidates) return dedupeByPath(noteCandidates);
  if (globCandidates) return dedupeByPath(globCandidates);
  return [];
}

/**
 * De-duplicate by absolute path. When the same file appears with both
 * scopes (theoretically possible via the glob path), notes win.
 */
function dedupeByPath(files: ResolvedFile[]): ResolvedFile[] {
  const byPath = new Map<string, ResolvedFile>();
  for (const f of files) {
    const existing = byPath.get(f.filePath);
    if (!existing) {
      byPath.set(f.filePath, f);
      continue;
    }
    if (existing.scope === 'source' && f.scope === 'notes') {
      byPath.set(f.filePath, f);
    }
  }
  return [...byPath.values()].sort((a, b) => a.filePath.localeCompare(b.filePath));
}

/**
 * Build a human-readable description of which note-only categories are
 * active in the spec, used in the contradiction error message.
 */
function describeNoteOnlyFilters(spec: FilterSpec): string {
  const parts: string[] = [];
  if (spec.types?.length) parts.push(`--types ${spec.types.join(',')}`);
  if (spec.tags?.length) parts.push(`--tags ${spec.tags.join(',')}`);
  if (spec.ids?.length) parts.push(`--ids ${spec.ids.join(',')}`);
  return parts.join(' ');
}

/**
 * Internal export for tests. The minimatch dependency is used in the
 * `glob` library at runtime; importing it here keeps the test surface
 * able to reason about pattern semantics without re-implementing them.
 *
 * @see {DD017.DC.04} contradiction error message contract
 */
export const __FILTERS_FOR_TEST = {
  classifyScope,
  isUnderRoot,
  hasNoteOnlyFilters,
  describeNoteOnlyFilters,
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  minimatch,
};
