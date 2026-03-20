/**
 * Claim thread builder for SCEpter.
 *
 * Builds a tree view of all relationships for a given claim, showing
 * derivation chains (up and down), source implementations, test validations,
 * note references, and verification events.
 *
 * @implements {DD005.§DC.21} Thread view showing all claim relationships
 * @implements {DD005.§DC.22} Configurable depth (default 1, direct relationships)
 * @implements {DD005.§DC.24} JSON-ready tree structure with claim, relationship, file, line, children
 * @implements {DD005.§DC.25} Accept bare note ID to thread all claims in that note
 */

import type { ClaimIndexData, ClaimIndexEntry, ClaimCrossReference } from './claim-index.js';
import type { VerificationStore, VerificationEvent } from './verification-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Relationship types in a claim thread tree. */
export type ClaimThreadRelationship =
  | 'root'
  | 'derives-from'
  | 'derives-into'
  | '@implements'
  | '@validates'
  | 'referenced-by'
  | 'verified';

/**
 * A node in the claim thread tree.
 *
 * @implements {DD005.§DC.24} Tree node with claim, relationship, file, line, children
 */
export interface ClaimThreadNode {
  /** The claim FQID (e.g., "ARCH017.4.AC.18"). */
  claim: string;
  /** The relationship type that connects this node to its parent. */
  relationship: ClaimThreadRelationship;
  /** Claim title/heading, if available. */
  title?: string;
  /** File path, for source/test references. */
  file?: string;
  /** Line number, for source/test references. */
  line?: number;
  /** Verification actor, for verified relationships. */
  actor?: string;
  /** Verification method, for verified relationships. */
  method?: string;
  /** Verification date, for verified relationships. */
  date?: string;
  /** Note ID, for referenced-by relationships. */
  noteId?: string;
  /** Child nodes — further depth levels. */
  children: ClaimThreadNode[];
}

export interface ClaimThreadOptions {
  /** Maximum depth to traverse. Default: 1 (direct relationships only). */
  depth?: number;
}

/**
 * Context object passed to buildClaimThread to avoid repeated parameter passing.
 */
