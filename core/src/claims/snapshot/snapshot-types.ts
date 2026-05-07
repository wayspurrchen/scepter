/**
 * Snapshot subsystem on-disk JSON schema as TypeScript interfaces.
 * Pure type declarations + the schema-version constant and the body-hash
 * constants.  No runtime logic beyond the canonical body-normalizer.
 *
 * The DD pins the discipline that this file is the SINGLE SOURCE OF TRUTH
 * for: the schema-version integer, the hash algorithm/encoding strings, and
 * the body-normalizer function.  No other module is permitted to inline
 * `'sha256'`, `'hex'`, the literal version, or a re-implementation of the
 * trim normalization.
 *
 * @implements {DD018.§3.DC.01} SCHEMA_VERSION constant of type number; initial value 1
 * @implements {DD018.§3.DC.02} SnapshotMetadata interface
 * @implements {DD018.§3.DC.03} SnapshotClaimEntry interface
 * @implements {DD018.§3.DC.04} SnapshotLifecycle interface
 * @implements {DD018.§3.DC.05} SnapshotSourceRef interface
 * @implements {DD018.§3.DC.06} BODY_HASH_ALGORITHM and BODY_HASH_ENCODING constants
 * @implements {DD018.§3.DC.07} normalizeBodyForHash — canonical normalizer
 * @implements {DD018.§3.DC.08} SnapshotNoteEntry interface
 * @implements {DD018.§3.DC.10} Top-level Snapshot interface with sort-order contract
 * @implements {DD018.§3.DC.11} Schema version is integer-monotonic; bump on read-incompatible changes
 */

/**
 * Maximum schema version this binary can read and write.
 *
 * The writer embeds this constant on every captured snapshot (see
 * `snapshot-writer.ts`); the diff reader (Phase 2) validates loaded
 * snapshots against it.  Bumping is required for any change that breaks
 * read compatibility (field rename, semantic shift, removal); purely
 * additive changes do NOT require a bump.
 *
 * @implements {DD018.§3.DC.01} SCHEMA_VERSION constant
 * @implements {DD018.§3.DC.11} integer-monotonic schema version
 */
export const SCHEMA_VERSION: number = 1;

/**
 * Hash algorithm used for both per-claim body hashes and per-note
 * aggregated-content hashes.  The two MUST be the same per §DC.09; having
 * two hash mechanisms in one file would be a documentation and
 * consistency liability with no offsetting benefit.
 *
 * sha256 is selected over md5 (which appears at
 * `core/src/context/context-gatherer.ts:240`) because snapshots may be
 * checked into version control by user choice; md5 collisions are too
 * cheap to defend against accidental or intentional content collisions.
 *
 * @implements {DD018.§3.DC.06} BODY_HASH_ALGORITHM = 'sha256'
 */
export const BODY_HASH_ALGORITHM = 'sha256' as const;

/**
 * Encoding used when serializing the hash digest into JSON.
 *
 * @implements {DD018.§3.DC.06} BODY_HASH_ENCODING = 'hex'
 */
export const BODY_HASH_ENCODING = 'hex' as const;

/**
 * Canonical body-normalizer.  Strips leading and trailing ASCII
 * whitespace (equivalent to `body.trim()`).  No line-ending translation,
 * no Unicode normalization, no case folding.
 *
 * Determinism of the snapshot output depends on this function being the
 * single canonical normalizer; any divergence between writer and diff
 * normalization would invalidate body-hash equality and produce phantom
 * drift on bit-identical content.
 *
 * @implements {DD018.§3.DC.07} normalizeBodyForHash trim semantics
 */
export function normalizeBodyForHash(body: string): string {
  return body.trim();
}

/**
 * Top-level metadata block embedded in every snapshot file.
 *
 * - `schemaVersion` is the integer pinned in `SCHEMA_VERSION`.
 * - `capturedAt` is an ISO 8601 UTC timestamp (e.g.,
 *   `2026-05-06T17:42:31.219Z`).
 * - `projectRoot` is the absolute path of the project at capture time.
 * - `gitCommit` is the resolved HEAD SHA, or `null` when the project is
 *   not a git working tree, when git is unavailable, or when
 *   `git rev-parse HEAD` fails for any reason (per
 *   {R014.§1.AC.08}).
 *
 * @implements {DD018.§3.DC.02}
 */
