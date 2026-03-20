import { glob } from 'glob';
import fs from 'fs/promises';
import path from 'path';
import { parseNoteMentions } from '../parsers/note/note-parser.js';
import type { NoteMention } from '../parsers/note/note-parser.js';

export interface ScanOptions {
  include?: string[];
  exclude?: string[];
  projectRoot?: string;
}

export type ContextItem = {
  noteId: string;
  file: string;
  line: number;
  contentExtension?: string;
  tagExtensions?: string[];
  inclusionModifiers?: {
    content?: boolean;
    outgoingReferences?: boolean;
    incomingReferences?: boolean;
    contextHints?: boolean;
    everything?: boolean;
  };
  context?: string;
};

export interface ScanResult {
  items: ContextItem[];
  files: string[];
  errors: Array<{ file: string; error: string }>;
}

const DEFAULT_INCLUDE = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.md', '**/*.context.md'];

const DEFAULT_EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/coverage/**',
  '**/prompts/**',
];

export async function scanProject(options: ScanOptions = {}): Promise<ScanResult> {
  const { include = DEFAULT_INCLUDE, exclude = DEFAULT_EXCLUDE, projectRoot = process.cwd() } = options;

  const items: ContextItem[] = [];
  const errors: Array<{ file: string; error: string }> = [];
  const processedFiles: string[] = [];

  // Find all matching files
  const patterns = include.map((pattern) => path.join(projectRoot, pattern));
  const files = await glob(patterns, {
    ignore: exclude.map((pattern) => path.join(projectRoot, pattern)),
    absolute: true,
  });

  // Process each file
  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const relativePath = path.relative(projectRoot, file);
      processedFiles.push(relativePath);

      // Parse all files for note mentions
      const mentions = parseNoteMentions(content, {
        filePath: relativePath,
        includeContext: true,
      });

      items.push(
        ...mentions.map((mention) => ({
          noteId: mention.id,
          file: relativePath,
          line: mention.line,
          contentExtension: mention.contentExtension,
          tagExtensions: mention.tagExtensions,
          inclusionModifiers: mention.inclusionModifiers,
          context: mention.context,
        })),
      );
    } catch (error) {
      errors.push({
        file: path.relative(projectRoot, file),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { items, files: processedFiles, errors };
}

export function filterItems(
  items: ContextItem[],
  criteria: {
    noteIds?: string[];
    tags?: string[];
    file?: string;
    hasModifiers?: boolean;
  },
): ContextItem[] {
  return items.filter((item) => {
    if (criteria.noteIds && !criteria.noteIds.includes(item.noteId)) return false;
    if (criteria.file && !item.file.includes(criteria.file)) return false;
    if (criteria.hasModifiers && !item.inclusionModifiers) return false;
    if (criteria.tags && criteria.tags.length > 0) {
      // Item must have at least one of the specified tags
      if (!item.tagExtensions) return false;
      return criteria.tags.some((cat) => item.tagExtensions?.includes(cat));
    }
    return true;
  });
}

export function searchItems(items: ContextItem[], query: string): ContextItem[] {
  const lowerQuery = query.toLowerCase();
  return items.filter((item) => {
    return (
      item.noteId.toLowerCase().includes(lowerQuery) ||
      item.contentExtension?.toLowerCase().includes(lowerQuery) ||
      item.tagExtensions?.some((cat) => cat.toLowerCase().includes(lowerQuery)) ||
      item.file.toLowerCase().includes(lowerQuery) ||
      item.context?.toLowerCase().includes(lowerQuery)
    );
  });
}

export function groupItemsByNoteId(items: ContextItem[]): Record<string, ContextItem[]> {
  return items.reduce(
    (acc, item) => {
      if (!acc[item.noteId]) acc[item.noteId] = [];
      acc[item.noteId].push(item);
      return acc;
    },
    {} as Record<string, ContextItem[]>,
  );
}

export function extractAllTags(items: ContextItem[]): Map<string, number> {
  const tagCounts = new Map<string, number>();

  items.forEach((item) => {
    item.tagExtensions?.forEach((tag) => {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    });
  });

  return tagCounts;
}

export function groupItemsByFile(items: ContextItem[]): Record<string, ContextItem[]> {
  return items.reduce(
    (acc, item) => {
      if (!acc[item.file]) acc[item.file] = [];
      acc[item.file].push(item);
      return acc;
    },
    {} as Record<string, ContextItem[]>,
  );
}