interface ThreadBuildContext {
  data: ClaimIndexData;
  getDerivatives: (claimId: string) => string[];
  verificationStore?: VerificationStore;
  maxDepth: number;
  visited: Set<string>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a claim thread tree for a single claim, showing all relationships
 * up to the configured depth.
 *
 * @implements {DD005.§DC.21} Thread view for a single claim
 * @implements {DD005.§DC.22} Depth-controlled traversal
 */
export function buildClaimThread(
  claimFqid: string,
  data: ClaimIndexData,
  getDerivatives: (claimId: string) => string[],
  options?: ClaimThreadOptions,
  verificationStore?: VerificationStore,
): ClaimThreadNode | null {
  const entry = data.entries.get(claimFqid);
  if (!entry) return null;

  const maxDepth = options?.depth ?? 1;

  const ctx: ThreadBuildContext = {
    data,
    getDerivatives,
    verificationStore,
    maxDepth,
    visited: new Set(),
  };

  return buildNodeAtDepth(entry, 'root', ctx, 0);
}

/**
 * Build claim threads for all claims in a note.
 *
 * @implements {DD005.§DC.25} Bare note ID threads all claims in the note
 */
export function buildClaimThreadsForNote(
  noteId: string,
  data: ClaimIndexData,
  getDerivatives: (claimId: string) => string[],
  options?: ClaimThreadOptions,
  verificationStore?: VerificationStore,
): ClaimThreadNode[] {
  const results: ClaimThreadNode[] = [];

  // Collect all claims for this note, sorted by section path + claim number
  const noteClaims: ClaimIndexEntry[] = [];
  for (const entry of data.entries.values()) {
    if (entry.noteId === noteId) {
      noteClaims.push(entry);
    }
  }

  noteClaims.sort((a, b) => {
    const pathCmp = compareSectionPaths(a.sectionPath, b.sectionPath);
    if (pathCmp !== 0) return pathCmp;
    if (a.claimPrefix !== b.claimPrefix) return a.claimPrefix.localeCompare(b.claimPrefix);
    const numDiff = a.claimNumber - b.claimNumber;
    if (numDiff !== 0) return numDiff;
    return (a.claimSubLetter ?? '').localeCompare(b.claimSubLetter ?? '');
  });

  for (const entry of noteClaims) {
    const node = buildClaimThread(
      entry.fullyQualified,
      data,
      getDerivatives,
      options,
      verificationStore,
    );
    if (node) {
      results.push(node);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Build a thread node for a claim entry at a given depth, collecting
 * all relationship children.
 */
function buildNodeAtDepth(
  entry: ClaimIndexEntry,
  relationship: ClaimThreadRelationship,
  ctx: ThreadBuildContext,
  currentDepth: number,
): ClaimThreadNode {
  const node: ClaimThreadNode = {
    claim: entry.fullyQualified,
    relationship,
    title: entry.heading,
    children: [],
  };

  // Guard against infinite loops in derivation chains
  if (ctx.visited.has(entry.fullyQualified)) {
    return node;
  }
  ctx.visited.add(entry.fullyQualified);

  // At depth 0, only show the claim's own metadata (no relationships)
  if (ctx.maxDepth === 0) {
    return node;
  }

  // --- Derives from (upward) ---
  if (entry.derivedFrom.length > 0) {
    for (const sourceFqid of entry.derivedFrom) {
      const sourceEntry = ctx.data.entries.get(sourceFqid);
      if (sourceEntry) {
        node.children.push({
          claim: sourceFqid,
          relationship: 'derives-from',
          title: sourceEntry.heading,
          children: [],
        });
      } else {
        node.children.push({
          claim: sourceFqid,
          relationship: 'derives-from',
          children: [],
        });
      }
    }
  }

  // --- Derived into (downward) ---
  const derivatives = ctx.getDerivatives(entry.fullyQualified);
  for (const derivFqid of derivatives) {
    const derivEntry = ctx.data.entries.get(derivFqid);
    if (derivEntry) {
      if (currentDepth + 1 < ctx.maxDepth) {
        // Recurse deeper into derivative's relationships
        const childNode = buildNodeAtDepth(derivEntry, 'derives-into', ctx, currentDepth + 1);
        node.children.push(childNode);
      } else {
        // Leaf level — just show the derivative claim info
        node.children.push({
          claim: derivFqid,
          relationship: 'derives-into',
          title: derivEntry.heading,
          children: [],
        });
      }
    } else {
      node.children.push({
        claim: derivFqid,
        relationship: 'derives-into',
        children: [],
      });
    }
  }

  // --- Cross-references: @implements, @validates, referenced-by ---
  const incomingRefs = ctx.data.crossRefs.filter(
    (ref) => ref.toClaim === entry.fullyQualified,
  );

  for (const ref of incomingRefs) {
    const fromType = ctx.data.noteTypes.get(ref.fromNoteId) ?? 'Unknown';

    if (fromType === 'Source') {
      // Determine if it's @implements or @validates based on the file path
      const rel = classifySourceReference(ref);
      node.children.push({
        claim: entry.fullyQualified,
        relationship: rel,
        file: ref.filePath,
        line: ref.line,
        children: [],
      });
    } else {
      // Note reference
      node.children.push({
        claim: entry.fullyQualified,
        relationship: 'referenced-by',
        noteId: ref.fromNoteId,
        file: ref.filePath,
        line: ref.line,
        children: [],
      });
    }
  }

  // --- Verification events ---
  if (ctx.verificationStore) {
    const events = ctx.verificationStore[entry.fullyQualified];
    if (events && events.length > 0) {
      // Show the latest verification event
      const latest = events[events.length - 1];
      node.children.push({
        claim: entry.fullyQualified,
        relationship: 'verified',
        date: latest.date,
        actor: latest.actor,
        method: latest.method,
        children: [],
      });
    }
  }

  return node;
}

/**
 * Classify a source code cross-reference as @implements or @validates
 * based on the file path. Test files are @validates, others are @implements.
 */
function classifySourceReference(ref: ClaimCrossReference): '@implements' | '@validates' {
  const filePath = ref.filePath.toLowerCase();
  // Common test file patterns
  if (
    filePath.includes('.test.') ||
    filePath.includes('.spec.') ||
    filePath.includes('__tests__') ||
    filePath.includes('/test/') ||
    filePath.includes('/tests/')
  ) {
    return '@validates';
  }
  return '@implements';
}

/**
 * Compare two section paths lexicographically by each numeric segment.
 */
function compareSectionPaths(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}
