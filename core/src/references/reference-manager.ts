import type { Reference, ReferenceGraph, ReferenceCounts } from '../types/reference';
import type { SourceReferenceIndex } from './source-reference-index';

/**
 * Manages the reference graph between notes, providing efficient
 * querying and traversal of note relationships.
 */
export class ReferenceManager {
  private graph: ReferenceGraph = {
    outgoing: new Map(),
    incoming: new Map()
  };
  private sourceIndex?: SourceReferenceIndex;

  /**
   * Add a reference between two notes
   */
  addReference(ref: Reference): void {
    // Add to outgoing
    const outgoing = this.graph.outgoing.get(ref.fromId) || [];
    outgoing.push(ref);
    this.graph.outgoing.set(ref.fromId, outgoing);

    // Add to incoming
    const incoming = this.graph.incoming.get(ref.toId) || [];
    incoming.push(ref);
    this.graph.incoming.set(ref.toId, incoming);
  }

  /**
   * Get all references from a note
   */
  getReferencesFrom(noteId: string): Reference[] {
    return this.graph.outgoing.get(noteId) || [];
  }

  /**
   * Set the source reference index for unified queries
   */
  setSourceIndex(index: SourceReferenceIndex): void {
    this.sourceIndex = index;
  }

  /**
   * Get all references to a note (both note and source references)
   * @param noteId - The note ID to get references for
   * @param includeSource - Include source code references (default: true)
   */
  getReferencesTo(noteId: string, includeSource: boolean = true): Reference[] {
    const noteRefs = this.graph.incoming.get(noteId) || [];
    
    if (!includeSource || !this.sourceIndex) {
      return noteRefs;
    }
    
    const sourceRefs = this.sourceIndex.getReferencesToNote(noteId);
    return [...noteRefs, ...sourceRefs];
  }

  /**
   * Get all referenced note IDs from a note
   */
  getReferencedNoteIds(noteId: string): string[] {
    const refs = this.getReferencesFrom(noteId);
    return [...new Set(refs.map(r => r.toId))];
  }

  /**
   * Follow references to a specified depth
   */
  async followReferences(
    noteIds: string[],
    maxDepth: number = 1,
    visited: Set<string> = new Set()
  ): Promise<string[]> {
    if (maxDepth <= 0) return [];

    const result: string[] = [];
    const toFollow: string[] = [];

    // Mark current notes as visited and collect their references
    for (const noteId of noteIds) {
      visited.add(noteId);
      const refs = this.getReferencedNoteIds(noteId);
      for (const ref of refs) {
        if (!visited.has(ref)) {
          toFollow.push(ref);
        }
      }
    }

    // Add unvisited references to result
    for (const noteId of toFollow) {
      if (!visited.has(noteId)) {
        result.push(noteId);
        visited.add(noteId);
      }
    }

    // Recursively follow deeper references
    if (result.length > 0 && maxDepth > 1) {
      const deeperRefs = await this.followReferences(
        result,
        maxDepth - 1,
        visited
      );
      result.push(...deeperRefs);
    }

    return result;
  }

  /**
   * Validate all references point to existing notes
   */
  async validateReferences(noteIds: Set<string>): Promise<{
    valid: boolean;
    broken: Reference[];
  }> {
    const broken: Reference[] = [];
    
    for (const [fromId, refs] of this.graph.outgoing) {
      for (const ref of refs) {
        if (!noteIds.has(ref.toId)) {
          broken.push(ref);
        }
      }
    }

    return {
      valid: broken.length === 0,
      broken
    };
  }

  /**
   * Get reference counts for a note
   */
  getReferenceCounts(noteId: string): ReferenceCounts {
    const noteRefs = this.graph.incoming.get(noteId) || [];
    const sourceCount = this.sourceIndex?.getSourceReferenceCount(noteId) || 0;
    
    return {
      notes: noteRefs.length,
      source: sourceCount,
      total: noteRefs.length + sourceCount
    };
  }

  /**
   * Check if a note has any references
   */
  hasReferences(noteId: string, includeSource: boolean = true): boolean {
    const hasNoteRefs = (this.graph.incoming.get(noteId) || []).length > 0;
    
    if (!includeSource || !this.sourceIndex) {
      return hasNoteRefs;
    }
    
    return hasNoteRefs || this.sourceIndex.hasSourceReferences(noteId);
  }

  /**
   * Remove only outgoing references from a note
   */
  removeOutgoingReferences(noteId: string): void {
    // Remove from outgoing map
    this.graph.outgoing.delete(noteId);
    
    // Remove from incoming entries where this note is the source
    for (const [targetId, refs] of this.graph.incoming) {
      const filtered = refs.filter(r => r.fromId !== noteId);
      if (filtered.length > 0) {
        this.graph.incoming.set(targetId, filtered);
      } else {
        this.graph.incoming.delete(targetId);
      }
    }
  }

  /**
   * Remove all references from/to a note
   */
  removeNote(noteId: string): void {
    // Remove outgoing references
    this.graph.outgoing.delete(noteId);

    // Remove incoming references  
    for (const [id, refs] of this.graph.outgoing) {
      const filtered = refs.filter(r => r.toId !== noteId);
      if (filtered.length > 0) {
        this.graph.outgoing.set(id, filtered);
      } else {
        this.graph.outgoing.delete(id);
      }
    }

    // Update incoming graph
    this.graph.incoming.delete(noteId);
    for (const [id, refs] of this.graph.incoming) {
      const filtered = refs.filter(r => r.fromId !== noteId);
      if (filtered.length > 0) {
        this.graph.incoming.set(id, filtered);
      } else {
        this.graph.incoming.delete(id);
      }
    }
  }

