import { Command } from 'commander';
import * as chrono from 'chrono-node';
import type { NoteQuery } from '../../../types/note';
import type { ContextHints } from '../../../types/context';

/**
 * Parse natural language date strings using chrono
 * Examples: "yesterday", "1 hour ago", "last week", "2 days ago"
 */
function parseNaturalDate(dateStr: string): Date | undefined {
  const parsed = chrono.parseDate(dateStr);
  return parsed || undefined;
}

/**
 * Snap a date cutoff to a UTC day boundary when notes are stored at date
 * precision. Notes written with `timestampPrecision: "date"` are reloaded as
 * UTC midnight (e.g. `2026-04-27T00:00:00Z`), so a sub-day cutoff like
 * "10 minutes ago" would otherwise filter out every note created today. We
 * snap "after" cutoffs to the start of the cutoff's UTC day and "before"
 * cutoffs to the end, matching the granularity actually stored.
 */
function snapCutoffForPrecision(date: Date, precision: 'date' | 'datetime' | undefined, edge: 'start' | 'end'): Date {
  if (precision !== 'date' || isNaN(date.getTime())) return date;
  const isoDay = date.toISOString().split('T')[0];
  const startOfDay = new Date(isoDay);
  if (edge === 'start') return startOfDay;
  return new Date(startOfDay.getTime() + 86_400_000 - 1);
}

function resolveCutoff(
  raw: string,
  edge: 'start' | 'end',
  precision: 'date' | 'datetime' | undefined,
): Date {
  const parsed = parseNaturalDate(raw) ?? new Date(raw);
  return snapCutoffForPrecision(parsed, precision, edge);
}

/**
 * Parse comma-separated values from CLI arguments
 * Handles both space-separated and comma-separated formats
 * Examples: ["R", "T"] or ["R,T"] or ["R,T", "D"]
 */
function parseCommaSeparatedValues(values: string[]): string[] {
  const result: string[] = [];

  for (const value of values) {
    // Split by comma and trim whitespace
    const parts = value
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v);
    result.push(...parts);
  }

  return result;
}

/**
 * Common filter options that can be applied across multiple context commands
 */
export interface CommonFilterOptions {
  // Type filters
  types?: string[];
  type?: string[];  // Alias for types
  excludeTypes?: string[];

  // Tag filters
  tags?: string[];
  excludeTags?: string[];

  // Date filters
  createdAfter?: string;
  createdBefore?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;

  // Reference filters
  minIncomingRefs?: number;
  minOutgoingRefs?: number;
  hasNoRefs?: boolean;
  hasIncomingRefs?: boolean;
  hasOutgoingRefs?: boolean;
  referencedBy?: string[];
  references?: string[];

  // Content filters
  search?: string;

  // Task-specific filters
  status?: string[];
  
  // Archive/Delete filters
  includeArchived?: boolean;
  includeDeleted?: boolean;
  onlyArchived?: boolean;
  onlyDeleted?: boolean;

  // Output options
  format?: 'table' | 'tree' | 'list' | 'json';
  output?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'id' | 'created' | 'modified' | 'type' | 'title';
  sortOrder?: 'asc' | 'desc';
  verbose?: boolean;
}

/**
 * Add common filter options to a command
 */
export function addCommonFilterOptions(command: Command): Command {
  return (
    command
      // Type filters
      .option('-t, --types <types...>', 'Filter by note types')
      .option('--type <type...>', 'Alias for --types')
      .option('--exclude-types <types...>', 'Exclude specific note types')

      // Tag filters
      .option('-c, --tags <tags...>', 'Filter by tags')
      .option('--exclude-tags <tags...>', 'Exclude specific tags')

      // Date filters
      .option('--created-after <date>', 'Filter notes created after date (ISO 8601)')
      .option('--created-before <date>', 'Filter notes created before date (ISO 8601)')
      .option('--modified-after <date>', 'Filter notes modified after date (ISO 8601)')
      .option('--modified-before <date>', 'Filter notes modified before date (ISO 8601)')

      // Reference filters
      .option('--min-incoming-refs <count>', 'Minimum incoming references', parseInt)
      .option('--min-outgoing-refs <count>', 'Minimum outgoing references', parseInt)
      .option('--has-no-refs', 'Only notes with no references')
      .option('--has-incoming-refs', 'Only notes with incoming references')
      .option('--has-outgoing-refs', 'Only notes with outgoing references')
      .option('--referenced-by <ids...>', 'Notes referenced by specific note IDs')
      .option('--references <ids...>', 'Notes that reference specific note IDs')

      // Task-specific filters
      .option('-s, --status <statuses...>', 'Filter tasks by status (pending, in_progress, completed, blocked)')

      // Output options
      .option('-f, --format <format>', 'Output format (table, tree, list, json)', 'table')
      .option('-o, --output <file>', 'Write output to file')
      .option('-l, --limit <count>', 'Limit number of results', parseInt)
      .option('--offset <count>', 'Skip first N results', parseInt)
      .option('--sort-by <field>', 'Sort by field (id, created, modified, type, title)', 'created')
      .option('--sort-order <order>', 'Sort order (asc, desc)', 'desc')
  );
}

