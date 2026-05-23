/**
 * Incidence collector — unifies note-site and source-site audit findings into
 * a single discriminated-union record. The collectors walk the resolved index
 * outcomes and the source scanner's references, synthesizing lifecycle-flag
 * codes (archived / soft-deleted) at consumer level per the (c) pattern from
 * {DD021.§10.DC.06}.
 *
 * Function bodies arrive in Steps 3 and 7 of the DD022 integration sequence;
 * this skeleton declares the public types so consumers (filters, formatters,
 * orchestrator) can import a stable shape.
 *
 * @see {DD022.§10.2} Incidence Collector module
 */

import type { ResolverFailureCode } from '../reference-resolver.js';
import { resolveReference } from '../reference-resolver.js';
import type {
  ClaimCrossReference,
  ClaimIndexData,
  ClaimIndexEntry,
} from '../claim-index.js';
import type {
  SourceReference,
  SourceReferenceType,
} from '../../types/reference.js';
import type { SourceCodeScanner } from '../../scanners/source-code-scanner.js';
import type {
  ClaimErrorCode,
  ClaimTreeError,
} from '../../parsers/claim/index.js';
import { parseClaimAddress } from '../../parsers/claim/index.js';
import { isDeletionMarker } from '../../lifecycle/deletion-marker.js';
import path from 'path';

/**
 * Discriminated union of every code that can appear on an `IncidenceRecord`.
 *
 * The union is the conjunction of three sources:
 *  - {@link ResolverFailureCode} — every code the unified resolver emits per {DD021.§10.DC.02}.
 *  - {@link ClaimErrorCode} — every code the per-note linter emits per `ClaimTreeError.type`.
 *  - `'reference-to-soft-deleted'` — the only NEW code this DD authorizes, synthesized
 *    consumer-side from `entry.softDeleted === true` per {DD022.§7 OQ.03}.
 *
 * NOTE: Most ResolverFailureCode values are also in ClaimErrorCode (the parser
 * union was widened to cover them per {DD021.§10.DC.09} parallel-emit). The
 * union here is set-theoretic, not enumeration-by-enumeration: TypeScript
 * dedups overlapping members automatically.
 *
 * @see {DD022.§10.2.DC.03} IncidenceCode union
 * @see {DD022.§7 OQ.03} `reference-to-soft-deleted` is the only new code; synthesized consumer-side
 */
export type IncidenceCode =
  | ResolverFailureCode
  | ClaimErrorCode
  | 'reference-to-soft-deleted';

/**
 * Discriminated union of an incidence's citing site.
 *
 * - `note-site`: citation appears in a note's markdown content. `noteId` is
 *   the citing note's ID; `claimId` is the citing claim's FQID (undefined
 *   when the citation is at prose level, not inside a claim definition);
 *   `section` is the section path of the citing claim.
 * - `source-site`: citation appears in a source-code annotation. `filePath`
 *   is absolute; `relativePath` is relative to the project root (for display
 *   stability across machines); `annotationType` records which annotation
 *   carried it (`@implements`, `@validates`, etc.).
 *
 * @see {DD022.§10.2.DC.03} IncidenceSite shape
 * @see {DD022.§10.2.DC.04} IncidenceSite is part of the canonical JSON contract
 */
export type IncidenceSite =
  | {
      kind: 'note-site';
      noteId: string;
      claimId?: string;
      section?: string;
      line: number;
      sourceSnippet: string;
      filePath: string;
    }
  | {
      kind: 'source-site';
      filePath: string;
      relativePath: string;
      line: number;
      annotationType: SourceReferenceType;
      sourceSnippet: string;
    };

/**
 * Unified audit-finding record. One `IncidenceRecord` per cited site per
 * error code — the JSON formatter emits these flat, the human formatter
 * groups them by code → target → site.
 *
 * The TypeScript declaration order of fields IS the canonical JSON-key
 * order per {DD022.§10.2.DC.04}. Field renames, removals, or insertions
 * are breaking changes.
 *
 * @see {DD022.§10.2.DC.03} IncidenceRecord shape
 * @see {DD022.§10.2.DC.04} canonical JSON contract
 * @see {R016.§5.AC.02} JSON `incidences` array element shape
 */
