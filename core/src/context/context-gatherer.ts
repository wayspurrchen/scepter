import { EventEmitter } from 'events';
import type { Note } from '../types/note';
import type { ContextHints } from '../types/context';
import type { Task } from '../types/task';
import type { NoteManager } from '../notes/note-manager';
import type { ConfigManager } from '../config/config-manager';
import type { ReferenceManager } from '../references/reference-manager';
import type { SCEpterConfig } from '../types/config';
import { createHash } from 'crypto';

// TODO: Eventually this should support mode prompts, and be able to pull them in
// specifically based on tag as well

export interface GatherOptions {
  maxDepth?: number; // How deep to follow references (default: 1)
  deduplicateContent?: boolean; // Remove duplicate content (default: true)
  sortBy?: 'relevance' | 'date' | 'type'; // Sort order (default: 'relevance')
  includeArchived?: boolean; // Include archived notes
  includeDeleted?: boolean; // Include deleted notes
}

export interface GatheredContext {
  contextHintNotes: Note[]; // Primary notes matching hints
  referencedNotes: Note[]; // Notes referenced by primary notes
  stats: ContextStats; // Statistics about gathering
}

export interface ContextStats {
  notesSearched: number; // Total notes examined
  notesIncluded: number; // Notes included in context
  referencesFollowed: number; // Number of references followed
  tagsMatched: string[]; // Which tags were found
  typesMatched: string[]; // Which note types were found
  gatherTimeMs: number; // Time taken to gather
}

export interface GatherProgress {
  phase: string;
  current: number;
  total: number | null;
}

/**
 * ContextGatherer is responsible for intelligently gathering relevant notes
 * based on task requirements and context hints. It serves as the primary
 * interface between the task execution system and the note management system.
 */
export class ContextGatherer extends EventEmitter {
  private defaultOptions: GatherOptions = {
    maxDepth: 1,
    deduplicateContent: true,
    sortBy: 'relevance',
  };

  constructor(
    private noteManager: NoteManager,
    private configManager: ConfigManager,
    private referenceManager: ReferenceManager,
  ) {
    super();
  }

  /**
   * Main method to gather context based on hints and options.
   *
   * @param hints - Context hints specifying what notes to gather
   * @param options - Options controlling gathering behavior
   * @returns Gathered context with notes and statistics
   */
  async gatherContext(hints: ContextHints, options?: GatherOptions): Promise<GatheredContext> {
    const startTime = Date.now();
    const opts = { ...this.defaultOptions, ...options };

    this.emit('gather:start', hints);

    try {
      // 1. Gather primary notes
      const primaryNotes = await this.gatherPrimaryNotes(hints, opts);

      // 2. Follow references
      const referencedNotes = await this.followReferences(
        primaryNotes,
        opts.maxDepth !== undefined ? opts.maxDepth : 1,
        new Set(),
        opts,
      );

      // 3. Apply filters and sorting
      const filtered = this.applyFilters(primaryNotes, referencedNotes, opts);

      // 4. Build result
      const context: GatheredContext = {
        contextHintNotes: filtered.primary,
        referencedNotes: filtered.referenced,
        stats: {
          notesSearched: primaryNotes.length + referencedNotes.length,
          notesIncluded: filtered.primary.length + filtered.referenced.length,
          referencesFollowed: referencedNotes.length,
          tagsMatched: this.extractMatchedTags(filtered.primary),
          typesMatched: this.extractMatchedTypes(filtered.primary),
          gatherTimeMs: Math.max(1, Date.now() - startTime), // Ensure at least 1ms
        },
      };

      // 5. Check for slow gathering
      const duration = Date.now() - startTime;
      if (duration > 1000) {
        this.emit('gather:slow', duration);
      }

      this.emit('gather:complete', context);
      return context;
    } catch (error) {
      this.emit('gather:error', error);
      throw error;
    }
  }

  /**
   * Convenience method that gathers context using task's context hints.
   *
   * @param task - Task to gather context for
   * @param options - Additional gathering options
   * @returns Gathered context for the task
   */
  async gatherForTask(task: Task, options?: GatherOptions): Promise<GatheredContext> {
    const mergedHints: ContextHints = task.contextHints || {};

    // 3. Gather context with merged configuration
    const context = await this.gatherContext(mergedHints, options);

    // 4. Track task-context association
    this.emit('task:context', { taskId: task.id, context });

    return context;
  }

