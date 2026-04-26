/**
 * Watch-mode coherence test for FilesystemMetadataStorage.
 *
 * @validates {DD014.§3.DC.65} watch emits StorageEvent with sentinel noteId
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  FilesystemMetadataStorage,
  METADATA_STORE_WATCH_SENTINEL,
} from './filesystem-metadata-storage';
import type { StorageEvent } from '../storage-types';
import type { MetadataEvent } from '../../claims/metadata-event';

const STORE_FILENAME = 'verification.json';

const event = (claimId: string): MetadataEvent => ({
  id: 'id-' + Math.random().toString(36).slice(2),
  claimId,
  key: 'verified',
  value: 'true',
  op: 'add',
  actor: 'tester',
  date: '2026-04-25T00:00:00.000Z',
});

describe('FilesystemMetadataStorage — watch', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scepter-meta-watch-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // T-Watch-1
  it('emits a StorageEvent with the sentinel noteId on file change', async () => {
    const storage = new FilesystemMetadataStorage(tmpDir);
    // Seed the file so chokidar can watch it from the start.
    await storage.append(event('R001.§1.AC.01'));

    const events: StorageEvent[] = [];
    const unsubscribe = storage.watch!((e) => events.push(e));

    // Give chokidar a moment to attach.
    await new Promise((r) => setTimeout(r, 200));

    // Externally mutate the file.
    const filePath = path.join(tmpDir, STORE_FILENAME);
    const current = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    current['R002.§1.AC.01'] = [event('R002.§1.AC.01')];
    await fs.writeFile(filePath, JSON.stringify(current, null, 2) + '\n', 'utf-8');

    const deadline = Date.now() + 2000;
    while (events.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    unsubscribe();

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe('modified');
    expect(events[0].noteId).toBe(METADATA_STORE_WATCH_SENTINEL);
  });
});
