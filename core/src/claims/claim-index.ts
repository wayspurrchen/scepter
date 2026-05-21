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
import { isDeletionMarker } from '../lifecycle/deletion-marker.js';
// @implements {DD021.§10.DC.08} Every resolution flows through the shared resolver.
import { resolveReference } from './reference-resolver.js';
import type { ResolverOutcome, ResolverFailureCode } from './reference-resolver.js';

/**
 * Detects an alias-prefixed cross-project target in a metadata value.
 * Matches the same kebab-case alias-name shape as the parser's
 * `ALIAS_PREFIX_RE` (lowercase letters, digits, internal hyphens; ≥2
 * chars; no leading or trailing hyphen) followed by `/`.
 *
 * Used to reject `derives=<alias>/<id>` and `superseded=<alias>/<id>`
 * per R011.§2.AC.03 / R011.§2.AC.04.
 */
const CROSS_PROJECT_TARGET_RE = /^[a-z][a-z0-9-]*[a-z0-9]\//;

/**
 * Format a per-code message for the new DD021.§10.DC.02 taxonomy emissions
 * at the cross-ref scan and derivation-resolution sites. The lint command's
 * rendering layer ({DD021.§10.DC.13}) will replace these with richer messages
 * during the C.12 update; this stub provides a sensible default during the
 * Phase B transition.
 *
 * @implements {DD021.§10.DC.13} (partial — final messages in lint-command.ts)
 */
