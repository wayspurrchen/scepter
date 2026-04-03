import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import { FilesystemVerificationStorage } from './filesystem-verification-storage';
import type { VerificationStore } from '../../claims/verification-store';

describe('FilesystemVerificationStorage', () => {
  const testDir = path.join(process.cwd(), '.test-tmp', 'fs-verification-storage');
  let storage: FilesystemVerificationStorage;

  beforeEach(async () => {
    await fs.remove(testDir);
    await fs.ensureDir(testDir);
    storage = new FilesystemVerificationStorage(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  it('should return empty store when no file exists', async () => {
    const store = await storage.load();
    expect(store).toEqual({});
  });

  it('should round-trip a verification store', async () => {
    const store: VerificationStore = {
      'R001.§1.AC.01': [
        { claimId: 'R001.§1.AC.01', date: '2026-04-01', actor: 'test-user', method: 'manual' },
      ],
    };

    await storage.save(store);
    const loaded = await storage.load();

    expect(loaded['R001.§1.AC.01']).toHaveLength(1);
    expect(loaded['R001.§1.AC.01'][0].actor).toBe('test-user');
    expect(loaded['R001.§1.AC.01'][0].date).toBe('2026-04-01');
  });

  it('should preserve multiple claims and events', async () => {
    const store: VerificationStore = {
      'R001.§1.AC.01': [
        { claimId: 'R001.§1.AC.01', date: '2026-04-01', actor: 'alice' },
        { claimId: 'R001.§1.AC.01', date: '2026-04-02', actor: 'bob' },
      ],
      'R002.§1.AC.01': [
        { claimId: 'R002.§1.AC.01', date: '2026-04-01', actor: 'alice' },
      ],
    };

    await storage.save(store);
    const loaded = await storage.load();

    expect(Object.keys(loaded)).toHaveLength(2);
    expect(loaded['R001.§1.AC.01']).toHaveLength(2);
    expect(loaded['R002.§1.AC.01']).toHaveLength(1);
  });

  it('should overwrite on save', async () => {
    await storage.save({ 'X.01': [{ claimId: 'X.01', date: '2026-01-01', actor: 'a' }] });
    await storage.save({ 'Y.01': [{ claimId: 'Y.01', date: '2026-02-01', actor: 'b' }] });

    const loaded = await storage.load();
    expect(loaded['X.01']).toBeUndefined();
    expect(loaded['Y.01']).toHaveLength(1);
  });
});
