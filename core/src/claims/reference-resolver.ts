/**
 * Unified reference resolver — the single normative resolution path for every
 * claim-CLI consumer (lint, trace, gaps, dependents, show, and any future
 * consumer). Replaces the per-consumer resolution logic that previously lived
 * in `claim-index.ts:resolveClaimAddress` and
 * `cli/commands/shared/resolve-claim-id.ts:resolveClaimInput`.
 *
 * @implements {DD021.§10.DC.01} resolveReference entry point + outcome shape
 * @implements {DD021.§10.DC.02} ResolverFailureCode discriminated union
 * @see {R004.§4.AC.07} unresolved-reference taxonomy split
 * @see {R004.§4.AC.08} shared lint/trace resolver invariant
 * @see {R006.§5.AC.04} resolver-owned failure-mode taxonomy
 */

import type { ClaimAddress } from '../parsers/claim/claim-parser.js';
import { parseClaimAddress } from '../parsers/claim/claim-parser.js';
import type { ClaimIndexData, ClaimIndexEntry } from './claim-index.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Discriminated union of every resolver-emitted failure code, plus the legacy
 * umbrella codes retained for transition-window parallel-emit per DC.09.
 *
 * Each new code is produced under exactly one structural condition; codes MUST
 * NOT be reused across structurally distinct conditions. Consumers (lint,
 * trace, VS Code diagnostics) render against this union.
 */
export type ResolverFailureCode =
  // The cited noteId is absent from the index entirely.
  | 'reference-to-unknown-note'
  // The cited noteId exists in the index but no entry matches the claim suffix.
  | 'reference-to-undefined-claim'
  // The citation resolves to an archived-note entry AND the caller opted to
  // treat archived as failure (opts.includeArchived === false).
  | 'reference-to-archived'
  // The raw input failed to parse as a ClaimAddress at the grammar level.
  | 'malformed-claim-reference'
  // `derives=` value is a bare note ID; claim-level address required.
  | 'derivation-target-bare-note-id'
  // `derives=` value is alias-prefixed; cross-project derivation is rejected.
  | 'derivation-target-cross-project'
  // `derives=` resolved to a `:removed` claim (post-resolution decoration).
  | 'derivation-target-removed'
  // `derives=` resolved to a `:superseded` claim (post-resolution decoration).
  | 'derivation-target-superseded'
  // `derives=` resolved ambiguously (section-less match against multiple
  // candidates).
  | 'derivation-target-ambiguous';

/**
 * Ambiguity discriminator on the `ambiguous` outcome kind. Two members in v1:
 *
 * - `bare-suffix`: a bare suffix like `AC.01` matched multiple sections of the
 *   current note (R004.§1.AC.04 same-note ambiguity, surfaced when the bare
 *   reference fails to resolve uniquely).
 * - `cross-note-section-less`: a section-less reference like `R030.PRI.01`
 *   matched multiple sections of the cited note (DC.03 cross-note ambiguity).
 *
 * @implements {DD021.§10.DC.03} section-less unique-match rule
 * @see {DD021.§7.OQ.03} disposition: single ambiguous outcome with reason
 */
export type AmbiguityReason = 'bare-suffix' | 'cross-note-section-less';

/**
 * The discriminated-union result of every `resolveReference()` call.
 *
 * @implements {DD021.§10.DC.01}
 */
export type ResolverOutcome =
  | { kind: 'resolved'; canonicalId: string; entry: ClaimIndexEntry }
  | { kind: 'ambiguous'; candidates: string[]; reason: AmbiguityReason }
  | { kind: 'unresolved'; code: ResolverFailureCode; detail?: string };

/**
 * Per-call options for `resolveReference()`.
 *
 * @implements {DD021.§10.DC.01}
 * @implements {DD021.§10.DC.05} includeArchived flag
 */
export interface ResolverOptions {
  /** Current note ID for scope-resolution of bare references (e.g., `AC.01`
   *  resolves to `<currentNoteId>.§*.AC.01`). */
  currentNoteId?: string;
  /** True when this is a `derives=` value, false for inline references.
   *  Activates the bare-note-id rejection rule (DC.04), the cross-project
   *  rejection emission (DC.02), and the derives-only failure codes. */
  derivesPosition?: boolean;
  /** When true (default), archived-note entries are eligible matches and the
   *  resolver returns `resolved` with `entry.archived === true`. When false,
   *  archived-note entries are treated as failures and the resolver returns
   *  `unresolved` with `code: 'reference-to-archived'`. The (c) consumer-side
   *  synthesis pattern (per R015.§1.AC.04b lint-downgrade-to-warning intent)
   *  uses the default `true`; the dormant `false` path is reserved for future
   *  consumers and is test-covered. */
  includeArchived?: boolean;
}

