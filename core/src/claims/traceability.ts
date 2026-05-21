/**
 * Traceability matrix and gap analysis for SCEpter claims.
 *
 * Given a built ClaimIndexData, produces a matrix showing how claims
 * from a source note are projected (referenced) across notes of
 * different types, and identifies gaps where claims are missing
 * coverage in some note types.
 *
 * @implements {R004.§5.AC.01} Traceability matrix shows claims vs projection types (buildTraceabilityMatrix)
 * @implements {R004.§5.AC.02} Gap detection across note types (findGaps)
 */

import type { ClaimIndexData, ClaimIndexEntry } from './claim-index.js';
import type { LifecycleState } from './claim-metadata.js';
import { isDeletionMarker } from '../lifecycle/deletion-marker.js';

/**
 * Extract the leading note-ID token from a fully qualified claim ID
 * (e.g., `_deleted_R005_at_20260519.§1.AC.01` → `_deleted_R005_at_20260519`).
 * Used by the tombstoned-edge filter to test whether a cross-reference's
 * source or target is rooted in a deletion-marker note.
 */
function leadingNoteId(claimFqid: string): string {
  return claimFqid.split('.', 1)[0];
}

/**
 * Predicate: is this cross-reference rooted in a tombstoned note on either
 * side (from or to)? The lifecycle-orchestrator's rewriter substitutes the
 * deletion marker into the note-ID portion of every inbound span on a
 * hard-delete, so a tombstoned reference's `toClaim` (or, less commonly,
 * `fromClaim`) carries the marker as its leading token.
 *
 * @implements {DD020.§5.DC.04} default matrix contains only live coverage
 */