export interface IncidenceRecord {
  code: IncidenceCode;
  /** The raw target token cited (e.g., 'R042', 'R042.§1.AC.03'). */
  targetRaw: string;
  /** The note ID portion of the target (after stripping any claim suffix), for grouping. May be undefined for malformed targets. */
  targetNoteId?: string;
  /** Resolver-supplied detail (canonical FQID for archived/soft-deleted; structural-error message for non-reference codes). */
  resolverDetail?: string;
  site: IncidenceSite;
  /** Set on `resolved`-but-lifecycle-flagged outcomes — `archived` or `soft-deleted`. */
  lifecycleFlag?: 'archived' | 'soft-deleted';
}

/**
 * Canonical reference-resolution-family code set per {R004.§4.AC.07} plus the
 * new `reference-to-soft-deleted` per {DD022.§7 OQ.03}.
 *
 * Consumed by `applyRefsOnlyFilter` ({DD022.§10.3.DC.15}) and by the human
 * formatter ({DD022.§10.4.DC.19}) for grouping order.
 *
 * @see {DD022.§10.3.DC.15} REFERENCE_FAMILY_CODES
 */
export const REFERENCE_FAMILY_CODES: ReadonlySet<IncidenceCode> = new Set<IncidenceCode>([
  'reference-to-unknown-note',
  'reference-to-undefined-claim',
  'reference-to-archived',
  'reference-to-soft-deleted',
  'malformed-claim-reference',
  'derivation-target-bare-note-id',
  'derivation-target-cross-project',
  'derivation-target-removed',
  'derivation-target-superseded',
  'derivation-target-ambiguous',
]);

/**
 * Codes that {DD021.§10.DC.09} parallel-emits as legacy companions to the new
 * resolver-emitted codes. The new code is the source of truth for the audit;
 * the legacy code is grep-stability infrastructure during the transition
 * window. Suppressing legacy codes here avoids double-counting incidences
 * (the per-note linter continues to emit both via `data.errors`).
 */
const LEGACY_PARALLEL_EMIT_CODES: ReadonlySet<string> = new Set([
  'unresolved-reference',
  'unresolvable-derivation-target',
  'cross-project-derives',
  'derivation-from-removed',
  'derivation-from-superseded',
]);

/**
 * Alias/peer reference errors surfaced by `validateAliasReferences` per
 * {R011.§3.AC.06}. These are cross-project diagnostics — the audit excludes
 * them per {R016} Edge Cases ("Cross-Project Citations"). In practice, these
 * codes are not pushed to `data.errors` by `ClaimIndex.build()` — they're
 * routed through a separate per-note path — so this set is defensive only.
 */
const CROSS_PROJECT_ERROR_CODES: ReadonlySet<string> = new Set([
  'alias-unknown',
  'peer-unresolved',
  'peer-target-not-found',
]);

/** Note-ID grammar; mirrors `claim-parser.ts:NOTE_ID_RE`. */
const NOTE_ID_RE = /^([A-Z]{1,5}\d{3,5})/;

/**
 * Extract the citing claim ID from a `ClaimCrossReference.fromClaim`. The
 * index uses a sentinel of the form `<noteId>:line-<N>` when the citation
 * is outside any claim (prose-level reference); in that case there is no
 * citing claim FQID and we return undefined.
 */
function extractCitingClaim(ref: ClaimCrossReference): string | undefined {
  const sentinel = `${ref.fromNoteId}:line-${ref.line}`;
  return ref.fromClaim === sentinel ? undefined : ref.fromClaim;
}

/**
 * Parse the note-ID portion of a raw target token. Returns undefined when
 * the token doesn't start with the note-ID grammar (e.g., malformed input
 * or a section-only/claim-only reference).
 */
function parseTargetNoteId(rawTarget: string): string | undefined {
  const match = rawTarget.match(NOTE_ID_RE);
  return match ? match[1] : undefined;
}

/**
 * Build a `note-site` IncidenceSite from a cross-reference. The `sourceSnippet`
 * is intentionally empty here — the human formatter ({DD022.§10.4.DC.19})
 * loads file contents lazily at render time, batched by filePath.
 */
