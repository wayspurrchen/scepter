import { Command } from 'commander';
import chalk from 'chalk';
import { searchNotes, formatSearchResults } from './search-handler';
import { BaseCommand } from '../base-command';

export const searchCommand = new Command('search')
  .description('Search notes by content')
  .argument('<query>', 'Search query (use quotes for phrases)')
  .option('-t, --title-only', 'Search in titles only')
  .option('--regex', 'Use regex search')
  .option('-c, --context-lines <n>', 'Show n lines of context around matches', (value) => parseInt(value, 10), 2)
  .option('--case-sensitive', 'Case sensitive search')
  .option('--types <types...>', 'Filter by note types')
  .option('--tags <tags...>', 'Filter by tags')
  .option('--status <statuses...>', 'Filter tasks by status')
  .option('--limit <n>', 'Maximum number of results', parseInt)
  .option('--format <format>', 'Output format (list, detailed, json)', 'list')
  .option('--show-excerpts', 'Show excerpts', true)
  .option('--highlight-matches', 'Highlight matches in excerpts', true)
  .option('--include-source', 'Include source code files in search')
  .option('--include-archived', 'Include archived notes in search')
  .option('--include-deleted', 'Include deleted notes in search')
  .action(async (query, options) => {
    try {
      await BaseCommand.execute(
        {
          projectDir: options.projectDir,
          requireNoteManager: true,
          startWatching: true,
        },
        async (context) => {
          const results = await searchNotes(query, {
            ...options,
            noteManager: context.projectManager.noteManager,
            projectPath: context.projectPath,
          });

          const output = formatSearchResults(results, {
            format: options.format,
            contextLines: options.contextLines,
            showExcerpts: options.excerpts,
            highlightMatches: options.highlight,
          });

          console.log(output);
        },
      );
    } catch (error) {
      BaseCommand.handleError(error);
    }
  });
