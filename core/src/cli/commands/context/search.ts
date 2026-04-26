/**
 * Unified search command.
 *
 * Implements the detection algorithm from DD006 §4:
 *   1. parseClaimAddress() → claim-address mode
 *   2. /^[A-Z]{1,5}\d{3,5}$/i → bare-note-id mode
 *   3. fallback → text-search mode
 *
 * --mode auto|note|claim overrides the detection.
 *
 * @implements {DD006.§3.DC.14} Unified search with --mode auto|note|claim
 * @implements {DD006.§3.DC.15} Detection algorithm: claim address → bare note ID → text search
 * @implements {DD006.§3.DC.16} Hint when auto-detection identifies claim address
 * @implements {DD006.§3.DC.17} Absorb claims search metadata filter options
 * @implements {DD006.§3.DC.18} --mode note forces text search regardless of query shape
 */

import * as path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import { searchNotes, formatSearchResults } from './search-handler.js';
import { BaseCommand } from '../base-command.js';
import { parseClaimAddress } from '../../../parsers/claim/claim-parser.js';
import { ensureIndex } from '../claims/ensure-index.js';
import { resolveSingleClaim } from '../shared/resolve-claim-id.js';
import { searchClaims } from '../../../claims/claim-search.js';
import type { ClaimSearchOptions } from '../../../claims/claim-search.js';
import { formatClaimTrace, formatSearchResults as formatClaimSearchResults, groupVerifiedEvents } from '../../formatters/claim-formatter.js';
import { buildTraceabilityMatrix } from '../../../claims/index.js';
import { parseMetadataFilters, applyMetadataFilters, collectStrings } from '../../../claims/index.js';
import type { ClaimIndexData, ClaimIndexEntry } from '../../../claims/index.js';

// @implements {DD006.§3.DC.15} Detection algorithm per DD006 §4
type SearchDetection = 'claim-address' | 'bare-note-id' | 'text-search';

const BARE_NOTE_ID_RE = /^[A-Z]{1,5}\d{3,5}$/i;

/**
 * Detect how to interpret a search query in auto mode.
 *
 * @implements {DD006.§3.DC.15} Step 1: parseClaimAddress, Step 2: bare note ID, Step 3: text fallback
 */
function detectSearchMode(query: string): SearchDetection {
  // Step 1: Try claim address parsing
  const addr = parseClaimAddress(query);
  if (addr !== null && addr.claimPrefix !== undefined) {
    return 'claim-address';
  }

  // Step 2: Try bare note ID pattern
  if (BARE_NOTE_ID_RE.test(query)) {
    return 'bare-note-id';
  }

  // Step 3: Fallback to text search
  return 'text-search';
}

// @implements {DD006.§3.DC.14} Unified search command with --mode option
export const searchCommand = new Command('search')
  .description('Search notes and claims')
  .argument('<query>', 'Search query: claim address, note ID, or text (use quotes for phrases)')
  // @implements {DD006.§3.DC.14} --mode option
  .option('--mode <mode>', 'Search mode: auto, note, or claim (default: auto)', 'auto')
  // Note-search options (original)
  .option('-t, --title-only', 'Search in titles only')
  .option('--regex', 'Use regex search')
  .option('-c, --context-lines <n>', 'Show n lines of context around matches', (value: string) => parseInt(value, 10), 2)
  .option('--case-sensitive', 'Case sensitive search')
  .option('--tags <tags...>', 'Filter by tags')
  .option('--status <statuses...>', 'Filter tasks by status')
  .option('--limit <n>', 'Maximum number of results', parseInt)
  .option('--format <format>', 'Output format (list, detailed, json)', 'list')
  .option('--show-excerpts', 'Show excerpts', true)
  .option('--highlight-matches', 'Highlight matches in excerpts', true)
  .option('--include-source', 'Include source code files in search')
  .option('--include-archived', 'Include archived notes in search')
  .option('--include-deleted', 'Include deleted notes in search')
  // @implements {DD006.§3.DC.17} Claims search metadata filters (active in claim mode)
  .option('--types <types...>', 'Filter by note types (claim mode) or note types (note mode)')
  .option('--note <noteId>', 'Restrict claim results to a specific note ID')
  .option('--importance <n>', 'Filter by minimum importance level (1-5)', parseInt)
  .option('--lifecycle <state>', 'Filter by lifecycle state (closed, deferred, removed, superseded)')
  .option('--derives-from <claimId>', 'Find claims that derive from the specified claim ID')
  .option('--derivatives-of <claimId>', 'Find claims in the derivatives list of the specified claim ID')
  .option('--has-derivation', 'Filter to claims that declare derivation from at least one source')
  .option('--id-only', 'Restrict query matching to claim IDs only (exclude heading text)')
  // @implements {DD014.§3.DC.55} Metadata filters: --where, --has-key, --missing-key (claim mode)
  .option('--where <pair>', 'Filter to claims where KEY=VALUE in folded metadata (repeatable, claim mode)', collectStrings, [])
  .option('--has-key <key>', 'Filter to claims with at least one value for KEY (repeatable, claim mode)', collectStrings, [])
  .option('--missing-key <key>', 'Filter to claims with no value for KEY (repeatable, claim mode)', collectStrings, [])
  .option('--reindex', 'Force rebuild of claim index')
  .action(async (query: string, options: {
    mode?: string;
    titleOnly?: boolean;
    regex?: boolean;
    contextLines?: number;
    caseSensitive?: boolean;
    types?: string[];
    tags?: string[];
    status?: string[];
    limit?: number;
    format?: string;
    showExcerpts?: boolean;
    highlightMatches?: boolean;
    includeSource?: boolean;
    includeArchived?: boolean;
    includeDeleted?: boolean;
    note?: string;
    importance?: number;
    lifecycle?: string;
    derivesFrom?: string;
    derivativesOf?: string;
    hasDerivation?: boolean;
    idOnly?: boolean;
    where?: string[];
    hasKey?: string[];
    missingKey?: string[];
    reindex?: boolean;
    projectDir?: string;
  }) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
        },
        async (context) => {
          const mode = options.mode ?? 'auto';

          // @implements {DD006.§3.DC.18} --mode note forces text search
          if (mode === 'note') {
            await performTextSearch(query, options, context);
            return;
          }

          // @implements {DD006.§3.DC.17} --mode claim forces claim search
          if (mode === 'claim') {
            await performClaimSearch(query, options, context);
            return;
          }

          // Auto mode: run detection algorithm
          // @implements {DD006.§3.DC.15} Detection algorithm
          const detection = detectSearchMode(query);

          if (detection === 'claim-address') {
            await performClaimAddressLookup(query, options, context);
            return;
          }

          if (detection === 'bare-note-id') {
            await performNoteIdLookup(query, options, context);
            return;
          }

          // text-search fallback
          await performTextSearch(query, options, context);
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });

