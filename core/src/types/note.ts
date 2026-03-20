import type { ContextHints } from './context';
import type { Reference } from './reference';

export interface FileLocation {
  path: string;
  line: number;
}

export interface Note {
  id: string; // e.g., 'D001', 'REQ001', 'ARCH001'
  type: string; // e.g., 'Decision', 'Requirement', 'Architecture'
  noteType?: string; // Alternative property name for type (for backward compatibility)
  title: string; // CHANGED: Now required
  content: string;
  tags: string[];
  created: Date;
  modified?: Date; // NEW: Track last modification time
  source?: FileLocation;
  filePath?: string; // File path for the note
  contextHints?: ContextHints;
  references?: {
    outgoing: Reference[]; // References from this note to other notes
    incoming: Reference[]; // References from other notes to this note
  };
  metadata?: NoteMetadata; // NEW: For storing frontmatter data

  // NEW: Folder-based note support fields
  // @implements {E002} - Exploration for folder-based notes feasibility
  // @implements {T003} - Implementation of folder-based notes
  isFolder?: boolean;        // True if note is folder-based
  folderPath?: string;        // Path to folder (if folder-based)
  additionalFiles?: {         // Metadata about additional files
    path: string;             // Relative path within folder
    type: 'markdown' | 'image' | 'data' | 'other';
    size: number;             // File size in bytes
    modified: Date;           // Last modified date
  }[];
}

export interface NoteMetadata {
  id?: string;
  type?: string;
  created?: Date;
  modified?: Date; // NEW: Add to metadata
  filePath?: string;
  status?: string; // NEW: For task status
  priority?: string; // NEW: For task priority
  
  // Archive/Delete metadata
  archivedAt?: Date;
  archiveReason?: string;
  archivePriorStatus?: string;
  deletedAt?: Date;
  deleteReason?: string;
  deletePriorStatus?: string;
  
  [key: string]: any; // Allow arbitrary frontmatter fields
}

// Base note from .md file
export interface BaseNote {
  id: string;
  type: string;
  originalContent: string; // Content from the .md file
  originalTags: string[]; // Tags from the .md file
  contextHints?: ContextHints; // From frontmatter
  filePath: string;
  created: Date;
  modified: Date;
}

// Extensions from mentions
export interface NoteExtensions {
  contentExtensions: string[]; // All {ID: content} extensions
  tagExtensions: string[]; // All additional tags from mentions
  sources: Array<{
    // Where each extension came from
    filePath: string;
    line: number;
  }>;
}

// Computed merge
export interface ExtendedNote extends BaseNote {
  extensions: NoteExtensions;
  mergedContent: string; // originalContent + contentExtensions
  mergedTags: string[]; // originalTags + tagExtensions
}

// Unified Query API types
export interface NoteQuery {
  // Identity filters
  ids?: string[]; // Specific note IDs to include

  // Type filters
  types?: string[]; // Note types to include
  excludeTypes?: string[]; // Note types to exclude

  // Tag filters
  tags?: string[]; // Tags to include (OR)
  excludeTags?: string[]; // Tags to exclude

  // Content filters
  searchPatterns?: string[]; // Content patterns to match (OR)
  excludePatterns?: string[]; // Content patterns to exclude
  titleSearch?: string; // Search only in titles
  searchFields?: ('title' | 'content' | 'all')[]; // Where to search
  contentContains?: string; // Simple text content filter

  // Date filters
  createdAfter?: Date;
  createdBefore?: Date;
  modifiedAfter?: Date;
  modifiedBefore?: Date;

  // Reference filters
  hasIncomingRefs?: boolean; // Has any incoming references
  hasOutgoingRefs?: boolean; // Has any outgoing references
  hasNoRefs?: boolean; // Orphaned (no refs either direction)
  referencedBy?: string[]; // Referenced by specific note IDs
  references?: string[]; // References specific note IDs
  minIncomingRefs?: number; // Minimum incoming reference count
  minOutgoingRefs?: number; // Minimum outgoing reference count

  // Task-specific filters
  statuses?: string[]; // Filter by task status
  
  // Archive/Delete filters
  includeArchived?: boolean; // Include archived notes in results
  includeDeleted?: boolean; // Include deleted notes in results
  onlyArchived?: boolean; // Return only archived notes
  onlyDeleted?: boolean; // Return only deleted notes

  // Result control
  limit?: number; // Maximum results to return
  offset?: number; // Skip first N results
  sortBy?: 'created' | 'modified' | 'type' | 'title' | 'id';
  sortOrder?: 'asc' | 'desc';
  
  // Unified search (for convenience)
  search?: string; // General search term for title/content
}

export interface NoteQueryResult {
  notes: Note[];
  totalCount: number; // Total before limit/offset
  hasMore: boolean; // More results available
}
