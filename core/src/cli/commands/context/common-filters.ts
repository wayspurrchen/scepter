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

/**
 * Convert CLI options to NoteQuery
 */
export function optionsToNoteQuery(options: CommonFilterOptions): NoteQuery {
  const query: NoteQuery = {};

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
    const parsed = parseNaturalDate(options.createdAfter);
    if (parsed) {
      query.createdAfter = parsed;
    } else {
      // Fallback to direct date parsing
      query.createdAfter = new Date(options.createdAfter);
    }
  }
  if (options.createdBefore) {
    const parsed = parseNaturalDate(options.createdBefore);
    if (parsed) {
      query.createdBefore = parsed;
    } else {
      query.createdBefore = new Date(options.createdBefore);
    }
  }
  if (options.modifiedAfter) {
    const parsed = parseNaturalDate(options.modifiedAfter);
    if (parsed) {
      query.modifiedAfter = parsed;
    } else {
      query.modifiedAfter = new Date(options.modifiedAfter);
    }
  }
  if (options.modifiedBefore) {
    const parsed = parseNaturalDate(options.modifiedBefore);
    if (parsed) {
      query.modifiedBefore = parsed;
    } else {
      query.modifiedBefore = new Date(options.modifiedBefore);
    }
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
