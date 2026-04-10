/**
 * CLI command: `scepter claims search`
 *
 * Searches the claim index with text queries, metadata filters,
 * and derivation graph queries. Operates entirely in-memory after
 * building the index — no additional file I/O.
 *
 * @implements {R007.§5.AC.01} Command registered as `scepter claims search <query> [options]`
 * @implements {R007.§5.AC.02} Builds claim index via ensureIndex() before search
 * @implements {R007.§5.AC.03} No file I/O after index build
 * @implements {R007.§5.AC.04} Specific error messages for invalid options
 * @implements {R007.§5.AC.05} Help text with option descriptions
 */

import { Command } from 'commander';
import { BaseCommand } from '../base-command.js';
import { ensureIndex } from './ensure-index.js';
import { searchClaims } from '../../../claims/index.js';
import type { ClaimSearchOptions } from '../../../claims/index.js';
import { formatSearchResults } from '../../formatters/claim-formatter.js';

// @implements {R007.§5.AC.01} Command with positional query and filter/format options
export const searchCommand = new Command('search')
  // @implements {R007.§5.AC.05} Description and usage examples
  .description('Search the claim index by text, metadata filters, and derivation graph queries')
  .argument('[query]', 'Text query to match against claim IDs and headings')
  // @implements {R007.§1.AC.02} --id-only flag
  .option('--id-only', 'Restrict query matching to claim IDs only (exclude heading text)')
  // @implements {R007.§1.AC.03} --regex flag
  .option('--regex', 'Treat query as a regular expression (\\| normalized to | for alternation)')
  // @implements {R007.§2.AC.01} --types option
  .option('--types <types...>', 'Filter by note type(s) (e.g., Requirement, DetailedDesign, R, DD)')
  // @implements {R007.§2.AC.02} --note option
  .option('--note <noteId>', 'Restrict results to a specific note ID')
  // @implements {R007.§2.AC.03} --importance option
  .option('--importance <n>', 'Filter by minimum importance level (1-5)', parseInt)
  // @implements {R007.§2.AC.04} --lifecycle option
  .option('--lifecycle <state>', 'Filter by lifecycle state (closed, deferred, removed, superseded)')
  // @implements {R007.§3.AC.01} --derives-from option
  .option('--derives-from <claimId>', 'Find claims that derive from the specified claim ID')
  // @implements {R007.§3.AC.02} --derivatives-of option
  .option('--derivatives-of <claimId>', 'Find claims in the derivatives list of the specified claim ID')
  // @implements {R007.§3.AC.03} --has-derivation flag
  .option('--has-derivation', 'Filter to claims that declare derivation from at least one source')
  // @implements {R007.§4.AC.01-03} --format option
  .option('--format <format>', 'Output format: list (default), detailed, json', 'list')
  // @implements {R007.§2.AC.06} --limit option
  .option('--limit <n>', 'Maximum number of results (default: 50)', parseInt)
  .action(async (
    query: string | undefined,
    options: {
      idOnly?: boolean;
      regex?: boolean;
      types?: string[];
      note?: string;
      importance?: number;
      lifecycle?: string;
      derivesFrom?: string;
      derivativesOf?: string;
      hasDerivation?: boolean;
      format?: string;
      limit?: number;
      projectDir?: string;
    },
  ) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
        },
        async (context) => {
          // @implements {R007.§5.AC.02} Build index before search
          const data = await ensureIndex(context.projectManager);
          const claimIndex = context.projectManager.claimIndex;

          // Resolve --types shortcodes to canonical type names
          // @implements {R007.§2.AC.01} Type resolution via config noteTypes
          let resolvedTypes: string[] | undefined;
          if (options.types) {
            const config = context.projectManager.configManager.getConfig();
            const noteTypeKeys = Object.keys(config.noteTypes);
            resolvedTypes = [];
            for (const input of options.types) {
              // Try exact match first (full name)
              if (noteTypeKeys.includes(input)) {
                resolvedTypes.push(input);
                continue;
              }
              // Try shortcode resolution
              const matched = noteTypeKeys.find(key => {
                const typeConfig = config.noteTypes[key];
                return typeConfig.shortcode === input || typeConfig.shortcode?.toUpperCase() === input.toUpperCase();
              });
              if (matched) {
                resolvedTypes.push(matched);
              } else {
                // @implements {R007.§5.AC.04} Specific error for unresolvable type
                console.error(`Error: Unknown note type "${input}". Available types: ${noteTypeKeys.join(', ')}.`);
                return;
              }
            }
          }

          // @implements {R007.§5.AC.04} Validate format option
          const validFormats = ['list', 'detailed', 'json'];
          const format = (options.format ?? 'list') as 'list' | 'detailed' | 'json';
          if (!validFormats.includes(format)) {
            console.error(`Error: Invalid format "${options.format}". Valid formats: ${validFormats.join(', ')}.`);
            return;
          }

          // Build search options
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

          // Execute search
          const result = searchClaims(data, claimIndex, searchOptions);

          // @implements {R007.§5.AC.04} Display error from search logic
          if (result.error) {
            console.error(`Error: ${result.error}`);
            return;
          }

          // Format and display
          console.log(formatSearchResults(result, format));
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