function formatNewCodeMessage(
  code: string,
  rawRef: string,
  targetNoteId: string | undefined,
  fromNoteId: string,
): string {
  switch (code) {
    case 'reference-to-unknown-note':
      return `Reference "${rawRef}" cites note ${targetNoteId ?? '?'} which does not exist in the project.`;
    case 'reference-to-undefined-claim':
      return `Reference "${rawRef}" cites note ${targetNoteId ?? '?'}, which exists but does not define this claim.`;
    case 'reference-to-archived':
      return `Reference "${rawRef}" resolves to archived note ${targetNoteId ?? '?'}. Consider rewriting the citation or un-archiving the target.`;
    case 'malformed-claim-reference':
      return `Reference "${rawRef}" does not match the claim grammar.`;
    case 'derivation-target-bare-note-id':
      return `\`derives=${rawRef}\` is a bare note ID; \`derives=\` requires a claim-level address.`;
    case 'derivation-target-cross-project':
      return `\`derives=${rawRef}\` is alias-prefixed; cross-project derivation is rejected (R006.§Non-Goals / R011.§2.AC.03).`;
    case 'derivation-target-removed':
      return `Claim derives from "${rawRef}" which is tagged \`:removed\`.`;
    case 'derivation-target-superseded':
      return `Claim derives from "${rawRef}" which is tagged \`:superseded\`. Consider re-deriving from the replacement.`;
    case 'derivation-target-ambiguous':
      return `\`derives=${rawRef}\` is ambiguous; multiple candidates match (use the fully qualified form to disambiguate).`;
    default:
      return `Reference "${rawRef}" in note ${fromNoteId}.`;
  }
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface NoteWithContent {
  id: string;
  type: string;
  filePath: string;
  content: string;
  /**
   * Note's tag set, surfaced from `Note.tags`. Used by `ClaimIndex.build()`
   * to populate `ClaimIndexEntry.archived` per {DD021.§10.DC.17} from
   * `tags.includes('archived')`. Optional for backward compatibility with
   * older callers; when absent, entries have `archived: false`.
   *
   * @implements {DD021.§10.DC.17} NoteWithContent.tags plumbing
   */
  tags?: string[];
}

/**
 * @implements {R005.§1.AC.01} importance field from inline importance parsing
 * @implements {R005.§2.AC.01} lifecycle field from lifecycle tag parsing
 * @implements {R006.§2.AC.01} derivedFrom field from derives=TARGET metadata
 * @implements {DD021.§10.DC.17} `archived: boolean` field populated from `note.tags.includes('archived')`; resolver branches on archive state per {R015.§1.AC.04a}.
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
  /**
   * Raw `:derives=TARGET` target strings whose resolution failed (NOT
   * tombstoned — those go to `tombstonedDerivedFrom`). Populated alongside
   * `derivedFrom` during Phase 1.5 derivation resolution when the resolver
   * returns `unresolved` or `ambiguous`. Each entry carries the raw author-
   * written target plus the resolver's failure code so the trace renderer
   * can surface a sentinel per {DD021.§10.DC.12} ("Silent omission of the
   * `Derived from:` line for a malformed `derives=` is FORBIDDEN").
   *
   * The data model carries the NEW taxonomy code (ResolverFailureCode) only.
   * The legacy `unresolvable-derivation-target` parallel-emit is an output
   * concern of `claim-index.ts` Phase 1.5 (it pushes to `data.errors`),
   * not an index-state concern. Renderer reads from this field; lint
   * output's parallel-emit handles the legacy companion separately.
   *
   * @implements {DD021.§10.DC.12} trace surfaces unresolved derives= entries
   */
  unresolvedDerivationTargets: Array<{ rawTarget: string; code: ResolverFailureCode }>;
  /**
   * Raw `:derives=TARGET` target strings whose note-ID portion is a
   * deletion marker (e.g., `_deleted_R005_at_20260519.§1.AC.03`).
   *
   * These targets are recognized lifecycle state, NOT broken references.
   * They are kept separate from `derivedFrom` (which holds resolved live
   * FQIDs) so the trace matrix and gap report can branch on them per
   * R015 §5.AC.05 and the orphan-derives surface (see DD020 §5.DC.07,
   * realized in traceability.ts:findGaps).
   *
   * @implements {DD020.§5.DC.01} consumer-side tombstone recognition
   * @implements {R015.§5.AC.01} linter does not flag tombstoned derives=
   */
  tombstonedDerivedFrom: string[];
  /**
   * Raw `:superseded=TARGET` target string when the target's note-ID
   * portion is a deletion marker. Same rationale as `tombstonedDerivedFrom`.
   * Distinct from `lifecycle.target` (which carries the live target
   * string only when resolution is meaningful).
   *
   * @implements {R015.§5.AC.01} linter does not flag tombstoned superseded=
   */
  tombstonedSupersededBy?: string;
  /**
   * Whether the source note is archived (carries the `archived` tag).
   * Populated at entry construction from `NoteWithContent.tags`.
   *
   * Archived-note entries remain in the index per {R015.§1.AC.04a}
   * (resolver MUST resolve to them) but are filtered from gap-coverage
   * calculations per {R015.§1.AC.04a} ("@implements annotations and
   * inline citations are inert"). The resolver branches on this field
   * for the (c) consumer-synthesis pattern per {DD021.§10.DC.05},
   * {DD021.§10.DC.06}, and {R015.§1.AC.04b}.
   *
   * @implements {DD021.§10.DC.17} archived field on ClaimIndexEntry
   */
  archived: boolean;
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
  /**
   * @deprecated since {DD021.§10.DC.08} migration. Computed from
   * `resolverOutcome.kind === 'unresolved'`. Retained for transition-window
   * consumers per {DD021.§10.DC.09}.
   */
  unresolved?: boolean;
  /**
   * Full outcome from `resolveReference()` per {DD021.§10.DC.01}. Populated
   * for every edge post-{DD021.§10.DC.08} migration. Consumers branch on
   * `resolverOutcome.kind` for resolved/ambiguous/unresolved discrimination.
   * Closes {DD021.§7.OQ.02} (full outcome on edge vs separate diagnostics).
   *
   * Type imported via `import type` to avoid circular module dependency:
   * `reference-resolver.ts` imports `ClaimIndexEntry` from this file; this
   * field's type is forward-imported as a type only.
   *
   * @implements {DD021.§7.OQ.02} disposition (resolver outcome on edge)
   */
  resolverOutcome?: import('./reference-resolver.js').ResolverOutcome;
}

/**
 * A cross-project (alias-prefixed) reference encountered in a local
 * note. These are tracked separately from local `crossRefs` because
 * they MUST NOT enter the local trace matrix or gap report per
 * R011.§3.AC.03/.AC.04. They are read-only citations resolved at
 * lookup time, not edges in the local reference graph.
 *
 * @implements {R011.§3.AC.03} cross-project citations rendered separately
 * @implements {R011.§3.AC.04} cross-project refs not in local gap analysis
 */
export interface ClaimCrossProjectReference {
  /** The alias name (e.g., `vendor-lib`). */
  aliasPrefix: string;
  /** The parsed claim address — note id, section, claim, etc.,
   * with `aliasPrefix` set. */
  address: import('../parsers/claim/claim-parser').ClaimAddress;
  fromNoteId: string;
  line: number;
  filePath: string;
}

