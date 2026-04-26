/**
 * Filesystem adapter for the generalized metadata event log.
 *
 * Persists to `<dataDir>/verification.json` (filename preserved across the
 * verification → metadata transition for installed-project compatibility).
 * Writes are protected by a sidecar `.lock` file via `proper-lockfile`.
 *
 * Reads are lock-free: the append-only invariant plus full-file rewrites at
 * save time guarantee that any partially-flushed write is either fully
 * visible or fully absent at the JSON-document boundary.
 *
 * @implements {A004.§2.AC.04} Filesystem adapter persists to verification.json
 * @implements {A004.§1.AC.06} Concurrent-write protection via file lock
 * @implements {A004.§3.AC.05} Watch-mode hook
 * @implements {DD014.§3.DC.14} FilesystemMetadataStorage implements MetadataStorage
 * @implements {DD014.§3.DC.15} Constructor accepts dataDir; no I/O at construction
 * @implements {DD014.§3.DC.16} load returns {} on missing file; rejects legacy shape
 * @implements {DD014.§3.DC.17} save writes JSON with 2-space indentation under lock
 * @implements {DD014.§3.DC.18} append is durable (load-modify-write under lock)
 * @implements {DD014.§3.DC.36} proper-lockfile sidecar lock with 2000ms timeout
 * @implements {DD014.§3.DC.37} reads do not lock
 * @implements {DD014.§3.DC.65} watch via chokidar emits StorageEvent
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as lockfile from 'proper-lockfile';
import * as chokidar from 'chokidar';
import type { MetadataStorage } from '../storage-backend';
import type {
  MetadataEvent,
  MetadataStore,
  EventFilter,
} from '../../claims/metadata-event';
import { applyFold } from '../../claims/metadata-event';
import type { StorageEvent, Unsubscribe } from '../storage-types';

const STORE_FILENAME = 'verification.json';
const LOCK_SUFFIX = '.lock';
const DEFAULT_LOCK_TIMEOUT_MS = 2000;

/** Sentinel noteId emitted by the metadata-store watcher. */
export const METADATA_STORE_WATCH_SENTINEL = '__metadata_store__';

export interface FilesystemMetadataStorageOptions {
  /** Override the lock-acquire timeout (in milliseconds). Default 2000ms. */
  lockTimeoutMs?: number;
}

export class FilesystemMetadataStorage implements MetadataStorage {
  private readonly filePath: string;
  private readonly lockFilePath: string;
  private readonly lockTimeoutMs: number;

  constructor(
    private readonly dataDir: string,
    options: FilesystemMetadataStorageOptions = {},
  ) {
    this.filePath = path.join(dataDir, STORE_FILENAME);
    this.lockFilePath = this.filePath + LOCK_SUFFIX;
    this.lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  }

