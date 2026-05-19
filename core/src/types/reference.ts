export interface Reference {
  fromId: string;      // Source note ID or source:filepath
  toId: string;        // Target note ID
  line?: number;       // Line number where reference appears
  context?: string;    // Optional context around the reference
  modifier?: string;   // Optional modifier (+, >, <, $, *)
  sourceType?: 'note' | 'source';  // Type of reference
  tags?: string[];     // Optional tags from reference format {ID#tag1,tag2}
  /**
   * True when this edge's target is a deletion-marker token (e.g.,
   * `_deleted_R005_at_20260519`). Tombstoned edges are stored in the
   * graph as a distinct edge type so consumers can enumerate them
   * separately from live edges. A tombstoned edge does NOT resolve to
   * a live note when traversed; it records that the target was once a
   * live note and has since been hard-deleted.
   *
   * @implements {DD020.§5.DC.08} reference graph records tombstoned edges as a distinct edge type
   */
  isTombstoned?: boolean;
}

export interface SourceReference extends Reference {
  sourceType: 'source';
  filePath: string;
  language: Language;
  referenceType: SourceReferenceType;
  claimPath?: string; // Claim-level address suffix (e.g., '.§3.AC.01')
}

export type SourceReferenceType = 
  | 'implements'     // @implements {D001}
  | 'depends-on'     // @depends-on {R001}  
  | 'addresses'      // @addresses {Q001}
  | 'validates'      // @validates {R001}
  | 'blocked-by'     // @blocked-by {T001}
  | 'see'           // @see {D001}
  | 'mentions';      // Generic {D001} reference

export type Language = 
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'unknown';

export interface ReferenceGraph {
  // Outgoing references: noteId -> array of references from this note
  outgoing: Map<string, Reference[]>;
  
  // Incoming references: noteId -> array of references to this note  
  incoming: Map<string, Reference[]>;
}

export interface ReferenceCounts {
  notes: number;
  source: number;
  total: number;
}

/** Parsed claim reference address — full type in parsers/claim/claim-parser.ts */
export interface ClaimAddress {
  noteId?: string;
  sectionPath?: number[];
  claimPrefix?: string;
  claimNumber?: number;
  claimSubLetter?: string;
  metadata?: string[];
  raw: string;
}

/** Extension of Reference that can carry claim-level address info */
export interface ClaimLevelReference extends Reference {
  /** Parsed claim address when the reference targets a sub-note claim */
  claimAddress?: ClaimAddress;
}