/**
 * Cross-project alias resolver.
 *
 * Owns the alias-to-peer-ProjectManager cache for a single CLI
 * invocation and provides note- and claim-level lookup against a peer
 * project's index. Per R011 the peer is loaded read-only — no peer
 * data flows back into the local project's index, derivation graph,
 * gap report, or trace matrix.
 *
 * @implements {R011.§2.AC.05} resolution with distinct, actionable errors
 * @implements {R011.§2.AC.06} per-CLI-invocation peer cache
 * @implements {DD015.§1.DC.05} dedicated PeerProjectResolver class (preserves NoteManager/ClaimIndex per-project invariants)
 */
import type { ConfigManager, AliasResolution } from '../config/config-manager';
import type { ProjectManager } from './project-manager';
import type { ClaimAddress } from '../parsers/claim/claim-parser';
import type { Note } from '../types/note';
import type { ClaimIndexEntry } from '../claims/claim-index';

/**
 * Reasons an alias-prefixed lookup can fail. The four values map 1:1
 * to R011.§2.AC.05's "alias not found, peer project absent, note not
 * found in peer, claim not found in peer" enumeration. Transitive-
 * alias rejection (R011.§2.AC.07) yields `transitive-alias` so
 * callers can produce its specific error message.
 */
export type ResolutionErrorReason =
  | 'alias-unknown'
  | 'peer-unresolved'
  | 'peer-load-failed'
  | 'note-not-found'
  | 'claim-not-found'
  | 'transitive-alias';

/** Successful peer-project handle. Returned from `resolve()` and
 * carried through `lookupNote`/`lookupClaim` so callers can render
 * the alias header and the resolved peer path uniformly. */
export interface PeerProjectHandle {
  ok: true;
  aliasName: string;
  resolvedPath: string;
  description?: string;
  /** The peer's ProjectManager. Reads only — local CLI MUST NOT
   * write to peer-owned files via this manager. */
  projectManager: ProjectManager;
}

export interface ResolutionError {
  ok: false;
  reason: ResolutionErrorReason;
  /** The alias name from the local reference, if any. */
  aliasName?: string;
  /** Free-form, user-facing error message. */
  message: string;
}

export type ResolveResult = PeerProjectHandle | ResolutionError;

export interface PeerNoteLookup {
  ok: true;
  peer: PeerProjectHandle;
  note: Note;
}

export interface PeerClaimLookup {
  ok: true;
  peer: PeerProjectHandle;
  entry: ClaimIndexEntry;
}

/**
 * Factory signature for instantiating a peer ProjectManager. Defaults
 * to `createFilesystemProject` from `core/src/storage/filesystem`. The
 * indirection lets tests inject a stub without forcing a real peer
 * project on disk.
 */
export type PeerProjectFactory = (peerPath: string) => Promise<ProjectManager>;

export class PeerProjectResolver {
  /** Per-invocation cache of peer-project promises keyed by alias name.
   * Promises are cached (not resolved values) so concurrent lookups for
   * the same alias share a single load. */
  private peerCache = new Map<string, Promise<ResolveResult>>();

  /**
   * Per-alias cache of the peer's *built claim index* promise. The peer
   * ProjectManager (in `peerCache`) is loaded once, but its claim index
   * must also be built (parse every peer note, resolve every reference)
   * before `getClaim` can answer — an O(refs × claims) pass that on a
   * large peer (thousands of notes) costs seconds. Without this cache
   * every `lookupClaim` rebuilt the whole peer index from scratch, so a
   * note with N cross-project refs paid N full rebuilds per refresh and
   * every hover paid another — pinning the single-threaded extension
   * host for seconds-to-minutes at a time.
   *
   * Keyed by alias name and invalidated alongside `peerCache` in
   * `invalidate()` / `invalidateChanged()`, so an alias whose target
   * path changes rebuilds on next lookup. Within a stable session the
   * peer index is built exactly once per alias.
   *
   * DD015 designed `lookupClaim` to query an already-built peer index
   * (`claimIndex.getClaim(fqid)`) backed by this "peer-index cache owned
   * by core" — the prior implementation cached only the peer
   * `ProjectManager` and rebuilt its claim index on every lookup, which
   * is the conformance gap this field closes.
   *
   * @implements {R011.§4.AC.07} peer-index cache owned by core
   * @see {R011.§2.AC.06} mirrors the per-invocation peer-*loading* cache
   *   (realized separately by `peerCache`/`resolve()`); this field is the
   *   peer-*index* cache, so §2.AC.06 is a cross-reference, not a claim it realizes.
   */
  private peerIndexCache = new Map<string, Promise<void>>();