export interface ClaimIndexData {
  entries: Map<string, ClaimIndexEntry>;  // keyed by fullyQualified
  trees: Map<string, ClaimNode[]>;        // keyed by noteId
  noteTypes: Map<string, string>;         // noteId -> noteType for ALL scanned notes
  crossRefs: ClaimCrossReference[];
  /** Cross-project (alias-prefixed) references — kept SEPARATE from
   * `crossRefs` per R011.§3.AC.04. */
  crossProjectRefs: ClaimCrossProjectReference[];
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

// Note: the previous `resolveClaimAddress()` helper was REMOVED in Phase D.16
// per {DD021.§10.DC.08} — "no fallback resolution path may exist outside the
// shared module." Every resolution now flows through `resolveReference()` in
// `core/src/claims/reference-resolver.ts`. The R004.§4.AC.05 fuzzy-match
// invariant the helper realized is preserved by the resolver's Step 3 +
// Step 3b same-note scope branches.

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
    crossProjectRefs: [],
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
      crossProjectRefs: [],
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
        // Self-prefix validation: a self-prefixed claim definition (e.g.,
        // `**R049.LOCK.03**: ...`) carries `node.selfPrefix` set by the
        // parser. The prefix MUST match the containing note ID — anything
        // else is a likely copy/paste mistake or stale rename, and silently
        // registering the claim under the wrong note would create
        // hard-to-diagnose unresolved references downstream. Emit a
        // diagnostic and skip registration.
        // @implements {R004.§3.AC.05} self-prefix validated against containing note
        // @implements {S002.§8.AC.03} mismatch emits error AND skips registration
        // @implements {S002.§8.AC.04} mismatched-self-prefix surfaced through diagnostic pipelines
        // @implements {S002.§8.AC.06} folder-note variant uses parent note ID via aggregated content
        if (node.selfPrefix !== undefined && node.selfPrefix !== note.id) {
          this.data.errors.push({
            type: 'mismatched-self-prefix',
            claimId: node.id,
            line: node.line,
            message:
              `Self-prefix "${node.selfPrefix}" does not match containing note "${note.id}". ` +
              `Definition not registered. Check for a copy/paste error or stale rename — ` +
              `self-prefixed claim definitions MUST use the containing note's ID.`,
            noteId: note.id,
            noteFilePath: note.filePath,
          });
          continue;
        }

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
          tombstonedDerivedFrom: [],
          // @implements {DD021.§10.DC.12} unresolved derives= surfaced for trace rendering
          unresolvedDerivationTargets: [],
          // @implements {DD021.§10.DC.17} archived field populated from note tags
          archived: note.tags?.includes('archived') ?? false,
          noteType: note.type,
          noteFilePath: note.filePath,
        };

        // Same-note repeats are dropped by the parser (`buildClaimTree`
        // dedups on first occurrence). Cross-note FQID collisions can only
        // happen if two notes share an ID, which is guarded elsewhere — so
        // unconditionally take the first entry seen and ignore later ones.
        if (!this.data.entries.has(fullyQualified)) {
          this.data.entries.set(fullyQualified, entry);
        }
      }
    }

    // Phase 1.5: Derivation Resolution
    // @implements {R006.§1.AC.03} Derivation targets resolved via resolveReference() per DD021.§10.DC.08
    // @implements {R006.§2.AC.01} Resolve derivedFrom targets to FQIDs
    // @implements {R006.§2.AC.04} Build reverse derivativesMap
    // Must happen after ALL entries are populated — a derived claim in DD003
    // may reference a source claim in R005; if we resolved during entry creation,
    // R005's entries might not exist yet.
    for (const entry of this.data.entries.values()) {
      if (entry.derivedFrom.length === 0) continue;

      const resolved: string[] = [];
      const tombstoned: string[] = [];
      for (const target of entry.derivedFrom) {
        // Tombstoned (deletion-marker) targets are a recognized lifecycle
        // state, not broken references. The note-ID portion of TARGET is
        // the leading token before the first `.`. If it's a deletion
        // marker, capture the raw target on `tombstonedDerivedFrom` and
        // skip resolution — no error, no `derivativesMap` entry.
        // @implements {DD020.§5.DC.01} consumer-side tombstone recognition
        // @implements {R015.§5.AC.01} no broken-ref error on tombstoned derives=
        const leadingToken = target.split('.', 1)[0];
        if (isDeletionMarker(leadingToken)) {
          tombstoned.push(target);
          continue;
        }

        // Route every derives= target through the shared resolver per DC.08.
        // The resolver's pre-checks handle:
        //   - bare-note-id (DC.04) -> derivation-target-bare-note-id
        //   - alias-prefix (with derivesPosition: true) -> derivation-target-cross-project
        //   - malformed string -> malformed-claim-reference
        // Resolution outcomes are translated into parallel-emit ClaimTreeError
        // entries per DC.09's transition window (legacy first per Q7, then
        // new-code per the resolver's outcome).
        //
        // B.8: This route SUBSUMES the prior CROSS_PROJECT_TARGET_RE direct
        // emission of `cross-project-derives` (formerly at L443-451 / L529-539).
        // The legacy `cross-project-derives` code is now emitted as a parallel
        // companion to the new `derivation-target-cross-project` code, preserving
        // the verbose R011-rationale message at the legacy emission per Q1 caveat.
        //
        // @implements {DD021.§10.DC.08} every resolution flows through resolveReference()
        // @implements {DD021.§10.DC.04} bare-note-id derives= detection (via resolver)
        // @implements {R011.§2.AC.03} cross-project derives= rejected (via resolver)
        // @implements {DD021.§10.DC.09} parallel-emit during transition window

        // Normalize: strip § for resolver input (matches resolveReference's
        // expectation of pre-normalized text; the resolver parses internally).
        const normalized = target.replace(/§/g, '');
        const outcome: ResolverOutcome = resolveReference(normalized, this.data, {
          currentNoteId: entry.noteId,
          derivesPosition: true,
        });

        if (outcome.kind === 'resolved') {
          const resolvedId = outcome.canonicalId;
          resolved.push(resolvedId);
          // Build reverse index: source claim -> derived claims
          const existing = this.derivativesMap.get(resolvedId) ?? [];
          existing.push(entry.fullyQualified);
          this.derivativesMap.set(resolvedId, existing);
        } else if (outcome.kind === 'ambiguous') {
          // Section-less derives= matched multiple candidates. Parallel-emit
          // legacy `unresolvable-derivation-target` + new `derivation-target-ambiguous`.
          this.data.errors.push({
            type: 'unresolvable-derivation-target',
            claimId: entry.fullyQualified,
            line: entry.line,
            message: `Claim "${entry.fullyQualified}" declares derives=${target} but target does not resolve in the index.`,
            noteId: entry.noteId,
            noteFilePath: entry.noteFilePath,
          });
          this.data.errors.push({
            type: 'derivation-target-ambiguous',
            claimId: entry.fullyQualified,
            line: entry.line,
            message: `Claim "${entry.fullyQualified}" declares derives=${target}, which is ambiguous; candidates: ${outcome.candidates.join(', ')}. Use the fully qualified form to disambiguate.`,
            noteId: entry.noteId,
            noteFilePath: entry.noteFilePath,
          });
          // Populate entry's unresolvedDerivationTargets per DC.12 for trace
          // sentinel rendering. Ambiguous outcomes don't have a single
          // `outcome.code`; use 'derivation-target-ambiguous' per the §2 mapping.
          // @implements {DD021.§10.DC.12} unresolved derives= surfaced for trace rendering
          entry.unresolvedDerivationTargets.push({
            rawTarget: target,
            code: 'derivation-target-ambiguous',
          });
        } else {
          // unresolved kind: emit legacy + new code per DC.09 parallel-emit.
          // The cross-project case gets the verbatim R011-rationale message
          // on the legacy emission (preserves today's text for grep-stability
          // per Q1 caveat); the new code carries a short detail.
          if (outcome.code === 'derivation-target-cross-project') {
            // Legacy first per Q7 — verbatim R011 message from today's L448.
            this.data.errors.push({
              type: 'cross-project-derives',
              claimId: entry.fullyQualified,
              line: entry.line,
              message: `Claim "${entry.fullyQualified}" declares derives=${target}, but cross-project derivation is rejected. The derivation graph is per-project (R006.§Non-Goals). R011.§2.AC.03 permits reconsideration via a future requirement that relaxes both R006 and R011.§2.AC.03 together; in this version, derives= MUST point at a local claim.`,
              noteId: entry.noteId,
              noteFilePath: entry.noteFilePath,
            });
            // New code second per DC.09 ordering.
            this.data.errors.push({
              type: 'derivation-target-cross-project',
              claimId: entry.fullyQualified,
              line: entry.line,
              message: formatNewCodeMessage(outcome.code, target, undefined, entry.noteId),
              noteId: entry.noteId,
              noteFilePath: entry.noteFilePath,
            });
          } else {
            // Other unresolved codes (bare-note-id, unknown-note,
            // undefined-claim, malformed) parallel-emit with legacy
            // `unresolvable-derivation-target` first per Q7.
            this.data.errors.push({
              type: 'unresolvable-derivation-target',
              claimId: entry.fullyQualified,
              line: entry.line,
              message: `Claim "${entry.fullyQualified}" declares derives=${target} but target does not resolve in the index.`,
              noteId: entry.noteId,
              noteFilePath: entry.noteFilePath,
            });
            this.data.errors.push({
              type: outcome.code,
              claimId: entry.fullyQualified,
              line: entry.line,
              message: formatNewCodeMessage(outcome.code, target, undefined, entry.noteId),
              noteId: entry.noteId,
              noteFilePath: entry.noteFilePath,
            });
          }
          // Populate entry's unresolvedDerivationTargets per DC.12 for trace
          // sentinel rendering. Both cross-project and other-unresolved branches
          // record the raw target + the new-taxonomy code (ResolverFailureCode).
          // @implements {DD021.§10.DC.12} unresolved derives= surfaced for trace rendering
          entry.unresolvedDerivationTargets.push({
            rawTarget: target,
            code: outcome.code,
          });
        }
      }
      // Replace raw targets with resolved FQIDs
      entry.derivedFrom = resolved;
      // Tombstoned derivation targets are tracked separately so consumers
      // (orphan-derives, lint audit) can surface them without polluting
      // the live derivation graph.
      entry.tombstonedDerivedFrom = tombstoned;
    }

    // Phase 1.6: Cross-project supersession rejection + tombstone capture.
    // @implements {R011.§2.AC.04} cross-project superseded= rejected (permanent)
    // @implements {DD020.§5.DC.01} consumer-side tombstone recognition for superseded=
    // The local project lacks authority to assert lifecycle facts about a
    // peer's claims. This boundary is permanent — see R011.§2.AC.04.
    // Tombstoned supersession targets are a recognized lifecycle state per
    // {R015.§5.AC.01}; they are captured on `tombstonedSupersededBy` and
    // do NOT produce a cross-project error.
    for (const entry of this.data.entries.values()) {
      if (entry.lifecycle?.type !== 'superseded') continue;
      const target = entry.lifecycle.target;
      if (typeof target !== 'string') continue;
      const leadingToken = target.split('.', 1)[0];
      if (isDeletionMarker(leadingToken)) {
        entry.tombstonedSupersededBy = target;
        continue;
      }
      if (CROSS_PROJECT_TARGET_RE.test(target)) {
        this.data.errors.push({
          type: 'cross-project-superseded',
          claimId: entry.fullyQualified,
          line: entry.line,
          message: `Claim "${entry.fullyQualified}" declares superseded=${target}, but cross-project supersession is permanently rejected. Supersession asserts that the target is the authoritative replacement for the asserting claim — the local project has no authority to make lifecycle assertions on a peer project's claims (R011.§2.AC.04).`,
          noteId: entry.noteId,
          noteFilePath: entry.noteFilePath,
        });
      }
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

        // Cross-project alias-prefixed references are read-only citations
        // and MUST NOT enter the local cross-reference graph, gap report,
        // or trace matrix per R011.§3.AC.03 / R011.§3.AC.04. They are
        // captured in a separate list (`crossProjectRefs`) so the lint
        // command can validate them against the resolver without polluting
        // the local index.
        // @implements {R011.§3.AC.03} cross-project citations rendered separately
        // @implements {R011.§3.AC.04} cross-project refs not in local gap analysis
        if (addr.aliasPrefix) {
          this.data.crossProjectRefs.push({
            aliasPrefix: addr.aliasPrefix,
            address: addr,
            fromNoteId: note.id,
            line: ref.line,
            filePath: note.filePath,
          });
          continue;
        }

        // Section-only references (e.g., §10, §3.1) are structural navigation
        // markers, not claim cross-references. Skip them to prevent false matches
        // where bare section numbers like "10" fuzzy-match claim IDs ending in ".10".
        // @implements {R004.§4.AC.04} Section-only references must not create cross-references
        if (addr.claimPrefix === undefined) {
          continue;
        }

        // Build the raw reference string for resolution (used in error
        // messages even when the resolver consumes the parsed ClaimAddress
        // directly).
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

        // Route through the shared resolver. The resolver branches on the
        // pre-parsed ClaimAddress (raw: ClaimAddress path — malformed cannot
        // fire). Outcomes are translated into ClaimCrossReference edges with
        // both `resolverOutcome` (new shape) and `unresolved?: boolean`
        // (legacy retained for transition per OQ.02), and into parallel
        // ClaimTreeError entries (legacy + new) per DC.09's transition window.
        // @implements {DD021.§10.DC.08} cross-ref scan calls resolveReference
        const outcome: ResolverOutcome = resolveReference(addr, this.data, {
          currentNoteId: note.id,
          derivesPosition: false,
        });

        if (outcome.kind === 'resolved') {
          const targetEntry = outcome.entry;

          // Skip references from a note to claims within the same note
          // (these are structural, not cross-references)
          if (targetEntry.noteId === note.id) {
            continue;
          }

          // Find the claim in the current note that contains this reference line
          const fromClaim = this.findContainingClaim(note.id, ref.line);

          this.data.crossRefs.push({
            fromClaim: fromClaim ?? `${note.id}:line-${ref.line}`,
            toClaim: outcome.canonicalId,
            fromNoteId: note.id,
            toNoteId: targetEntry.noteId,
            line: ref.line,
            filePath: note.filePath,
            resolverOutcome: outcome,
          });
        } else {
          // Only report as broken if the reference targets a different note
          // (or has an explicit note ID that isn't the current document)
          if (addr.noteId && addr.noteId !== note.id && addr.claimPrefix !== undefined) {
            // Q7 legacy-first ordering: emit legacy `unresolved-reference`
            // first (today's grep surface), then new code per DC.09's
            // expanded body. Both rows appear in lint output during the
            // transition window.
            // @implements {DD021.§10.DC.09} parallel-emit during transition window
            this.data.errors.push({
              type: 'unresolved-reference',
              claimId: rawRef,
              line: ref.line,
              message: `Unresolved claim reference "${rawRef}" in note ${note.id} at line ${ref.line}.`,
              noteId: note.id,
              noteFilePath: note.filePath,
            });

            // Emit the new code per the resolver outcome kind.
            // - unresolved: use the discrete failure code (reference-to-unknown-note,
            //   reference-to-undefined-claim, malformed-claim-reference, etc.)
            // - ambiguous: surface as new `ambiguous` ClaimTreeError type? No —
            //   today's `ambiguous` claim-tree-error is for SAME-NOTE ambiguity
            //   from {R004.§1.AC.04}. The cross-note section-less ambiguity from
            //   DC.03 surfaces via the new unresolved-reference family: we emit
            //   reference-to-undefined-claim with candidates in the detail (or
            //   leave the legacy `unresolved-reference` alone and emit no new
            //   code on `ambiguous` outcomes for inline-ref position — they're
            //   surfaced via the resolverOutcome attached below).
            if (outcome.kind === 'unresolved') {
              this.data.errors.push({
                type: outcome.code,
                claimId: rawRef,
                line: ref.line,
                message: formatNewCodeMessage(outcome.code, rawRef, addr.noteId, note.id),
                noteId: note.id,
                noteFilePath: note.filePath,
              });
            }
            // For `ambiguous` outcomes in inline-ref position, we attach the
            // outcome to the cross-ref edge below; rendering layers (trace,
            // lint) discriminate via `ref.resolverOutcome.kind === 'ambiguous'`.
            // No new ClaimTreeError emitted — the cross-ref's outcome is the
            // primary signal, paralleled by the legacy `unresolved-reference`
            // above for grep-stability.

            // Also create an unresolved cross-reference so the trace command
            // can surface broken refs instead of silently dropping them.
            // Attach the full resolver outcome per OQ.02 closure.
            const fromClaim = this.findContainingClaim(note.id, ref.line);
            this.data.crossRefs.push({
              fromClaim: fromClaim ?? `${note.id}:line-${ref.line}`,
              toClaim: rawRef,
              fromNoteId: note.id,
              toNoteId: addr.noteId,
              line: ref.line,
              filePath: note.filePath,
              unresolved: true,
              resolverOutcome: outcome,
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

  // @implements {DD019.§3.DC.08} computeAuthorDeltas/applyAuthorDeltas removed.
  // Author suffix tokens are read directly from the populated
  // ClaimIndexEntry fields (importance, lifecycle, derivedFrom, parsedTags).
  // The merge into the event-derived fold happens at filter time via
  // mergeMarkdownIntoFold (DD019.§3.DC.11). The index no longer writes to
  // the metadata store at all.

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
