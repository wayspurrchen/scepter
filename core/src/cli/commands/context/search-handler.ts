import { ProjectManager } from '../../../project/project-manager';
import { formatNote } from '../../formatters/note-formatter';
import { generateSearchExcerpt } from '../../formatters/excerpt-extractor';
import type { Note } from '../../../types/note';
import matter from 'gray-matter';
import chalk from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { glob } from 'glob';

export interface SearchOptions {
  titleOnly?: boolean;
  regex?: boolean;
  contextLines?: number;
  caseSensitive?: boolean;
  // Common filter options that might be passed
  types?: string[];
  tags?: string[];
  mode?: string[];
  status?: string[];
  limit?: number;
  // Output options
  format?: 'list' | 'detailed' | 'json';
  showExcerpts?: boolean;
  highlightMatches?: boolean;
  includeSource?: boolean;
  includeArchived?: boolean;
  includeDeleted?: boolean;
}

export interface SearchResult {
  note?: Note;
  sourceFile?: {
    path: string;
    relativePath: string;
  };
  matches: MatchInfo[];
  excerpt?: string;
}

export interface MatchInfo {
  field: 'title' | 'content';
  line?: number;
  column?: number;
  context?: string;
  match: string;
}

/**
 * Search notes by content with advanced options
 */
export async function searchNotes(
  query: string,
  options: SearchOptions & { noteManager?: any; projectPath?: string } = {},
): Promise<SearchResult[]> {
  let noteManager = options.noteManager;
  let projectManager: ProjectManager | undefined;

  // If no noteManager provided, create one
  if (!noteManager) {
    // Get project root from options, environment or current directory
    const projectPath = options.projectPath || process.env.SCEPTER_PROJECT_PATH || process.cwd();

    // Initialize project manager
    projectManager = new ProjectManager(projectPath);

    // Load config from filesystem first
    await projectManager.configManager.loadConfigFromFilesystem();

    // Initialize the project
    await projectManager.initialize();
    noteManager = projectManager.noteManager;

    if (!noteManager) {
      throw new Error('Note manager not initialized');
    }

    // Start watching to scan existing files
    await noteManager.startWatching();
  }

  const projectPath = projectManager?.projectPath || options.projectPath || process.cwd();

  try {
    // Build search pattern
    let searchPattern: string | RegExp;
    if (options.regex) {
      // Normalize BRE-style \| to JS alternation |
      // Shell-escaped \| is common (grep convention) but in JS regex \| is a literal pipe
      const normalized = query.replace(/\\\|/g, '|');
      const flags = options.caseSensitive ? '' : 'i';
      searchPattern = new RegExp(normalized, flags);
    } else {
      // Escape special regex characters for literal search
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const flags = options.caseSensitive ? '' : 'i';
      searchPattern = new RegExp(escaped, flags);
    }

    // Determine search fields
    const searchFields = options.titleOnly ? ['title'] : ['title', 'content'];

    // Build query with filters
    const noteQuery = {
      searchPatterns: [searchPattern],
      searchFields,
      types: options.types,
      tags: options.tags,
      statuses: options.status,
      limit: options.limit,
      includeArchived: options.includeArchived,
      includeDeleted: options.includeDeleted,
    };

    // Get matching notes
    const result = await noteManager.getNotes(noteQuery);
    const notes = result.notes;

    // Process each note to find specific matches
    const searchResults: SearchResult[] = [];

    for (const note of notes) {
      const matches: MatchInfo[] = [];

      // Search in title
      if (searchFields.includes('title')) {
        const titleMatches = findMatches(note.title, searchPattern, 'title');
        matches.push(...titleMatches);
      }

      // Search in content
      if (searchFields.includes('content')) {
        // Get the original file content to search with accurate line numbers
        let searchContent = note.content;
        let frontmatterLineCount = 0;
        let usingOriginalContent = false;

        // Try to get the original file content if we have access to noteFileManager
        if (noteManager.noteFileManager) {
          const originalContent = await noteManager.noteFileManager.getFileContents(note.id);
          if (originalContent) {
            searchContent = originalContent;
            frontmatterLineCount = 0; // No offset needed when searching original content
            usingOriginalContent = true;
          }
        }

        if (!usingOriginalContent) {
          // Fallback: Calculate approximate frontmatter line count from metadata
          if (note.metadata && Object.keys(note.metadata).length > 0) {
            // Estimate 1 line per metadata field + 2 for --- markers + 1 empty line
            frontmatterLineCount = Object.keys(note.metadata).length + 3;
          }
        }

        const contentMatches = findMatchesWithContext(
          searchContent,
          searchPattern,
          options.contextLines !== undefined ? options.contextLines : 2,
          frontmatterLineCount,
        );

        matches.push(...contentMatches);
      }

      // Generate excerpt if requested
      let excerpt: string | undefined;
      if (options.showExcerpts && matches.length > 0) {
        // Use the first content match for excerpt, or title if no content matches
        const contentMatch = matches.find((m) => m.field === 'content');
        if (contentMatch) {
          const excerpts = generateSearchExcerpt(
            note.content,
            searchPattern instanceof RegExp ? searchPattern : new RegExp(searchPattern, 'i'),
            {
              maxLength: 200,
              highlightPattern: options.highlightMatches !== false ? (searchPattern instanceof RegExp ? searchPattern : new RegExp(searchPattern, 'i')) : undefined,
            },
          );
          // Join multiple excerpts with ellipsis
          excerpt = excerpts.join(' ... ');
        }
      }

      searchResults.push({
        note,
        matches,
        excerpt,
      });
    }

    // Search source files if requested
    if (options.includeSource && projectManager) {
      const sourceResults = await searchSourceFiles(projectManager, searchPattern, options);
      searchResults.push(...sourceResults);
    }

    return searchResults;
  } finally {
    // Clean up if we created the projectManager
    if (!options.noteManager && projectManager) {
      await projectManager.cleanup();
    }
  }
}