function buildNoteSite(ref: ClaimCrossReference) {
  const claimId = extractCitingClaim(ref);
  return {
    kind: 'note-site' as const,
    noteId: ref.fromNoteId,
    ...(claimId !== undefined ? { claimId } : {}),
    line: ref.line,
    sourceSnippet: '',
    filePath: ref.filePath,
  };
}

/**
 * Build a `note-site` IncidenceSite from a structural error. Structural
 * errors have `claimId` (the FQID of the offending claim), `line`, optional
 * `noteId` and `noteFilePath`.
 */
function buildStructuralSite(error: ClaimTreeError) {
  const noteId = error.noteId ?? parseTargetNoteId(error.claimId) ?? '';
  return {
    kind: 'note-site' as const,
    noteId,
    claimId: error.claimId,
    line: error.line,
    sourceSnippet: '',
    filePath: error.noteFilePath ?? '',
  };
}

/**
 * Synthesize an archived-citation incidence for a resolved-but-archived edge.
 * Mirrors the (c) consumer-synthesis pattern from {DD021.§10.DC.06} as
 * realized in `lint-command.ts:collectInlineRefArchiveSynthesis`.
 *
 * @implements {DD022.§10.2.DC.06} consumer-side synthesis of reference-to-archived
 * @implements {R016.§4.AC.01} archived citations flagged in default sweep
 */
function synthesizeArchivedNoteIncidence(
  ref: ClaimCrossReference,
  entry: ClaimIndexEntry,
): IncidenceRecord {
  return {
    code: 'reference-to-archived',
    targetRaw: ref.toClaim,
    targetNoteId: entry.noteId,
    site: buildNoteSite(ref),
    lifecycleFlag: 'archived',
  };
}

/**
 * Synthesize a soft-deleted-citation incidence for a resolved-but-soft-deleted
 * edge. The pattern mirrors the archive synthesis; the precondition
 * `ClaimIndexEntry.softDeleted` is realized at `claim-index.ts:197` per
 * {DD022.§12} (Primitive Preconditions row).
 *
 * @implements {DD022.§10.2.DC.07} consumer-side synthesis of reference-to-soft-deleted
 * @implements {R016.§4.AC.02} soft-deleted citations flagged in default sweep
 */
function synthesizeSoftDeletedNoteIncidence(
  ref: ClaimCrossReference,
  entry: ClaimIndexEntry,
): IncidenceRecord {
  return {
    code: 'reference-to-soft-deleted',
    targetRaw: ref.toClaim,
    targetNoteId: entry.noteId,
    site: buildNoteSite(ref),
    lifecycleFlag: 'soft-deleted',
  };
}

function buildUnresolvedNoteIncidence(
  ref: ClaimCrossReference,
  code: IncidenceCode,
  detail?: string,
): IncidenceRecord {
  const targetNoteId = parseTargetNoteId(ref.toClaim);
  return {
    code,
    targetRaw: ref.toClaim,
    ...(targetNoteId !== undefined ? { targetNoteId } : {}),
    ...(detail !== undefined ? { resolverDetail: detail } : {}),
    site: buildNoteSite(ref),
  };
}

function buildStructuralIncidence(error: ClaimTreeError): IncidenceRecord {
  const fallbackTargetNoteId = parseTargetNoteId(error.claimId);
  const targetNoteId = error.noteId ?? fallbackTargetNoteId;
  return {
    code: error.type,
    targetRaw: error.claimId,
    ...(targetNoteId !== undefined ? { targetNoteId } : {}),
    resolverDetail: error.message,
    site: buildStructuralSite(error),
  };
}

/**
 * Walk the claim index's cross-references and structural errors, emitting
 * incidences for unresolved/ambiguous edges and synthesizing lifecycle-flag
 * incidences (archived/soft-deleted) for resolved-but-flagged edges.
 *
 * Source-code edges (those added by `ClaimIndex.addSourceReferences`) are
 * excluded here by `resolverOutcome === undefined` — they don't carry a
 * resolver outcome because the index attaches one only on the inline-ref
 * resolution path. Source edges are processed independently by
 * {@link collectSourceIncidences} in the `--code` branch.
 *
 * Tombstoned tokens (`_deleted_<ID>_at_<TS>`) are dropped silently — they
 * are a recognized lifecycle state per {R015.§5.AC.01}, not a failure.
 *
 * @implements {DD022.§10.2.DC.05} collectNoteIncidences walks crossRefs and data.errors
 * @implements {DD022.§10.2.DC.08} isDeletionMarker pre-check before emit
 * @implements {R016.§1.AC.01} project-wide note sweep
 * @implements {R016.§4.AC.05} tombstones preserved verbatim
 * @implements {R016.§6.AC.01} resolution via {DD021} resolver (consumed from resolverOutcome)
 */