  /**
   * Export reference graph for visualization
   */
  exportGraph(): {
    nodes: string[];
    edges: Array<{ from: string; to: string }>;
  } {
    const nodes = new Set<string>();
    const edges: Array<{ from: string; to: string }> = [];

    for (const [fromId, refs] of this.graph.outgoing) {
      nodes.add(fromId);
      for (const ref of refs) {
        nodes.add(ref.toId);
        edges.push({
          from: ref.fromId,
          to: ref.toId
        });
      }
    }

    return {
      nodes: Array.from(nodes),
      edges
    };
  }

  /**
   * Update references to a deleted note by adding #deleted tag
   * This is used when a note is deleted to mark all references to it
   * 
   * @param noteId - The ID of the note being deleted
   * @returns Information about updated references
   */
  async updateReferencesForDeletion(noteId: string): Promise<{
    updatedFiles: Map<string, {
      originalContent: string;
      updatedContent: string;
      references: Array<{
        line: number;
        originalText: string;
        updatedText: string;
      }>;
    }>;
    totalUpdated: number;
  }> {
    const updatedFiles = new Map<string, {
      originalContent: string;
      updatedContent: string;
      references: Array<{
        line: number;
        originalText: string;
        updatedText: string;
      }>;
    }>();
    let totalUpdated = 0;

    // Get all incoming references to this note (from other notes)
    const incomingRefs = this.graph.incoming.get(noteId) || [];
    
    // Group references by source file/note
    const refsBySource = new Map<string, Reference[]>();
    for (const ref of incomingRefs) {
      if (ref.sourceType !== 'source') { // Only handle note references
        const existing = refsBySource.get(ref.fromId) || [];
        existing.push(ref);
        refsBySource.set(ref.fromId, existing);
      }
    }

    // For each source, update the references
    for (const [sourceId, refs] of refsBySource) {
      // This would need to be implemented with actual file reading/writing
      // For now, we'll return the structure that would be used
      const fileInfo = {
        originalContent: '', // Would be read from file
        updatedContent: '',  // Would be the updated content
        references: refs.map(ref => ({
          line: ref.line || 0,
          originalText: `{${noteId}}`,  // Would detect actual format
          updatedText: `{${noteId}#deleted}` // Add #deleted tag
        }))
      };
      
      updatedFiles.set(sourceId, fileInfo);
      totalUpdated += refs.length;
    }

    return { updatedFiles, totalUpdated };
  }

  /**
   * Update references to a restored note by removing #deleted tag
   * This is used when a deleted note is restored
   * 
   * @param noteId - The ID of the note being restored
   * @returns Information about updated references
   */
  async updateReferencesForRestore(noteId: string): Promise<{
    updatedFiles: Map<string, {
      originalContent: string;
      updatedContent: string;
      references: Array<{
        line: number;
        originalText: string;
        updatedText: string;
      }>;
    }>;
    totalUpdated: number;
  }> {
    const updatedFiles = new Map<string, {
      originalContent: string;
      updatedContent: string;
      references: Array<{
        line: number;
        originalText: string;
        updatedText: string;
      }>;
    }>();
    let totalUpdated = 0;

    // Get all incoming references to this note
    const incomingRefs = this.graph.incoming.get(noteId) || [];
    
    // Group references by source
    const refsBySource = new Map<string, Reference[]>();
    for (const ref of incomingRefs) {
      if (ref.sourceType !== 'source') { // Only handle note references
        const existing = refsBySource.get(ref.fromId) || [];
        existing.push(ref);
        refsBySource.set(ref.fromId, existing);
      }
    }

    // For each source, update the references
    for (const [sourceId, refs] of refsBySource) {
      const fileInfo = {
        originalContent: '', // Would be read from file
        updatedContent: '',  // Would be the updated content
        references: refs.map(ref => ({
          line: ref.line || 0,
          originalText: '', // Would detect actual format with #deleted
          updatedText: ''   // Remove #deleted tag
        }))
      };
      
      // Note: In actual implementation, this would:
      // 1. Read the file content
      // 2. Find references matching patterns like:
      //    - {noteId#deleted}
      //    - {noteId#tag1,deleted,tag2}
      //    - {noteId+>#deleted}
      // 3. Remove the #deleted tag while preserving other tags
      // 4. Update the content
      
      updatedFiles.set(sourceId, fileInfo);
      totalUpdated += refs.length;
    }

    return { updatedFiles, totalUpdated };
  }

  /**
   * Find all references that have a specific tag
   * This can be used to find all references marked with #deleted
   * 
   * @param tag - The tag to search for (without the # prefix)
   * @returns Array of references with the specified tag
   */
  findReferencesWithTag(tag: string): Reference[] {
    const referencesWithTag: Reference[] = [];
    
    // This would need to be implemented with actual parsing
    // For now, return empty array as placeholder
    // In actual implementation:
    // 1. Iterate through all references
    // 2. Parse the reference format to extract tags
    // 3. Check if the specified tag is present
    // 4. Collect matching references
    
    return referencesWithTag;
  }
}