/**
 * Status Mapping Resolver Module
 * ===============================
 * 
 * This module provides a flexible, hierarchical system for mapping note statuses
 * to visual indicators (emojis and colors). It supports both direct mappings and
 * aliases, with a three-tier priority system.
 * 
 * ## Core Concepts
 * 
 * 1. **Status Mapping**: An object containing an emoji and/or color for a status
 * 2. **Alias**: A string that points to another status (enabling status synonyms)
 * 3. **Priority Hierarchy**: Note-type specific > Global > Default mappings
 * 
 * ## How It Works
 * 
 * The resolver follows a three-tier priority system:
 * 
 * 1. **Note-Type Specific**: Mappings defined for a specific note type (e.g., Task)
 * 2. **Global**: Mappings defined at the project level in scepter.config.json
 * 3. **Default**: Built-in mappings provided by this module
 * 
 * When resolving a status, the system checks each tier in order and returns the
 * first matching mapping found. This allows for progressive customization.
 * 
 * ## Alias Resolution
 * 
 * Aliases are strings that point to other statuses. They can chain multiple levels:
 * - "done" → "completed" → { emoji: "✅", color: "green" }
 * - "wip" → "in-progress" → { emoji: "🟡", color: "yellow" }
 * 
 * The resolver protects against circular references and will warn if detected.
 * 
 * ## Usage Examples
 * 
 * ```typescript
 * // Basic usage - resolve with defaults
 * const resolver = new StatusMappingResolver(config);
 * const mapping = resolver.resolve('pending');
 * // Returns: { emoji: '🔵', color: 'blue' }
 * 
 * // Note-type specific resolution
 * const taskMapping = resolver.resolve('pending', 'Task');
 * // Returns Task-specific mapping if defined, otherwise falls back
 * 
 * // Get all available mappings for a note type
 * const allMappings = resolver.getAllMappings('Decision');
 * // Returns all resolved mappings including aliases
 * ```
 * 
 * ## Configuration Example
 * 
 * ```json
 * {
 *   "statusMappings": {
 *     "draft": { "emoji": "📝", "color": "gray" },
 *     "wip": "in-progress"  // Global alias
 *   },
 *   "noteTypes": {
 *     "Task": {
 *       "statusMappings": {
 *         "backlog": { "emoji": "📚", "color": "gray" },
 *         "todo": "backlog"  // Type-specific alias
 *       }
 *     }
 *   }
 * }
 * ```
 */

import type { StatusMapping, SCEpterConfig } from '../types/config';

/**
 * Default status mappings provided by SCEpter
 * 
 * This constant defines the built-in status mappings that are available
 * to all projects. It includes both direct mappings (objects with emoji
 * and color) and aliases (strings pointing to other statuses).
 * 
 * Projects can override these defaults through configuration, but they
 * serve as a sensible starting point for common status workflows.
 */
export const DEFAULT_STATUS_MAPPINGS: Record<string, StatusMapping | string> = {
  // Core status mappings (objects)
  pending: {
    emoji: '🔵',
    color: 'blue',
  },
  'in-progress': {
    emoji: '🟡',
    color: 'yellow',
  },
  completed: {
    emoji: '✅',
    color: 'green',
  },
  blocked: {
    emoji: '🔴',
    color: 'red',
  },
  cancelled: {
    emoji: '❌',
    color: 'gray',
  },
  deferred: {
    emoji: '⏸️',
    color: 'gray',
  },
  review: {
    emoji: '👀',
    color: 'purple',
  },
  approved: {
    emoji: '👍',
    color: 'green',
  },
  rejected: {
    emoji: '👎',
    color: 'red',
  },
  draft: {
    emoji: '📝',
    color: 'gray',
  },
  published: {
    emoji: '📢',
    color: 'blue',
  },
  archived: {
    emoji: '📦',
    color: 'gray',
  },

  // Common aliases (strings pointing to other statuses)
  done: 'completed',
  in_progress: 'in-progress',
  todo: 'pending',
  wip: 'in-progress',
  canceled: 'cancelled',
  paused: 'deferred',
  reviewing: 'review',
  ok: 'approved',
  nok: 'rejected',
  'not-started': 'pending',
  finished: 'completed',
};

/**
 * StatusMappingResolver Class
 * 
 * This class handles the resolution of status strings to their visual representations
 * (emoji and color). It implements a caching mechanism for performance and supports
 * complex alias chains while protecting against circular references.
 * 
 * ## Key Features
 * 
 * - **Hierarchical Resolution**: Checks note-type, global, then default mappings
 * - **Alias Support**: Resolves chains of aliases (e.g., "done" → "completed")
 * - **Circular Reference Protection**: Detects and prevents infinite loops
 * - **Type Safety**: Fully typed with TypeScript for reliable integration
 * 
 * ## Integration with CLI Formatters
 * 
 * CLI formatters should create a single instance of this resolver and use it
 * to look up status mappings when rendering notes:
 * 
 * ```typescript
 * // In a formatter
 * const resolver = new StatusMappingResolver(config);
 * 
 * function formatNoteTitle(note: Note): string {
 *   const mapping = resolver.resolve(note.metadata?.status, note.type);
 *   if (mapping?.emoji) {
 *     return `${mapping.emoji} ${note.title}`;
 *   }
 *   return note.title;
 * }
 * ```
 */