export interface SnapshotMetadata {
  schemaVersion: number;
  capturedAt: string;
  projectRoot: string;
  gitCommit: string | null;
}

/**
 * Lifecycle state as serialized into a snapshot.
 *
 * The on-disk `supersedes` field name intentionally diverges from the
 * in-memory `target` field on `LifecycleState` (`claim-metadata.ts`) so
 * the on-disk payload is self-documenting.  The writer translates between
 * the two field names.
 *
 * `type` is one of: `closed`, `deferred`, `removed`, `superseded`.
 * `supersedes` is present only when `type === 'superseded'`.
 *
 * @implements {DD018.§3.DC.04}
 */
export interface SnapshotLifecycle {
  type: string;
  supersedes?: string;
}

/**
 * One incoming source-projection reference for a claim.
 *
 * `filePath` is a project-relative POSIX path.  `refKind` is the verbatim
 * `SourceReferenceType` union value (`implements`, `validates`,
 * `depends-on`, `addresses`, `blocked-by`, `see`, `mentions`).
 *
 * @implements {DD018.§3.DC.05}
 */
export interface SnapshotSourceRef {
  filePath: string;
  line: number;
  refKind: string;
}

/**
 * One claim's serialized record in a snapshot.
 *
 * NOTE the absence of any body-text field — by deliberate design.  Only
 * the `bodyHash` is stored; full body text is never persisted.  This
 * preserves the per-{R014.§1.AC.05} and {R014.§8.AC.01} no-body-bytes
 * invariants.
 *
 * @implements {DD018.§3.DC.03}
 */
export interface SnapshotClaimEntry {
  fqid: string;
  noteId: string;
  noteType: string;
  heading: string;
  lifecycle: SnapshotLifecycle | null;
  importance: number | null;
  derivedFrom: string[];
  incomingNoteRefs: string[];
  incomingSourceRefs: SnapshotSourceRef[];
  bodyHash: string;
}

/**
 * One note's serialized record in a snapshot.
 *
 * `claimFqids` is in document order; `noteContentHash` is computed via
 * the same algorithm and normalization as the body hash (§DC.09) over
 * the full aggregated note content.  `noteTitle` is the display title
 * from the index; if unavailable the field MAY be the empty string.
 *
 * @implements {DD018.§3.DC.08}
 */
export interface SnapshotNoteEntry {
  noteId: string;
  noteTitle: string;
  claimFqids: string[];
  noteContentHash: string;
}

/**
 * The top-level snapshot value as serialized to JSON.
 *
 * Sort order is part of the contract: `claims` MUST be sorted by `fqid`
 * ascending and `notes` MUST be sorted by `noteId` ascending.  Two
 * captures with identical inputs (modulo `metadata.capturedAt`) MUST
 * produce byte-equal JSON files.  This is the basis for the determinism
 * test in §10 of the DD.
 *
 * @implements {DD018.§3.DC.10}
 */
export interface Snapshot {
  metadata: SnapshotMetadata;
  claims: SnapshotClaimEntry[];
  notes: SnapshotNoteEntry[];
}

/**
 * Uniform diff-engine view of a snapshot side.  Defined now even though
 * Phase 1 doesn't consume it — Phase 2's `snapshot-diff.ts` will key
 * `claims` and `notes` into `Map<string, ...>` shapes for O(1) FQID
 * lookup.  Storing the type here keeps the type module the single
 * declaration site for the on-disk shape AND its in-memory diff form.
 *
 * Phase 2 will own the `loadSnapshotSide`, `liveSide`, and `computeDiff`
 * implementations that produce and consume `SnapshotData` values; this
 * Phase 1 declaration anchors the shape so the writer/store and diff
 * engine agree on the field names from day one.
 *
 * `kind: 'live'` snapshots have `metadata: null` because they are
 * captured in-memory without serializing.  `kind: 'snapshot'` carries
 * the metadata block from the file.
 */
export interface SnapshotData {
  kind: 'snapshot' | 'live';
  claims: Map<string, SnapshotClaimEntry>;
  notes: Map<string, SnapshotNoteEntry>;
  metadata: SnapshotMetadata | null;
}