function isTombstonedCrossRef(
  ref: { fromClaim?: string; toClaim: string },
): boolean {
  if (isDeletionMarker(leadingNoteId(ref.toClaim))) return true;
  if (ref.fromClaim && isDeletionMarker(leadingNoteId(ref.fromClaim))) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ProjectionPresence {
  noteId: string;
  noteType: string;
  claimId?: string;    // the claim in that note that references the source claim
  line?: number;
}

/**
 * @implements {R005.§1.AC.02} importance field for filtering/sorting
 * @implements {R005.§2.AC.02} lifecycle field for gap filtering
 * @implements {R006.§4.AC.01} derivedFrom field for trace derivation display
 */
export interface TraceabilityRow {
  claimId: string;              // fully qualified
  claimPrefix: string;
  claimNumber: number;
  claimSubLetter?: string;      // e.g., "a" for AC.01a
  heading: string;
  sectionPath: number[];
  metadata: string[];
  importance?: number;
  lifecycle?: LifecycleState;
  derivedFrom: string[];        // source claim FQIDs this claim derives from
  projections: Map<string, ProjectionPresence[]>;  // keyed by noteType
  unresolved?: boolean;         // true when target claim could not be resolved in the index
  noteType?: string;            // the note type this claim is defined in (for gap display)
  isOutgoing?: boolean;         // true when this row is from the outgoing (referenced-by-this-note) section
  relevantProjections?: Set<string>;  // projection types relevant to this row's source type (for gap display)
}

export interface TraceabilityMatrix {
  sourceNoteId: string;
  sourceNoteType: string;
  rows: TraceabilityRow[];
  projectionTypes: string[];    // all note types that appear
  /**
   * Tombstoned references collected for each source claim when
   * `includeTombstoned` is set. Keyed by the source claim's FQID.
   * Each entry records the rewritten target FQID (which carries the
   * deletion marker as its leading note-ID token) and the referring
   * note/file/line.
   *
   * Absent when `includeTombstoned` is false (the default).
   *
   * @implements {DD020.§5.DC.05} tombstoned-references surfaced as a separate column
   */
  tombstonedRefs?: Map<string, ProjectionPresence[]>;
}

/**
 * Options for buildTraceabilityMatrix.
 *
 * @implements {DD020.§5.DC.04} tombstoned references suppressed by default
 * @implements {DD020.§5.DC.05} opt-in flag surfaces tombstoned column
 */
export interface BuildMatrixOptions {
  /**
   * When true, the matrix retains cross-references whose source or target
   * is rooted in a tombstoned (deletion-marker) note, and exposes them via
   * the `tombstonedRefs` map for separate-column rendering. Default false:
   * tombstoned edges are filtered out entirely.
   */
  includeTombstoned?: boolean;
}

/**
 * Derivation coverage status for a gap report entry.
 * @implements {R006.§3.AC.02} Partial derivation coverage annotation
 */
export interface DerivationStatus {
  totalDerivatives: number;
  coveredDerivatives: number;
  uncoveredDerivatives: string[];
}

/**
 * @implements {R005.§2.AC.02} importance and lifecycle for gap filtering
 * @implements {R006.§3.AC.02} derivationStatus for derivation-aware gap closure
 */
export interface GapReport {
  claimId: string;              // fully qualified
  presentIn: string[];          // note types where claim is referenced
  missingFrom: string[];        // note types where claim could be but isn't
  metadata: string[];
  importance?: number;
  lifecycle?: LifecycleState;
  derivationStatus?: DerivationStatus;
  /**
   * Gap category — defaults to standard projection-coverage gap.
   * `orphan-derives` is set when the claim's `derives=` target is
   * tombstoned (the deriving claim has lost its source-of-truth anchor
   * because the upstream note was hard-deleted). Surfaced separately
   * from generic gaps so consumers can present an `orphan-derives`
   * category rather than degrading the claim to a broken-reference.
   */
  category?: 'standard' | 'orphan-derives';
  /** Raw tombstoned target string(s) when `category === 'orphan-derives'`. */
  tombstonedDerivedFrom?: string[];
}

/**
 * Options for filtering gaps by lifecycle state.
 * @implements {R005.§2.AC.02} Gap filtering by lifecycle state
 * @implements {R005.§2.AC.03} excludeDeferred option
 * @implements {R005.§2.AC.04} excludeClosed option
 */
export interface GapFilterOptions {
  excludeClosed?: boolean;
  excludeDeferred?: boolean;
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Build a traceability matrix for a single source note.
 *
 * Two modes:
 * 1. **Claim-defining note** (has §-sections): shows incoming references
 *    TO this note's claims from other notes, grouped by note type.
 * 2. **Referencing note** (no claims, but references other notes' claims):
 *    shows outgoing references FROM this note to external claims,
 *    grouped by target note type.
 */
export function buildTraceabilityMatrix(
  noteId: string,
  index: ClaimIndexData,
  options?: BuildMatrixOptions,
): TraceabilityMatrix {
  const includeTombstoned = options?.includeTombstoned === true;

  // Gather claims defined in this note
  const sourceClaims: ClaimIndexEntry[] = [];
  let sourceNoteType = index.noteTypes.get(noteId) ?? '';

  for (const entry of index.entries.values()) {
    if (entry.noteId === noteId) {
      sourceClaims.push(entry);
      if (!sourceNoteType) {
        sourceNoteType = entry.noteType;
      }
    }
  }

  // Collect tombstoned cross-refs separately if surfacing is requested.
  // The marker substitution applies to the note-ID portion of TARGET in
  // every inbound rewrite (§4.DC.03), so a tombstoned edge has a `toClaim`
  // whose leading token is a deletion marker. We key by the original
  // (pre-deletion) claim FQID — recoverable by stripping the marker and
  // restoring the original ID via parseDeletionMarker — but for the v1
  // surface here we key by the original-claim suffix attached to the
  // referring claim, falling back to the rewritten target.
  // @implements {DD020.§5.DC.04} default matrix excludes tombstoned edges
  // @implements {DD020.§5.DC.05} opt-in surfaces tombstoned column data
  const tombstonedRefs = includeTombstoned ? new Map<string, ProjectionPresence[]>() : undefined;
  if (tombstonedRefs) {
    for (const claim of sourceClaims) {
      // A tombstoned-derives-from claim has lost its source-of-truth anchor;
      // surface the recorded raw target.
      // (For pure incoming-rewrite tombstones — references TO this note's
      // claims that got rewritten elsewhere — those don't exist for live
      // sourceClaims: tombstoning means the note was deleted, so its
      // claims aren't in the live index.)
      const tombstoned = claim.tombstonedDerivedFrom ?? [];
      if (tombstoned.length > 0) {
        const list: ProjectionPresence[] = tombstoned.map((raw) => ({
          noteId: leadingNoteId(raw),
          noteType: 'Tombstoned',
          claimId: raw,
        }));
        tombstonedRefs.set(claim.fullyQualified, list);
      }
    }
  }

  // Filter the index's crossRefs to drop tombstoned edges from the live
  // matrix unless the caller opts in. The non-mutating filtered view is
  // passed to the internal builders.
  // @implements {DD020.§5.DC.04} tombstoned edges suppressed from default matrix
  const liveCrossRefs = includeTombstoned
    ? index.crossRefs
    : index.crossRefs.filter((ref) => !isTombstonedCrossRef(ref));
  const filteredIndex: ClaimIndexData = liveCrossRefs === index.crossRefs
    ? index
    : { ...index, crossRefs: liveCrossRefs };

  // Check for outgoing references from this note to external claims
  const hasOutgoing = filteredIndex.crossRefs.some((ref) => ref.fromNoteId === noteId);

  if (sourceClaims.length > 0 && hasOutgoing) {
    // Dual-role note: defines claims AND references external claims.
    // Merge both directions, with outgoing rows marked and derivation
    // duplicates filtered out.
    const incoming = buildIncomingMatrix(noteId, sourceNoteType, sourceClaims, filteredIndex);
    const outgoing = buildOutgoingMatrix(noteId, sourceNoteType, filteredIndex);

    // Collect all derivation sources from incoming claims — these already
    // appear as projection column entries, so exclude them from outgoing rows.
    const derivationSources = new Set<string>();
    for (const claim of sourceClaims) {
      for (const src of claim.derivedFrom) {
        derivationSources.add(src);
      }
    }

    // Mark outgoing rows and filter derivation-source duplicates
    const filteredOutgoing = outgoing.rows
      .filter(row => !derivationSources.has(row.claimId))
      .map(row => ({ ...row, isOutgoing: true as const }));

    // Combine projection types from both
    const allTypes = new Set([...incoming.projectionTypes, ...outgoing.projectionTypes]);

    const result: TraceabilityMatrix = {
      sourceNoteId: noteId,
      sourceNoteType,
      rows: [...incoming.rows, ...filteredOutgoing],
      projectionTypes: [...allTypes].sort(),
    };
    if (tombstonedRefs) result.tombstonedRefs = tombstonedRefs;
    return result;
  }

  if (sourceClaims.length > 0) {
    const result = buildIncomingMatrix(noteId, sourceNoteType, sourceClaims, filteredIndex);
    if (tombstonedRefs) result.tombstonedRefs = tombstonedRefs;
    return result;
  }

  // No claims defined — show outgoing references from this note to external claims
  const result = buildOutgoingMatrix(noteId, sourceNoteType, filteredIndex);
  if (tombstonedRefs) result.tombstonedRefs = tombstonedRefs;
  return result;
}

/**
 * Build matrix showing incoming references TO this note's claims.
 * Used when the note defines its own claims via § headings.
 */
function buildIncomingMatrix(
  noteId: string,
  sourceNoteType: string,
  sourceClaims: ClaimIndexEntry[],
  index: ClaimIndexData,
): TraceabilityMatrix {
  // Sort by section path then by claim number (with sub-letter) for stable ordering
  sourceClaims.sort((a, b) => {
    const pathCmp = compareSectionPaths(a.sectionPath, b.sectionPath);
    if (pathCmp !== 0) return pathCmp;
    if (a.claimPrefix !== b.claimPrefix) return a.claimPrefix.localeCompare(b.claimPrefix);
    const numDiff = a.claimNumber - b.claimNumber;
    if (numDiff !== 0) return numDiff;
    return (a.claimSubLetter ?? '').localeCompare(b.claimSubLetter ?? '');
  });

  const projectionTypesSet = new Set<string>();
  const rows: TraceabilityRow[] = [];

  for (const claim of sourceClaims) {
    // Find all cross-references pointing TO this claim
    const incomingRefs = index.crossRefs.filter(
      (ref) => ref.toClaim === claim.fullyQualified,
    );

    // Group by the note type of the referring note
    const projections = new Map<string, ProjectionPresence[]>();

    for (const crossRef of incomingRefs) {
      // Look up the referring note's type from the noteTypes map
      const fromType = index.noteTypes.get(crossRef.fromNoteId) ?? 'Unknown';
      projectionTypesSet.add(fromType);

      const presence: ProjectionPresence = {
        noteId: crossRef.fromNoteId,
        noteType: fromType,
        claimId: crossRef.fromClaim,
        line: crossRef.line,
      };

      const existing = projections.get(fromType) ?? [];
      existing.push(presence);
      projections.set(fromType, existing);
    }

    // Derivation sources create projection coverage: if this claim derives
    // from ARCH023.ARCH.14, the Architecture column should show ARCH023.
    for (const derivSource of claim.derivedFrom) {
      const sourceEntry = index.entries.get(derivSource);
      if (sourceEntry) {
        const sourceType = sourceEntry.noteType;
        projectionTypesSet.add(sourceType);

        const existing = projections.get(sourceType) ?? [];
        // Avoid duplicate if already present from a cross-reference
        if (!existing.some(p => p.noteId === sourceEntry.noteId && p.claimId === derivSource)) {
          existing.push({
            noteId: sourceEntry.noteId,
            noteType: sourceType,
            claimId: derivSource,
          });
          projections.set(sourceType, existing);
        }
      }
    }

    // @implements {R005.§1.AC.02} Copy importance from ClaimIndexEntry
    // @implements {R006.§4.AC.01} Copy derivedFrom from ClaimIndexEntry
    rows.push({
      claimId: claim.fullyQualified,
      claimPrefix: claim.claimPrefix,
      claimNumber: claim.claimNumber,
      ...(claim.claimSubLetter ? { claimSubLetter: claim.claimSubLetter } : {}),
      heading: claim.heading,
      sectionPath: claim.sectionPath,
      metadata: claim.metadata,
      importance: claim.importance,
      lifecycle: claim.lifecycle,
      derivedFrom: claim.derivedFrom,
      projections,
    });
  }

  return {
    sourceNoteId: noteId,
    sourceNoteType: sourceNoteType,
    rows,
    projectionTypes: [...projectionTypesSet].sort(),
  };
}

/**
 * Build matrix showing outgoing references FROM this note to external claims.
 * Used when the note has no claims of its own but references other notes' claims.
 *
 * Each unique target claim becomes a row. Projection columns show which target
 * notes own those claims (the note types of the claim owners).
 */
function buildOutgoingMatrix(
  noteId: string,
  sourceNoteType: string,
  index: ClaimIndexData,
): TraceabilityMatrix {
  // Find all outgoing cross-references from this note
  const outgoingRefs = index.crossRefs.filter(
    (ref) => ref.fromNoteId === noteId,
  );

  // Deduplicate by target claim and collect line references
  const targetClaimMap = new Map<string, { entry: ClaimIndexEntry; lines: number[] }>();
  // Track unresolved cross-refs separately — they have no index entry
  const unresolvedMap = new Map<string, { crossRef: typeof outgoingRefs[0]; lines: number[] }>();

  for (const crossRef of outgoingRefs) {
    if (crossRef.unresolved) {
      const existing = unresolvedMap.get(crossRef.toClaim);
      if (existing) {
        existing.lines.push(crossRef.line);
      } else {
        unresolvedMap.set(crossRef.toClaim, { crossRef, lines: [crossRef.line] });
      }
      continue;
    }

    const targetEntry = index.entries.get(crossRef.toClaim);
    if (!targetEntry) continue;

    const existing = targetClaimMap.get(crossRef.toClaim);
    if (existing) {
      existing.lines.push(crossRef.line);
    } else {
      targetClaimMap.set(crossRef.toClaim, {
        entry: targetEntry,
        lines: [crossRef.line],
      });
    }
  }

  // Build rows from unique target claims
  const projectionTypesSet = new Set<string>();
  const rows: TraceabilityRow[] = [];

  // Sort target claims by their fully qualified ID for stable ordering
  const sortedTargets = [...targetClaimMap.entries()].sort(([a], [b]) => a.localeCompare(b));

  for (const [_claimId, { entry, lines }] of sortedTargets) {
    // The "projection" for an outgoing matrix is the target note's type
    const targetType = entry.noteType;
    projectionTypesSet.add(targetType);

    const projections = new Map<string, ProjectionPresence[]>();
    projections.set(targetType, [{
      noteId: entry.noteId,
      noteType: targetType,
      claimId: entry.fullyQualified,
      line: lines[0],
    }]);

    rows.push({
      claimId: entry.fullyQualified,
      claimPrefix: entry.claimPrefix,
      claimNumber: entry.claimNumber,
      ...(entry.claimSubLetter ? { claimSubLetter: entry.claimSubLetter } : {}),
      heading: entry.heading,
      sectionPath: entry.sectionPath,
      metadata: entry.metadata,
      importance: entry.importance,
      lifecycle: entry.lifecycle,
      derivedFrom: entry.derivedFrom,
      projections,
    });
  }

  // Append rows for unresolved cross-references so the trace surfaces them
  const sortedUnresolved = [...unresolvedMap.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [claimId, { crossRef, lines }] of sortedUnresolved) {
    // Extract a claim prefix, number, and optional sub-letter from the raw ref
    const dotParts = claimId.split('.');
    let claimPrefix = 'UNKNOWN';
    let claimNumber = 0;
    let claimSubLetter: string | undefined;
    // Walk backwards to find PREFIX.NN[a-z]? pattern
    for (let i = dotParts.length - 2; i >= 0; i--) {
      if (/^[A-Z]+$/.test(dotParts[i]) && /^\d+[a-z]?$/.test(dotParts[i + 1])) {
        claimPrefix = dotParts[i];
        const numPart = dotParts[i + 1];
        const letterMatch = numPart.match(/^(\d+)([a-z])$/);
        if (letterMatch) {
          claimNumber = parseInt(letterMatch[1], 10);
          claimSubLetter = letterMatch[2];
        } else {
          claimNumber = parseInt(numPart, 10);
        }
        break;
      }
    }

    rows.push({
      claimId,
      claimPrefix,
      claimNumber,
      ...(claimSubLetter ? { claimSubLetter } : {}),
      heading: `Unresolved reference to ${claimId}`,
      sectionPath: [],
      metadata: [],
      derivedFrom: [],
      projections: new Map(),
      unresolved: true,
    });
  }

  return {
    sourceNoteId: noteId,
    sourceNoteType: sourceNoteType,
    rows,
    projectionTypes: [...projectionTypesSet].sort(),
  };
}

/**
 * @deprecated Use `findPartialCoverageGaps()` instead. This function requires
 * a pre-configured list of projection types and produces combinatorial noise
 * when many types are configured. Kept for backward compatibility.
 *
 * Find gaps across all claims in the index.
 *
 * Gap detection is presence-based: for each claim, check which note
 * types reference it. A claim referenced in some types but not others
 * is a gap worth reporting.
 *
 * @param index - The built claim index data
 * @param allNoteTypes - All note types in the project to consider
 * @param options - Filter options for lifecycle states (default: exclude closed and deferred)
 * @param derivativesLookup - Optional function returning derivative claim FQIDs for a given source claim.
 *                            Injected from ClaimIndex.getDerivatives() to keep this module decoupled.
 *
 * @implements {R005.§2.AC.02} Gap filtering excludes closed/deferred by default
 * @implements {R005.§2.AC.03} excludeDeferred option
 * @implements {R005.§2.AC.04} excludeClosed option
 * @implements {R006.§3.AC.01} Derivation-aware gap closure
 * @implements {R006.§3.AC.02} Partial derivation coverage annotation
 * @implements {DD020.§5.DC.07} findGaps excludes tombstoned references from generic gap analysis; claims whose derives= target is tombstoned are surfaced under an `orphan-derives` category
 */
export function findGaps(
  index: ClaimIndexData,
  allNoteTypes: string[],
  options?: GapFilterOptions,
  derivativesLookup?: (claimId: string) => string[],
): GapReport[] {
  const excludeClosed = options?.excludeClosed ?? true;
  const excludeDeferred = options?.excludeDeferred ?? true;

  const reports: GapReport[] = [];

  // For each claim, determine which types reference it
  for (const entry of index.entries.values()) {
    // Skip archived claims from gap analysis. Archived-note entries remain in
    // the index per {R015.§1.AC.04a} so the resolver MUST resolve to them and
    // trace MUST render a row for them, but their @implements annotations and
    // inline citations are inert for projection-coverage tally. Paired with
    // ensure-index.ts B.5 so the gap surface stays correct: before B.5 archived
    // notes weren't in the index (couldn't contribute to gaps anyway); after
    // B.5+B.5b, they are in the index AND filtered out of gaps. Net behavior
    // at the gap surface is identical.
    // @implements {R015.§1.AC.04a} archived notes inert for projection coverage
    if (entry.archived) continue;

    // Skip claims based on lifecycle filtering
    if (entry.lifecycle) {
      if (excludeClosed && entry.lifecycle.type === 'closed') continue;
      if (excludeDeferred && entry.lifecycle.type === 'deferred') continue;
      // Removed and superseded claims are always excluded from gap analysis
      if (entry.lifecycle.type === 'removed') continue;
      if (entry.lifecycle.type === 'superseded') continue;
    }

    // Orphan-derives: this claim's derives= target is tombstoned. The
    // upstream source-of-truth note was hard-deleted, so the derivation
    // anchor is gone. Surface as a distinct category rather than letting
    // it fall through to generic projection-coverage reporting (where
    // the missing source would look like a normal Source gap).
    // @implements {DD020.§5.DC.07} orphan-derives category for tombstoned derives= targets
    if (entry.tombstonedDerivedFrom && entry.tombstonedDerivedFrom.length > 0) {
      reports.push({
        claimId: entry.fullyQualified,
        presentIn: [entry.noteType],
        missingFrom: [],
        metadata: entry.metadata,
        ...(entry.importance !== undefined ? { importance: entry.importance } : {}),
        ...(entry.lifecycle ? { lifecycle: entry.lifecycle } : {}),
        category: 'orphan-derives',
        tombstonedDerivedFrom: [...entry.tombstonedDerivedFrom],
      });
      // Orphan-derives claims still participate in generic gap analysis
      // below — the orphan category is additive, not exclusive — but the
      // tombstoned edges are filtered out of crossRefs so they don't
      // pollute the missingFrom calculation.
    }

    // Filter out tombstoned cross-refs from the gap calculation: a
    // reference whose source or target is rooted in a deleted note is
    // not a live coverage edge, and including it as "present" would
    // mask a real gap.
    // @implements {DD020.§5.DC.07} tombstoned references excluded from generic gap analysis
    const incomingRefs = index.crossRefs.filter(
      (ref) => ref.toClaim === entry.fullyQualified && !isTombstonedCrossRef(ref),
    );

    // Collect the note types of notes referencing this claim
    const presentTypes = new Set<string>();
    for (const ref of incomingRefs) {
      const fromType = index.noteTypes.get(ref.fromNoteId);
      if (fromType) {
        presentTypes.add(fromType);
      }
    }

    // Also count the claim's own note type as "present"
    presentTypes.add(entry.noteType);

    // Only report gaps for claims that have at least one projection
    // (i.e., they are referenced by at least one other note type)
    if (presentTypes.size <= 1) {
      continue;
    }

    // Find types in allNoteTypes that could have a projection but don't
    const missingFrom = allNoteTypes.filter(
      (t) => !presentTypes.has(t) && t !== entry.noteType,
    );

    if (missingFrom.length > 0) {
      reports.push({
        claimId: entry.fullyQualified,
        presentIn: [...presentTypes].sort(),
        missingFrom: missingFrom.sort(),
        metadata: entry.metadata,
        importance: entry.importance,
        lifecycle: entry.lifecycle,
      });
    }
  }

  // @implements {R006.§3.AC.01} Derivation-aware gap closure
  // @implements {R006.§3.AC.02} Partial derivation coverage annotation
  // For each gap candidate that has derivatives, check if the Source projection
  // gap is closed by derivative claims having Source coverage.
  if (derivativesLookup) {
    const closedGapIndices: number[] = [];

    for (let i = 0; i < reports.length; i++) {
      const gap = reports[i];

      // Only apply derivation gap closure when Source is in missingFrom
      if (!gap.missingFrom.includes('Source')) continue;

      const derivatives = derivativesLookup(gap.claimId);
      if (derivatives.length === 0) continue;

      // Check Source coverage on each derivative
      const uncovered: string[] = [];
      let covered = 0;

      for (const derivFqid of derivatives) {
        const hasSource = index.crossRefs.some(
          (ref) =>
            ref.toClaim === derivFqid &&
            index.noteTypes.get(ref.fromNoteId) === 'Source',
        );
        if (hasSource) {
          covered++;
        } else {
          uncovered.push(derivFqid);
        }
      }

      if (covered === derivatives.length) {
        // All derivatives have Source coverage → close this gap
        // Remove "Source" from missingFrom
        gap.missingFrom = gap.missingFrom.filter((t) => t !== 'Source');
        if (gap.missingFrom.length === 0) {
          // No remaining gaps → mark for removal
          closedGapIndices.push(i);
        }
      } else if (covered > 0) {
        // Partial coverage → annotate
        gap.derivationStatus = {
          totalDerivatives: derivatives.length,
          coveredDerivatives: covered,
          uncoveredDerivatives: uncovered,
        };
      }
    }

    // Remove fully closed gaps (iterate in reverse to preserve indices)
    for (let i = closedGapIndices.length - 1; i >= 0; i--) {
      reports.splice(closedGapIndices[i], 1);
    }
  }

  return reports;
}

// ---------------------------------------------------------------------------
// Partial-coverage gap detection (DD005)
// ---------------------------------------------------------------------------

/**
 * Options for the trace-based partial-coverage gap detection.
 *
 * @implements {DD005.§DC.04} projectionFilter as optional restriction
 * @implements {DD005.§DC.10} includeZeroCoverage option
 * @implements {DD005.§DC.11} excludeClosed/excludeDeferred lifecycle filters
 */
export interface PartialCoverageOptions {
  /** Scope gap analysis to a single note's claims. */
  noteId?: string;
  /** Restrict columns to these projection types (from --projection flag or config). */
  projectionFilter?: string[];
  /** Include claims with zero coverage (no references at all). Default: false. */
  includeZeroCoverage?: boolean;
  /** Exclude closed claims. Default: true. */
  excludeClosed?: boolean;
  /** Exclude deferred claims. Default: true. */
  excludeDeferred?: boolean;
}

/**
 * Discover projection types and build gap rows directly from the claim index,
 * filtering to claims with partial coverage — at least one projection with
 * references and at least one without.
 *
 * Unlike `findGaps()` which requires a pre-configured list of projection types,
 * this function discovers types dynamically from actual cross-references.
 *
 * @implements {DD005.§DC.01} Partial coverage filtering
 * @implements {DD005.§DC.02} Aggregate across all claim-defining notes
 * @implements {DD005.§DC.03} Dynamic projection type discovery
 * @implements {DD005.§DC.15} Exclude zero-coverage by default
 * @implements {DD005.§DC.16} Exclude full-coverage
 * @implements {DD005.§DC.17} Single-projection handling
 */
export function findPartialCoverageGaps(
  index: ClaimIndexData,
  options?: PartialCoverageOptions,
): TraceabilityMatrix {
  const excludeClosed = options?.excludeClosed ?? true;
  const excludeDeferred = options?.excludeDeferred ?? true;

  // Step 1: Build per-source-type projection maps.
  // For each source note type, discover which projection types have coverage
  // from at least one claim of that type. A gap is only meaningful when
  // sibling claims (same source type) have coverage in a projection type.
  const coverageBySourceType = new Map<string, Set<string>>();

  for (const entry of index.entries.values()) {
    if (options?.noteId && entry.noteId !== options.noteId) continue;
    if (entry.lifecycle) {
      if (excludeClosed && entry.lifecycle.type === 'closed') continue;
      if (excludeDeferred && entry.lifecycle.type === 'deferred') continue;
      if (entry.lifecycle.type === 'removed') continue;
      if (entry.lifecycle.type === 'superseded') continue;
    }

    const incomingRefs = index.crossRefs.filter(
      (ref) => ref.toClaim === entry.fullyQualified,
    );

    for (const ref of incomingRefs) {
      const fromType = index.noteTypes.get(ref.fromNoteId) ?? 'Unknown';
      if (fromType === entry.noteType) continue; // skip self-type refs
      let typeSet = coverageBySourceType.get(entry.noteType);
      if (!typeSet) {
        typeSet = new Set<string>();
        coverageBySourceType.set(entry.noteType, typeSet);
      }
      typeSet.add(fromType);
    }
  }

  // Step 2: Apply explicit projection filter if provided
  if (options?.projectionFilter && options.projectionFilter.length > 0) {
    const filterSet = new Set(options.projectionFilter);
    for (const [sourceType, projTypes] of coverageBySourceType) {
      const filtered = new Set([...projTypes].filter(t => filterSet.has(t)));
      coverageBySourceType.set(sourceType, filtered);
    }
  }

  // Step 3: For each claim entry, build a TraceabilityRow with projections
  // from cross-references, then filter to partial coverage within that
  // source type's relevant projection types.
  const gapRows: TraceabilityRow[] = [];

  for (const entry of index.entries.values()) {
    if (options?.noteId && entry.noteId !== options.noteId) continue;
    if (entry.lifecycle) {
      if (excludeClosed && entry.lifecycle.type === 'closed') continue;
      if (excludeDeferred && entry.lifecycle.type === 'deferred') continue;
      if (entry.lifecycle.type === 'removed') continue;
      if (entry.lifecycle.type === 'superseded') continue;
    }

    // Get the projection types relevant to this claim's source type
    const relevantTypes = coverageBySourceType.get(entry.noteType);
    if (!relevantTypes || relevantTypes.size === 0) continue;

    // Find all cross-references pointing TO this claim
    const incomingRefs = index.crossRefs.filter(
      (ref) => ref.toClaim === entry.fullyQualified,
    );

    // Build projections map: group references by the note type of the referring note
    const projections = new Map<string, ProjectionPresence[]>();
    for (const ref of incomingRefs) {
      const fromType = index.noteTypes.get(ref.fromNoteId) ?? 'Unknown';
      const presence: ProjectionPresence = {
        noteId: ref.fromNoteId,
        noteType: fromType,
        claimId: ref.fromClaim,
        line: ref.line,
      };
      const existing = projections.get(fromType) ?? [];
      existing.push(presence);
      projections.set(fromType, existing);
    }

    // Count coverage against this source type's relevant projection types
    let filledCount = 0;
    let emptyCount = 0;

    for (const pType of relevantTypes) {
      const presences = projections.get(pType);
      if (presences && presences.length > 0) {
        filledCount++;
      } else {
        emptyCount++;
      }
    }

    // DC.16: full coverage — skip
    if (emptyCount === 0) continue;

    // DC.15: zero coverage — skip unless includeZeroCoverage
    if (filledCount === 0 && !options?.includeZeroCoverage) continue;

    // DC.17: single-projection — only a gap if explicit filter
    if (relevantTypes.size <= 1 && !options?.projectionFilter) continue;

    gapRows.push({
      claimId: entry.fullyQualified,
      claimPrefix: entry.claimPrefix,
      claimNumber: entry.claimNumber,
      ...(entry.claimSubLetter ? { claimSubLetter: entry.claimSubLetter } : {}),
      heading: entry.heading,
      sectionPath: entry.sectionPath,
      metadata: entry.metadata,
      importance: entry.importance,
      lifecycle: entry.lifecycle,
      derivedFrom: entry.derivedFrom,
      projections,
      noteType: entry.noteType,
      relevantProjections: relevantTypes,
    });
  }

  // Sort rows by note ID, then section path, then claim number
  gapRows.sort((a, b) => {
    const noteIdCmp = a.claimId.localeCompare(b.claimId);
    if (noteIdCmp !== 0) return noteIdCmp;
    const pathCmp = compareSectionPaths(a.sectionPath, b.sectionPath);
    if (pathCmp !== 0) return pathCmp;
    return a.claimNumber - b.claimNumber;
  });

  // Columns are the union of relevant projection types across displayed rows.
  // Only include types that are in at least one row's relevantProjections set —
  // this ensures irrelevant types (e.g., Exploration for Architecture claims)
  // don't become columns even if they happen to have coverage on some row.
  const activeTypes = new Set<string>();
  for (const row of gapRows) {
    if (row.relevantProjections) {
      for (const t of row.relevantProjections) {
        if (t !== row.noteType) {
          activeTypes.add(t);
        }
      }
    }
  }

  return {
    sourceNoteId: options?.noteId ?? '(all)',
    sourceNoteType: options?.noteId
      ? (index.noteTypes.get(options.noteId) ?? '')
      : '',
    rows: gapRows,
    projectionTypes: [...activeTypes].sort(),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