export class StatusMappingResolver {
  /**
   * The SCEpter configuration containing global and note-type specific mappings
   */
  private config: SCEpterConfig;

  constructor(config: SCEpterConfig) {
    this.config = config;
  }

  /**
   * Resolve a status mapping with priority: note-type specific > global > default
   * 
   * This method is the primary interface for resolving status strings to their
   * visual representations. It checks mappings in the following order:
   * 
   * 1. Note-type specific mappings (if noteType is provided)
   * 2. Global mappings from the SCEpter configuration
   * 3. Default mappings built into this module
   * 
   * The method handles alias resolution automatically, following chains of
   * string references until it finds a StatusMapping object or determines
   * that no mapping exists.
   * 
   * @param status The status string to resolve (e.g., "pending", "done", "in-progress")
   * @param noteType Optional note type for type-specific lookups (e.g., "Task", "Decision")
   * @returns The resolved StatusMapping with emoji/color, or null if no mapping exists
   * 
   * @example
   * // Simple resolution with defaults
   * resolver.resolve('pending') // → { emoji: '🔵', color: 'blue' }
   * 
   * // Note-type specific resolution
   * resolver.resolve('backlog', 'Task') // → { emoji: '📚', color: 'gray' }
   * 
   * // Alias resolution
   * resolver.resolve('done') // → { emoji: '✅', color: 'green' }
   */
  resolve(status: string, noteType?: string): StatusMapping | null {
    // Try to resolve with circular reference protection
    const visited = new Set<string>();
    return this.resolveWithPriority(status, noteType, visited);
  }

  /**
   * Internal method that implements the priority-based resolution logic
   * 
   * This method is called recursively when resolving aliases, using the visited
   * set to detect circular references. It checks each mapping source in priority
   * order and returns the first match found.
   * 
   * @private
   */
  private resolveWithPriority(
    status: string,
    noteType: string | undefined,
    visited: Set<string>,
  ): StatusMapping | null {
    // Check for circular references
    if (visited.has(status)) {
      console.warn(`Circular reference detected in status mapping: ${status}`);
      return null;
    }
    visited.add(status);

    // Priority 1: Note-type specific mappings
    if (noteType && this.config.noteTypes?.[noteType]?.statusMappings) {
      const noteTypeMapping = this.resolveFromMappings(
        status,
        this.config.noteTypes[noteType].statusMappings!,
        visited,
        noteType,
      );
      if (noteTypeMapping) return noteTypeMapping;
    }

    // Priority 2: Global mappings
    if (this.config.statusMappings) {
      const globalMapping = this.resolveFromMappings(status, this.config.statusMappings, visited, noteType);
      if (globalMapping) return globalMapping;
    }

    // Priority 3: Default mappings
    return this.resolveFromMappings(status, DEFAULT_STATUS_MAPPINGS, visited, noteType);
  }

  /**
   * Resolve a status from a specific mapping source
   * 
   * This method handles both direct mappings (StatusMapping objects) and
   * aliases (strings). When it encounters an alias, it recursively calls
   * resolveWithPriority to check all mapping sources for the target status.
   * 
   * @private
   */
  private resolveFromMappings(
    status: string,
    mappings: Record<string, StatusMapping | string>,
    visited: Set<string>,
    noteType?: string,
  ): StatusMapping | null {
    const mapping = mappings[status];

    if (!mapping) {
      return null;
    }

    // If it's a StatusMapping object, return it
    if (typeof mapping === 'object' && 'emoji' in mapping) {
      return mapping;
    }

    // If it's a string alias, resolve it recursively
    if (typeof mapping === 'string') {
      // Try all mapping sources in priority order
      return this.resolveWithPriority(mapping, noteType, visited);
    }

    return null;
  }

  /**
   * Get all available status mappings for a note type
   * 
   * This method returns a complete dictionary of all resolved status mappings
   * available for a given note type. It merges mappings from all three sources
   * (note-type specific, global, and default) and resolves all aliases to their
   * final StatusMapping objects.
   * 
   * This is useful for:
   * - Displaying available statuses in UI
   * - Generating documentation
   * - Validating status values
   * 
   * @param noteType Optional note type to include type-specific mappings
   * @returns Dictionary of status names to their resolved StatusMapping objects
   * 
   * @example
   * // Get all mappings including Task-specific ones
   * const taskMappings = resolver.getAllMappings('Task');
   * // Returns: {
   * //   'pending': { emoji: '🔵', color: 'blue' },
   * //   'backlog': { emoji: '📚', color: 'gray' },
   * //   'done': { emoji: '✅', color: 'green' },
   * //   ... all other mappings ...
   * // }
   */
  getAllMappings(noteType?: string): Record<string, StatusMapping> {
    const result: Record<string, StatusMapping> = {};
    const allKeys = new Set<string>();

    // Collect all keys from all sources
    Object.keys(DEFAULT_STATUS_MAPPINGS).forEach((key) => allKeys.add(key));
    if (this.config.statusMappings) {
      Object.keys(this.config.statusMappings).forEach((key) => allKeys.add(key));
    }
    if (noteType && this.config.noteTypes?.[noteType]?.statusMappings) {
      Object.keys(this.config.noteTypes[noteType].statusMappings!).forEach((key) => allKeys.add(key));
    }

    // Resolve each key
    for (const key of allKeys) {
      const resolved = this.resolve(key, noteType);
      if (resolved) {
        result[key] = resolved;
      }
    }

    return result;
  }
}
