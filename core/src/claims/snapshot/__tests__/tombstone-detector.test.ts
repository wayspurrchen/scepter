/**
 * Tests for the tombstone-detector module.
 *
 * @validates {DD018.§3.DC.32} CONTENT_TOMBSTONE_RE pattern coverage
 * @validates {DD018.§3.DC.33} isLifecycleTombstone
 * @validates {DD018.§3.DC.34} isContentTombstone (incl. trim and empty-body)
 * @validates {DD018.§3.DC.35} isTombstoned cache + ordering
 */
import { describe, it, expect } from 'vitest';
import {
  CONTENT_TOMBSTONE_RE,
  isLifecycleTombstone,
  isContentTombstone,
  isTombstoned,
} from '../tombstone-detector';
import type { ClaimIndexEntry } from '../../claim-index';

const stubEntry = (overrides: Partial<ClaimIndexEntry> = {}): ClaimIndexEntry => ({
  noteId: 'R001',
  claimId: 'AC.01',
  fullyQualified: 'R001.§1.AC.01',
  sectionPath: [1],
  claimPrefix: 'AC',
  claimNumber: 1,
  heading: '§1.AC.01 stub heading',
  line: 10,
  endLine: 11,
  metadata: [],
  parsedTags: [],
  derivedFrom: [],
  noteType: 'Requirement',
  noteFilePath: '/tmp/stub.md',
  ...overrides,
});

describe('CONTENT_TOMBSTONE_RE', () => {
  it.each([
    'Removed',
    'removed',
    'REMOVED',
    'removed.',
    'Removed.',
    'Superseded',
    'superseded',
    'superseded.',
    'Superseded.',
  ])('matches %s', (s) => {
    expect(CONTENT_TOMBSTONE_RE.test(s)).toBe(true);
  });

  it.each([
    'Removed: see X',
    'This was removed in v2',
    '',
    'remove',
    'supersede',
    'removed!',
    'removed; see X',
    'Removed.\nSee X',
  ])('does NOT match %s', (s) => {
    expect(CONTENT_TOMBSTONE_RE.test(s)).toBe(false);
  });
});

describe('isLifecycleTombstone', () => {
  it('true for removed', () => {
    expect(isLifecycleTombstone({ type: 'removed' })).toBe(true);
  });
  it('true for superseded (no target)', () => {
    expect(isLifecycleTombstone({ type: 'superseded' })).toBe(true);
  });
  it('true for superseded (with target)', () => {
    expect(isLifecycleTombstone({ type: 'superseded', target: 'R002.AC.01' })).toBe(true);
  });
  it('false for closed', () => {
    expect(isLifecycleTombstone({ type: 'closed' })).toBe(false);
  });
  it('false for deferred', () => {
    expect(isLifecycleTombstone({ type: 'deferred' })).toBe(false);
  });
  it('false for undefined', () => {
    expect(isLifecycleTombstone(undefined)).toBe(false);
  });
  it('false for null', () => {
    expect(isLifecycleTombstone(null)).toBe(false);
  });
});

describe('isContentTombstone', () => {
  it('trims before testing', () => {
    expect(isContentTombstone('  Removed.  ')).toBe(true);
    expect(isContentTombstone('\nremoved\n')).toBe(true);
  });
  it('returns false for empty body', () => {
    expect(isContentTombstone('')).toBe(false);
    expect(isContentTombstone('   \t\n  ')).toBe(false);
  });
  it('returns false when there is non-tombstone prose', () => {
    expect(isContentTombstone('This claim was removed in v2')).toBe(false);
  });
});

describe('isTombstoned', () => {
  it('returns false when entry is undefined and caches', () => {
    const cache = new Map<string, boolean>();
    const result = isTombstoned({
      fqid: 'R001.§1.AC.01',
      entry: undefined,
      bodyResolver: () => 'Removed',
      cache,
    });
    expect(result).toBe(false);
    expect(cache.get('R001.§1.AC.01')).toBe(false);
  });

  it('returns true and caches on lifecycle hit (does NOT call bodyResolver)', () => {
    const cache = new Map<string, boolean>();
    let bodyResolverCalled = false;
    const result = isTombstoned({
      fqid: 'R001.§1.AC.01',
      entry: stubEntry({ lifecycle: { type: 'removed' } }),
      bodyResolver: () => {
        bodyResolverCalled = true;
        return 'irrelevant';
      },
      cache,
    });
    expect(result).toBe(true);
    expect(bodyResolverCalled).toBe(false);
    expect(cache.get('R001.§1.AC.01')).toBe(true);
  });

  it('falls through to body when lifecycle is closed', () => {
    const cache = new Map<string, boolean>();
    const result = isTombstoned({
      fqid: 'R001.§1.AC.01',
      entry: stubEntry({ lifecycle: { type: 'closed' } }),
      bodyResolver: () => 'Removed.',
      cache,
    });
    expect(result).toBe(true);
  });

  it('falls through to body when lifecycle is undefined', () => {
    const cache = new Map<string, boolean>();
    const result = isTombstoned({
      fqid: 'R001.§1.AC.01',
      entry: stubEntry({ lifecycle: undefined }),
      bodyResolver: () => 'Superseded',
      cache,
    });
    expect(result).toBe(true);
  });

  it('returns false when neither lifecycle nor content tombstones', () => {
    const cache = new Map<string, boolean>();
    const result = isTombstoned({
      fqid: 'R001.§1.AC.01',
      entry: stubEntry({ lifecycle: { type: 'closed' } }),
      bodyResolver: () => 'Some normal claim body.',
      cache,
    });
    expect(result).toBe(false);
    expect(cache.get('R001.§1.AC.01')).toBe(false);
  });

  it('uses cached result on a second call (does NOT re-resolve)', () => {
    const cache = new Map<string, boolean>();
    let calls = 0;
    const ctx = {
      fqid: 'R001.§1.AC.01',
      entry: stubEntry({ lifecycle: undefined }),
      bodyResolver: () => {
        calls += 1;
        return 'Removed';
      },
      cache,
    };
    expect(isTombstoned(ctx)).toBe(true);
    expect(isTombstoned(ctx)).toBe(true);
    expect(calls).toBe(1);
  });
});
