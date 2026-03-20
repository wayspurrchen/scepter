/**
 * Tests for verification event store.
 *
 * @validates {R005.§3.AC.01} Verification store persistence
 * @validates {R005.§3.AC.02} VerificationEvent structure
 * @validates {R005.§3.AC.06} Append-only semantics
 * @validates {R005.§3.AC.07} Latest verification retrieval
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  loadVerificationStore,
  saveVerificationStore,
  addVerificationEvent,
  getLatestVerification,
} from '../verification-store';
import type { VerificationEvent, VerificationStore } from '../verification-store';

describe('Verification Store', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scepter-verify-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('addVerificationEvent', () => {
    // @validates {R005.§3.AC.06}
    it('should create array for new claim and append event', () => {
      const store: VerificationStore = {};
      const event: VerificationEvent = {
        claimId: 'R004.1.AC.01',
        date: '2026-03-11',
        actor: 'dev',
      };

      addVerificationEvent(store, event);

      expect(store['R004.1.AC.01']).toHaveLength(1);
      expect(store['R004.1.AC.01'][0]).toEqual(event);
    });

    it('should append to existing array', () => {
      const store: VerificationStore = {
        'R004.1.AC.01': [{
          claimId: 'R004.1.AC.01',
          date: '2026-03-10',
          actor: 'dev1',
        }],
      };

      const event: VerificationEvent = {
        claimId: 'R004.1.AC.01',
        date: '2026-03-11',
        actor: 'dev2',
        method: 'code review',
      };

      addVerificationEvent(store, event);

      expect(store['R004.1.AC.01']).toHaveLength(2);
      expect(store['R004.1.AC.01'][1]).toEqual(event);
    });

    it('should handle optional method field', () => {
      const store: VerificationStore = {};
      const event: VerificationEvent = {
        claimId: 'R004.1.AC.01',
        date: '2026-03-11',
        actor: 'dev',
        method: 'unit test',
      };

      addVerificationEvent(store, event);
      expect(store['R004.1.AC.01'][0].method).toBe('unit test');
    });
  });

  describe('getLatestVerification', () => {
    // @validates {R005.§3.AC.07}
    it('should return null for unknown claim', () => {
      const store: VerificationStore = {};
      expect(getLatestVerification(store, 'R004.1.AC.01')).toBeNull();
    });

    it('should return null for empty event array', () => {
      const store: VerificationStore = { 'R004.1.AC.01': [] };
      expect(getLatestVerification(store, 'R004.1.AC.01')).toBeNull();
    });

    it('should return the last event in the array', () => {
      const store: VerificationStore = {
        'R004.1.AC.01': [
          { claimId: 'R004.1.AC.01', date: '2026-03-10', actor: 'dev1' },
          { claimId: 'R004.1.AC.01', date: '2026-03-11', actor: 'dev2' },
        ],
      };

      const latest = getLatestVerification(store, 'R004.1.AC.01');
      expect(latest).not.toBeNull();
      expect(latest!.date).toBe('2026-03-11');
      expect(latest!.actor).toBe('dev2');
    });
  });

  describe('loadVerificationStore', () => {
    // @validates {R005.§3.AC.01}
    it('should return empty store when file does not exist', async () => {
      const store = await loadVerificationStore(tmpDir);
      expect(store).toEqual({});
    });

    it('should load existing store from disk', async () => {
      const storeData: VerificationStore = {
        'R004.1.AC.01': [{
          claimId: 'R004.1.AC.01',
          date: '2026-03-11',
          actor: 'dev',
        }],
      };

      await fs.writeFile(
        path.join(tmpDir, 'verification.json'),
        JSON.stringify(storeData, null, 2),
        'utf-8',
      );

      const loaded = await loadVerificationStore(tmpDir);
      expect(loaded).toEqual(storeData);
    });
  });

  describe('saveVerificationStore', () => {
    // @validates {R005.§3.AC.01}
    it('should write store to disk as JSON', async () => {
      const store: VerificationStore = {
        'R004.1.AC.01': [{
          claimId: 'R004.1.AC.01',
          date: '2026-03-11',
          actor: 'dev',
        }],
      };

      await saveVerificationStore(tmpDir, store);

      const content = await fs.readFile(
        path.join(tmpDir, 'verification.json'),
        'utf-8',
      );
      const parsed = JSON.parse(content);
      expect(parsed).toEqual(store);
    });

    it('should use 2-space indent', async () => {
      const store: VerificationStore = {
        'R004.1.AC.01': [{
          claimId: 'R004.1.AC.01',
          date: '2026-03-11',
          actor: 'dev',
        }],
      };

      await saveVerificationStore(tmpDir, store);

      const content = await fs.readFile(
        path.join(tmpDir, 'verification.json'),
        'utf-8',
      );
      // 2-space indent means lines start with "  " for nested properties
      expect(content).toContain('  "R004.1.AC.01"');
    });
  });

  describe('round-trip', () => {
    it('should survive save + load cycle', async () => {
      const store: VerificationStore = {};

      addVerificationEvent(store, {
        claimId: 'R004.1.AC.01',
        date: '2026-03-10',
        actor: 'agent',
        method: 'code review',
      });
      addVerificationEvent(store, {
        claimId: 'R004.1.AC.01',
        date: '2026-03-11',
        actor: 'dev',
      });
      addVerificationEvent(store, {
        claimId: 'R004.2.AC.01',
        date: '2026-03-11',
        actor: 'ci',
        method: 'automated test',
      });

      await saveVerificationStore(tmpDir, store);
      const loaded = await loadVerificationStore(tmpDir);

      expect(loaded['R004.1.AC.01']).toHaveLength(2);
      expect(loaded['R004.2.AC.01']).toHaveLength(1);

      const latest = getLatestVerification(loaded, 'R004.1.AC.01');
      expect(latest!.actor).toBe('dev');
    });
  });
});
