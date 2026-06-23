/**
 * Multi-scope confidence audit.
 *
 * Walks source files (via sourceCodeIntegration) and/or note files (via
 * discoveryPaths), routes each through `getAdapter(filePath)`, and
 * aggregates results both per-scope (`bySource`/`byNotes`) and across
 * scopes (top-level fields). Files whose `getAdapter` returns null are
 * silently skipped per DC.08.
 *
 * @implements {S004.§2.AC.01}
 * @implements {S004.§2.AC.02}
 * @implements {S004.§2.AC.03}
 * @implements {S004.§2.AC.04}
 * @implements {S004.§2.AC.05}
 * @implements {S004.§2.AC.06}
 * @implements {S004.§2.AC.09}
 * @implements {DD017.DC.05}
 * @implements {DD017.DC.06}
 * @implements {DD017.DC.07}
 * @implements {DD017.DC.08}
 * @implements {DD017.DC.09}
 * @implements {DD017.DC.10}
 */

import fs from 'fs-extra';
import * as path from 'path';
import { glob } from 'glob';
import type { SourceCodeIntegrationConfig } from '../../types/config.js';
import type { ProjectManager } from '../../project/project-manager.js';
import { getAdapter } from './registry.js';
import type { ConfidenceLevel, ConfidenceAnnotation, ReviewerIcon } from './types.js';

/**
 * Per-scope audit substructure. Same six fields as the legacy top-level
 * shape; populated for whichever scopes ran. The unrun scope's
 * substructure is zero-valued (never undefined) so consumers don't need
 * null guards.
 *
 * @implements {DD017.DC.05}
 * @implements {DD017.DC.09}
 * @implements {DD017.§8.DC.40} additive byReviewer per-reviewer tally
 */
export interface ScopedAuditResult {
  total: number;
  annotated: number;
  unannotated: number;
  byLevel: Record<ConfidenceLevel, number>;
  /** Per-reviewer count of annotated files (at minimum '🤖' and '👤'). */
  byReviewer: Record<ReviewerIcon, number>;
  files: ConfidenceAnnotation[];
  unannotatedFiles: string[];
}

/**
 * Aggregate result from auditing a project. Top-level fields are the
 * union across scopes (sums for counts, concatenation for arrays). The
 * `bySource`/`byNotes` substructures expose the same shape per-scope.
 *
 * @implements {DD017.DC.05}
 * @implements {DD017.DC.06}
 */
export interface ConfidenceAuditResult extends ScopedAuditResult {
  bySource: ScopedAuditResult;
  byNotes: ScopedAuditResult;
}

/**
 * Options to drive multi-scope discovery.
 *
 * @implements {DD017.DC.09}
 */
export interface AuditOptions {
  /** Which scope(s) to walk. Default `'both'`. */
  scope?: 'source' | 'notes' | 'both';
}

function emptyScopedResult(): ScopedAuditResult {
  return {
    total: 0,
    annotated: 0,
    unannotated: 0,
    byLevel: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    byReviewer: { '🤖': 0, '👤': 0 },
    files: [],
    unannotatedFiles: [],
  };
}

/**
 * Discover source files using the same pattern as SourceCodeScanner.
 * Returns project-relative paths.
 *
 * @implements {DD017.DC.07}
 */
async function discoverSourceFiles(
  projectPath: string,
  config: SourceCodeIntegrationConfig,
): Promise<string[]> {
  const files: string[] = [];

  for (const folder of config.folders) {
    const pattern = path.join(folder, '**/*');
    const matches = await glob(pattern, {
      cwd: projectPath,
      ignore: config.exclude,
      nodir: true,
    });

    const sourceFiles = matches.filter((file) =>
      config.extensions.some((ext) => file.endsWith(ext)),
    );

    files.push(...sourceFiles);
  }

  return files;
}

/**
 * Discover note files via `noteManager.getNotes({})`. Returns absolute
 * paths.
 *
 * @implements {DD017.DC.07}
 */
async function discoverNoteFiles(pm: ProjectManager): Promise<string[]> {
  const result = await pm.noteManager.getNotes({});
  const files: string[] = [];
  for (const note of result.notes) {
    if (!note.filePath) continue;
    const absolute = path.isAbsolute(note.filePath)
      ? note.filePath
      : path.resolve(pm.projectPath, note.filePath);
    files.push(absolute);
  }
  return files;
}

/**
 * Walk a list of files and accumulate the results into a
 * ScopedAuditResult. Each file is routed through `getAdapter(filePath)`;
 * adapter-null files are silently omitted from BOTH counts.
 *
 * The resolved `defaultReviewer` ({R017}) is threaded into each
 * `adapter.parse` call so a bare-digit annotation parses to a human
 * (`👤`) annotation under the active policy, counting as annotated.
 *
 * @implements {DD017.DC.04}
 * @implements {DD017.DC.08}
 * @implements {DD017.§8.DC.40} byReviewer increment per annotated file
 * @implements {DD017.§8.DC.41} defaultReviewer threaded into parse
 */
