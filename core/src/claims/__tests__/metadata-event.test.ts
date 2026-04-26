/**
 * Tests for the metadata-event type module: shape and fold determinism.
 *
 * @validates {DD014.§3.DC.08} Fold rule for the four ops
 * @validates {DD014.§3.DC.09a} applyFold pure function
 * @validates {A004.§1.AC.03}
 */
import { describe, it, expect } from 'vitest';
import { applyFold } from '../metadata-event';
import type { MetadataEvent } from '../metadata-event';

const baseEvent = (
  partial: Partial<MetadataEvent> & Pick<MetadataEvent, 'op' | 'key' | 'value'>,
): MetadataEvent => ({
  id: partial.id ?? 'id-' + Math.random().toString(36).slice(2),
  claimId: partial.claimId ?? 'R009.§1.AC.01',
  actor: partial.actor ?? 'tester',
  date: partial.date ?? '2026-04-25T00:00:00.000Z',
  ...partial,
});

describe('applyFold (DD014.§3.DC.08, §3.DC.09a)', () => {
  // T-Fold-1
  describe('add semantic', () => {
    // @validates {DD014.§3.DC.08} add appends if not present
    it('appends distinct values in order', () => {
      const events: MetadataEvent[] = [
        baseEvent({ op: 'add', key: 'reviewer', value: 'a' }),
        baseEvent({ op: 'add', key: 'reviewer', value: 'b' }),
      ];
      expect(applyFold(events)).toEqual({ reviewer: ['a', 'b'] });
    });

    // @validates {DD014.§3.DC.08} add is idempotent at view level
    it('does not duplicate an existing value (idempotent)', () => {
      const events: MetadataEvent[] = [
        baseEvent({ op: 'add', key: 'reviewer', value: 'a' }),
        baseEvent({ op: 'add', key: 'reviewer', value: 'a' }),
      ];
      expect(applyFold(events)).toEqual({ reviewer: ['a'] });
    });
  });

  // T-Fold-2
  describe('set semantic', () => {
    // @validates {DD014.§3.DC.08} set clears values then appends
    it('clears prior values and records the new one', () => {
      const events: MetadataEvent[] = [
        baseEvent({ op: 'add', key: 'priority', value: 'low' }),
        baseEvent({ op: 'set', key: 'priority', value: 'high' }),
      ];
      expect(applyFold(events)).toEqual({ priority: ['high'] });
    });

    it('does not affect other keys', () => {
      const events: MetadataEvent[] = [
        baseEvent({ op: 'set', key: 'priority', value: 'high' }),
        baseEvent({ op: 'add', key: 'reviewer', value: 'alice' }),
      ];
      expect(applyFold(events)).toEqual({
        priority: ['high'],
        reviewer: ['alice'],
      });
    });
  });

  // T-Fold-3
  describe('unset semantic', () => {
    // @validates {DD014.§3.DC.08} unset clears values; key absent in result
    it('clears all values for the key (key absent from result)', () => {
      const events: MetadataEvent[] = [
        baseEvent({ op: 'add', key: 'reviewer', value: 'a' }),
        baseEvent({ op: 'add', key: 'reviewer', value: 'b' }),
        baseEvent({ op: 'unset', key: 'reviewer', value: '' }),
      ];
      expect(applyFold(events)).toEqual({});
    });

    it('does not affect other keys', () => {
      const events: MetadataEvent[] = [
        baseEvent({ op: 'add', key: 'reviewer', value: 'a' }),
        baseEvent({ op: 'add', key: 'priority', value: 'high' }),
        baseEvent({ op: 'unset', key: 'reviewer', value: '' }),
      ];
      expect(applyFold(events)).toEqual({ priority: ['high'] });
    });

    it('subsequent add after unset re-establishes the key', () => {
      const events: MetadataEvent[] = [
        baseEvent({ op: 'add', key: 'verified', value: 'true' }),
        baseEvent({ op: 'unset', key: 'verified', value: '' }),
        baseEvent({ op: 'add', key: 'verified', value: 'true' }),
      ];
      expect(applyFold(events)).toEqual({ verified: ['true'] });
    });
  });

  // T-Fold-4
  describe('retract semantic', () => {
    // @validates {DD014.§3.DC.08} retract removes named value if present
    it('removes the named value', () => {
      const events: MetadataEvent[] = [
        baseEvent({ op: 'add', key: 'reviewer', value: 'a' }),
        baseEvent({ op: 'add', key: 'reviewer', value: 'b' }),
        baseEvent({ op: 'retract', key: 'reviewer', value: 'a' }),
      ];
      expect(applyFold(events)).toEqual({ reviewer: ['b'] });
    });

    // @validates {DD014.§3.DC.08} retract is no-op when value absent
    it('is a no-op if the value is not present', () => {
      const events: MetadataEvent[] = [
        baseEvent({ op: 'add', key: 'reviewer', value: 'a' }),
        baseEvent({ op: 'retract', key: 'reviewer', value: 'c' }),
      ];
      expect(applyFold(events)).toEqual({ reviewer: ['a'] });
    });

    it('removing the only value drops the key from the result', () => {
      const events: MetadataEvent[] = [
        baseEvent({ op: 'add', key: 'reviewer', value: 'a' }),
        baseEvent({ op: 'retract', key: 'reviewer', value: 'a' }),
      ];
      expect(applyFold(events)).toEqual({});
    });
  });

  // T-Fold-5
  describe('combined determinism', () => {
    // @validates {DD014.§3.DC.09a} fold is deterministic across invocations
    it('produces the same state across two independent fold invocations', () => {
      const events: MetadataEvent[] = [
        baseEvent({ op: 'add', key: 'importance', value: '5' }),
        baseEvent({ op: 'add', key: 'reviewer', value: 'alice' }),
        baseEvent({ op: 'add', key: 'reviewer', value: 'bob' }),
        baseEvent({ op: 'set', key: 'importance', value: '4' }),
        baseEvent({ op: 'retract', key: 'reviewer', value: 'alice' }),
        baseEvent({ op: 'add', key: 'tag', value: 'security' }),
        baseEvent({ op: 'add', key: 'tag', value: 'auth' }),
        baseEvent({ op: 'unset', key: 'tag', value: '' }),
        baseEvent({ op: 'add', key: 'verified', value: 'true' }),
        baseEvent({ op: 'add', key: 'reviewer', value: 'carol' }),
        baseEvent({ op: 'set', key: 'priority', value: 'high' }),
        baseEvent({ op: 'retract', key: 'reviewer', value: 'missing' }),
      ];
      const first = applyFold(events);
      const second = applyFold(events);
      expect(first).toEqual(second);
      expect(first).toEqual({
        importance: ['4'],
        reviewer: ['bob', 'carol'],
        verified: ['true'],
        priority: ['high'],
      });
    });

    it('keys with empty values[] after the fold are excluded', () => {
      const events: MetadataEvent[] = [
        baseEvent({ op: 'add', key: 'a', value: 'x' }),
        baseEvent({ op: 'unset', key: 'a', value: '' }),
        baseEvent({ op: 'add', key: 'b', value: 'y' }),
      ];
      const result = applyFold(events);
      expect('a' in result).toBe(false);
      expect(result).toEqual({ b: ['y'] });
    });

    it('empty event list produces empty state', () => {
      expect(applyFold([])).toEqual({});
    });
  });
});
