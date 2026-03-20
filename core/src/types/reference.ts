export interface Reference {
  fromId: string;      // Source note ID or source:filepath
  toId: string;        // Target note ID
  line?: number;       // Line number where reference appears
  context?: string;    // Optional context around the reference
  modifier?: string;   // Optional modifier (+, >, <, $, *)
  sourceType?: 'note' | 'source';  // Type of reference
  tags?: string[];     // Optional tags from reference format {ID#tag1,tag2}
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