export function collectNoteIncidences(data: ClaimIndexData): IncidenceRecord[] {
  const records: IncidenceRecord[] = [];

  // (A) Walk cross-reference edges. Each carries a `resolverOutcome` for
  // inline references resolved by `ClaimIndex.build()` via {DD021}'s
  // `resolveReference`. Source-code edges (added by `addSourceReferences`)
  // do NOT carry a `resolverOutcome` and are skipped here.
  for (const ref of data.crossRefs) {
    if (ref.resolverOutcome === undefined) continue;

    // DC.08: drop tombstoned tokens silently.
    const leadingToken = ref.toClaim.split('.', 1)[0];
    if (isDeletionMarker(leadingToken)) continue;

    const outcome = ref.resolverOutcome;
    if (outcome.kind === 'resolved') {
      const entry = outcome.entry;
      if (entry.archived === true) {
        records.push(synthesizeArchivedNoteIncidence(ref, entry));
      } else if (entry.softDeleted === true) {
        records.push(synthesizeSoftDeletedNoteIncidence(ref, entry));
      }
      // Else: resolved + live — no incidence.
    } else if (outcome.kind === 'unresolved') {
      records.push(buildUnresolvedNoteIncidence(ref, outcome.code, outcome.detail));
    } else {
      // Ambiguous inline outcomes: the DD itself flags the exact code as
      // specification-layer TBD per DC.05. We map by analogy to the
      // derives-position ambiguity, which the existing claim-index.ts:545-552
      // path already maps to `derivation-target-ambiguous`.
      records.push(
        buildUnresolvedNoteIncidence(
          ref,
          'derivation-target-ambiguous',
          outcome.candidates.length > 0
            ? `Ambiguous resolution; candidates: ${outcome.candidates.join(', ')}`
            : undefined,
        ),
      );
    }
  }

  // (B) Walk structural errors. These carry `claimId`, `line`, `message`,
  // optional `noteId`/`noteFilePath`. Filter out legacy parallel-emit codes
  // (already represented by their new-code companion) and cross-project
  // diagnostics (out of scope per Edge Cases).
  for (const error of data.errors) {
    if (LEGACY_PARALLEL_EMIT_CODES.has(error.type)) continue;
    if (CROSS_PROJECT_ERROR_CODES.has(error.type)) continue;
    records.push(buildStructuralIncidence(error));
  }

  return records;
}

/**
 * Build a `source-site` IncidenceSite from a SourceReference. `projectRoot`
 * is used to derive `relativePath`; when undefined or the path is outside
 * the project root, `relativePath` falls back to `filePath`.
 */
function buildSourceSite(
  ref: SourceReference,
  projectRoot: string | undefined,
) {
  const relativePath = projectRoot
    ? path.relative(projectRoot, ref.filePath) || ref.filePath
    : ref.filePath;
  return {
    kind: 'source-site' as const,
    filePath: ref.filePath,
    relativePath,
    line: ref.line ?? 0,
    annotationType: ref.referenceType,
    sourceSnippet: ref.context ?? '',
  };
}

/**
 * Process a single SourceReference through the unified resolver and produce
 * a source-site IncidenceRecord (or null if the ref should be silently
 * dropped — cross-project, tombstoned, or resolved-and-live).
 *
 * Shared by `collectSourceIncidences` (project-wide --all --code path) and
 * the per-note `--code` branch in `lint-command.ts` per {DD022.§10.5.DC.25}.
 *
 * @implements {DD022.§10.2.DC.08} isDeletionMarker check before emit
 * @implements {DD022.§10.2.DC.09} resolver-routing logic for source refs
 * @implements {DD022.§10.2.DC.10} cross-project annotations excluded via address.aliasPrefix
 */
