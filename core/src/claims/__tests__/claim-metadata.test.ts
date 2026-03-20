/**
 * Tests for claim metadata interpreter.
 *
 * @validates {R005.§1.AC.01} Bare digit 1-5 recognized as importance
 * @validates {R005.§1.AC.05} Digits outside 1-5 treated as tags
 * @validates {R005.§2.AC.01} Lifecycle tags extracted correctly
 * @validates {R005.§2.AC.07} Multiple lifecycle tags use first
 * @validates {R006.§1.AC.01} derives=TARGET recognized and extracted to derivedFrom[]
 * @validates {R006.§1.AC.02} Multiple derives= entries independently collected
 * @validates {R006.§1.AC.04} Derivation coexists with lifecycle
 */
import { describe, it, expect } from 'vitest';
import {
  parseClaimMetadata,
  isLifecycleTag,
  isDerivationTag,
  LIFECYCLE_TAGS,
} from '../claim-metadata';
import type { ParsedMetadata } from '../claim-metadata';

describe('isLifecycleTag', () => {
  it('should recognize exact lifecycle keywords', () => {
    expect(isLifecycleTag('closed')).toBe(true);
    expect(isLifecycleTag('deferred')).toBe(true);
    expect(isLifecycleTag('removed')).toBe(true);
    expect(isLifecycleTag('superseded')).toBe(true);
  });

  it('should recognize superseded=TARGET pattern', () => {
    expect(isLifecycleTag('superseded=R004.§2.AC.07')).toBe(true);
    expect(isLifecycleTag('superseded=S001.1.AC.01')).toBe(true);
  });

  it('should reject bare superseded= with no target', () => {
    expect(isLifecycleTag('superseded=')).toBe(false);
  });

  it('should reject non-lifecycle strings', () => {
    expect(isLifecycleTag('security')).toBe(false);
    expect(isLifecycleTag('P0')).toBe(false);
    expect(isLifecycleTag('important')).toBe(false);
    expect(isLifecycleTag('')).toBe(false);
    expect(isLifecycleTag('Closed')).toBe(false); // case sensitive
  });
});

// ---------------------------------------------------------------------------
// isDerivationTag
// @validates {R006.§1.AC.01}
// ---------------------------------------------------------------------------

describe('isDerivationTag', () => {
  it('should recognize derives=TARGET pattern', () => {
    expect(isDerivationTag('derives=R005.§1.AC.01')).toBe(true);
    expect(isDerivationTag('derives=S001.1.AC.01')).toBe(true);
    expect(isDerivationTag('derives=X')).toBe(true);
  });

  it('should reject bare derives= with no target', () => {
    expect(isDerivationTag('derives=')).toBe(false);
  });

  it('should reject non-derivation strings', () => {
    expect(isDerivationTag('derived=X')).toBe(false);
    expect(isDerivationTag('derive=X')).toBe(false);
    expect(isDerivationTag('security')).toBe(false);
    expect(isDerivationTag('')).toBe(false);
    expect(isDerivationTag('superseded=X')).toBe(false);
  });
});

describe('LIFECYCLE_TAGS', () => {
  it('should contain exactly four tags', () => {
    expect(LIFECYCLE_TAGS).toHaveLength(4);
    expect(LIFECYCLE_TAGS).toContain('closed');
    expect(LIFECYCLE_TAGS).toContain('deferred');
    expect(LIFECYCLE_TAGS).toContain('removed');
    expect(LIFECYCLE_TAGS).toContain('superseded');
  });
});

