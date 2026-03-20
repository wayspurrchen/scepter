import type { SourceReference } from '../types/reference';

export interface IndexStats {
  totalFiles: number;
  totalNotes: number;
  totalReferences: number;
}

/**
 * Maintains bidirectional index of source code references to notes.
 *
 * Responsibilities:
 * - Store source->note and note->source mappings
 * - Provide efficient lookups in both directions
 * - Track metadata about each reference
 * - Support reference updates and removals
 */
export class SourceReferenceIndex {
  // File -> Set of note IDs referenced in that file
  private fileToNotes: Map<string, Set<string>>;

  // Note ID -> Set of files that reference it
  private noteToFiles: Map<string, Set<string>>;

  // Detailed reference storage: "file:line" -> SourceReference
  private references: Map<string, SourceReference>;

  // Statistics
  private stats: IndexStats;

  constructor() {
    this.fileToNotes = new Map();
    this.noteToFiles = new Map();
    this.references = new Map();
    this.stats = {
      totalFiles: 0,
      totalNotes: 0,
      totalReferences: 0,
    };
  }

  /**
   * Add a source reference to the index
   *
   * Side effects:
   * - Updates all internal maps
   * - Updates statistics
   */
  addReference(ref: SourceReference): void {
    const key = `${ref.filePath}:${ref.line}`;

    // Check if replacing existing reference
    const existing = this.references.get(key);
    if (existing) {
      this.removeReference(existing);
    }

    // Add to detailed references
    this.references.set(key, ref);

    // Update file->notes mapping
    if (!this.fileToNotes.has(ref.filePath)) {
      this.fileToNotes.set(ref.filePath, new Set());
      this.stats.totalFiles++;
    }
    this.fileToNotes.get(ref.filePath)!.add(ref.toId);

    // Update note->files mapping
    if (!this.noteToFiles.has(ref.toId)) {
      this.noteToFiles.set(ref.toId, new Set());
      this.stats.totalNotes++;
    }
    this.noteToFiles.get(ref.toId)!.add(ref.filePath);

    this.stats.totalReferences++;
  }

  /**
   * Remove a source reference from the index
   */
  removeReference(ref: SourceReference): void {
    const key = `${ref.filePath}:${ref.line}`;

    if (!this.references.has(key)) return;

    this.references.delete(key);
    this.stats.totalReferences--;

    // Update mappings
    const fileNotes = this.fileToNotes.get(ref.filePath);
    if (fileNotes) {
      fileNotes.delete(ref.toId);
      if (fileNotes.size === 0) {
        this.fileToNotes.delete(ref.filePath);
        this.stats.totalFiles--;
      }
    }

    const noteFiles = this.noteToFiles.get(ref.toId);
    if (noteFiles) {
      noteFiles.delete(ref.filePath);
      if (noteFiles.size === 0) {
        this.noteToFiles.delete(ref.toId);
        this.stats.totalNotes--;
      }
    }
  }

  /**
   * Get all references to a specific note
   * @returns References sorted by file path and line number
   */
  getReferencesToNote(noteId: string): SourceReference[] {
    const files = this.noteToFiles.get(noteId);
    if (!files) return [];

    const refs: SourceReference[] = [];

    for (const file of files) {
      for (const [key, ref] of this.references) {
        if (ref.filePath === file && ref.toId === noteId) {
          refs.push(ref);
        }
      }
    }

    return refs.sort((a, b) => {
      const fileCompare = a.filePath.localeCompare(b.filePath);
      return fileCompare !== 0 ? fileCompare : (a?.line ?? 0) - (b?.line ?? 0);
    });
  }

  /**
   * Get all references from a specific file
   * @returns References sorted by line number
   */
  getReferencesFromFile(filePath: string): SourceReference[] {
    const notes = this.fileToNotes.get(filePath);
    if (!notes) return [];

    const refs: SourceReference[] = [];

    for (const [key, ref] of this.references) {
      if (ref.filePath === filePath) {
        refs.push(ref);
      }
    }

    return refs.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  }

  /**
   * Remove all references from a file
   * Used when a file is deleted or needs full rescan
   */
  removeFileReferences(filePath: string): void {
    const refs = this.getReferencesFromFile(filePath);
    for (const ref of refs) {
      this.removeReference(ref);
    }
  }

  /**
   * Get statistics about the index
   */
  getStats(): Readonly<IndexStats> {
    return { ...this.stats };
  }

  /**
   * Clear all data from the index
   */
  clear(): void {
    this.fileToNotes.clear();
    this.noteToFiles.clear();
    this.references.clear();
    this.stats = {
      totalFiles: 0,
      totalNotes: 0,
      totalReferences: 0,
    };
  }

  /**
   * Check if a note has any source references
   */
  hasSourceReferences(noteId: string): boolean {
    return this.noteToFiles.has(noteId);
  }

  /**
   * Get count of source references for a note
   */
  getSourceReferenceCount(noteId: string): number {
    const files = this.noteToFiles.get(noteId);
    if (!files) return 0;

    let count = 0;
    for (const [_, ref] of this.references) {
      if (ref.toId === noteId) count++;
    }
    return count;
  }

  /**
   * Get all references (for validation or export)
   */
  getAllReferences(): SourceReference[] {
    return Array.from(this.references.values());
  }

  /**
   * Get all file paths that have been indexed
   */
  getIndexedFiles(): string[] {
    return Array.from(this.fileToNotes.keys());
  }

  /**
   * Get all note IDs that have source references
   */
  getIndexedNoteIds(): string[] {
    return Array.from(this.noteToFiles.keys());
  }
}