export interface OptionsToNoteQueryConfig {
  /**
   * Storage precision for note timestamps. When 'date', sub-day cutoffs like
   * "10 minutes ago" are snapped to UTC day boundaries so today's notes
   * (which are stamped at UTC midnight) still match.
   */
  timestampPrecision?: 'date' | 'datetime';
}

/**
 * Convert CLI options to NoteQuery
 */
export function optionsToNoteQuery(
  options: CommonFilterOptions,
  config: OptionsToNoteQueryConfig = {},
): NoteQuery {
  const query: NoteQuery = {};
  const precision = config.timestampPrecision;

  // Type filters - handle comma-separated values
  // Handle both --types and --type (alias)
  if (options.types?.length) {
    query.types = parseCommaSeparatedValues(options.types);
  } else if (options.type?.length) {
    query.types = parseCommaSeparatedValues(options.type);
  }
  if (options.excludeTypes?.length) {
    query.excludeTypes = parseCommaSeparatedValues(options.excludeTypes);
  }

  // Tag filters - handle comma-separated values
  if (options.tags?.length) {
    query.tags = parseCommaSeparatedValues(options.tags);
  }
  if (options.excludeTags?.length) {
    query.excludeTags = parseCommaSeparatedValues(options.excludeTags);
  }

  // Date filters
  if (options.createdAfter) {
    query.createdAfter = resolveCutoff(options.createdAfter, 'start', precision);
  }
  if (options.createdBefore) {
    query.createdBefore = resolveCutoff(options.createdBefore, 'end', precision);
  }
  if (options.modifiedAfter) {
    query.modifiedAfter = resolveCutoff(options.modifiedAfter, 'start', precision);
  }
  if (options.modifiedBefore) {
    query.modifiedBefore = resolveCutoff(options.modifiedBefore, 'end', precision);
  }

  // Reference filters
  if (options.minIncomingRefs !== undefined) {
    query.minIncomingRefs = options.minIncomingRefs;
  }
  if (options.minOutgoingRefs !== undefined) {
    query.minOutgoingRefs = options.minOutgoingRefs;
  }
  if (options.hasNoRefs) {
    query.hasNoRefs = true;
  }
  if (options.hasIncomingRefs) {
    query.hasIncomingRefs = true;
  }
  if (options.hasOutgoingRefs) {
    query.hasOutgoingRefs = true;
  }
  if (options.referencedBy?.length) {
    query.referencedBy = parseCommaSeparatedValues(options.referencedBy);
  }
  if (options.references?.length) {
    query.references = parseCommaSeparatedValues(options.references);
  }

  // Task-specific filters
  if (options.status?.length) {
    query.statuses = parseCommaSeparatedValues(options.status);
  }
  
  // Archive/Delete filters
  if (options.includeArchived) query.includeArchived = true;
  if (options.includeDeleted) query.includeDeleted = true;
  if (options.onlyArchived) query.onlyArchived = true;
  if (options.onlyDeleted) query.onlyDeleted = true;

  // Sorting
  if (options.sortBy) {
    query.sortBy = options.sortBy as any;
  }
  if (options.sortOrder) {
    query.sortOrder = options.sortOrder;
  }

  // Pagination
  if (options.limit !== undefined) {
    query.limit = options.limit;
  }
  if (options.offset !== undefined) {
    query.offset = options.offset;
  }

  return query;
}

/**
 * Convert search patterns to ContextHints
 */
export function patternsToContextHints(patterns: string[], options?: Partial<CommonFilterOptions>): ContextHints {
  const hints: ContextHints = {
    patterns,
  };

  if (options?.types?.length) {
    hints.includeTypes = options.types;
  }
  if (options?.tags?.length) {
    hints.includeTags = options.tags;
  }
  if (options?.excludeTypes?.length || options?.excludeTags?.length) {
    // Combine exclude patterns
    const excludePatterns: string[] = [];
    // Note: This is a simplified approach. In practice, we might need more sophisticated exclusion logic
    hints.excludePatterns = excludePatterns;
  }

  return hints;
}