  constructor(
    private readonly configManager: ConfigManager,
    private readonly factory: PeerProjectFactory,
  ) {}

  /**
   * Resolve an alias name to a loaded peer ProjectManager, or to a
   * typed error describing why resolution failed. Subsequent calls for
   * the same alias return the cached promise.
   *
   * @implements {R011.§2.AC.05} alias-unknown / peer-unresolved / peer-load-failed
   * @implements {R011.§2.AC.06} cached for the CLI invocation lifetime
   */
  resolve(aliasName: string): Promise<ResolveResult> {
    const cached = this.peerCache.get(aliasName);
    if (cached) return cached;
    const promise = this.resolveUncached(aliasName);
    this.peerCache.set(aliasName, promise);
    return promise;
  }

  private async resolveUncached(aliasName: string): Promise<ResolveResult> {
    const resolution: AliasResolution | null = this.configManager.getAliasResolution(aliasName);
    if (resolution === null) {
      return {
        ok: false,
        reason: 'alias-unknown',
        aliasName,
        message: `Alias '${aliasName}' is not declared in projectAliases.`,
      };
    }
    if (!resolution.resolved) {
      return {
        ok: false,
        reason: 'peer-unresolved',
        aliasName,
        message: resolution.message,
      };
    }
    try {
      const peer = await this.factory(resolution.resolvedPath);
      return {
        ok: true,
        aliasName,
        resolvedPath: resolution.resolvedPath,
        description: resolution.description,
        projectManager: peer,
      };
    } catch (err) {
      return {
        ok: false,
        reason: 'peer-load-failed',
        aliasName,
        message: `Failed to load peer project for alias '${aliasName}' at ${resolution.resolvedPath}: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Look up a single note in the peer project named by the alias.
   * Returns a typed error for any failure mode (alias unknown, peer
   * unresolved, peer load failed, note not found).
   *
   * @implements {R011.§2.AC.05} note-not-found error case
   */
  async lookupNote(aliasName: string, noteId: string): Promise<PeerNoteLookup | ResolutionError> {
    const result = await this.resolve(aliasName);
    if (!result.ok) return result;
    await result.projectManager.initialize();
    const note = await result.projectManager.noteManager.getNoteById(noteId);
    if (!note) {
      return {
        ok: false,
        reason: 'note-not-found',
        aliasName,
        message: `Note '${noteId}' not found in peer project '${aliasName}' (${result.resolvedPath}).`,
      };
    }
    return { ok: true, peer: result, note };
  }

  /**
   * Look up a claim by its ClaimAddress in the peer project named by
   * the alias prefix on the address. The ClaimAddress's aliasPrefix
   * MUST be set; callers should not call this for local addresses.
   *
   * @implements {R011.§2.AC.05} claim-not-found error case
   */
  async lookupClaim(address: ClaimAddress): Promise<PeerClaimLookup | ResolutionError> {
    if (!address.aliasPrefix) {
      return {
        ok: false,
        reason: 'alias-unknown',
        message: `lookupClaim called on a local address (no aliasPrefix). This is a programmer error — local addresses must be resolved against the local ClaimIndex.`,
      };
    }
    const result = await this.resolve(address.aliasPrefix);
    if (!result.ok) return result;
    await result.projectManager.initialize();
    const fqid = buildFullyQualifiedClaimId(address);
    if (!fqid) {
      return {
        ok: false,
        reason: 'claim-not-found',
        aliasName: address.aliasPrefix,
        message: `Cannot construct fully qualified claim ID from address '${address.raw}' (missing note ID and/or claim prefix).`,
      };
    }
    // Build the peer's claim index once per alias, then reuse it. Rebuilding
    // on every lookup is what pinned the extension host — see peerIndexCache.
    await this.ensurePeerIndexBuilt(address.aliasPrefix, result.projectManager);
    const entry = result.projectManager.claimIndex.getClaim(fqid);
    if (!entry) {
      return {
        ok: false,
        reason: 'claim-not-found',
        aliasName: address.aliasPrefix,
        message: `Claim '${fqid}' not found in peer project '${address.aliasPrefix}' (${result.resolvedPath}).`,
      };
    }
    return { ok: true, peer: result, entry };
  }

  /**
   * Build the peer's claim index exactly once per alias and memoize the
   * in-flight/completed build promise. Concurrent lookups for the same
   * alias share a single build; subsequent lookups reuse the already-built
   * `projectManager.claimIndex`.
   *
   * If the build throws, the cache entry is dropped so a later lookup can
   * retry rather than being poisoned by a rejected promise.
   */
  private ensurePeerIndexBuilt(aliasName: string, projectManager: ProjectManager): Promise<void> {
    const cached = this.peerIndexCache.get(aliasName);
    if (cached) return cached;
    const promise = (async () => {
      const peerNotes = await projectManager.noteManager.getAllNotes();
      const peerNotesWithContent = await Promise.all(peerNotes.map(async (n) => {
        const content = await projectManager.noteFileManager.getAggregatedContents(n.id);
        return {
          id: n.id,
          type: n.type ?? '',
          filePath: n.filePath ?? '',
          content: content ?? '',
        };
      }));
      projectManager.claimIndex.build(peerNotesWithContent);
    })().catch((err) => {
      this.peerIndexCache.delete(aliasName);
      throw err;
    });
    this.peerIndexCache.set(aliasName, promise);
    return promise;
  }

  /**
   * Drop the cached peer-project entry for `aliasName`. The next
   * `resolve(aliasName)` call will re-load via the factory. Idempotent:
   * invalidating an unknown alias is a no-op.
   *
   * Used during `projectAliases` reload (config edit, project switch)
   * to ensure a renamed/repointed/removed alias does not return its
   * stale cached `Promise<PeerProject>`. Per R011.§4.AC.12.
   *
   * The §2.AC.06 caching invariant requires that aliases whose
   * paths are unchanged remain in the cache. Callers that diff alias
   * maps and call this only for changed/removed aliases preserve the
   * invariant; callers that wholesale-clear the cache violate it.
   * Use `invalidateChanged()` for the diff-and-invalidate idiom.
   *
   * @implements {R011.§4.AC.12} per-alias peer-cache invalidation
   */
  invalidate(aliasName: string): void {
    this.peerCache.delete(aliasName);
    this.peerIndexCache.delete(aliasName);
  }

  /**
   * Diff two alias resolution maps and invalidate cache entries for
   * any alias whose resolved path changed, was removed, or whose
   * resolved-vs-unresolved status flipped. Aliases unchanged across
   * both maps remain cached, preserving the §2.AC.06 caching invariant.
   *
   * Returns the list of alias names that were invalidated, for
   * caller-side logging/diagnostics.
   *
   * @implements {R011.§4.AC.12} diff-based invalidation preserving §2.AC.06
   */
  invalidateChanged(
    prev: ReadonlyMap<string, AliasResolution>,
    next: ReadonlyMap<string, AliasResolution>,
  ): string[] {
    const invalidated: string[] = [];
    // Aliases that existed before but are now removed: invalidate.
    for (const [name] of prev) {
      if (!next.has(name)) {
        if (this.peerCache.has(name)) {
          this.peerCache.delete(name);
          this.peerIndexCache.delete(name);
          invalidated.push(name);
        }
      }
    }
    // Aliases that exist in next: invalidate iff resolved-path or
    // resolved-status changed.
    for (const [name, nextRes] of next) {
      const prevRes = prev.get(name);
      if (!prevRes) continue; // New alias; nothing cached to invalidate.
      const prevPath = prevRes.resolvedPath;
      const nextPath = nextRes.resolvedPath;
      const statusChanged = prevRes.resolved !== nextRes.resolved;
      if (prevPath !== nextPath || statusChanged) {
        if (this.peerCache.has(name)) {
          this.peerCache.delete(name);
          this.peerIndexCache.delete(name);
          invalidated.push(name);
        }
      }
    }
    return invalidated;
  }

  /** Number of cache entries (resolved or in-flight). For tests/diagnostics. */
  get cacheSize(): number {
    return this.peerCache.size;
  }
}

/**
 * Reconstruct the fully qualified claim ID (in the local-index canonical
 * form) from a ClaimAddress. Mirrors the form used by ClaimIndex.build()
 * keys: `<NoteId>[.section][.PREFIX.NN]`. Returns null when the address
 * has no note ID and no claim prefix (i.e., nothing the index can key
 * on).
 */
function buildFullyQualifiedClaimId(address: ClaimAddress): string | null {
  const parts: string[] = [];
  if (address.noteId) parts.push(address.noteId);
  if (address.sectionPath) parts.push(...address.sectionPath.map(String));
  if (address.claimPrefix !== undefined && address.claimNumber !== undefined) {
    const num = String(address.claimNumber).padStart(2, '0');
    const sub = address.claimSubLetter ?? '';
    parts.push(`${address.claimPrefix}.${num}${sub}`);
  }
  if (parts.length === 0) return null;
  return parts.join('.');
}
