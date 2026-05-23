/**
 * Project-wide reference audit orchestrator — entry point for `scepter lint --all`.
 *
 * @see {DD022.§10.1} Audit Orchestrator module
 * @see {R016.§1.AC.01} Project-wide sweep entry point
 */

import type { ProjectManager } from '../../project/project-manager.js';
import { ensureIndex } from '../../cli/commands/claims/ensure-index.js';
import {
  collectNoteIncidences,
  collectSourceIncidences,
  type IncidenceRecord,
} from './incidence-collector.js';
import {
  applyRefsOnlyFilter,
  applyCodesFilter,
  applyTargetFilter,
  applyArchivedOptOut,
  applySoftDeletedOptOut,
} from './audit-filters.js';
import { formatAuditHuman, formatAuditJson } from './audit-formatters.js';

/**
 * Options bag for `runProjectWideAudit`. Constructed by the CLI action
 * handler from parsed Commander options; not consumed elsewhere.
 *
 * @see {DD022.§10.1.DC.01} runProjectWideAudit signature
 */
export interface AuditOptions {
  /** Include source-code annotations in the audit (`--code` flag). */
  code: boolean;
  /** Comma-separated note IDs and claim FQIDs to reverse-look-up (`--target`). */
  target?: string[];
  /** Filter to specific error codes (`--codes`). */
  codes?: string[];
  /** Suppress non-reference-resolution findings (`--refs-only`). */
  refsOnly: boolean;
  /** Treat archived-note references as valid (`--include-archived-as-valid`). */
  includeArchivedAsValid: boolean;
  /** Treat soft-deleted-note references as valid (`--include-soft-deleted-as-valid`). */
  includeSoftDeletedAsValid: boolean;
  /** Emit JSON instead of human-readable text (`--json`). */
  json: boolean;
}

/**
 * Scanned-count summary surfaced in audit output (header/footer in human
 * format, top-level `scanned` field in JSON format).
 *
 * @see {DD022.§10.1.DC.02} AuditScanned shape
 * @see {R016.§5.AC.04} scanned counts surfaced
 */
export interface AuditScanned {
  /** Number of notes in the claim index (data.trees.size). */
  notes: number;
  /** Number of distinct source files scanned (0 when --code is not set). */
  sourceFiles: number;
  /** Total references encountered (crossRefs + crossProjectRefs + source). */
  references: number;
}

/**
 * Orchestrate a project-wide reference audit.
 *
 * Pipeline:
 *  1. Load the claim index via `ensureIndex`.
 *  2. Collect note-site incidences from the index's crossRefs and errors.
 *  3. If `--code`: collect source-site incidences via the unified resolver.
 *  4. Apply the five filters in canonical DC.14 order (unconditional pipeline
 *     with in-filter flag gates).
 *  5. Compute `AuditScanned` counts.
 *  6. Dispatch to `formatAuditJson` or `formatAuditHuman` and write to stdout.
 *
 * @implements {DD022.§10.1.DC.01} runProjectWideAudit orchestration
 * @implements {DD022.§10.1.DC.02} AuditScanned counts shape
 * @implements {DD022.§10.5.DC.26} --code requires source-code integration enabled
 * @implements {R016.§1.AC.01} project-wide sweep
 * @implements {R016.§1.AC.02} --code source-scan integration
 * @implements {R016.§5.AC.04} scanned counts surfaced
 * @implements {R016.§6.AC.01} resolution via {DD021} resolver
 */
export async function runProjectWideAudit(
  projectManager: ProjectManager,
  options: AuditOptions,
): Promise<void> {
  // (1) Load the claim index — ensureIndex passes includeArchived: true and
  // includeDeleted: true per Step 0, so archived and soft-deleted note
  // entries are present in the index for synthesis.
  const data = await ensureIndex(projectManager);

  // (2) Collect note-site incidences (always — `--all` always scans notes).
  let incidences: IncidenceRecord[] = collectNoteIncidences(data);

  // (3) Optionally collect source-site incidences.
  let sourceFilesScanned = 0;
  let sourceReferencesCount = 0;
  if (options.code) {
    const scanner = projectManager.sourceScanner;
    if (!scanner || !scanner.isReady()) {
      throw new Error(
        '--code requires source-code integration to be enabled in scepter.config.json (sourceCodeIntegration.enabled = true)',
      );
    }
    incidences = incidences.concat(collectSourceIncidences(scanner, data));
    sourceFilesScanned = scanner.getIndex().getIndexedFiles().length;
    sourceReferencesCount = scanner.getIndex().getAllReferences().length;
  }

  // (4) Apply filters in canonical DC.14 order. Each filter is called
  // unconditionally; each gates internally on its flag (in-filter flag-gate
  // pattern per Section 4 Finding #1).
  incidences = applyRefsOnlyFilter(incidences, options.refsOnly);
  incidences = applyCodesFilter(incidences, options.codes);
  incidences = applyTargetFilter(incidences, options.target);
  incidences = applyArchivedOptOut(incidences, options.includeArchivedAsValid);
  incidences = applySoftDeletedOptOut(
    incidences,
    options.includeSoftDeletedAsValid,
  );

  // (5) Build AuditScanned per DC.02. The references count is the total
  // across crossRefs, crossProjectRefs, and source references for the
  // scope active in this invocation.
  const scanned: AuditScanned = {
    notes: data.trees.size,
    sourceFiles: sourceFilesScanned,
    references:
      data.crossRefs.length +
      data.crossProjectRefs.length +
      sourceReferencesCount,
  };

  // (6) Format and emit.
  if (options.json) {
    console.log(formatAuditJson(incidences, scanned));
  } else {
    console.log(await formatAuditHuman(incidences, scanned));
  }
}