// ---------------------------------------------------------------------------
// Internal regex (mirrors claim-index.ts:CROSS_PROJECT_TARGET_RE)
// ---------------------------------------------------------------------------

/**
 * Cross-project alias prefix at the start of a raw target string.
 * Mirrors `claim-index.ts:CROSS_PROJECT_TARGET_RE`. Used for the
 * `derivesPosition: true` cross-project rejection path; alias-prefixed inline
 * references are filtered upstream by `claim-index.ts:540` per
 * R011.§3.AC.03 (display-only citations).
 */
const CROSS_PROJECT_TARGET_RE = /^[a-z][a-z0-9-]*[a-z0-9]\//;

/**
 * Note ID grammar (1-5 uppercase letters + 3-5 digits). Mirrors
 * `claim-parser.ts:NOTE_ID_RE`. Used to detect bare-note-id `derives=` values
 * per DC.04.
 */
const NOTE_ID_RE = /^[A-Z]{1,5}\d{3,5}$/;

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

/**
 * Resolve a claim reference to a canonical index entry, or produce a
 * discriminated failure outcome.
 *
 * Branching algorithm (per DD021 §4):
 *
 * 1. Pre-checks (kind-determination order):
 *    a. derivesPosition + bare note ID -> derivation-target-bare-note-id
 *    b. derivesPosition + alias-prefix -> derivation-target-cross-project
 *    c. parse failure (raw: string path) -> malformed-claim-reference
 * 2. Exact-match probe on index.entries[fqid]:
 *    a. Hit + not archived -> resolved
 *    b. Hit + archived + !includeArchived -> reference-to-archived
 *    c. Hit + archived + includeArchived -> resolved (entry.archived = true)
 * 3. Same-note scope probe (currentNoteId prefix).
 * 4. Section-less probe (DC.03 unique-match across sections).
 * 5. Note-presence vs claim-presence discrimination (DC.07):
 *    a. noteId absent -> reference-to-unknown-note
 *    b. noteId present, claim absent -> reference-to-undefined-claim
 *
 * @implements {DD021.§10.DC.01} single normative resolver
 * @implements {DD021.§10.DC.03} section-less unique-match rule
 * @implements {DD021.§10.DC.04} bare-note-id derives= detection
 * @implements {DD021.§10.DC.05} includeArchived flag semantics
 * @implements {DD021.§10.DC.06} reference-to-archived discrete code
 * @implements {DD021.§10.DC.07} note-presence vs claim-presence discrimination
 */
