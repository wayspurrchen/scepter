/**
 * Concurrent-write rejection tests for FilesystemMetadataStorage.
 *
 * @validates {DD014.§3.DC.36} proper-lockfile sidecar lock with timeout
 * @validates {DD014.§3.DC.37} Reads do not lock
 * @validates {A004.§1.AC.06}
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as lockfile from 'proper-lockfile';
import { FilesystemMetadataStorage } from './filesystem-metadata-storage';
import type { MetadataEvent } from '../../claims/metadata-event';

const STORE_FILENAME = 'verification.json';

const event = (claimId: string, value: string): MetadataEvent => ({
  id: 'id-' + Math.random().toString(36).slice(2),
  claimId,
  key: 'k',
  value,
  op: 'add',
  actor: 'tester',
  date: '2026-04-25T00:00:00.000Z',
});

async function ensureLockFile(filePath: string): Promise<void> {
  const handle = await fs.open(filePath, 'a');
  await handle.close();
}

describe('FilesystemMetadataStorage — concurrent-write lock', () => {
  let tmpDir: string;
  let lockFilePath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scepter-meta-lock-'));
    await fs.mkdir(tmpDir, { recursive: true });
    lockFilePath = path.join(tmpDir, STORE_FILENAME + '.lock');
    await ensureLockFile(lockFilePath);
  });

  afterEach(async () => {
    try {
      const release = await lockfile.lock(lockFilePath, { realpath: false }).catch(() => null);
      if (release) await release();
    } catch {
      // ignore
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // T-Lock-1
  it('rejects an append while another holder owns the lock', async () => {
    const release = await lockfile.lock(lockFilePath, { realpath: false });
    try {
      const storage = new FilesystemMetadataStorage(tmpDir, { lockTimeoutMs: 200 });
      await expect(storage.append(event('R001.§1.AC.01', 'a'))).rejects.toThrow(
        /Concurrent write detected/,
      );
    } finally {
      await release();
    }
  });

  // T-Lock-2
  it('reads do not acquire the lock', async () => {
    const release = await lockfile.lock(lockFilePath, { realpath: false });
    try {
      const storage = new FilesystemMetadataStorage(tmpDir, { lockTimeoutMs: 200 });
      await expect(storage.load()).resolves.toBeDefined();
      await expect(storage.fold('NO_SUCH')).resolves.toEqual({});
      await expect(storage.query({})).resolves.toEqual([]);
    } finally {
      await release();
    }
  });

  // T-Lock-3
  it('append succeeds after the holder releases the lock', async () => {
    const release = await lockfile.lock(lockFilePath, { realpath: false });
    await release();

    const storage = new FilesystemMetadataStorage(tmpDir, { lockTimeoutMs: 1000 });
    await expect(storage.append(event('R001.§1.AC.01', 'a'))).resolves.toBeUndefined();
    const loaded = await storage.load();
    expect(loaded['R001.§1.AC.01']).toHaveLength(1);
  });
});
