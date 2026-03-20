/**
 * Claim Index for SCEpter.
 *
 * Builds and maintains an in-memory index of all claims across notes,
 * providing fast lookup by fully qualified claim ID, note ID, and
 * cross-reference traversal.
 *
 * @implements {R004.§4.AC.01} Index built from scanning all project notes (ClaimIndex.build)
 * @implements {R004.§4.AC.02} Cross-references between claims tracked (Phase 2 in build)
 * @implements {R004.§4.AC.03} Validation errors collected during build
 * @implements {R004.§8.AC.01} Metadata stored per claim in index (metadata field in ClaimIndexEntry)
 */

import * as path from 'path';
import {
  buildClaimTree,
  validateClaimTree,
  parseClaimReferences,
} from '../parsers/claim/index.js';
import type {
  ClaimNode,
  ClaimTreeResult,
  ClaimTreeError,
  ClaimParseOptions,
} from '../parsers/claim/index.js';
import { parseNoteId } from '../parsers/note/shared-note-utils.js';
import type { SourceReference } from '../types/reference.js';
import { parseClaimMetadata } from './claim-metadata.js';
import type { LifecycleState } from './claim-metadata.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface NoteWithContent {
  id: string;
  type: string;
  filePath: string;
  content: string;
}

/**
 * @implements {R005.§1.AC.01} importance field from inline importance parsing
 * @implements {R005.§2.AC.01} lifecycle field from lifecycle tag parsing
 * @implements {R006.§2.AC.01} derivedFrom field from derives=TARGET metadata
 */
export interface ClaimIndexEntry {
  noteId: string;
  claimId: string;           // e.g., "AC.01"
  fullyQualified: string;    // e.g., "R004.3.AC.01"
  sectionPath: number[];     // e.g., [3]
  claimPrefix: string;       // e.g., "AC"
  claimNumber: number;       // e.g., 1
  claimSubLetter?: string;   // e.g., "a" for AC.01a
  heading: string;           // full heading text
  line: number;
  endLine: number;
  metadata: string[];        // raw from colon-suffix (unchanged)
  importance?: number;       // interpreted: digit 1-5
  lifecycle?: LifecycleState; // interpreted: lifecycle tag
  parsedTags: string[];      // interpreted: freeform tags
  derivedFrom: string[];     // resolved FQIDs from derives=TARGET metadata
  noteType: string;          // e.g., "Requirement"
  noteFilePath: string;
}

export interface ClaimCrossReference {
  fromClaim: string;         // fully qualified source claim
  toClaim: string;           // fully qualified target claim
  fromNoteId: string;
  toNoteId: string;
  line: number;
  filePath: string;
  unresolved?: boolean;      // true when the target claim could not be resolved in the index
}

export interface ClaimIndexData {
  entries: Map<string, ClaimIndexEntry>;  // keyed by fullyQualified
  trees: Map<string, ClaimNode[]>;        // keyed by noteId
  noteTypes: Map<string, string>;         // noteId -> noteType for ALL scanned notes
  crossRefs: ClaimCrossReference[];
  errors: ClaimTreeError[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the section path from a ClaimNode's id.
 *
 * The claim tree builder produces IDs like:
 *   "1.AC.01"     -> section path [1]
 *   "3.1.AC.02"   -> section path [3, 1]
 *   "AC.01"       -> section path []
 *
 * We split on '.', consume leading numeric segments as section path,
 * then the rest is PREFIX.NN.
 */
function extractSectionPath(claimNodeId: string): number[] {
  const parts = claimNodeId.split('.');
  const sectionPath: number[] = [];

  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      sectionPath.push(parseInt(part, 10));
    } else {
      // Hit the claim prefix — stop
      break;
    }
  }

  return sectionPath;
}

/**
 * Build the fully qualified claim ID from a note ID and a claim node.
 *
 * Format: {noteId}.{sectionPath joined with dots}.{claimPrefix}.{paddedNumber}
 * e.g., R004.3.AC.01
 */
