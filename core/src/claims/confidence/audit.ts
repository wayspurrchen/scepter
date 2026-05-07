/**
 * Source-file confidence audit. Preserves the legacy auditConfidence
 * function's behavior unchanged; this file is a transitional home until
 * {S004}'s DD relocates it to core/src/claims/audit.ts.
 *
 * @see {DD016.§9} migration and test mapping (auditConfidence preserved)
 * @see {S004} downstream consumer DD that relocates this body
 */

import fs from 'fs-extra';
import * as path from 'path';
import { glob } from 'glob';
import type { SourceCodeIntegrationConfig } from '../../types/config.js';
import { cFamilyAdapter } from './adapters/c-family.js';
import type { ConfidenceLevel, ConfidenceAnnotation } from './types.js';

/**
 * Aggregate result from scanning multiple files for confidence annotations.
 * @implements {R004.§7.AC.01} Audit result structure
 */
export interface ConfidenceAuditResult {
  total: number;
  annotated: number;
  unannotated: number;
  byLevel: Record<ConfidenceLevel, number>;
  files: ConfidenceAnnotation[];
  unannotatedFiles: string[];
}

/**
 * Discover source files using the same pattern as SourceCodeScanner.
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
 * Audit all source files for confidence annotations.
 * Discovers files per SourceCodeIntegrationConfig, parses each for
 * @confidence annotations, and returns aggregate statistics.
 *
 * @implements {R004.§7.AC.01} File discovery and aggregation
 */
export async function auditConfidence(
  projectPath: string,
  config: SourceCodeIntegrationConfig,
): Promise<ConfidenceAuditResult> {
  const sourceFiles = await discoverSourceFiles(projectPath, config);

  const result: ConfidenceAuditResult = {
    total: sourceFiles.length,
    annotated: 0,
    unannotated: 0,
    byLevel: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    files: [],
    unannotatedFiles: [],
  };

  for (const relativeFile of sourceFiles) {
    const absolutePath = path.resolve(projectPath, relativeFile);
    try {
      const content = await fs.readFile(absolutePath, 'utf-8');
      const annotation = cFamilyAdapter.parse(content, relativeFile);

      if (annotation) {
        result.annotated++;
        result.byLevel[annotation.level]++;
        result.files.push(annotation);
      } else {
        result.unannotated++;
        result.unannotatedFiles.push(relativeFile);
      }
    } catch {
      // File unreadable — count as unannotated
      result.unannotated++;
      result.unannotatedFiles.push(relativeFile);
    }
  }

  return result;
}