/**
 * Claim address lookup: build index, find claim, display trace.
 * @implements {DD006.§3.DC.15} Claim address detected → show claim detail
 * @implements {DD006.§3.DC.16} Hint appended for auto-detection
 */
async function performClaimAddressLookup(
  query: string,
  options: { format?: string; json?: boolean; reindex?: boolean; projectDir?: string },
  context: { projectManager: any; projectPath: string },
): Promise<void> {
  const data = await ensureIndex(context.projectManager, { reindex: options.reindex });
  // @implements {DD008.§1.DC.01} Centralized flexible resolver ($→§, zero-padding, suffix matching).
  const entry = resolveSingleClaim(query, data);
  if (!entry) {
    // @implements {DD006.§3.DC.16} Hint for false-positive scenario
    console.log('');
    console.log(chalk.dim('Use --mode note to search note content instead.'));
    return;
  }

  // Show claim detail with traceability
  // @implements {DD014.§3.DC.54} search reads via metadataStorage
  const incoming = data.crossRefs.filter((ref) => ref.toClaim === entry.fullyQualified);
  const verifiedEventList = await context.projectManager.metadataStorage!.query({ key: 'verified' });
  const verifiedEvents = groupVerifiedEvents(verifiedEventList);

  if (options.format === 'json') {
    const eventsForClaim = verifiedEvents.get(entry.fullyQualified) ?? [];
    const latestVerification = eventsForClaim.length > 0 ? eventsForClaim[eventsForClaim.length - 1] : undefined;
    console.log(JSON.stringify({
      entry,
      incoming,
      verification: latestVerification ?? undefined,
    }, null, 2));
  } else {
    console.log(await formatClaimTrace(entry, incoming, data.noteTypes, undefined, verifiedEvents));
  }

  // @implements {DD006.§3.DC.16} Auto-detection hint
  console.log('');
  console.log(chalk.dim('Detected as claim address. Use --mode note for text search.'));
}

/**
 * Bare note ID lookup: display note summary with its claim list.
 * @implements {DD006.§3.DC.15} Bare note ID → show note with claim summary
 */
async function performNoteIdLookup(
  query: string,
  _options: { format?: string; reindex?: boolean; projectDir?: string },
  context: { projectManager: any; projectPath: string },
): Promise<void> {
  const noteManager = context.projectManager.noteManager;
  const note = await noteManager.getNoteById(query.toUpperCase());

  if (!note) {
    console.log(`Note not found: ${query}`);
    return;
  }

  // Display note summary
  console.log(chalk.bold(`${chalk.cyan(note.id)} — ${note.title}`));
  console.log(chalk.dim(`  Type: ${note.type}  Status: ${note.status ?? 'n/a'}  Tags: ${(note.tags ?? []).join(', ') || 'none'}`));

  // Show claim summary from the index
  const data = await ensureIndex(context.projectManager, { reindex: _options.reindex });
  const claimIndex = context.projectManager.claimIndex;
  const claims = claimIndex.getClaimsForNote(note.id);

  if (claims.length > 0) {
    console.log('');
    console.log(chalk.bold(`Claims (${claims.length}):`));
    for (const claim of claims) {
      const imp = claim.importance !== undefined ? chalk.yellow(` [${claim.importance}]`) : '';
      console.log(`  ${chalk.cyan(claim.fullyQualified)}${imp} ${claim.heading}`);
    }
  } else {
    console.log('');
    console.log(chalk.dim('No claims found in this note.'));
  }
}