function buildFullyQualified(noteId: string, node: ClaimNode): string {
  const sectionPath = extractSectionPath(node.id);
  const numStr = String(node.claimNumber).padStart(2, '0');
  const subLetter = node.id.match(/[a-z]$/)?.[0] ?? '';

  const segments: string[] = [noteId];
  if (sectionPath.length > 0) {
    segments.push(...sectionPath.map(String));
  }
  segments.push(`${node.claimPrefix}.${numStr}${subLetter}`);

  return segments.join('.');
}

/**
 * Recursively walk a ClaimNode tree and collect all claim-type nodes.
 */
function collectClaims(nodes: ClaimNode[], collected: ClaimNode[]): void {
  for (const node of nodes) {
    if (node.type === 'claim') {
      collected.push(node);
    }
    if (node.children.length > 0) {
      collectClaims(node.children, collected);
    }
  }
}

/**
 * Derive the set of known shortcodes from an array of note IDs.
 */
function deriveKnownShortcodes(noteIds: string[]): Set<string> {
  const shortcodes = new Set<string>();
  for (const noteId of noteIds) {
    const parsed = parseNoteId(noteId);
    if (parsed) {
      shortcodes.add(parsed.shortcode);
    }
  }
  return shortcodes;
}

/**
 * Resolve a claim address to a fully qualified ID in the index.
 *
 * The address may be partial (e.g. just "AC.01") or fully qualified
 * (e.g. "R004.3.AC.01"). We try exact match first, then fall back
 * to searching entries that end with the partial pattern.
 */
