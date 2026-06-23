/**
 * The shape-specific adapter contract for confidence annotations.
 *
 * @see {DD016.§3} adapter interface
 */

import type {
  ConfidenceAnnotation,
  ConfidencePayload,
  ConfidenceLevel,
  ReviewerIcon,
  ConfidenceParseOptions,
} from './types.js';

/**
 * The shape-specific adapter contract. Every shape that carries
 * confidence annotations is represented by exactly one adapter.
 * Operations are pure functions over content strings — no I/O.
 *
 * @implements {S003.§1.AC.01}
 * @implements {S003.§5.AC.04}
 * @implements {DD016.§3.DC.11}
 * @implements {DD016.§3.DC.12}
 */
export interface ConfidenceAdapter {
  /** Stable identifier for diagnostics and logs. */
  readonly id: string;

  /**
   * Returns true if this adapter handles the given file path.
   * Pure function of path/extension. No I/O.
   * @implements {S003.§1.AC.03}
   */
  matches(filePath: string): boolean;

  /**
   * Parse a confidence annotation out of file content. Returns null
   * when the content carries no recognized annotation. Never throws.
   *
   * The OPTIONAL `options.defaultReviewer` carries the resolved
   * implied-human default ({R017}). When it is a reviewer value, a bare
   * level digit with no leading emoji is attributed to that reviewer;
   * when omitted/null, a bare digit does NOT parse (today's behavior).
   *
   * @implements {S003.§1.AC.04}
   * @implements {S003.§1.AC.08}
   * @implements {DD016.§10.DC.50}
   */
  parse(
    content: string,
    filePath: string,
    options?: ConfidenceParseOptions,
  ): ConfidenceAnnotation | null;

  /**
   * Render a payload as the adapter's annotation string. When date is
   * undefined (per R013.§1.AC.06's includeDate=false path), the adapter
   * MUST omit the trailing space and date.
   * @implements {S003.§5.AC.05}
   * @implements {DD016.§3.DC.13}
   */
  format(reviewer: ReviewerIcon, level: ConfidenceLevel, date?: string): string;

  /**
   * Insert or replace a confidence annotation in file content.
   * Returns the new content. Pure: no FS writes.
   * @implements {S003.§1.AC.05}
   * @implements {S003.§1.AC.06}
   * @implements {S003.§1.AC.07}
   */
  insert(content: string, payload: ConfidencePayload): string;
}
