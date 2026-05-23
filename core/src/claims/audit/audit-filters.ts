/**
 * Audit filter predicates — five pure functions over `IncidenceRecord[]`.
 *
 * Each filter takes its flag parameter directly and gates internally on the
 * flag (no-op identity when the flag is absent). Per {DD022.§10.3.DC.14}, the
 * orchestrator calls all five unconditionally in canonical pipeline order
 * (refs-only → codes → target → archived → soft-deleted), keeping the code
 * path uniform.
 *
 * @see {DD022.§10.3} Audit Filters module
 */

import type { IncidenceRecord, IncidenceCode } from './incidence-collector.js';
import { REFERENCE_FAMILY_CODES } from './incidence-collector.js';
import { CLAIM_ERROR_CODES } from '../../parsers/claim/index.js';

// ---------------------------------------------------------------------------
// Recognized-codes union (for `applyCodesFilter` input validation)
// ---------------------------------------------------------------------------

/**
 * Union of REFERENCE_FAMILY_CODES and CLAIM_ERROR_CODES — every code that
 * `applyCodesFilter` accepts as a valid input. Lazy-computed once at first
 * call to avoid module-init order concerns.
 *
 * Per {DD022.§10.3.DC.16} strict reading: the recognized set is the union of
 * REFERENCE_FAMILY_CODES and ClaimTreeError.type (exported as
 * CLAIM_ERROR_CODES). Legacy parallel-emit codes (e.g., `unresolved-reference`)
 * are INCLUDED here — they're in `ClaimTreeError.type`. The audit's collector
 * suppresses them upstream so they won't surface in incidence output, but the
 * filter accepts them as user inputs and returns an empty result set, which
 * is the friendly UX.
 */
let _recognizedCodes: ReadonlySet<string> | null = null;
function getRecognizedCodes(): ReadonlySet<string> {
  if (_recognizedCodes === null) {
    _recognizedCodes = new Set<string>([
      ...REFERENCE_FAMILY_CODES,
      ...CLAIM_ERROR_CODES,
    ]);
  }
  return _recognizedCodes;
}

// ---------------------------------------------------------------------------
// Filter predicates
// ---------------------------------------------------------------------------

/**
 * Drop records whose `code` is NOT in {@link REFERENCE_FAMILY_CODES}. No-op
 * when `refsOnly === false` per DC.14 in-filter flag-gate pattern.
 *
 * @implements {DD022.§10.3.DC.15} applyRefsOnlyFilter
 * @implements {R016.§3.AC.01} --refs-only suppresses non-reference findings
 */
export function applyRefsOnlyFilter(
  records: IncidenceRecord[],
  refsOnly: boolean,
): IncidenceRecord[] {
  if (!refsOnly) return records;
  return records.filter((r) => REFERENCE_FAMILY_CODES.has(r.code));
}

/**
 * Drop records whose `code` is not in the supplied list. Throws on unknown
 * codes, surfacing the recognized set in the error message. No-op when
 * `codes` is undefined or empty per DC.14 in-filter flag-gate pattern.
 *
 * @implements {DD022.§10.3.DC.16} applyCodesFilter validates input against
 *   REFERENCE_FAMILY_CODES ∪ CLAIM_ERROR_CODES
 * @implements {R016.§3.AC.02} --codes filter; unknown-code error
 */
export function applyCodesFilter(
  records: IncidenceRecord[],
  codes: string[] | undefined,
): IncidenceRecord[] {
  if (codes === undefined || codes.length === 0) return records;

  const recognized = getRecognizedCodes();
  const unknown = codes.filter((c) => !recognized.has(c));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown error code(s): ${unknown.join(', ')}. ` +
        `Recognized codes: ${Array.from(recognized).sort().join(', ')}`,
    );
  }

  const codesSet = new Set(codes);
  return records.filter((r) => codesSet.has(r.code));
}

/**
 * Filter records to those citing one of the supplied target tokens. Targets
 * MAY be IDs that do not exist in the index — the matching is textual, not
 * an existence check ({R016.§2.AC.02}). No-op when `targets` is undefined or
 * empty per DC.14 in-filter flag-gate pattern.
 *
 * Two matching modes per {DD022.§10.3.DC.13}:
 *  - Note-level token (`R042`): matches any record with `targetNoteId === 'R042'`,
 *    regardless of claim suffix.
 *  - Claim-level token (`R042.§1.AC.03`): matches only records whose normalized
 *    `targetRaw` equals the claim-level FQID.
 *
 * @implements {DD022.§10.3.DC.11} applyTargetFilter
 * @implements {DD022.§10.3.DC.12} targets MAY be absent (no existence check)
 * @implements {DD022.§10.3.DC.13} note-level vs claim-level matching semantics
 * @implements {R016.§2.AC.01} --target accepts comma-separated note IDs and FQIDs
 * @implements {R016.§2.AC.02} targets MAY be absent
 * @implements {R016.§2.AC.03} claim-level vs note-level scope
 */
export function applyTargetFilter(
  records: IncidenceRecord[],
  targets: string[] | undefined,
): IncidenceRecord[] {
  if (targets === undefined || targets.length === 0) return records;

  // Pre-parse targets into note-level and claim-level sets.
  const noteLevelTargets = new Set<string>();
  const claimLevelTargets = new Set<string>();
  const NOTE_ID_ONLY = /^[A-Z]{1,5}\d{3,5}$/;
  for (const t of targets) {
    const normalized = normalizeTargetToken(t);
    if (NOTE_ID_ONLY.test(normalized)) {
      noteLevelTargets.add(normalized);
    } else {
      claimLevelTargets.add(normalized);
    }
  }

  return records.filter((r) => {
    if (r.targetNoteId && noteLevelTargets.has(r.targetNoteId)) return true;
    if (claimLevelTargets.has(normalizeTargetToken(r.targetRaw))) return true;
    return false;
  });
}

/**
 * Drop records whose `code === 'reference-to-archived'` when the user opts
 * to treat archived notes as valid resolution targets. No-op when
 * `includeArchivedAsValid === false` per DC.14 in-filter flag-gate pattern.
 *
 * @implements {DD022.§10.3.DC.17} applyArchivedOptOut
 * @implements {R016.§4.AC.03} --include-archived-as-valid suppresses archived findings
 */
export function applyArchivedOptOut(
  records: IncidenceRecord[],
  includeArchivedAsValid: boolean,
): IncidenceRecord[] {
  if (!includeArchivedAsValid) return records;
  return records.filter((r) => r.code !== 'reference-to-archived');
}

/**
 * Drop records whose `code === 'reference-to-soft-deleted'` when the user
 * opts to treat soft-deleted notes as valid resolution targets. No-op when
 * `includeSoftDeletedAsValid === false` per DC.14 in-filter flag-gate pattern.
 *
 * @implements {DD022.§10.3.DC.18} applySoftDeletedOptOut
 * @implements {R016.§4.AC.04} --include-soft-deleted-as-valid suppresses soft-deleted findings
 */
export function applySoftDeletedOptOut(
  records: IncidenceRecord[],
  includeSoftDeletedAsValid: boolean,
): IncidenceRecord[] {
  if (!includeSoftDeletedAsValid) return records;
  return records.filter((r) => r.code !== 'reference-to-soft-deleted');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip `§` characters from a target token. Mirrors the normalization
 * `claim-index.ts:521` does for resolver input.
 */
function normalizeTargetToken(raw: string): string {
  return raw.replace(/§/g, '');
}

// Re-export IncidenceCode for downstream consumers that import the filter
// signatures and want the type alongside.
export type { IncidenceCode };