function resolveClaimAddress(
  raw: string,
  entries: Map<string, ClaimIndexEntry>,
  currentNoteId: string,
): string | null {
  // Exact match on fully qualified
  if (entries.has(raw)) {
    return raw;
  }

  // Try prefixing with current note ID
  const withCurrentNote = `${currentNoteId}.${raw}`;
  if (entries.has(withCurrentNote)) {
    return withCurrentNote;
  }

  // Fuzzy: find entries ending with the raw pattern, scoped to current note only.
  // Bare references like "AC.01" should resolve to the current note's own claims
  // (e.g., "ARCH018.1.AC.01"), not to claims from unrelated notes. Cross-note
  // references must include an explicit note ID (handled by exact match above).
  // @implements {R004.§4.AC.05} Fuzzy matching requires claim prefix pattern
  // Guard: only attempt fuzzy matching when raw contains a claim prefix pattern
  // (uppercase letters + dot + digits). Bare numbers like "10" or section paths
  // like "3.1" must NOT fuzzy-match claim IDs ending in ".10" or ".1".
  if (!/[A-Z]+\.\d{2,3}/.test(raw)) {
    return null;
  }
  const suffix = `.${raw}`;
  const currentPrefix = `${currentNoteId}.`;
  for (const key of entries.keys()) {
    if (key.startsWith(currentPrefix) && key.endsWith(suffix)) {
      return key;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// ClaimIndex
// ---------------------------------------------------------------------------

/**
 * Stateful index of all claims across notes.
 * Call `build()` to populate, then use query methods to read.
 */
export class ClaimIndex {
  private data: ClaimIndexData = {
    entries: new Map(),
    trees: new Map(),
    noteTypes: new Map(),
    crossRefs: [],
    errors: [],
  };

  /**
   * Reverse index mapping source claim FQIDs to arrays of derived claim FQIDs.
   * Built during `build()` Phase 1.5 after all entries are populated.
   * @implements {R006.§2.AC.04} Bidirectional derivation indexing
   */
  private derivativesMap: Map<string, string[]> = new Map();

  /**
   * Build the claim index from an array of notes with their content.
   *
   * For each note:
   *   1. Parse the content into a claim tree via `buildClaimTree`
   *   2. Validate the tree via `validateClaimTree` to collect errors
   *   3. Extract all claim nodes into `ClaimIndexEntry` objects
   *   4. Scan content for cross-references between claims
   */
  build(notes: NoteWithContent[]): ClaimIndexData {
    // Reset state
    this.data = {
      entries: new Map(),
      trees: new Map(),
      noteTypes: new Map(),
      crossRefs: [],
      errors: [],
    };
    // @implements {R006.§2.AC.04} Reset derivation reverse index
    this.derivativesMap = new Map();

    const noteIds = notes.map((n) => n.id);
    const knownShortcodes = deriveKnownShortcodes(noteIds);

    // Phase 1: Build trees and extract entries for every note
    for (const note of notes) {
      const treeResult: ClaimTreeResult = buildClaimTree(note.content);
      const validationErrors = validateClaimTree(treeResult);

      // Store note type for ALL notes (not just those with claims)
      this.data.noteTypes.set(note.id, note.type);

      // Store tree roots
      this.data.trees.set(note.id, treeResult.roots);

      // Collect validation errors, annotating with note context
      for (const err of validationErrors) {
        this.data.errors.push({ ...err, noteId: note.id, noteFilePath: note.filePath });
      }

      // Walk the tree and extract all claim nodes into index entries
      const claimNodes: ClaimNode[] = [];
      collectClaims(treeResult.roots, claimNodes);

      for (const node of claimNodes) {
        const fullyQualified = buildFullyQualified(note.id, node);
        const sectionPath = extractSectionPath(node.id);

        // Interpret raw metadata into importance, lifecycle, and tags
        // @implements {R005.§1.AC.01} importance populated from digit 1-5
        // @implements {R005.§2.AC.01} lifecycle populated from lifecycle tags
        const parsed = parseClaimMetadata(node.metadata ?? []);

        const entry: ClaimIndexEntry = {
          noteId: note.id,
          claimId: node.id,
          fullyQualified,
          sectionPath,
          claimPrefix: node.claimPrefix!,
          claimNumber: node.claimNumber!,
          ...(node.claimSubLetter ? { claimSubLetter: node.claimSubLetter } : {}),
          heading: node.heading,
          line: node.line,
          endLine: node.endLine,
          metadata: node.metadata ?? [],
          importance: parsed.importance,
          lifecycle: parsed.lifecycle,
          parsedTags: parsed.tags,
          // @implements {R006.§2.AC.01} Raw derivation targets, resolved in Phase 1.5
          derivedFrom: parsed.derivedFrom,
          noteType: note.type,
          noteFilePath: note.filePath,
        };

        if (this.data.entries.has(fullyQualified)) {
          this.data.errors.push({
            type: 'duplicate',
            claimId: fullyQualified,
            line: node.line,
            message: `Duplicate fully qualified claim "${fullyQualified}" in note ${note.id} at line ${node.line}.`,
            noteId: note.id,
            noteFilePath: note.filePath,
          });
        } else {
          this.data.entries.set(fullyQualified, entry);
        }
      }
    }

    // Phase 1.5: Derivation Resolution
    // @implements {R006.§1.AC.03} Derivation targets resolved via resolveClaimAddress()
    // @implements {R006.§2.AC.01} Resolve derivedFrom targets to FQIDs
    // @implements {R006.§2.AC.04} Build reverse derivativesMap
    // Must happen after ALL entries are populated — a derived claim in DD003
    // may reference a source claim in R005; if we resolved during entry creation,
    // R005's entries might not exist yet.
    for (const entry of this.data.entries.values()) {
      if (entry.derivedFrom.length === 0) continue;

      const resolved: string[] = [];
      for (const target of entry.derivedFrom) {
        // Normalize: strip § for index lookup
        const normalized = target.replace(/§/g, '');
        const resolvedId = resolveClaimAddress(normalized, this.data.entries, entry.noteId);

        if (resolvedId) {
          resolved.push(resolvedId);
          // Build reverse index: source claim -> derived claims
          const existing = this.derivativesMap.get(resolvedId) ?? [];
          existing.push(entry.fullyQualified);
          this.derivativesMap.set(resolvedId, existing);
        } else {
          // Unresolvable derivation target → record error
          this.data.errors.push({
            type: 'unresolvable-derivation-target',
            claimId: entry.fullyQualified,
            line: entry.line,
            message: `Claim "${entry.fullyQualified}" declares derives=${target} but target does not resolve in the index.`,
            noteId: entry.noteId,
            noteFilePath: entry.noteFilePath,
          });
        }
      }
      // Replace raw targets with resolved FQIDs
      entry.derivedFrom = resolved;
    }

    // Phase 2: Scan content for cross-references
    for (const note of notes) {
      const parseOptions: ClaimParseOptions = {
        knownShortcodes,
        bracelessEnabled: true,
        currentDocumentId: note.id,
      };

      const refs = parseClaimReferences(note.content, parseOptions);

      for (const ref of refs) {
        const addr = ref.address;

        // Section-only references (e.g., §10, §3.1) are structural navigation
        // markers, not claim cross-references. Skip them to prevent false matches
        // where bare section numbers like "10" fuzzy-match claim IDs ending in ".10".
        // @implements {R004.§4.AC.04} Section-only references must not create cross-references
        if (addr.claimPrefix === undefined) {
          continue;
        }

        // Build the raw reference string for resolution
        const rawParts: string[] = [];
        if (addr.noteId) rawParts.push(addr.noteId);
        if (addr.sectionPath) rawParts.push(...addr.sectionPath.map(String));
        if (addr.claimPrefix !== undefined && addr.claimNumber !== undefined) {
          const numStr = String(addr.claimNumber).padStart(2, '0');
          const subLetter = addr.claimSubLetter ?? '';
          rawParts.push(`${addr.claimPrefix}.${numStr}${subLetter}`);
        }

        if (rawParts.length === 0) continue;

        const rawRef = rawParts.join('.');

        // Skip self-referencing claims (claim referencing itself within the same note)
        const resolved = resolveClaimAddress(rawRef, this.data.entries, note.id);

        if (resolved) {
          const targetEntry = this.data.entries.get(resolved)!;

          // Skip references from a note to claims within the same note
          // (these are structural, not cross-references)
          if (targetEntry.noteId === note.id) {
            continue;
          }

          // Find the claim in the current note that contains this reference line
          const fromClaim = this.findContainingClaim(note.id, ref.line);

          this.data.crossRefs.push({
            fromClaim: fromClaim ?? `${note.id}:line-${ref.line}`,
            toClaim: resolved,
            fromNoteId: note.id,
            toNoteId: targetEntry.noteId,
            line: ref.line,
            filePath: note.filePath,
          });
        } else {
          // Only report as broken if the reference targets a different note
          // (or has an explicit note ID that isn't the current document)
          if (addr.noteId && addr.noteId !== note.id && addr.claimPrefix !== undefined) {
            this.data.errors.push({
              type: 'unresolved-reference',
              claimId: rawRef,
              line: ref.line,
              message: `Unresolved claim reference "${rawRef}" in note ${note.id} at line ${ref.line}.`,
              noteId: note.id,
              noteFilePath: note.filePath,
            });

            // Also create an unresolved cross-reference so the trace command
            // can surface broken refs instead of silently dropping them
            const fromClaim = this.findContainingClaim(note.id, ref.line);
            this.data.crossRefs.push({
              fromClaim: fromClaim ?? `${note.id}:line-${ref.line}`,
              toClaim: rawRef,
              fromNoteId: note.id,
              toNoteId: addr.noteId,
              line: ref.line,
              filePath: note.filePath,
              unresolved: true,
            });
          }
        }
      }
    }

    return this.data;
  }

  /**
   * Get all claims belonging to a specific note.
   */
  getClaimsForNote(noteId: string): ClaimIndexEntry[] {
    const result: ClaimIndexEntry[] = [];
    for (const entry of this.data.entries.values()) {
      if (entry.noteId === noteId) {
        result.push(entry);
      }
    }
    return result;
  }

  /**
   * Look up a single claim by its fully qualified ID.
   */
  getClaim(fullyQualified: string): ClaimIndexEntry | null {
    return this.data.entries.get(fullyQualified) ?? null;
  }

  /**
   * Get all cross-references originating FROM a claim (by fully qualified ID).
   */
  getCrossRefsFrom(claimId: string): ClaimCrossReference[] {
    return this.data.crossRefs.filter((ref) => ref.fromClaim === claimId);
  }

  /**
   * Get all cross-references pointing TO a claim (by fully qualified ID).
   */
  getCrossRefsTo(claimId: string): ClaimCrossReference[] {
    return this.data.crossRefs.filter((ref) => ref.toClaim === claimId);
  }

  /**
   * Get all errors collected during the last build.
   */
  getErrors(): ClaimTreeError[] {
    return this.data.errors;
  }

  /**
   * Get the full index data from the last build.
   */
  getData(): ClaimIndexData {
    return this.data;
  }

  /**
   * Get the source claims that a derived claim declares derivation from.
   * Returns resolved FQIDs. Empty array if claim not found or has no derivation.
   * @implements {R006.§2.AC.02}
   */
  getDerivedFrom(claimId: string): string[] {
    const entry = this.data.entries.get(claimId);
    return entry?.derivedFrom ?? [];
  }

  /**
   * Get all claims that declare `derives=TARGET` pointing to the given claim.
   * Returns derived claim FQIDs. Empty array if claim has no derivatives.
   * @implements {R006.§2.AC.03}
   */
  getDerivatives(claimId: string): string[] {
    return this.derivativesMap.get(claimId) ?? [];
  }

  /**
   * Incorporate source code references into the index.
   *
   * For each SourceReference that has a claimPath, resolve it against
   * the existing claim entries and add it as a cross-reference.
   * Source files appear as a "Source" projection type in the noteTypes map.
   *
   * Must be called AFTER build() so the claim entries are populated.
   */
  addSourceReferences(refs: SourceReference[]): void {
    for (const ref of refs) {
      if (!ref.claimPath) continue;

      // claimPath is like '.§3.AC.01' or '.3.AC.01'
      // Normalize: strip leading dot, remove § characters
      const normalized = ref.claimPath.replace(/^\./, '').replace(/§/g, '');

      // Build the fully qualified claim address: noteId.sectionPath.PREFIX.NN
      const fullyQualified = `${ref.toId}.${normalized}`;

      // Check if this claim exists in the index
      const targetEntry = this.data.entries.get(fullyQualified);
      if (!targetEntry) continue;

      // Use the filename (not full path) as the source identifier for readability
      const sourceId = `source:${path.basename(ref.filePath)}`;

      // Register this source file in the noteTypes map as "Source"
      if (!this.data.noteTypes.has(sourceId)) {
        this.data.noteTypes.set(sourceId, 'Source');
      }

      this.data.crossRefs.push({
        fromClaim: `${sourceId}:L${ref.line ?? 0}`,
        toClaim: fullyQualified,
        fromNoteId: sourceId,
        toNoteId: targetEntry.noteId,
        line: ref.line ?? 0,
        filePath: ref.filePath,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Find the claim entry in a note that contains a given line number.
   * Returns the fully qualified ID, or null if the line is outside any claim.
   */
  private findContainingClaim(noteId: string, line: number): string | null {
    let bestMatch: ClaimIndexEntry | null = null;

    for (const entry of this.data.entries.values()) {
      if (entry.noteId !== noteId) continue;
      if (line >= entry.line && line <= entry.endLine) {
        // Prefer the most specific (smallest range) containing claim
        if (!bestMatch || (entry.endLine - entry.line) < (bestMatch.endLine - bestMatch.line)) {
          bestMatch = entry;
        }
      }
    }

    return bestMatch?.fullyQualified ?? null;
  }
}