async function walkScope(
  files: string[],
  projectPath: string,
  pathDisplay: 'absolute' | 'relative',
  defaultReviewer: ReviewerIcon | null,
): Promise<ScopedAuditResult> {
  const result = emptyScopedResult();

  for (const filePath of files) {
    const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(projectPath, filePath);
    const display = pathDisplay === 'absolute' ? absolute : path.relative(projectPath, absolute);

    const adapter = getAdapter(absolute);
    if (!adapter) continue;

    try {
      const content = await fs.readFile(absolute, 'utf-8');
      const annotation = adapter.parse(content, display, { defaultReviewer });

      result.total++;
      if (annotation) {
        result.annotated++;
        result.byLevel[annotation.level]++;
        result.byReviewer[annotation.reviewer]++;
        result.files.push(annotation);
      } else {
        result.unannotated++;
        result.unannotatedFiles.push(display);
      }
    } catch {
      // File unreadable — count as unannotated, mirroring the legacy
      // single-scope behavior so existing JSON/table consumers see no
      // shape change for the failure path.
      result.total++;
      result.unannotated++;
      result.unannotatedFiles.push(display);
    }
  }

  return result;
}

/**
 * Combine two scoped results into a top-level union. Counters sum,
 * arrays concatenate, byLevel and byReviewer sum per key.
 *
 * @implements {DD017.§8.DC.40} byReviewer summed per reviewer across scopes
 */
function unionScopes(
  source: ScopedAuditResult,
  notes: ScopedAuditResult,
): ScopedAuditResult {
  return {
    total: source.total + notes.total,
    annotated: source.annotated + notes.annotated,
    unannotated: source.unannotated + notes.unannotated,
    byLevel: {
      1: source.byLevel[1] + notes.byLevel[1],
      2: source.byLevel[2] + notes.byLevel[2],
      3: source.byLevel[3] + notes.byLevel[3],
      4: source.byLevel[4] + notes.byLevel[4],
      5: source.byLevel[5] + notes.byLevel[5],
    },
    byReviewer: {
      '🤖': source.byReviewer['🤖'] + notes.byReviewer['🤖'],
      '👤': source.byReviewer['👤'] + notes.byReviewer['👤'],
    },
    files: [...source.files, ...notes.files],
    unannotatedFiles: [...source.unannotatedFiles, ...notes.unannotatedFiles],
  };
}

/**
 * Audit a project for confidence annotations across source files,
 * notes, or both. The result's top-level fields are the union across
 * scopes (additive); `bySource`/`byNotes` expose per-scope detail.
 *
 * @implements {S004.§2.AC.01}
 * @implements {S004.§2.AC.02}
 * @implements {S004.§2.AC.03}
 * @implements {S004.§2.AC.05}
 * @implements {S004.§2.AC.09}
 * @implements {DD017.DC.10}
 * @implements {DD017.§8.DC.39} resolve impliedHuman ?? true
 * @implements {DD017.§8.DC.39a} map to defaultReviewer ('👤' | null)
 * @implements {DD017.§8.DC.41} thread defaultReviewer through walkScope
 */
export async function auditConfidence(
  pm: ProjectManager,
  options: AuditOptions = {},
): Promise<ConfidenceAuditResult> {
  const scope = options.scope ?? 'both';
  const config = pm.configManager.getConfig();

  // {R017} read-time policy: resolve impliedHuman (default active) and map
  // to the parse-policy defaultReviewer ('👤' active, null inactive).
  const impliedHuman = config.claims?.confidence?.impliedHuman ?? true;
  const defaultReviewer: ReviewerIcon | null = impliedHuman ? '👤' : null;

  let bySource: ScopedAuditResult = emptyScopedResult();
  let byNotes: ScopedAuditResult = emptyScopedResult();

  if (scope === 'source' || scope === 'both') {
    if (config.sourceCodeIntegration?.enabled) {
      const sourceFiles = await discoverSourceFiles(pm.projectPath, config.sourceCodeIntegration);
      bySource = await walkScope(sourceFiles, pm.projectPath, 'relative', defaultReviewer);
    }
  }

  if (scope === 'notes' || scope === 'both') {
    const noteFiles = await discoverNoteFiles(pm);
    byNotes = await walkScope(noteFiles, pm.projectPath, 'absolute', defaultReviewer);
  }

  const top = unionScopes(bySource, byNotes);
  return {
    ...top,
    bySource,
    byNotes,
  };
}