describe('parseClaimMetadata', () => {
  describe('importance parsing', () => {
    // @validates {R005.§1.AC.01}
    it('should recognize bare digit 1-5 as importance', () => {
      expect(parseClaimMetadata(['4'])).toEqual({
        importance: 4,
        tags: [],
        derivedFrom: [],
      });
    });

    it('should handle importance 1 (lowest)', () => {
      expect(parseClaimMetadata(['1'])).toEqual({
        importance: 1,
        tags: [],
        derivedFrom: [],
      });
    });

    it('should handle importance 5 (highest)', () => {
      expect(parseClaimMetadata(['5'])).toEqual({
        importance: 5,
        tags: [],
        derivedFrom: [],
      });
    });

    // @validates {R005.§1.AC.05}
    it('should treat digit 0 as freeform tag (out of range)', () => {
      expect(parseClaimMetadata(['0'])).toEqual({
        tags: ['0'],
        derivedFrom: [],
      });
    });

    it('should treat digit 6 as freeform tag (out of range)', () => {
      expect(parseClaimMetadata(['6'])).toEqual({
        tags: ['6'],
        derivedFrom: [],
      });
    });

    it('should treat digit 9 as freeform tag (out of range)', () => {
      expect(parseClaimMetadata(['9'])).toEqual({
        tags: ['9'],
        derivedFrom: [],
      });
    });

    it('should use the first importance value when multiple provided', () => {
      const result = parseClaimMetadata(['3', '5']);
      expect(result.importance).toBe(3);
      // Second digit (5) is still a valid importance digit — it's consumed
      // but not stored (first wins). It does NOT become a tag.
      expect(result.tags).toEqual([]);
    });
  });

  describe('lifecycle parsing', () => {
    // @validates {R005.§2.AC.01}
    it('should parse closed lifecycle tag', () => {
      expect(parseClaimMetadata(['closed'])).toEqual({
        lifecycle: { type: 'closed' },
        tags: [],
        derivedFrom: [],
      });
    });

    it('should parse deferred lifecycle tag', () => {
      expect(parseClaimMetadata(['deferred'])).toEqual({
        lifecycle: { type: 'deferred' },
        tags: [],
        derivedFrom: [],
      });
    });

    it('should parse removed lifecycle tag', () => {
      expect(parseClaimMetadata(['removed'])).toEqual({
        lifecycle: { type: 'removed' },
        tags: [],
        derivedFrom: [],
      });
    });

    it('should parse superseded lifecycle tag with target', () => {
      const result = parseClaimMetadata(['superseded=R004.§2.AC.07']);
      expect(result.lifecycle).toEqual({
        type: 'superseded',
        target: 'R004.§2.AC.07',
      });
      expect(result.tags).toEqual([]);
    });

    it('should parse bare superseded as lifecycle (no target)', () => {
      const result = parseClaimMetadata(['superseded']);
      expect(result.lifecycle).toEqual({ type: 'superseded' });
    });

    // @validates {R005.§2.AC.07}
    it('should use first lifecycle tag when multiple provided', () => {
      const result = parseClaimMetadata(['closed', 'removed']);
      expect(result.lifecycle).toEqual({ type: 'closed' });
      // Second lifecycle tag is silently skipped (lint catches this)
      expect(result.tags).toEqual([]);
    });
  });

  describe('combined metadata', () => {
    it('should parse importance + lifecycle together', () => {
      const result = parseClaimMetadata(['4', 'closed']);
      expect(result).toEqual({
        importance: 4,
        lifecycle: { type: 'closed' },
        tags: [],
        derivedFrom: [],
      });
    });

    it('should parse importance + lifecycle + tags', () => {
      const result = parseClaimMetadata(['4', 'closed', 'security']);
      expect(result).toEqual({
        importance: 4,
        lifecycle: { type: 'closed' },
        tags: ['security'],
        derivedFrom: [],
      });
    });

    it('should handle real-world metadata: importance + superseded', () => {
      const result = parseClaimMetadata(['3', 'superseded=R004.§2.AC.07']);
      expect(result.importance).toBe(3);
      expect(result.lifecycle).toEqual({
        type: 'superseded',
        target: 'R004.§2.AC.07',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Derivation metadata
  // @validates {R006.§1.AC.01} derives=TARGET recognition
  // @validates {R006.§1.AC.02} Multiple derives= entries
  // @validates {R006.§1.AC.04} Coexistence with lifecycle
  // ---------------------------------------------------------------------------

  describe('derivation metadata', () => {
    it('should extract single derives=TARGET to derivedFrom[]', () => {
      const result = parseClaimMetadata(['derives=R005.§1.AC.01']);
      expect(result).toEqual({
        derivedFrom: ['R005.§1.AC.01'],
        tags: [],
      });
    });

    // @validates {R006.§1.AC.02}
    it('should extract multiple derives=TARGET entries independently', () => {
      const result = parseClaimMetadata(['derives=R005.§1.AC.01', 'derives=R005.§1.AC.02']);
      expect(result).toEqual({
        derivedFrom: ['R005.§1.AC.01', 'R005.§1.AC.02'],
        tags: [],
      });
    });

    it('should not push derives=TARGET into tags[]', () => {
      const result = parseClaimMetadata(['derives=R005.§1.AC.01']);
      expect(result.tags).toEqual([]);
    });

    it('should not push derives=TARGET into lifecycle', () => {
      const result = parseClaimMetadata(['derives=R005.§1.AC.01']);
      expect(result.lifecycle).toBeUndefined();
    });

    // @validates {R006.§1.AC.04}
    it('should coexist with importance', () => {
      const result = parseClaimMetadata(['4', 'derives=R005.§1.AC.01']);
      expect(result).toEqual({
        importance: 4,
        derivedFrom: ['R005.§1.AC.01'],
        tags: [],
      });
    });

    // @validates {R006.§1.AC.04}
    it('should coexist with lifecycle', () => {
      const result = parseClaimMetadata(['derives=R005.§1.AC.01', 'closed']);
      expect(result).toEqual({
        lifecycle: { type: 'closed' },
        derivedFrom: ['R005.§1.AC.01'],
        tags: [],
      });
    });

    // @validates {R006.§1.AC.04}
    it('should coexist with importance + lifecycle + tags', () => {
      const result = parseClaimMetadata(['4', 'derives=R005.§1.AC.01', 'closed', 'security']);
      expect(result).toEqual({
        importance: 4,
        lifecycle: { type: 'closed' },
        derivedFrom: ['R005.§1.AC.01'],
        tags: ['security'],
      });
    });

    it('should coexist with superseded (both populate their separate fields)', () => {
      const result = parseClaimMetadata(['superseded=X', 'derives=Y']);
      expect(result.lifecycle).toEqual({ type: 'superseded', target: 'X' });
      expect(result.derivedFrom).toEqual(['Y']);
    });

    it('should handle derives= with empty target as freeform tag', () => {
      // derives= with no target is not recognized as a derivation tag
      const result = parseClaimMetadata(['derives=']);
      expect(result.derivedFrom).toEqual([]);
      expect(result.tags).toEqual(['derives=']);
    });
  });

  describe('freeform tags', () => {
    it('should collect unrecognized strings as tags', () => {
      const result = parseClaimMetadata(['security', 'P0', 'auth']);
      expect(result.tags).toEqual(['security', 'P0', 'auth']);
      expect(result.importance).toBeUndefined();
      expect(result.lifecycle).toBeUndefined();
    });

    it('should handle multi-digit numbers as tags', () => {
      const result = parseClaimMetadata(['42']);
      expect(result.tags).toEqual(['42']);
    });
  });

  describe('empty / edge cases', () => {
    it('should handle empty metadata array', () => {
      expect(parseClaimMetadata([])).toEqual({ tags: [], derivedFrom: [] });
    });

    it('should handle single freeform tag', () => {
      expect(parseClaimMetadata(['security'])).toEqual({
        tags: ['security'],
        derivedFrom: [],
      });
    });
  });
});
