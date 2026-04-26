/**
 * Tests for the metadata-filters utility.
 *
 * @validates {DD014.§3.DC.55} parseMetadataFilters validates KEY/VALUE shapes
 * @validates {DD014.§3.DC.56} matchesMetadataFilters AND semantics
 * @validates {DD014.§3.DC.56} applyMetadataFilters composes via fold lookup
 */
import { describe, it, expect } from 'vitest';
import {
  parseMetadataFilters,
  matchesMetadataFilters,
  applyMetadataFilters,
} from '../metadata-filters';
import type { MetadataStorage } from '../../storage/storage-backend';
import type { MetadataEvent, MetadataStore } from '../metadata-event';
import { applyFold } from '../metadata-event';

function makeStorage(store: MetadataStore): MetadataStorage {
  return {
    async load() {
      return store;
    },
    async save(s) {
      Object.assign(store, s);
    },
    async append(event: MetadataEvent) {
      const existing = store[event.claimId] ?? [];
      existing.push(event);
      store[event.claimId] = existing;
    },
    async query(filter) {
      const claimIds = filter.claimId ? [filter.claimId] : Object.keys(store);
      const out: MetadataEvent[] = [];
      for (const claimId of claimIds) {
        for (const event of store[claimId] ?? []) {
          if (filter.key !== undefined && event.key !== filter.key) continue;
          out.push(event);
        }
      }
      return out;
    },
    async fold(claimId: string) {
      return applyFold(store[claimId] ?? []);
    },
  };
}