  // Private methods

  private async gatherPrimaryNotes(hints: ContextHints, options?: GatherOptions): Promise<Note[]> {
    // Use the unified getNotes API
    const result = await this.noteManager.getNotes({
      searchPatterns: hints.patterns,
      tags: hints.includeTags,
      types: hints.includeTypes,
      excludePatterns: hints.excludePatterns,
      includeArchived: options?.includeArchived,
      includeDeleted: options?.includeDeleted,
    });

    return result.notes;
  }

  private async followReferences(notes: Note[], maxDepth: number, visited: Set<string>, options?: GatherOptions): Promise<Note[]> {
    if (maxDepth <= 0) return [];

    // Extract note IDs from the provided notes
    const noteIds = notes.map((n) => {
      visited.add(n.id);
      return n.id;
    });

    // Use ReferenceManager to follow references
    const referencedIds = await this.referenceManager.followReferences(noteIds, maxDepth, visited);

    // Fetch the actual notes for the referenced IDs
    const referencedNotes: Note[] = [];
    if (referencedIds.length > 0) {
      const result = await this.noteManager.getNotes({
        ids: referencedIds,
        includeArchived: options?.includeArchived,
        includeDeleted: options?.includeDeleted,
      });
      referencedNotes.push(...result.notes);
    }

    // Check if we hit depth limit and have remaining references
    if (maxDepth <= 1 && referencedNotes.length > 0) {
      let remainingRefs = 0;
      for (const note of referencedNotes) {
        if (note.references?.outgoing) {
          remainingRefs += note.references.outgoing.filter((ref) => !visited.has(ref.toId)).length;
        }
      }
      if (remainingRefs > 0) {
        this.emit('references:depth-limit', remainingRefs);
      }
    }

    // Emit progress
    this.emit('progress', {
      phase: 'following-references',
      current: visited.size,
      total: null, // Unknown total
    });

    return referencedNotes;
  }

  private applyFilters(
    primary: Note[],
    referenced: Note[],
    options: GatherOptions,
  ): { primary: Note[]; referenced: Note[] } {
    let filteredPrimary = [...primary];
    let filteredReferenced = [...referenced];

    // 1. Reserved for future filtering (e.g., archived notes)

    // 2. Deduplicate content if requested
    if (options.deduplicateContent) {
      const contentHashes = new Set<string>();

      filteredPrimary = filteredPrimary.filter((note) => {
        const hash = this.hashContent(note.content);
        if (contentHashes.has(hash)) return false;
        contentHashes.add(hash);
        return true;
      });

      filteredReferenced = filteredReferenced.filter((note) => {
        const hash = this.hashContent(note.content);
        if (contentHashes.has(hash)) return false;
        contentHashes.add(hash);
        return true;
      });
    }

    // 3. Apply sorting
    if (options.sortBy) {
      const compareFn = this.getComparator(options.sortBy);
      filteredPrimary.sort(compareFn);
      filteredReferenced.sort(compareFn);
    }

    return { primary: filteredPrimary, referenced: filteredReferenced };
  }

  private hashContent(content: string): string {
    return createHash('md5').update(content).digest('hex');
  }

  private getComparator(sortBy: 'relevance' | 'date' | 'type'): (a: Note, b: Note) => number {
    switch (sortBy) {
      case 'type':
        return (a, b) => a.type.localeCompare(b.type);
      case 'date':
        return (a, b) => b.created.getTime() - a.created.getTime();
      case 'relevance':
        // TODO: Implement relevance scoring
        return () => 0;
      default:
        return () => 0;
    }
  }

  private extractMatchedTags(notes: Note[]): string[] {
    const tags = new Set<string>();
    for (const note of notes) {
      note.tags.forEach((cat) => tags.add(cat));
    }
    return Array.from(tags);
  }

  private extractMatchedTypes(notes: Note[]): string[] {
    const types = new Set<string>();
    for (const note of notes) {
      types.add(note.type);
    }
    return Array.from(types);
  }
}