/**
 * Find all matches in text
 */
function findMatches(text: string, pattern: RegExp, field: 'title' | 'content'): MatchInfo[] {
  const matches: MatchInfo[] = [];
  const regex = new RegExp(pattern.source, pattern.flags + 'g');

  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push({
      field,
      match: match[0],
      column: match.index,
    });
  }

  return matches;
}

/**
 * Find matches with surrounding context lines
 */
function findMatchesWithContext(
  text: string,
  pattern: RegExp,
  contextLines: number,
  frontmatterLineCount: number = 0,
): MatchInfo[] {
  const matches: MatchInfo[] = [];
  const lines = text.split('\n');
  const regex = new RegExp(pattern.source, pattern.flags + 'g');

  lines.forEach((line, lineIndex) => {
    regex.lastIndex = 0; // Reset regex state
    let match;
    while ((match = regex.exec(line)) !== null) {
      // Get context lines
      const startLine = Math.max(0, lineIndex - contextLines);
      const endLine = Math.min(lines.length - 1, lineIndex + contextLines);

      // If contextLines is 0, only include the match line
      const contextLinesList = contextLines === 0 ? [line] : lines.slice(startLine, endLine + 1);

      matches.push({
        field: 'content',
        line: lineIndex + 1 + frontmatterLineCount, // 1-based, accounting for frontmatter
        column: match.index,
        match: match[0],
        context: contextLinesList.join('\n'),
      });
    }
  });

  return matches;
}

/**
 * Search source code files
 */
async function searchSourceFiles(
  projectManager: ProjectManager,
  searchPattern: RegExp,
  options: SearchOptions,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const config = projectManager.configManager.getConfig();

  if (!config.sourceCodeIntegration?.enabled) {
    return results;
  }

  // Use the correct property names from SourceCodeIntegrationConfig
  const scanPaths = config.sourceCodeIntegration.folders || [];
  const ignorePaths = config.sourceCodeIntegration.exclude || [];

  // Convert ignore paths to glob patterns
  const ignorePatterns = ignorePaths.map((p) => (p.startsWith('**/') ? p : `**/${p}`));

  // Get file extensions
  const extensions = config.sourceCodeIntegration.extensions || ['.js', '.ts', '.jsx', '.tsx', '.py', '.java'];

  for (const scanPath of scanPaths) {
    // Create glob pattern for each extension
    const patterns = extensions.map((ext) => path.join(projectManager.projectPath, scanPath, `**/*${ext}`));

    for (const pattern of patterns) {
      const files = await glob(pattern, {
        ignore: ignorePatterns.map((p) => path.join(projectManager.projectPath, p)),
        nodir: true,
      });

      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          const relativePath = path.relative(projectManager.projectPath, file);

          const matches = findMatchesWithContext(
            content,
            searchPattern,
            options.contextLines !== undefined ? options.contextLines : 2,
          );

          if (matches.length > 0) {
            // Generate excerpt
            let excerpt: string | undefined;
            if (options.showExcerpts && matches.length > 0) {
              const excerpts = generateSearchExcerpt(content, searchPattern, {
                maxLength: 200,
                highlightPattern: options.highlightMatches !== false ? (searchPattern instanceof RegExp ? searchPattern : new RegExp(searchPattern, 'i')) : undefined,
              });
              excerpt = excerpts.join(' ... ');
            }

            results.push({
              sourceFile: {
                path: file,
                relativePath,
              },
              matches,
              excerpt,
            });

            // Apply limit if specified
            if (options.limit && results.length >= options.limit) {
              return results;
            }
          }
        } catch (error) {
          // Skip files that can't be read
          continue;
        }
      }
    }
  }

  return results;
}