export function processSourceReference(
  ref: SourceReference,
  data: ClaimIndexData,
  projectRoot: string | undefined,
): IncidenceRecord | null {
  // (1) Tombstone exclusion per DC.08. The note-ID portion is ref.toId
  // (which is the bare note ID at the SourceReference layer).
  if (isDeletionMarker(ref.toId)) return null;

  // (2) Parse the address to discover alias-prefixed (cross-project)
  // annotations per DC.10. The parsed address is also reused for the
  // resolver call below — single parse, dual purpose.
  const rawTarget = ref.claimPath ? `${ref.toId}${ref.claimPath}` : ref.toId;
  const address = parseClaimAddress(rawTarget);
  if (address === null) {
    // Grammar-level malformed citation. Surface as malformed-claim-reference.
    return {
      code: 'malformed-claim-reference',
      targetRaw: rawTarget,
      site: buildSourceSite(ref, projectRoot),
    };
  }

  if (address.aliasPrefix !== undefined) {
    // Cross-project — excluded per {R011.§3.AC.03} and R016 Edge Cases.
    return null;
  }

  // (3) Route through the unified resolver per {R016.§6.AC.01}. Use
  // includeArchived: true to match the (c) consumer-synthesis pattern from
  // {DD021.§10.DC.05} — archived entries return as `resolved` and we
  // synthesize the discrete code below.
  const outcome = resolveReference(address, data, { includeArchived: true });

  if (outcome.kind === 'resolved') {
    const entry = outcome.entry;
    if (entry.archived === true) {
      return {
        code: 'reference-to-archived',
        targetRaw: rawTarget,
        targetNoteId: entry.noteId,
        site: buildSourceSite(ref, projectRoot),
        lifecycleFlag: 'archived',
      };
    }
    if (entry.softDeleted === true) {
      return {
        code: 'reference-to-soft-deleted',
        targetRaw: rawTarget,
        targetNoteId: entry.noteId,
        site: buildSourceSite(ref, projectRoot),
        lifecycleFlag: 'soft-deleted',
      };
    }
    // Resolved + live — no incidence.
    return null;
  }
  const targetNoteId = parseTargetNoteId(rawTarget);
  if (outcome.kind === 'unresolved') {
    const detail = outcome.detail;
    return {
      code: outcome.code,
      targetRaw: rawTarget,
      ...(targetNoteId !== undefined ? { targetNoteId } : {}),
      ...(detail !== undefined ? { resolverDetail: detail } : {}),
      site: buildSourceSite(ref, projectRoot),
    };
  }
  // Ambiguous — per Section 3 Finding #5, map to derivation-target-ambiguous.
  return {
    code: 'derivation-target-ambiguous',
    targetRaw: rawTarget,
    ...(targetNoteId !== undefined ? { targetNoteId } : {}),
    ...(outcome.candidates.length > 0
      ? {
          resolverDetail: `Ambiguous resolution; candidates: ${outcome.candidates.join(', ')}`,
        }
      : {}),
    site: buildSourceSite(ref, projectRoot),
  };
}

/**
 * Walk the source-code scanner's references and route each through the
 * unified resolver, emitting source-site incidences for unresolved/ambiguous
 * outcomes and lifecycle-flag synthesis on resolved-but-flagged edges.
 *
 * Signature is verbatim per {DD022.§10.2.DC.09}. The scanner argument is
 * used to fetch the full reference list; per-reference processing is
 * delegated to {@link processSourceReference} which the per-note `--code`
 * path (`lint-command.ts`) also calls.
 *
 * @implements {DD022.§10.2.DC.09} collectSourceIncidences walks scanner.getIndex().getAllReferences()
 * @implements {DD022.§10.2.DC.10} cross-project annotations excluded
 * @implements {R016.§1.AC.02} --code source-scan integration
 * @implements {R016.§6.AC.01} resolution via {DD021} resolver
 */
export function collectSourceIncidences(
  scanner: SourceCodeScanner,
  data: ClaimIndexData,
): IncidenceRecord[] {
  const records: IncidenceRecord[] = [];
  const refs = scanner.getIndex().getAllReferences();
  const projectRoot = scanner.getProjectPath();
  for (const ref of refs) {
    const incidence = processSourceReference(ref, data, projectRoot);
    if (incidence !== null) records.push(incidence);
  }
  return records;
}
