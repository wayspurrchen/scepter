/**
 * File discovery for lifecycle command paths.
 *
 * Given a project root, enumerate every file the rewriter needs to
 * scan: markdown files under any configured note-discovery path AND
 * markdown files outside the discovery paths (e.g., `docs/`, `README.md`)
 * AND source-code files under the configured source-code integration
 * folders.
 *
 * Per {DD020.§2.DC.18} the engine MUST scan project-markdown files
 * outside note-discovery paths (e.g., `docs/`, `README.md`). This
 * discovery surface is the realization of that DC.
 *
 * @implements {DD020.§2.DC.18} discovery sweeps markdown outside note-discovery paths
 */

import * as path from 'path';
import fs from 'fs-extra';
import { glob } from 'glob';
import type { SCEpterConfig } from '../../types/config';

/**
 * Categorization of a discovered file so the orchestrator can attach
 * the right scanner adapters.
 */
export type DiscoveredFileKind = 'markdown' | 'source';

export interface DiscoveredFile {
  filePath: string;
  kind: DiscoveredFileKind;
  /** True when the file lives under a configured note-discovery path. */
  isNoteRoot: boolean;
}

/**
 * Excluded directories during file discovery.
 *
 * Discovery scope decision (R015 §1.AC.04 implementation):
 * - `_archive/` is INCLUDED. Archived notes are preserved as valid
 *   reference targets — they remain referenceable per the archive
 *   semantics, and references inside archived notes that cite a
 *   hard-deleted note MUST be rewritten to the deletion marker so the
 *   archived note's body stays coherent.
 * - `_deleted/` is EXCLUDED. Soft-deleted notes are transient (the user
 *   may purge or restore them); references inside them are not worth
 *   keeping coherent because the file may be purged entirely.
 * - All other entries (`_templates`, `_prompts`, etc.) are excluded
 *   because they are scaffold/output surfaces, not citation surfaces.
 */
const DEFAULT_EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '_templates',
  '_prompts',
  '_lifecycle-staging',
  'lifecycle-log',
  '_deleted',
]);

const DEFAULT_SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.css',
  '.py',
]);

const DEFAULT_MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);

/**
 * Discover every project file the lifecycle commands should scan.
 *
 * Strategy:
 *  1. Glob under each note-discovery path for markdown files.
 *  2. Glob under each source-code integration folder for source files.
 *  3. Glob the project root for top-level project-markdown files
 *     (e.g., `README.md`, `CHANGELOG.md`) and any `docs/` tree, but
 *     SKIP whatever is already inside a discovery or source-integration
 *     root (we don't want duplicates).
 *
 * All paths returned are absolute. Files inside the excluded dir set
 * (`node_modules`, `.git`, etc.) are skipped.
 */
export async function discoverProjectFiles(
  projectPath: string,
  config: SCEpterConfig,
): Promise<DiscoveredFile[]> {
  const out: DiscoveredFile[] = [];
  const seen = new Set<string>();

  const noteRoots = (config.discoveryPaths ?? ['_scepter']).map((p) =>
    path.resolve(projectPath, p),
  );
  const sourceFolders = (config.sourceCodeIntegration?.folders ?? [])
    .map((p) => path.resolve(projectPath, p));
  const sourceExtensions = new Set(
    (config.sourceCodeIntegration?.extensions ?? Array.from(DEFAULT_SOURCE_EXTENSIONS)),
  );

  // (1) Note-root markdown files.
  for (const root of noteRoots) {
    if (!(await fs.pathExists(root))) continue;
    const matches = await glob('**/*.md', {
      cwd: root,
      absolute: true,
      nodir: true,
      dot: false,
    });
    for (const m of matches) {
      if (await shouldExclude(m, root, projectPath, config)) continue;
      if (seen.has(m)) continue;
      seen.add(m);
      out.push({ filePath: m, kind: 'markdown', isNoteRoot: true });
    }
  }

  // (2) Source-code files.
  for (const root of sourceFolders) {
    if (!(await fs.pathExists(root))) continue;
    const matches = await glob('**/*', {
      cwd: root,
      absolute: true,
      nodir: true,
      dot: false,
    });
    for (const m of matches) {
      const ext = path.extname(m).toLowerCase();
      if (!sourceExtensions.has(ext)) continue;
      if (await shouldExclude(m, root, projectPath, config)) continue;
      if (seen.has(m)) continue;
      seen.add(m);
      out.push({ filePath: m, kind: 'source', isNoteRoot: false });
    }
  }

  // (3) Project-level markdown outside discovery roots (per
  //     {DD020.§2.DC.18}). We sweep the project root with `**/*.md`
  //     and then filter out anything already under noteRoots or
  //     sourceFolders or an excluded dir.
  const topMatches = await glob('**/*.md', {
    cwd: projectPath,
    absolute: true,
    nodir: true,
    dot: false,
  });
  for (const m of topMatches) {
    if (seen.has(m)) continue;
    if (await shouldExclude(m, projectPath, projectPath, config)) continue;
    if (isUnderAny(m, noteRoots)) continue;
    if (isUnderAny(m, sourceFolders)) continue;
    const ext = path.extname(m).toLowerCase();
    if (!DEFAULT_MARKDOWN_EXTENSIONS.has(ext)) continue;
    seen.add(m);
    out.push({ filePath: m, kind: 'markdown', isNoteRoot: false });
  }

  return out;
}

async function shouldExclude(
  filePath: string,
  rootPath: string,
  projectPath: string,
  config: SCEpterConfig,
): Promise<boolean> {
  // Skip if any segment in the relative path is in the exclude set.
  const rel = path.relative(projectPath, filePath);
  const parts = rel.split(path.sep);
  const userExcludes = new Set([
    ...(config.discoveryExclude ?? []),
    ...(config.sourceCodeIntegration?.exclude ?? []),
  ]);
  for (const p of parts) {
    if (DEFAULT_EXCLUDE_DIRS.has(p)) return true;
    if (userExcludes.has(p)) return true;
  }
  // Avoid scanning the project's own staging directory.
  if (rel.startsWith(path.join('_scepter', '_lifecycle-staging'))) return true;
  if (rel.startsWith(path.join('_scepter', 'lifecycle-log'))) return true;
  return false;
}

function isUnderAny(filePath: string, roots: string[]): boolean {
  for (const root of roots) {
    const rel = path.relative(root, filePath);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      return true;
    }
  }
  return false;
}