/**
 * Format search results for display
 */
export function formatSearchResults(results: SearchResult[], options: SearchOptions = {}): string {
  if (options.format === 'json') {
    return JSON.stringify(results, null, 2);
  }

  const lines: string[] = [];

  if (results.length === 0) {
    return 'No matches found.';
  }

  const noteCount = results.filter((r) => r.note).length;
  const sourceCount = results.filter((r) => r.sourceFile).length;

  if (sourceCount > 0 && noteCount > 0) {
    lines.push(`Found ${noteCount} notes and ${sourceCount} source files with matches:\n`);
  } else if (sourceCount > 0) {
    lines.push(`Found ${sourceCount} source files with matches:\n`);
  } else {
    lines.push(`Found ${noteCount} notes with matches:\n`);
  }

  for (const result of results) {
    if (options.format === 'detailed') {
      // Detailed format with match info
      if (result.note) {
        lines.push(
          formatNote(result.note, {
            showContent: false,
            showMetadata: true,
          }),
        );
      } else if (result.sourceFile) {
        lines.push(chalk.cyan(`Source: ${result.sourceFile.relativePath}`));
      }

      // Show matches
      lines.push(`Matches (${result.matches.length}):`);
      for (const match of result.matches) {
        const location = match.line ? `  ${match.field}:${match.line}:${match.column}` : `  ${match.field}`;
        lines.push(`${location}: "${match.match}"`);

        if (match.context && options.contextLines) {
          const contextLines = match.context.split('\n').map((l) => `    | ${l}`);
          lines.push(...contextLines);
        }
      }

      if (result.excerpt) {
        lines.push(`\nExcerpt:`);
        lines.push(result.excerpt);
      }

      lines.push(''); // Blank line between results
    } else {
      // Simple list format
      const matchCount = result.matches.length;
      const matchText = matchCount === 1 ? '1 match' : `${matchCount} matches`;

      if (result.note) {
        // If the title already includes the ID prefix, don't duplicate it
        const displayTitle = result.note.title.startsWith(`${result.note.id} -`)
          ? result.note.title
          : `${result.note.id} - ${result.note.title}`;
        lines.push(chalk.bold(displayTitle) + chalk.gray(` (${matchText})`));
      } else if (result.sourceFile) {
        lines.push(chalk.cyan(`${result.sourceFile.relativePath}`) + chalk.gray(` (${matchText})`));
      }

      // Show context for each match instead of excerpt
      if (options.showExcerpts !== false && result.matches.length > 0) {
        // Group matches by proximity to avoid duplicate context
        const contentMatches = result.matches.filter((m) => m.field === 'content' && m.context);

        if (contentMatches.length > 0) {
          // Show up to 3 matches with context
          const matchesToShow = contentMatches.slice(0, 3);

          // Track displayed lines to avoid duplicates
          const displayedLines = new Set<string>();

          for (const match of matchesToShow) {
            if (match.context && match.line) {
              const contextLines = match.context.split('\n');
              const contextLinesCount = options.contextLines !== undefined ? options.contextLines : 2;
              // The match line is always at index = contextLinesCount (e.g., with 2 context lines, it's at index 2)
              const matchLineIndex = contextLinesCount;

              // Calculate the starting line number
              // The context includes lines before and after the match
              // So if match is on line 15 with 2 context lines, we show lines 13-17
              const startLineNum = match.line! - contextLinesCount;

              contextLines.forEach((line, idx) => {
                const lineNum = startLineNum + idx;
                const lineKey = `${lineNum}:${line}`;

                // Skip if we've already displayed this line
                if (displayedLines.has(lineKey)) {
                  return;
                }
                displayedLines.add(lineKey);

                const isMatchLine = idx === matchLineIndex;
                const prefix = chalk.gray(`  ${lineNum}: `);

                if (isMatchLine && options.highlightMatches !== false) {
                  // Highlight the match in the line
                  const highlighted = line.replace(new RegExp(`(${match.match})`, 'gi'), chalk.yellow('$1'));
                  lines.push(prefix + highlighted);
                } else {
                  lines.push(prefix + chalk.gray(line));
                }
              });
            }
          }

          if (contentMatches.length > matchesToShow.length) {
            lines.push(chalk.gray(`  ... and ${contentMatches.length - matchesToShow.length} more matches`));
          }
        } else if (result.excerpt) {
          // Fallback to excerpt for title-only matches
          lines.push(chalk.gray(`  ${result.excerpt}`));
        }
      }

      lines.push(''); // Blank line between results
    }
  }

  return lines.join('\n');
}
