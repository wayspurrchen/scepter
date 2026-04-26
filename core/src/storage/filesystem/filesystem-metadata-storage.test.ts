/**
 * Tests for FilesystemMetadataStorage: load/save/append/query/fold semantics
 * plus legacy-shape rejection. Lock and watch tests live in dedicated files.
 *
 * @validates {DD014.§3.DC.14} Implements MetadataStorage; persists to verification.json
 * @validates {DD014.§3.DC.15} Constructor accepts dataDir; no I/O at construction
 * @validates {DD014.§3.DC.16} load returns {} on missing file; rejects legacy shape
 * @validates {DD014.§3.DC.17} save round-trips
 * @validates {DD014.§3.DC.18} append durability
 * @validates {DD014.§3.DC.09a} fold parity with applyFold
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FilesystemMetadataStorage } from './filesystem-metadata-storage';
import type { MetadataEvent, MetadataStore } from '../../claims/metadata-event';

const STORE_FILENAME = 'verification.json';

const baseEvent = (
  partial: Partial<MetadataEvent> & Pick<MetadataEvent, 'op' | 'key' | 'value'>,
): MetadataEvent => ({
  id: partial.id ?? 'id-' + Math.random().toString(36).slice(2),
  claimId: partial.claimId ?? 'R009.§1.AC.01',
  actor: partial.actor ?? 'tester',
  date: partial.date ?? '2026-04-25T00:00:00.000Z',
  ...partial,
});

describe('FilesystemMetadataStorage', () => {
  let tmpDir: string;
  let storage: FilesystemMetadataStorage;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scepter-meta-storage-'));
    storage = new FilesystemMetadataStorage(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('load', () => {
    // T-Migration-5
    // @validates {DD014.§3.DC.16}
    it('returns empty store when no file exists', async () => {
      const store = await storage.load();
      expect(store).toEqual({});
    });

    // T-Migration-5
    // @validates {DD014.§3.DC.16}
    it('rejects legacy-shape verification.json with a clear error', async () => {
      const filePath = path.join(tmpDir, STORE_FILENAME);
      const legacy = {
        'R001.§1.AC.01': [
          { claimId: 'R001.§1.AC.01', date: '2026-04-01', actor: 'alice' },
        ],
      };
      await fs.writeFile(filePath, JSON.stringify(legacy, null, 2), 'utf-8');
      await expect(storage.load()).rejects.toThrow(/meta migrate-legacy/);
    });

    it('loads new-shape events', async () => {
      const event = baseEvent({ op: 'add', key: 'verified', value: 'true' });
      const filePath = path.join(tmpDir, STORE_FILENAME);
      const content: MetadataStore = { [event.claimId]: [event] };
      await fs.writeFile(filePath, JSON.stringify(content, null, 2), 'utf-8');

      const loaded = await storage.load();
      expect(loaded[event.claimId]).toHaveLength(1);
      expect(loaded[event.claimId][0]).toEqual(event);
    });
  });

  describe('save', () => {
    // @validates {DD014.§3.DC.17}
    it('writes JSON with 2-space indentation and round-trips', async () => {
      const event = baseEvent({ op: 'add', key: 'verified', value: 'true' });
      const store: MetadataStore = { [event.claimId]: [event] };

      await storage.save(store);

      const filePath = path.join(tmpDir, STORE_FILENAME);
      const written = await fs.readFile(filePath, 'utf-8');
      expect(written).toContain('  "claimId":'); // 2-space indent
      expect(written.endsWith('\n')).toBe(true);

      const loaded = await storage.load();
      expect(loaded).toEqual(store);
    });

    it('overwrites the file', async () => {
      await storage.save({ X: [baseEvent({ op: 'add', key: 'a', value: '1', claimId: 'X' })] });
      await storage.save({ Y: [baseEvent({ op: 'add', key: 'b', value: '2', claimId: 'Y' })] });

      const loaded = await storage.load();
      expect(loaded.X).toBeUndefined();
      expect(loaded.Y).toHaveLength(1);
    });
  });

  describe('append', () => {
    // @validates {DD014.§3.DC.18}
    it('is durable (visible in a fresh storage instance after the call resolves)', async () => {
      const event = baseEvent({ op: 'add', key: 'verified', value: 'true' });
      await storage.append(event);

      // Fresh instance — simulates a new process.
      const fresh = new FilesystemMetadataStorage(tmpDir);
      const loaded = await fresh.load();
      expect(loaded[event.claimId]).toHaveLength(1);
      expect(loaded[event.claimId][0].id).toBe(event.id);
    });

    it('appends to an existing claim array', async () => {
      const a = baseEvent({ op: 'add', key: 'reviewer', value: 'alice' });
      const b = baseEvent({ op: 'add', key: 'reviewer', value: 'bob' });
      await storage.append(a);
      await storage.append(b);

      const loaded = await storage.load();
      expect(loaded[a.claimId]).toHaveLength(2);
      expect(loaded[a.claimId][0].value).toBe('alice');
      expect(loaded[a.claimId][1].value).toBe('bob');
    });

    it('creates the data directory if missing', async () => {
      const nested = path.join(tmpDir, 'nested', 'deeper');
      const nestedStorage = new FilesystemMetadataStorage(nested);
      await nestedStorage.append(baseEvent({ op: 'add', key: 'k', value: 'v' }));
      const loaded = await nestedStorage.load();
      expect(Object.keys(loaded)).toHaveLength(1);
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      await storage.append(
        baseEvent({ op: 'add', key: 'verified', value: 'true', claimId: 'R001.§1.AC.01', actor: 'alice', date: '2026-04-01T00:00:00.000Z' }),
      );
      await storage.append(
        baseEvent({ op: 'add', key: 'reviewer', value: 'bob', claimId: 'R001.§1.AC.01', actor: 'alice', date: '2026-04-02T00:00:00.000Z' }),
      );
      await storage.append(
        baseEvent({ op: 'add', key: 'verified', value: 'true', claimId: 'R002.§1.AC.01', actor: 'bob', date: '2026-04-03T00:00:00.000Z' }),
      );
    });

    it('filters by claimId', async () => {
      const events = await storage.query({ claimId: 'R001.§1.AC.01' });
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.claimId === 'R001.§1.AC.01')).toBe(true);
    });

    it('filters by key', async () => {
      const events = await storage.query({ key: 'verified' });
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.key === 'verified')).toBe(true);
    });

    it('filters by claimId AND key together', async () => {
      const events = await storage.query({ claimId: 'R001.§1.AC.01', key: 'verified' });
      expect(events).toHaveLength(1);
      expect(events[0].value).toBe('true');
    });

    it('filters by actor', async () => {
      const events = await storage.query({ actor: 'bob' });
      expect(events).toHaveLength(1);
      expect(events[0].claimId).toBe('R002.§1.AC.01');
    });

    it('filters by date range (since/until inclusive)', async () => {
      const events = await storage.query({ since: '2026-04-02T00:00:00.000Z', until: '2026-04-02T23:59:59.999Z' });
      expect(events).toHaveLength(1);
      expect(events[0].key).toBe('reviewer');
    });

    it('returns empty when no events match', async () => {
      const events = await storage.query({ claimId: 'NO_SUCH' });
      expect(events).toEqual([]);
    });
  });

  describe('fold', () => {
    // @validates {DD014.§3.DC.09a}
    it('produces the same projection as applyFold', async () => {
      const claimId = 'R001.§1.AC.01';
      await storage.append(baseEvent({ op: 'add', key: 'verified', value: 'true', claimId }));
      await storage.append(baseEvent({ op: 'add', key: 'reviewer', value: 'alice', claimId }));
      await storage.append(baseEvent({ op: 'set', key: 'priority', value: 'high', claimId }));
      await storage.append(baseEvent({ op: 'unset', key: 'verified', value: '', claimId }));

      const folded = await storage.fold(claimId);
      expect(folded).toEqual({
        reviewer: ['alice'],
        priority: ['high'],
      });
    });

    it('returns {} for an unknown claim', async () => {
      const folded = await storage.fold('NO_SUCH');
      expect(folded).toEqual({});
    });
  });

  describe('constructor', () => {
    // @validates {DD014.§3.DC.15}
    it('does not touch the filesystem at construction', async () => {
      const newDir = path.join(tmpDir, 'untouched');
      // Just instantiate — should not create the directory.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _s = new FilesystemMetadataStorage(newDir);
      await expect(fs.access(newDir)).rejects.toThrow();
    });
  });
});
