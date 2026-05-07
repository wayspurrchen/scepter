/**
 * Tests for confidence reviewer/level validation.
 *
 * @validates {S003.§5.AC.03} reviewer/level validation rule
 * @validates {DD016.§7.DC.41} validateReviewerLevel verbatim move
 * @validates {DD016.§7.DC.42} type imports from ./types.js
 * @validates {R004.§7.AC.02} reviewer icon and level validation
 */

import { describe, it, expect } from 'vitest';
import { validateReviewerLevel, mapReviewerArg } from '../validation.js';

describe('validateReviewerLevel', () => {
  it('accepts AI levels 1-3', () => {
    expect(validateReviewerLevel('🤖', 1).valid).toBe(true);
    expect(validateReviewerLevel('🤖', 2).valid).toBe(true);
    expect(validateReviewerLevel('🤖', 3).valid).toBe(true);
  });

  it('rejects AI level 4-5', () => {
    expect(validateReviewerLevel('🤖', 4).valid).toBe(false);
    expect(validateReviewerLevel('🤖', 5).valid).toBe(false);
    expect(validateReviewerLevel('🤖', 4).message).toContain('1-3');
  });

  it('accepts Human levels 3-5', () => {
    expect(validateReviewerLevel('👤', 3).valid).toBe(true);
    expect(validateReviewerLevel('👤', 4).valid).toBe(true);
    expect(validateReviewerLevel('👤', 5).valid).toBe(true);
  });

  it('rejects Human levels 1-2', () => {
    expect(validateReviewerLevel('👤', 1).valid).toBe(false);
    expect(validateReviewerLevel('👤', 2).valid).toBe(false);
    expect(validateReviewerLevel('👤', 1).message).toContain('3-5');
  });
});

describe('mapReviewerArg', () => {
  it('maps "ai" to 🤖', () => {
    expect(mapReviewerArg('ai')).toBe('🤖');
  });

  it('maps "human" to 👤', () => {
    expect(mapReviewerArg('human')).toBe('👤');
  });

  it('is case-insensitive', () => {
    expect(mapReviewerArg('AI')).toBe('🤖');
    expect(mapReviewerArg('Human')).toBe('👤');
    expect(mapReviewerArg('HUMAN')).toBe('👤');
  });

  it('returns null for unknown arg', () => {
    expect(mapReviewerArg('bot')).toBeNull();
    expect(mapReviewerArg('')).toBeNull();
  });
});