describe('parseMetadataFilters (DD014.§3.DC.55)', () => {
  it('returns ok with empty arrays for undefined inputs', () => {
    const result = parseMetadataFilters({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.where).toEqual([]);
    expect(result.hasKey).toEqual([]);
    expect(result.missingKey).toEqual([]);
  });

  it('parses --where KEY=VALUE pairs', () => {
    const result = parseMetadataFilters({ where: ['priority=high', 'reviewer=alice'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.where).toEqual([
      { key: 'priority', value: 'high' },
      { key: 'reviewer', value: 'alice' },
    ]);
  });

  it('preserves "=" inside the VALUE portion', () => {
    const result = parseMetadataFilters({ where: ['equation=a=b+c'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.where).toEqual([{ key: 'equation', value: 'a=b+c' }]);
  });

  it('rejects --where without =', () => {
    const result = parseMetadataFilters({ where: ['just-a-key'] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Invalid --where pair/);
  });

  it('rejects --where with empty VALUE', () => {
    const result = parseMetadataFilters({ where: ['key='] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Empty --where VALUE/);
  });

  it('rejects --where with invalid KEY', () => {
    const result = parseMetadataFilters({ where: ['BadKey=foo'] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Invalid --where KEY/);
  });

  it('rejects --has-key with invalid KEY', () => {
    const result = parseMetadataFilters({ hasKey: ['1bad'] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Invalid --has-key KEY/);
  });

  it('rejects --missing-key with invalid KEY', () => {
    const result = parseMetadataFilters({ missingKey: ['BadKey'] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Invalid --missing-key KEY/);
  });
});

describe('matchesMetadataFilters (DD014.§3.DC.56 AND semantics)', () => {
  const folded = {
    importance: ['5'],
    reviewer: ['alice', 'bob'],
    priority: ['high'],
  };

  it('passes claims with matching --where clauses', () => {
    expect(
      matchesMetadataFilters(folded, {
        where: [{ key: 'priority', value: 'high' }],
        hasKey: [],
        missingKey: [],
      }),
    ).toBe(true);
  });

  it('rejects when --where VALUE is missing', () => {
    expect(
      matchesMetadataFilters(folded, {
        where: [{ key: 'priority', value: 'low' }],
        hasKey: [],
        missingKey: [],
      }),
    ).toBe(false);
  });

  it('passes when value is one of multiple values for the key', () => {
    expect(
      matchesMetadataFilters(folded, {
        where: [{ key: 'reviewer', value: 'bob' }],
        hasKey: [],
        missingKey: [],
      }),
    ).toBe(true);
  });

  it('passes --has-key for keys with values', () => {
    expect(
      matchesMetadataFilters(folded, {
        where: [],
        hasKey: ['priority'],
        missingKey: [],
      }),
    ).toBe(true);
  });

  it('rejects --has-key for keys without values', () => {
    expect(
      matchesMetadataFilters(folded, {
        where: [],
        hasKey: ['nonexistent'],
        missingKey: [],
      }),
    ).toBe(false);
  });

  it('passes --missing-key for absent keys', () => {
    expect(
      matchesMetadataFilters(folded, {
        where: [],
        hasKey: [],
        missingKey: ['nonexistent'],
      }),
    ).toBe(true);
  });

  it('rejects --missing-key for keys that have values', () => {
    expect(
      matchesMetadataFilters(folded, {
        where: [],
        hasKey: [],
        missingKey: ['priority'],
      }),
    ).toBe(false);
  });

  // T-Filter-4 composability matrix
  it('AND-composes --where + --has-key + --missing-key', () => {
    expect(
      matchesMetadataFilters(folded, {
        where: [{ key: 'priority', value: 'high' }],
        hasKey: ['reviewer'],
        missingKey: ['nonexistent'],
      }),
    ).toBe(true);

    // Same set, but one clause fails
    expect(
      matchesMetadataFilters(folded, {
        where: [{ key: 'priority', value: 'high' }],
        hasKey: ['reviewer'],
        missingKey: ['priority'], // priority IS present → fail
      }),
    ).toBe(false);
  });

  it('empty filter set passes trivially', () => {
    expect(
      matchesMetadataFilters(folded, { where: [], hasKey: [], missingKey: [] }),
    ).toBe(true);
    expect(
      matchesMetadataFilters({}, { where: [], hasKey: [], missingKey: [] }),
    ).toBe(true);
  });
});

describe('applyMetadataFilters (DD014.§3.DC.56)', () => {
  const sample: MetadataStore = {
    'R001.1.AC.01': [
      {
        id: 'a1',
        claimId: 'R001.1.AC.01',
        key: 'priority',
        value: 'high',
        op: 'add',
        actor: 'tester',
        date: '2026-04-25T00:00:00.000Z',
      },
    ],
    'R001.1.AC.02': [
      {
        id: 'a2',
        claimId: 'R001.1.AC.02',
        key: 'priority',
        value: 'low',
        op: 'add',
        actor: 'tester',
        date: '2026-04-25T00:00:00.000Z',
      },
    ],
    'R001.1.AC.03': [],
  };

  const items = [
    { claimId: 'R001.1.AC.01' },
    { claimId: 'R001.1.AC.02' },
    { claimId: 'R001.1.AC.03' },
  ];

  it('fast-paths empty filters', async () => {
    const storage = makeStorage(sample);
    const result = await applyMetadataFilters(items, (i) => i.claimId, storage, {
      where: [],
      hasKey: [],
      missingKey: [],
    });
    expect(result).toEqual(items);
  });

  it('filters via the fold projection (--where)', async () => {
    const storage = makeStorage(sample);
    const result = await applyMetadataFilters(items, (i) => i.claimId, storage, {
      where: [{ key: 'priority', value: 'high' }],
      hasKey: [],
      missingKey: [],
    });
    expect(result).toEqual([{ claimId: 'R001.1.AC.01' }]);
  });

  it('filters via --has-key (claim must have at least one value)', async () => {
    const storage = makeStorage(sample);
    const result = await applyMetadataFilters(items, (i) => i.claimId, storage, {
      where: [],
      hasKey: ['priority'],
      missingKey: [],
    });
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.claimId).sort()).toEqual([
      'R001.1.AC.01',
      'R001.1.AC.02',
    ]);
  });

  it('filters via --missing-key (claim must NOT have a value)', async () => {
    const storage = makeStorage(sample);
    const result = await applyMetadataFilters(items, (i) => i.claimId, storage, {
      where: [],
      hasKey: [],
      missingKey: ['priority'],
    });
    expect(result).toEqual([{ claimId: 'R001.1.AC.03' }]);
  });

  it('AND-composes --where with --has-key and --missing-key', async () => {
    const storage = makeStorage({
      ...sample,
      'R002.1.AC.01': [
        {
          id: 'b1',
          claimId: 'R002.1.AC.01',
          key: 'priority',
          value: 'high',
          op: 'add',
          actor: 'tester',
          date: '2026-04-25T00:00:00.000Z',
        },
        {
          id: 'b2',
          claimId: 'R002.1.AC.01',
          key: 'reviewer',
          value: 'alice',
          op: 'add',
          actor: 'tester',
          date: '2026-04-25T00:00:00.000Z',
        },
      ],
    });
    const result = await applyMetadataFilters(
      [
        { claimId: 'R001.1.AC.01' },
        { claimId: 'R002.1.AC.01' },
      ],
      (i) => i.claimId,
      storage,
      {
        where: [{ key: 'priority', value: 'high' }],
        hasKey: ['reviewer'],
        missingKey: [],
      },
    );
    expect(result).toEqual([{ claimId: 'R002.1.AC.01' }]);
  });
});
