/**
 * Pure-function tests for the meta subcommand group's shared helpers.
 *
 * @validates {DD014.§3.DC.04} KEY validation regex
 * @validates {DD014.§3.DC.25} --date accepts both YYYY-MM-DD and full ISO
 * @validates {DD014.§3.DC.26} validateKeys atomicity (all-or-nothing)
 */
import { describe, it, expect } from 'vitest';
import {
  parseDateOption,
  validateKeys,
  parseKeyValuePairs,
} from '../shared';

describe('parseDateOption (DD014.§3.DC.25)', () => {
  it('returns now() for undefined', () => {
    const result = parseDateOption(undefined);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('pads YYYY-MM-DD to start-of-day UTC', () => {
    expect(parseDateOption('2026-04-25')).toBe('2026-04-25T00:00:00.000Z');
  });

  it('passes through full ISO 8601 datetimes', () => {
    expect(parseDateOption('2026-04-25T15:30:42.123Z')).toBe('2026-04-25T15:30:42.123Z');
  });

  it('passes through arbitrary input untouched (caller is trusted)', () => {
    // The function is permissive — it doesn't validate the format beyond
    // the YYYY-MM-DD shortcut.
    expect(parseDateOption('not-a-date')).toBe('not-a-date');
  });
});

describe('validateKeys (DD014.§3.DC.04, §3.DC.26)', () => {
  it('accepts lowercase keys with allowed characters', () => {
    expect(validateKeys(['reviewer', 'priority.high', 'tag-name', 'a_b', 'a.b.c'])).toBeNull();
  });

  it('accepts a single character key starting with a lowercase letter', () => {
    expect(validateKeys(['a', 'z'])).toBeNull();
  });

  it('rejects keys starting with a digit', () => {
    const err = validateKeys(['1key']);
    expect(err).toMatch(/Invalid KEY/);
    expect(err).toContain('1key');
  });

  it('rejects keys starting with uppercase', () => {
    const err = validateKeys(['Reviewer']);
    expect(err).toMatch(/Invalid KEY/);
  });

  it('rejects keys with spaces', () => {
    const err = validateKeys(['my key']);
    expect(err).toMatch(/Invalid KEY/);
  });

  it('rejects keys with special characters not in the regex', () => {
    expect(validateKeys(['key!'])).toMatch(/Invalid KEY/);
    expect(validateKeys(['key@host'])).toMatch(/Invalid KEY/);
    expect(validateKeys(['key/path'])).toMatch(/Invalid KEY/);
  });

  it('rejects empty keys', () => {
    const err = validateKeys(['']);
    expect(err).toMatch(/Invalid KEY/);
  });

  // @validates {DD014.§3.DC.26}
  it('atomicity: rejects the whole set if any one key is invalid', () => {
    const err = validateKeys(['valid_key', 'BadKey', 'also_valid']);
    expect(err).toMatch(/Invalid KEY/);
    expect(err).toContain('BadKey');
  });

  it('returns null for an empty array', () => {
    expect(validateKeys([])).toBeNull();
  });
});

describe('parseKeyValuePairs', () => {
  it('parses a single KEY=VALUE pair', () => {
    const result = parseKeyValuePairs(['reviewer=alice']);
    expect(result).toEqual({ pairs: [{ key: 'reviewer', value: 'alice' }] });
  });

  it('parses multiple pairs in order', () => {
    const result = parseKeyValuePairs(['priority=high', 'reviewer=alice', 'sprint=23']);
    expect(result).toEqual({
      pairs: [
        { key: 'priority', value: 'high' },
        { key: 'reviewer', value: 'alice' },
        { key: 'sprint', value: '23' },
      ],
    });
  });

  it('preserves "=" inside the VALUE portion', () => {
    // Only the first "=" is the delimiter.
    const result = parseKeyValuePairs(['equation=a=b+c']);
    expect(result).toEqual({ pairs: [{ key: 'equation', value: 'a=b+c' }] });
  });

  it('rejects an entry with no =', () => {
    const result = parseKeyValuePairs(['justakey']);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/Invalid KEY=VALUE/);
    }
  });

  it('rejects an entry with empty VALUE', () => {
    const result = parseKeyValuePairs(['key=']);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/Empty VALUE/);
    }
  });

  it('rejects an entry whose first character is "="', () => {
    const result = parseKeyValuePairs(['=value']);
    expect('error' in result).toBe(true);
  });
});
