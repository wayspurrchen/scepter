/**
 * Tests for the snapshot type module — constants, normalization, and
 * the schema-version invariant.
 *
 * @validates {DD018.§3.DC.01} SCHEMA_VERSION constant exists, integer 1
 * @validates {DD018.§3.DC.06} BODY_HASH_ALGORITHM/ENCODING constants
 * @validates {DD018.§3.DC.07} normalizeBodyForHash trim semantics
 */
import { describe, it, expect } from 'vitest';
import {
  SCHEMA_VERSION,
  BODY_HASH_ALGORITHM,
  BODY_HASH_ENCODING,
  normalizeBodyForHash,
} from '../snapshot-types';

describe('snapshot-types', () => {
  it('SCHEMA_VERSION is the integer 1', () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(Number.isInteger(SCHEMA_VERSION)).toBe(true);
  });

  it('hash constants are sha256 / hex', () => {
    expect(BODY_HASH_ALGORITHM).toBe('sha256');
    expect(BODY_HASH_ENCODING).toBe('hex');
  });

  describe('normalizeBodyForHash', () => {
    it('trims leading and trailing whitespace', () => {
      expect(normalizeBodyForHash('  hello  ')).toBe('hello');
      expect(normalizeBodyForHash('\n\nhello\n\n')).toBe('hello');
      expect(normalizeBodyForHash('\t hello \t')).toBe('hello');
    });

    it('does NOT translate line endings', () => {
      // CRLF preserved internally — only the leading/trailing trim runs.
      expect(normalizeBodyForHash('a\r\nb')).toBe('a\r\nb');
    });

    it('does NOT case-fold', () => {
      expect(normalizeBodyForHash('Hello')).toBe('Hello');
    });

    it('is idempotent', () => {
      const once = normalizeBodyForHash('  hello  ');
      const twice = normalizeBodyForHash(once);
      expect(twice).toBe(once);
    });

    it('returns empty string for whitespace-only input', () => {
      expect(normalizeBodyForHash('   \n\t   ')).toBe('');
    });
  });
});
