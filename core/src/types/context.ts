// Unified context types for SCEpter

import type { ExtendedNote } from './note';

/**
 * Context hints provide heuristic patterns for gathering additional context.
 * These are non-concrete suggestions that help the context CLI search for
 * related notes and information.
 */
export interface ContextHints {
  /** Search patterns to find related content */
  patterns?: string[];

  /** Tags to include when gathering context */
  includeTags?: string[];

  /** Note type keys to include (e.g., 'Requirement', 'Decision') */
  includeTypes?: string[];

  /** Patterns to exclude from context gathering */
  excludePatterns?: string[];
}

/**
 * Metadata tracking how a note was discovered during context gathering
 */
export interface DiscoveryMetadata {
  /** How the note was found */
  source: 'mention' | 'pattern' | 'tag' | 'type' | 'reference';

  /** Inclusion modifiers from the mention (only present for 'mention' source) */
  inclusionModifiers?: {
    content: boolean; // + modifier
    outgoingReferences: boolean; // > modifier
    incomingReferences: boolean; // < modifier
    contextHints: boolean; // $ modifier
    everything: boolean; // * modifier
  };

  /** The note ID that led to this discovery (for reference following) */
  via?: string;

  /** Direction of the reference (only present for 'reference' source) */
  direction?: 'incoming' | 'outgoing' | 'bidirectional';
}

/**
 * A note gathered with its discovery metadata
 */
export interface GatheredNote {
  /** The full note with extensions */
  note: ExtendedNote;

  /** How this note was discovered */
  discovery: DiscoveryMetadata;

  /** How many hops from the origin */
  depth: number;
}