/**
 * Full-text note content search (existing behavior).
 * @implements {DD006.§3.DC.18} --mode note or text-search fallback
 */
async function performTextSearch(
  query: string,
  options: {
    titleOnly?: boolean;
    regex?: boolean;
    contextLines?: number;
    caseSensitive?: boolean;
    types?: string[];
    tags?: string[];
    status?: string[];
    limit?: number;
    format?: string;
    showExcerpts?: boolean;
    highlightMatches?: boolean;
    includeSource?: boolean;
    includeArchived?: boolean;
    includeDeleted?: boolean;
    projectDir?: string;
  },
  context: { projectManager: any; projectPath: string },
): Promise<void> {
  const results = await searchNotes(query, {
    ...options,
    noteManager: context.projectManager.noteManager,
    projectPath: context.projectPath,
  });

  const output = formatSearchResults(results, {
    format: options.format as 'list' | 'detailed' | 'json' | undefined,
    contextLines: options.contextLines,
    showExcerpts: options.showExcerpts,
    highlightMatches: options.highlightMatches,
  });

  console.log(output);
}

/**
 * Claim search with metadata filters (forwarded to searchClaims).
 * @implements {DD006.§3.DC.17} Claim search mode absorbs claims search filters
 */
async function performClaimSearch(
  query: string,
  options: {
    regex?: boolean;
    idOnly?: boolean;
    types?: string[];
    note?: string;
    importance?: number;
    lifecycle?: string;
    derivesFrom?: string;
    derivativesOf?: string;
    hasDerivation?: boolean;
    where?: string[];
    hasKey?: string[];
    missingKey?: string[];
    format?: string;
    limit?: number;
    reindex?: boolean;
    projectDir?: string;
  },
  context: { projectManager: any; projectPath: string },
): Promise<void> {
  const data = await ensureIndex(context.projectManager, { reindex: options.reindex });
  const claimIndex = context.projectManager.claimIndex;

  // Resolve --types shortcodes to canonical type names
  let resolvedTypes: string[] | undefined;
  if (options.types) {
    const config = context.projectManager.configManager.getConfig();
    const noteTypeKeys = Object.keys(config.noteTypes);
    resolvedTypes = [];
    for (const input of options.types) {
      if (noteTypeKeys.includes(input)) {
        resolvedTypes.push(input);
        continue;
      }
      const matched = noteTypeKeys.find((key: string) => {
        const typeConfig = config.noteTypes[key];
        return typeConfig.shortcode === input || typeConfig.shortcode?.toUpperCase() === input.toUpperCase();
      });
      if (matched) {
        resolvedTypes.push(matched);
      } else {
        console.error(`Error: Unknown note type "${input}". Available types: ${noteTypeKeys.join(', ')}.`);
        return;
      }
    }
  }

  const validFormats = ['list', 'detailed', 'json'];
  const format = (options.format ?? 'list') as 'list' | 'detailed' | 'json';
  if (!validFormats.includes(format)) {
    console.error(`Error: Invalid format "${options.format}". Valid formats: ${validFormats.join(', ')}.`);
    return;
  }

  const searchOptions: ClaimSearchOptions = {
    query: query ?? '',
    regex: options.regex,
    idOnly: options.idOnly,
    types: resolvedTypes,
    note: options.note,
    importance: options.importance,
    lifecycle: options.lifecycle,
    derivesFrom: options.derivesFrom,
    derivativesOf: options.derivativesOf,
    hasDerivation: options.hasDerivation,
    limit: options.limit,
    format,
  };

  const result = searchClaims(data, claimIndex, searchOptions);

  if (result.error) {
    console.error(`Error: ${result.error}`);
    return;
  }

  // @implements {DD014.§3.DC.55} Parse and validate --where / --has-key / --missing-key
  // @implements {DD014.§3.DC.56} AND-compose metadata filters with the existing claim-search filters
  const filterParse = parseMetadataFilters({
    where: options.where,
    hasKey: options.hasKey,
    missingKey: options.missingKey,
  });
  if (!filterParse.ok) {
    console.error(chalk.red(filterParse.error));
    process.exit(1);
  }
  const beforeCount = result.matches.length;
  result.matches = await applyMetadataFilters(
    result.matches,
    (entry) => entry.fullyQualified,
    context.projectManager.metadataStorage!,
    filterParse,
  );
  const dropped = beforeCount - result.matches.length;
  if (dropped > 0) {
    result.total = Math.max(0, result.total - dropped);
  }

  console.log(formatClaimSearchResults(result, format));
}