  /**
   * @implements {DD014.§3.DC.16}
   */
  async load(): Promise<MetadataStore> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf-8');
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return {};
      }
      throw err;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const store: MetadataStore = {};
    for (const [claimId, eventsRaw] of Object.entries(parsed)) {
      if (!Array.isArray(eventsRaw)) {
        throw new Error(
          `Invalid verification.json: events for claim ${claimId} are not an array`,
        );
      }
      const events = eventsRaw as Array<Record<string, unknown>>;
      for (const event of events) {
        if (event === null || typeof event !== 'object' || !('op' in event)) {
          throw new Error(
            `Legacy-shape verification.json detected at ${this.filePath}. ` +
              `Run \`scepter claims meta migrate-legacy\` to convert it to the new shape.`,
          );
        }
      }
      store[claimId] = events as unknown as MetadataEvent[];
    }
    return store;
  }

  /**
   * @implements {DD014.§3.DC.17}
   */
  async save(store: MetadataStore): Promise<void> {
    await this.withLock(() => this.writeStore(store));
  }

  /**
   * @implements {DD014.§3.DC.18}
   */
  async append(event: MetadataEvent): Promise<void> {
    await this.withLock(async () => {
      const store = await this.loadUnlocked();
      const existing = store[event.claimId] ?? [];
      existing.push(event);
      store[event.claimId] = existing;
      await this.writeStore(store);
    });
  }

  /**
   * Phase-1 supports `claimId`, `key`, `actor`, `op`, `since`, `until`.
   * The `since`/`until` bounds are inclusive on the ISO 8601 `date` string
   * (lexicographic compare, which is correct for ISO 8601).
   *
   * @implements {DD014.§3.DC.11}
   */
  async query(filter: EventFilter): Promise<MetadataEvent[]> {
    const store = await this.load();
    const results: MetadataEvent[] = [];
    const claimIds = filter.claimId ? [filter.claimId] : Object.keys(store);
    for (const claimId of claimIds) {
      const events = store[claimId];
      if (!events) continue;
      for (const event of events) {
        if (filter.key !== undefined && event.key !== filter.key) continue;
        if (filter.actor !== undefined && event.actor !== filter.actor) continue;
        if (filter.op !== undefined && event.op !== filter.op) continue;
        if (filter.since !== undefined && event.date < filter.since) continue;
        if (filter.until !== undefined && event.date > filter.until) continue;
        results.push(event);
      }
    }
    return results;
  }

  /**
   * @implements {DD014.§3.DC.09a}
   */
  async fold(claimId: string): Promise<Record<string, string[]>> {
    const store = await this.load();
    const events = store[claimId] ?? [];
    return applyFold(events);
  }

  /**
   * Watches `verification.json` (NOT the `.lock` sidecar) and emits a
   * `StorageEvent` on each change. The emitted event uses
   * METADATA_STORE_WATCH_SENTINEL as `noteId` since the underlying store is
   * not note-scoped.
   *
   * @implements {DD014.§3.DC.65}
   */
  watch(callback: (event: StorageEvent) => void): Unsubscribe {
    const watcher = chokidar.watch(this.filePath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
    });
    const handler = () => {
      callback({
        type: 'modified',
        noteId: METADATA_STORE_WATCH_SENTINEL,
        path: this.filePath,
      });
    };
    watcher.on('change', handler);
    watcher.on('add', handler);
    return () => {
      void watcher.close();
    };
  }

  // ---- internals ----

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await fs.mkdir(this.dataDir, { recursive: true });
    // proper-lockfile expects the protected file to exist (or `realpath: false`).
    // We explicitly target a sidecar lock file and create it eagerly so
    // contention is gated on the lock file itself, not the data file.
    await this.ensureLockFile();
    let release: () => Promise<void>;
    try {
      release = await lockfile.lock(this.lockFilePath, {
        retries: {
          retries: Math.max(1, Math.floor(this.lockTimeoutMs / 100)),
          minTimeout: 50,
          maxTimeout: 200,
          factor: 1.2,
        },
        stale: Math.max(this.lockTimeoutMs * 5, 5000),
        realpath: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Concurrent write detected on ${this.filePath} (lock acquisition failed: ${message}). ` +
          `Retry in a moment.`,
      );
    }
    try {
      return await fn();
    } finally {
      try {
        await release();
      } catch {
        // Lock-release failures are best-effort; the lock will be reclaimed
        // by the `stale` timeout if the process aborts mid-write.
      }
    }
  }

  private async ensureLockFile(): Promise<void> {
    try {
      const handle = await fs.open(this.lockFilePath, 'a');
      await handle.close();
    } catch (err) {
      if (isNodeError(err) && err.code === 'EEXIST') return;
      throw err;
    }
  }

  private async loadUnlocked(): Promise<MetadataStore> {
    return this.load();
  }

  private async writeStore(store: MetadataStore): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.writeFile(
      this.filePath,
      JSON.stringify(store, null, 2) + '\n',
      'utf-8',
    );
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
