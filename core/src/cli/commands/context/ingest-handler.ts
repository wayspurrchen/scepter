import * as path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import matter from 'gray-matter';
import type { CommandContext } from '../base-command.js';

export interface IngestOptions {
  type: string;
  tags?: string[];
  status?: string;
  move?: boolean;
  dryRun?: boolean;
}

export interface IngestResult {
  ingested: Array<{
    sourcePath: string;
    destPath: string;
    noteId: string;
    title: string;
  }>;
  skipped: Array<{
    sourcePath: string;
    reason: string;
  }>;
}

/**
 * Ingest one or more files into SCEpter as notes of the given type.
 *
 * For each markdown file:
 * 1. Generate a new note ID
 * 2. Add SCEpter frontmatter (preserving existing frontmatter fields)
 * 3. Rename with the ID prefix
 * 4. Optionally move into the type's folder under _scepter/ (--move)
 */
export async function ingestNotes(
  sources: string[],
  options: IngestOptions,
  context: CommandContext,
): Promise<IngestResult> {
  const { projectManager, projectPath } = context;
  const noteManager = projectManager.noteManager;
  const noteTypeResolver = projectManager.noteTypeResolver;

  if (!noteManager || !noteTypeResolver) {
    throw new Error('Note manager or type resolver not initialized');
  }

  // Resolve the type — must be a configured type so we can generate IDs
  const resolvedType = noteTypeResolver.resolveTypeIdentifier(options.type);
  if (!resolvedType) {
    throw new Error(`Unknown note type: ${options.type}. The type must be configured so IDs can be generated.`);
  }

  // Determine target folder only if --move is requested
  let targetDir: string | null = null;
  if (options.move) {
    const config = projectManager.configManager.getConfig();
    const notesRoot = config.paths?.notesRoot || '_scepter';
    const typeInfo = noteTypeResolver.getType(resolvedType);
    const folderName = typeInfo?.folder || `${resolvedType.toLowerCase()}s`;
    targetDir = path.join(projectPath, notesRoot, folderName);
    await fs.ensureDir(targetDir);
  }

  // Collect all markdown files from the sources
  const filePaths = await collectMarkdownFiles(sources, projectPath);

  const result: IngestResult = { ingested: [], skipped: [] };

  for (const sourcePath of filePaths) {
    try {
      // Skip non-markdown files
      if (!sourcePath.endsWith('.md')) {
        result.skipped.push({ sourcePath, reason: 'Not a markdown file' });
        continue;
      }

      // Read file content
      const rawContent = await fs.readFile(sourcePath, 'utf-8');

      // Generate a new ID
      const noteId = await noteManager.generateNoteId(resolvedType);

      // Parse existing frontmatter (if any) and body
      const parsed = matter(rawContent);
      const existingData = parsed.data || {};
      const body = parsed.content;

      // Extract title from first heading or filename
      const title = extractTitle(body, sourcePath);

      // Build merged frontmatter
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const mergedData: Record<string, any> = {
        ...existingData,
        created: existingData.created || dateStr,
        tags: mergeTags(existingData.tags, options.tags),
      };

      if (options.status) {
        mergedData.status = options.status;
      } else if (!mergedData.status) {
        // Apply default status from type config if available
        const statusValidator = projectManager.statusValidator;
        if (statusValidator) {
          const defaultStatus = statusValidator.getDefaultStatus(resolvedType);
          if (defaultStatus) {
            mergedData.status = defaultStatus;
          }
        }
      }

      // Rebuild content: ensure the heading has the ID prefix
      const newBody = ensureIdHeading(body, noteId, title);
      const newContent = matter.stringify(newBody, mergedData);

      // Generate destination filename
      const cleanTitle = title
        .replace(/[^a-zA-Z0-9\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const filename = `${noteId} ${cleanTitle}`.substring(0, 80).trim() + '.md';

      // If --move, put in type folder; otherwise rename in place
      const destDir = targetDir || path.dirname(sourcePath);
      const destPath = path.join(destDir, filename);

      if (options.dryRun) {
        const label = targetDir ? '→' : '⟹';
        console.log(chalk.dim(`[dry-run] ${path.relative(projectPath, sourcePath)} ${label} ${path.relative(projectPath, destPath)} as ${noteId}`));
        result.ingested.push({ sourcePath, destPath, noteId, title });
        continue;
      }

      // Write new content to destination
      await fs.writeFile(destPath, newContent, 'utf-8');

      // Remove original (if dest is different from source)
      if (destPath !== sourcePath) {
        await fs.unlink(sourcePath);
      }

      result.ingested.push({ sourcePath, destPath, noteId, title });

      console.log(
        chalk.green(`  ${noteId}`) +
        chalk.dim(` ← ${path.relative(projectPath, sourcePath)}`) +
        chalk.white(` "${title}"`)
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.skipped.push({ sourcePath, reason: msg });
    }
  }

  return result;
}

/**
 * Collect all .md files from a list of file/directory paths.
 */
async function collectMarkdownFiles(sources: string[], projectPath: string): Promise<string[]> {
  const files: string[] = [];

  for (const source of sources) {
    const resolved = path.isAbsolute(source) ? source : path.resolve(projectPath, source);
    const stats = await fs.stat(resolved);

    if (stats.isFile()) {
      files.push(resolved);
    } else if (stats.isDirectory()) {
      const entries = await fs.readdir(resolved);
      for (const entry of entries) {
        if (entry.endsWith('.md')) {
          files.push(path.join(resolved, entry));
        }
      }
    }
  }

  // Sort by filename for deterministic ID assignment order
  files.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  return files;
}

/**
 * Extract a title from the body content or fall back to filename.
 */
function extractTitle(body: string, filePath: string): string {
  // Try first heading
  const headingMatch = body.match(/^#\s+(.+)$/m);
  if (headingMatch) {
    let title = headingMatch[1].trim();
    // Strip existing ID prefix if present (e.g., "D001 - Foo" → "Foo")
    const idPrefix = title.match(/^[A-Z]+\d+\s*-\s*/);
    if (idPrefix) {
      title = title.substring(idPrefix[0].length);
    }
    return title;
  }

  // Fall back to filename without extension
  return path.basename(filePath, '.md');
}

/**
 * Ensure the body has a heading with the note ID prefix.
 */
function ensureIdHeading(body: string, noteId: string, title: string): string {
  const headingMatch = body.match(/^(#\s+)(.+)$/m);

  if (headingMatch) {
    const prefix = headingMatch[1]; // "# " or "## " etc.
    const existingTitle = headingMatch[2].trim();

    // If heading already has an ID prefix, replace it
    const hasIdPrefix = /^[A-Z]+\d+\s*-\s*/.test(existingTitle);
    if (hasIdPrefix) {
      const stripped = existingTitle.replace(/^[A-Z]+\d+\s*-\s*/, '');
      return body.replace(headingMatch[0], `${prefix}${noteId} - ${stripped}`);
    }

    // Otherwise prepend the ID
    return body.replace(headingMatch[0], `${prefix}${noteId} - ${existingTitle}`);
  }

  // No heading found — prepend one
  return `# ${noteId} - ${title}\n\n${body}`;
}

/**
 * Merge existing tags with user-provided tags, deduplicating.
 */
function mergeTags(
  existing: string | string[] | undefined,
  userTags: string[] | undefined,
): string[] {
  const set = new Set<string>();

  if (Array.isArray(existing)) {
    for (const t of existing) set.add(t);
  } else if (typeof existing === 'string' && existing) {
    set.add(existing);
  }

  if (userTags) {
    for (const t of userTags) set.add(t);
  }

  return Array.from(set);
}
