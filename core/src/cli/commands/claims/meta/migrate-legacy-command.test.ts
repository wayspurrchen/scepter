/**
 * Unit tests for the migrate-legacy classifier and projector.
 *
 * The CLI wrapper is exercised at the integration level; this file tests the
 * pure migration logic directly.
 *
 * @validates {DD014.§3.DC.19} per-event projection from legacy to new shape
 * @validates {R009.§7.AC.01}
 */
import { describe, it, expect } from 'vitest';
import {
  classifyAndMigrate,
  normalizeLegacyDate,
  projectLegacyEvent,
} from './migrate-legacy-command';

describe('migrate-legacy: normalizeLegacyDate', () => {
  it('pads YYYY-MM-DD to start-of-day UTC', () => {
    expect(normalizeLegacyDate({ date: '2026-04-01' })).toBe('2026-04-01T00:00:00.000Z');
  });

  it('keeps full ISO 8601 datetime as-is', () => {
    expect(
      normalizeLegacyDate({ date: '2026-04-01T15:30:42.123Z' }),
    ).toBe('2026-04-01T15:30:42.123Z');
  });

  it('falls back to legacy `timestamp` when `date` is missing', () => {
    expect(normalizeLegacyDate({ timestamp: '2026-04-01' })).toBe('2026-04-01T00:00:00.000Z');
  });

  it('produces a valid ISO string for empty input', () => {
    const result = normalizeLegacyDate({});
    // The exact value isn't important; it just needs to be parseable.
    expect(new Date(result).toString()).not.toBe('Invalid Date');
  });
});

describe('migrate-legacy: projectLegacyEvent', () => {
  it('emits an add/verified=true event with the legacy actor and normalized date', () => {
    const event = projectLegacyEvent('R009.§1.AC.01', {
      claimId: 'R009.§1.AC.01',
      date: '2026-04-01',
      actor: 'alice',
    });
    expect(event.op).toBe('add');
    expect(event.key).toBe('verified');
    expect(event.value).toBe('true');
    expect(event.actor).toBe('alice');
    expect(event.date).toBe('2026-04-01T00:00:00.000Z');
    expect(event.note).toBeUndefined();
    expect(event.id).toMatch(/^[a-z0-9]{24}$/);
  });

  it('rewrites legacy `method` as `note=method=...`', () => {
    const event = projectLegacyEvent('R009.§1.AC.01', {
      claimId: 'R009.§1.AC.01',
      date: '2026-04-01',
      actor: 'alice',
      method: 'manual',
    });
    expect(event.note).toBe('method=manual');
  });

  it('falls back to the parent claimId if the legacy event lacks one', () => {
    const event = projectLegacyEvent('R001.§1.AC.01', { date: '2026-04-01', actor: 'alice' });
    expect(event.claimId).toBe('R001.§1.AC.01');
  });

  it('uses an empty string for missing actor (preserves legacy data faithfully)', () => {
    const event = projectLegacyEvent('R001.§1.AC.01', { date: '2026-04-01' });
    expect(event.actor).toBe('');
  });
});

describe('migrate-legacy: classifyAndMigrate', () => {
  // T-Migration-2
  it('classifies an empty document as `empty`', () => {
    expect(classifyAndMigrate({})).toEqual({ kind: 'empty' });
  });

  // T-Migration-1
  it('migrates an all-legacy document', () => {
    const parsed = {
      'R001.§1.AC.01': [
        { claimId: 'R001.§1.AC.01', date: '2026-04-01', actor: 'alice' },
        { claimId: 'R001.§1.AC.01', timestamp: '2026-04-02', actor: 'bob', method: 'manual' },
      ],
      'R002.§1.AC.01': [
        { claimId: 'R002.§1.AC.01', date: '2026-04-01T15:00:00.000Z', actor: 'carol' },
      ],
    };
    const outcome = classifyAndMigrate(parsed);
    expect(outcome.kind).toBe('migrated');
    if (outcome.kind !== 'migrated') return;
    expect(outcome.legacyCount).toBe(3);
    expect(Object.keys(outcome.store)).toEqual(['R001.§1.AC.01', 'R002.§1.AC.01']);
    expect(outcome.store['R001.§1.AC.01']).toHaveLength(2);
    expect(outcome.store['R001.§1.AC.01'][0].date).toBe('2026-04-01T00:00:00.000Z');
    expect(outcome.store['R001.§1.AC.01'][1].date).toBe('2026-04-02T00:00:00.000Z');
    expect(outcome.store['R001.§1.AC.01'][1].note).toBe('method=manual');
    expect(outcome.store['R002.§1.AC.01'][0].date).toBe('2026-04-01T15:00:00.000Z');
    // All events have op=add, key=verified, value=true
    for (const events of Object.values(outcome.store)) {
      for (const event of events) {
        expect(event.op).toBe('add');
        expect(event.key).toBe('verified');
        expect(event.value).toBe('true');
      }
    }
  });

  // T-Migration-3
  it('reports already-migrated when every event has op set', () => {
    const parsed = {
      'R001.§1.AC.01': [
        {
          id: 'cuid-x',
          claimId: 'R001.§1.AC.01',
          op: 'add',
          key: 'verified',
          value: 'true',
          actor: 'alice',
          date: '2026-04-01T00:00:00.000Z',
        },
      ],
    };
    expect(classifyAndMigrate(parsed)).toEqual({ kind: 'already-migrated', eventCount: 1 });
  });

  // T-Migration-4
  it('refuses mixed-shape documents', () => {
    const parsed = {
      'R001.§1.AC.01': [
        { claimId: 'R001.§1.AC.01', date: '2026-04-01', actor: 'alice' },
        {
          id: 'cuid-x',
          claimId: 'R001.§1.AC.01',
          op: 'add',
          key: 'verified',
          value: 'true',
          actor: 'bob',
          date: '2026-04-02T00:00:00.000Z',
        },
      ],
    };
    expect(classifyAndMigrate(parsed)).toEqual({
      kind: 'mixed',
      legacyCount: 1,
      newCount: 1,
    });
  });

  it('flags non-array per-claim entries as invalid', () => {
    const malformed: Record<string, unknown> = { X: 'not-an-array' };
    expect(classifyAndMigrate(malformed)).toEqual({
      kind: 'invalid-claim-shape',
      claimId: 'X',
    });
  });
});
