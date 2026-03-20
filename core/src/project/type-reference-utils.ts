/**
 * Type Reference Utilities
 * 
 * This module provides utilities for managing note references during type operations.
 * It serves as a facade over NoteMentionService, providing type-specific operations
 * while delegating the actual parsing logic to the well-tested note parser.
 * 
 * Main functions:
 * - findAllReferencesToType: Find all references in a project
 * - updateReferencesForTypeRename: Update references when shortcode changes
 * - transformResultToReferenceUpdate: Convert between result formats
 * - updateNoteFileNames: Rename note files when shortcode changes
 * 
 * @module type-reference-utils
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { NoteMentionService, type TransformResult } from '../services/note-mention-service';
import type { ReferenceLocation, ReferenceUpdate } from './types';

/**
 * Find all references to a note type in an entire directory tree
 * 
 * @param shortcode - The note type shortcode to search for
 * @param rootPath - The root directory to search from
 * @param excludePatterns - Glob patterns to exclude from search (defaults to common non-text files)
 * @returns Array of all reference locations found
 * 
 * @example
 * const refs = await findAllReferencesToType('D', '/project');
 * console.log(`Found ${refs.length} references to Decision notes`);
 */
export async function findAllReferencesToType(
  shortcode: string,
  rootPath: string,
  excludePatterns: string[] = ['node_modules/**', '**/*.{png,jpg,jpeg,gif,ico,pdf,zip}']
): Promise<ReferenceLocation[]> {
  const mentionService = new NoteMentionService(rootPath, excludePatterns);
  const mentions = await mentionService.findMentionsByShortcode(shortcode);
  
  // Convert mentions to ReferenceLocation format
  return mentions.map(mention => ({
    filePath: mention.filePath,
    line: mention.line,
    column: mention.column,
    text: mention.mention.context || '',
    referenceText: `{${mention.mention.id}}`,
    noteId: mention.mention.id
  }));
}

/**
 * Update all references when renaming a type's shortcode
 * 
 * This function finds all mentions with the old shortcode and updates them to use
 * the new shortcode, preserving all modifiers, tags, and content.
 * 
 * @param rootPath - The root directory to search and update
 * @param oldShortcode - The current shortcode (e.g., 'D')
 * @param newShortcode - The new shortcode (e.g., 'TD')
 * @returns Array of transform results showing what was changed
 * 
 * @example
 * // This will update {D001} → {TD001}, {D002+} → {TD002+}, etc.
 * const results = await updateReferencesForTypeRename('/project', 'D', 'TD');
 * console.log(`Updated ${results.length} files`);
 */
export async function updateReferencesForTypeRename(
  rootPath: string,
  oldShortcode: string,
  newShortcode: string
): Promise<TransformResult[]> {
  const mentionService = new NoteMentionService(rootPath);
  
  // Use the service to transform all mentions with the old shortcode
  const results = await mentionService.transformShortcode(oldShortcode, newShortcode);
  
  // Apply the transforms (write to disk)
  await mentionService.applyTransforms(results, { createBackup: true });
  
  return results;
}

/**
 * Convert TransformResult to ReferenceUpdate format for compatibility
 * 
 * @param result - The transform result from NoteMentionService
 * @returns Reference update in the format expected by type management operations
 */
export function transformResultToReferenceUpdate(result: TransformResult): ReferenceUpdate {
  return {
    filePath: result.filePath,
    originalContent: result.originalContent,
    updatedContent: result.updatedContent,
    updateCount: result.transformCount
  };
}

/**
 * Update all note file names when shortcode changes
 * 
 * This function renames note files to reflect a new shortcode. For example,
 * when changing from 'D' to 'TD', files like "D001 Title.md" become "TD001 Title.md".
 * 
 * @param notesPath - Path to the notes directory for this type
 * @param oldShortcode - The current shortcode
 * @param newShortcode - The new shortcode
 * @returns Array of rename operations performed
 * 
 * @example
 * const renames = await updateNoteFileNames('/project/notes/decisions', 'D', 'TD');
 * // Returns: [{ oldPath: '.../D001 Title.md', newPath: '.../TD001 Title.md' }, ...]
 */
export async function updateNoteFileNames(
  notesPath: string,
  oldShortcode: string,
  newShortcode: string
): Promise<Array<{ oldPath: string; newPath: string }>> {
  const renames: Array<{ oldPath: string; newPath: string }> = [];
  
  const files = await fs.readdir(notesPath);
  
  for (const file of files) {
    // Match files like "D001 Title.md" or "D001.md"
    const match = file.match(new RegExp(`^(${oldShortcode}\\d{3,5})(\\s.+)?\\.md$`));
    if (match) {
      const oldPath = path.join(notesPath, file);
      const newFileName = file.replace(
        new RegExp(`^${oldShortcode}`),
        newShortcode
      );
      const newPath = path.join(notesPath, newFileName);
      
      await fs.rename(oldPath, newPath);
      renames.push({ oldPath, newPath });
    }
  }
  
  return renames;
}