export function resolveReference(
  raw: string | ClaimAddress,
  index: ClaimIndexData,
  opts: ResolverOptions = {},
): ResolverOutcome {
  const includeArchived = opts.includeArchived ?? true;

  // ----- Step 1: Pre-checks (parse + derivesPosition short-circuits) -----

  let address: ClaimAddress;
  let rawText: string;

  if (typeof raw === 'string') {
    rawText = raw;

    // 1b: derivesPosition + alias-prefix short-circuit (cross-project).
    // Must fire before parseClaimAddress because alias-prefixed inputs do
    // parse successfully — the resolver's responsibility is to translate
    // them into the dedicated failure code when used in derives= position.
    // @implements {DD021.§10.DC.02} derivation-target-cross-project code
    if (opts.derivesPosition === true && CROSS_PROJECT_TARGET_RE.test(rawText)) {
      return { kind: 'unresolved', code: 'derivation-target-cross-project', detail: rawText };
    }

    // 1a: derivesPosition + bare note ID short-circuit. Must fire BEFORE
    // any note-existence check per DC.04 verbatim: "the detection MUST
    // fire before any note-existence check — a bare `derives=ARCH028`
    // produces this code even when ARCH028 exists in the index."
    // @implements {DD021.§10.DC.04}
    if (opts.derivesPosition === true && NOTE_ID_RE.test(rawText)) {
      return { kind: 'unresolved', code: 'derivation-target-bare-note-id', detail: rawText };
    }

    const parsed = parseClaimAddress(rawText);
    if (parsed === null) {
      // 1c: malformed (raw: string path only — the ClaimAddress branch
      // can't reach this because parse already succeeded upstream).
      // @implements {DD021.§10.DC.02} malformed-claim-reference code
      return { kind: 'unresolved', code: 'malformed-claim-reference', detail: rawText };
    }
    address = parsed;
  } else {
    address = raw;
    rawText = raw.raw;

    // ClaimAddress path: pre-parsed. Still apply derivesPosition shortcuts.
    if (opts.derivesPosition === true && address.aliasPrefix !== undefined) {
      return { kind: 'unresolved', code: 'derivation-target-cross-project', detail: rawText };
    }
    if (
      opts.derivesPosition === true &&
      address.noteId !== undefined &&
      address.claimPrefix === undefined
    ) {
      return { kind: 'unresolved', code: 'derivation-target-bare-note-id', detail: address.noteId };
    }
  }

  // ----- Step 2: Exact-match probe -----

  const exactFqid = buildFqid(address);
  if (exactFqid !== null) {
    const entry = index.entries.get(exactFqid);
    if (entry !== undefined) {
      return finalizeResolved(exactFqid, entry, includeArchived);
    }
  }

  // ----- Step 3: Same-note scope (prepend currentNoteId for bare refs) -----

  if (
    opts.currentNoteId !== undefined &&
    address.noteId === undefined &&
    address.claimPrefix !== undefined
  ) {
    const scoped: ClaimAddress = { ...address, noteId: opts.currentNoteId };

    // 3a: scoped exact-match probe (R042.§1.AC.01-shape resolution after prepend).
    const scopedFqid = buildFqid(scoped);
    if (scopedFqid !== null) {
      const entry = index.entries.get(scopedFqid);
      if (entry !== undefined) {
        return finalizeResolved(scopedFqid, entry, includeArchived);
      }
    }

    // 3b: scoped section-less enumeration — detects same-note bare-suffix
    // ambiguity per the {DD021.§7.OQ.03} disposition note ("Same-note
    // bare-suffix ambiguity is detected at exact-match-fail time"). When
    // the bare input has no sectionPath (e.g., `AC.01` inside R042),
    // enumerate `R042.§*.AC.01`; multi-match -> `ambiguous` with reason
    // `bare-suffix`; single-match -> `resolved`; zero-match -> commit the
    // scoped noteId so step 5's note-presence-vs-claim-presence check
    // produces `reference-to-undefined-claim` rather than degenerating.
    // @implements {DD021.§10.DC.03} bare-suffix-in-current-note ambiguity
    // @implements {DD021.§7.OQ.03} (closure) same-note bare-suffix discrimination
    if (
      scoped.claimNumber !== undefined &&
      (scoped.sectionPath === undefined || scoped.sectionPath.length === 0)
    ) {
      const matches = collectSectionlessMatches(scoped, index, includeArchived);
      if (matches.length === 1) {
        const [{ fqid, entry }] = matches;
        return { kind: 'resolved', canonicalId: fqid, entry };
      }
      if (matches.length > 1) {
        return {
          kind: 'ambiguous',
          candidates: matches.map(m => m.fqid),
          reason: 'bare-suffix',
        };
      }
      // Zero matches: commit the scope-prepend so step 5 sees the scoped
      // noteId and emits `reference-to-undefined-claim` (note exists, claim
      // absent) rather than `reference-to-undefined-claim` with a degenerate
      // raw-text detail.
      address = scoped;
    }
  }

  // ----- Step 4: Section-less probe (DC.03 unique-match rule) -----

  // Applies only when noteId + claimPrefix + claimNumber are present and
  // sectionPath is absent. Enumerate index entries matching
  // <noteId>.§*.<claimPrefix>.<claimNumber>; return resolved on unique
  // match, ambiguous on multiple, fall through on zero.
  if (
    address.noteId !== undefined &&
    address.claimPrefix !== undefined &&
    address.claimNumber !== undefined &&
    (address.sectionPath === undefined || address.sectionPath.length === 0)
  ) {
    const matches = collectSectionlessMatches(address, index, includeArchived);
    if (matches.length === 1) {
      const [{ fqid, entry }] = matches;
      // Archive filtering already applied inside collectSectionlessMatches
      // when includeArchived is false; we know the entry is eligible here.
      return { kind: 'resolved', canonicalId: fqid, entry };
    }
    if (matches.length > 1) {
      // @implements {DD021.§10.DC.03} multiple-match -> ambiguous
      return {
        kind: 'ambiguous',
        candidates: matches.map(m => m.fqid),
        reason: 'cross-note-section-less',
      };
    }
    // Zero matches: fall through to step 5.
  }

  // ----- Step 5: Note-presence vs claim-presence discrimination (DC.07) -----

  if (address.noteId !== undefined) {
    const notePresent = noteExistsInIndex(address.noteId, index);
    if (!notePresent) {
      // @implements {DD021.§10.DC.07} unknown-note case
      return {
        kind: 'unresolved',
        code: 'reference-to-unknown-note',
        detail: address.noteId,
      };
    }
    // @implements {DD021.§10.DC.07} undefined-claim case
    return {
      kind: 'unresolved',
      code: 'reference-to-undefined-claim',
      detail: rawText,
    };
  }

  // Fall-through (no noteId at all and same-note scope failed): treat as
  // undefined-claim with the raw text as detail. This is a degenerate input
  // shape and shouldn't normally reach this point.
  return {
    kind: 'unresolved',
    code: 'reference-to-undefined-claim',
    detail: rawText,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a fully qualified ID string from a ClaimAddress, or null if the
 * address lacks the required components.
 *
 * FQID format: `<noteId>.<section1>.<section2>...<claimPrefix>.<claimNumber><claimSubLetter?>`
 * Section path is joined with dots; claim number is zero-padded to 2 digits.
 * Mirrors the FQID construction in `claim-index.ts:Phase 2` cross-ref scan.
 */
function buildFqid(addr: ClaimAddress): string | null {
  if (addr.claimPrefix === undefined || addr.claimNumber === undefined) {
    return null;
  }
  if (addr.noteId === undefined) {
    return null;
  }
  const parts: string[] = [addr.noteId];
  if (addr.sectionPath !== undefined) {
    for (const seg of addr.sectionPath) {
      parts.push(String(seg));
    }
  }
  const numStr = String(addr.claimNumber).padStart(2, '0');
  const subLetter = addr.claimSubLetter ?? '';
  parts.push(`${addr.claimPrefix}.${numStr}${subLetter}`);
  return parts.join('.');
}

/**
 * Translate a successful entry lookup into either `resolved` (entry exists,
 * archived or not depending on includeArchived) or `unresolved` with
 * `reference-to-archived` (entry exists but is archived and the caller
 * opted out of archived).
 *
 * @implements {DD021.§10.DC.05} per-call includeArchived branching
 * @implements {DD021.§10.DC.06} reference-to-archived emission point
 */
function finalizeResolved(
  fqid: string,
  entry: ClaimIndexEntry,
  includeArchived: boolean,
): ResolverOutcome {
  if (entry.archived === true && !includeArchived) {
    return { kind: 'unresolved', code: 'reference-to-archived', detail: fqid };
  }
  return { kind: 'resolved', canonicalId: fqid, entry };
}

/**
 * Enumerate index entries whose FQID matches `<noteId>.§*.<claimPrefix>.<claimNumber>`
 * — any section. Filters out archived entries when `includeArchived` is false.
 *
 * @implements {DD021.§10.DC.03} section-less unique-match enumeration
 */
function collectSectionlessMatches(
  addr: ClaimAddress,
  index: ClaimIndexData,
  includeArchived: boolean,
): Array<{ fqid: string; entry: ClaimIndexEntry }> {
  const noteId = addr.noteId!;
  const claimPrefix = addr.claimPrefix!;
  const numStr = String(addr.claimNumber!).padStart(2, '0');
  const subLetter = addr.claimSubLetter ?? '';
  const suffix = `.${claimPrefix}.${numStr}${subLetter}`;
  const notePrefix = `${noteId}.`;
  const results: Array<{ fqid: string; entry: ClaimIndexEntry }> = [];
  for (const [key, entry] of index.entries) {
    if (!key.startsWith(notePrefix) || !key.endsWith(suffix)) continue;
    if (entry.archived === true && !includeArchived) continue;
    results.push({ fqid: key, entry });
  }
  return results;
}

/**
 * Check whether any entry in the index belongs to the given note ID.
 *
 * @implements {DD021.§10.DC.07} note-presence check
 */
function noteExistsInIndex(noteId: string, index: ClaimIndexData): boolean {
  const prefix = `${noteId}.`;
  for (const key of index.entries.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}
