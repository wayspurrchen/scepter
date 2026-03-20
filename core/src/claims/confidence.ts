/**
 * Confidence markers for SCEpter.
 *
 * File-level confidence annotations that classify each source file's
 * review status. Numeric levels 1-5 with emoji prefix (🤖 AI, 👤 Human).
 *
 * Convention: no space between emoji and number.
 *
 * @implements {R004.§7.AC.01} Confidence audit: discovery, parsing, aggregation
 * @implements {R004.§7.AC.02} Confidence marking: format, insert, validate
 * @implements {R004.§7.AC.03} Auto-insert config support
 */

import fs from 'fs-extra';
import * as path from 'path';
import { glob } from 'glob';
import type { SourceCodeIntegrationConfig } from '../types/config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Numeric confidence level 1-5.
 * @implements {R004.§7.AC.01} Level type definition
 * @implements {R004.§7.AC.02} Level type definition
 */
export type ConfidenceLevel = 1 | 2 | 3 | 4 | 5;

/**
 * Reviewer icon: AI-generated or human-reviewed.
 * @implements {R004.§7.AC.02} Reviewer icon type
 */
export type ReviewerIcon = '🤖' | '👤';

/**
 * Parsed confidence annotation from a source file.
 * @implements {R004.§7.AC.01} Annotation data structure
 * @implements {R004.§7.AC.02} Annotation data structure
 */
export interface ConfidenceAnnotation {
  level: ConfidenceLevel;
  reviewer: ReviewerIcon;
  date?: string;
  line: number;
  filePath: string;
}

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Valid confidence levels */
const VALID_LEVELS: readonly ConfidenceLevel[] = [1, 2, 3, 4, 5] as const;

/** Allowed level ranges per reviewer icon */
const REVIEWER_LEVEL_RANGES: Record<ReviewerIcon, readonly ConfidenceLevel[]> = {
  '🤖': [1, 2, 3],
  '👤': [3, 4, 5],
};

/**
 * Regex to match @confidence annotations in both line comments and doc blocks.
 * Matches: // @confidence <emoji><level> [trailing]
 *          * @confidence <emoji><level> [trailing]
 * No space between emoji and number.
 */
const CONFIDENCE_REGEX = /(?:\/\/|\*)\s*@confidence\s+(🤖|👤)(\d)(?:\s+(.+))?/;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a confidence annotation from file content.
 * Scans only the first 20 lines for performance.
 *
 * @implements {R004.§7.AC.01} Parse confidence from file header
 * @implements {R004.§7.AC.02} Recognize emoji+number format
 */
export function parseConfidenceAnnotation(
  content: string,
  filePath: string,
): ConfidenceAnnotation | null {
  const lines = content.split('\n');
  const scanLimit = Math.min(lines.length, 20);

  for (let i = 0; i < scanLimit; i++) {
    const match = lines[i].match(CONFIDENCE_REGEX);
    if (match) {
      const reviewer = match[1] as ReviewerIcon;
      const level = parseInt(match[2], 10);

      if (!VALID_LEVELS.includes(level as ConfidenceLevel)) {
        continue;
      }

      return {
        level: level as ConfidenceLevel,
        reviewer,
        date: match[3]?.trim(),
        line: i + 1,
        filePath,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

/**
 * Produce a confidence annotation comment string.
 * No space between emoji and number, per the convention.
 *
 * @implements {R004.§7.AC.02} Format annotation string
 */
export function formatConfidenceAnnotation(
  reviewer: ReviewerIcon,
  level: ConfidenceLevel,
  date: string,
): string {
  return `// @confidence ${reviewer}${level} ${date}`;
}

// ---------------------------------------------------------------------------
// Inserter
// ---------------------------------------------------------------------------

/**
 * Insert or replace a @confidence annotation in file content.
 * If an existing annotation is found (within first 20 lines), it is replaced.
 * If no annotation exists, it is inserted after any file-level JSDoc block,
 * or as the first line if no JSDoc exists.
 *
 * @implements {R004.§7.AC.02} Insert/replace annotation
 * @implements {R004.§7.AC.03} Supports auto-insert use case
 */
export function insertConfidenceAnnotation(
  content: string,
  annotation: string,
): string {
  // Handle empty content
  if (content === '') {
    return annotation;
  }

  const lines = content.split('\n');

  // Check for existing annotation in first 20 lines
  const scanLimit = Math.min(lines.length, 20);
  for (let i = 0; i < scanLimit; i++) {
    if (CONFIDENCE_REGEX.test(lines[i])) {
      // Replace existing annotation in-place
      lines[i] = annotation;
      return lines.join('\n');
    }
  }

  // No existing annotation — find insertion point
  // Look for end of file-level JSDoc block (first `*/` in header)
  let insertIndex = 0;
  for (let i = 0; i < scanLimit; i++) {
    if (lines[i].includes('*/')) {
      insertIndex = i + 1;
      break;
    }
  }

  // Insert the annotation
  lines.splice(insertIndex, 0, annotation);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate that a level is within the allowed range for a reviewer icon.
 * AI (🤖) can assign levels 1-3, Human (👤) can assign levels 3-5.
 */
export function validateReviewerLevel(
  reviewer: ReviewerIcon,
  level: ConfidenceLevel,
): { valid: boolean; message?: string } {
  const allowed = REVIEWER_LEVEL_RANGES[reviewer];
  if (!allowed.includes(level)) {
    const range = `${allowed[0]}-${allowed[allowed.length - 1]}`;
    const label = reviewer === '🤖' ? 'AI (🤖)' : 'Human (👤)';
    return {
      valid: false,
      message: `${label} can only assign levels ${range}, got ${level}`,
    };
  }
  return { valid: true };
}

/**
 * Map CLI positional argument to reviewer icon.
 */
export function mapReviewerArg(arg: string): ReviewerIcon | null {
  switch (arg.toLowerCase()) {
    case 'ai':
      return '🤖';
    case 'human':
      return '👤';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Auditor
// ---------------------------------------------------------------------------

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
      const annotation = parseConfidenceAnnotation(content, relativeFile);

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
