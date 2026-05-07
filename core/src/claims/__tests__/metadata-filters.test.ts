/**
 * Tests for the metadata-filters utility.
 *
 * @validates {DD014.§3.DC.55} parseMetadataFilters validates KEY/VALUE shapes
 * @validates {DD014.§3.DC.56} matchesMetadataFilters AND semantics
 * @validates {DD014.§3.DC.56} applyMetadataFilters composes via fold lookup
 * @validates {DD019.§3.DC.11} Markdown overlay merged into fold at filter time
 * @validates {DD019.§3.DC.12} Existing semantics preserved across merge
 * @validates {DD019.§3.DC.13} mergeMarkdownIntoFold purity over (entry, folded)
 * @validates {DD019.§3.DC.14} superseded decomposes into lifecycle + supersededBy
 */
import { describe, it, expect } from 'vitest';
import {
  parseMetadataFilters,
  matchesMetadataFilters,
  applyMetadataFilters,
  mergeMarkdownIntoFold,
} from '../metadata-filters';
import type { ClaimIndexEntry } from '../claim-index';
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

// Helper: build a minimal ClaimIndexEntry stub for merge tests.
function entryStub(partial: Partial<ClaimIndexEntry>): ClaimIndexEntry {
  return {
    noteId: 'R001',
    claimId: 'AC.01',
    fullyQualified: 'R001.1.AC.01',
    sectionPath: [1],
    claimPrefix: 'AC',
    claimNumber: 1,
    heading: '',
    line: 0,
    endLine: 0,
    metadata: [],
    parsedTags: [],
    derivedFrom: [],
    noteType: 'Requirement',
    noteFilePath: '/tmp/R001.md',
    ...partial,
  };
}

describe('mergeMarkdownIntoFold (DD019.§3.DC.11–.DC.14)', () => {
  it('returns the fold unchanged when entry is undefined', () => {
    const folded = { reviewer: ['alice'] };
    const merged = mergeMarkdownIntoFold(undefined, folded);
    expect(merged).toEqual({ reviewer: ['alice'] });
    // Pure: returns a fresh object, not the input.
    expect(merged).not.toBe(folded);
  });

  it('overlays importance from the entry onto an empty fold', () => {
    const merged = mergeMarkdownIntoFold(entryStub({ importance: 5 }), {});
    expect(merged).toEqual({ importance: ['5'] });
  });

  it('overlays bare lifecycle (closed) onto an empty fold', () => {
    const merged = mergeMarkdownIntoFold(
      entryStub({ lifecycle: { type: 'closed' } }),
      {},
    );
    expect(merged).toEqual({ lifecycle: ['closed'] });
  });

  it('decomposes superseded=TARGET into lifecycle + supersededBy', () => {
    const merged = mergeMarkdownIntoFold(
      entryStub({ lifecycle: { type: 'superseded', target: 'R005.§1.AC.01' } }),
      {},
    );
    expect(merged).toEqual({
      lifecycle: ['superseded'],
      supersededBy: ['R005.§1.AC.01'],
    });
  });

  it('overlays derives from derivedFrom[]', () => {
    const merged = mergeMarkdownIntoFold(
      entryStub({ derivedFrom: ['R005.§1.AC.01', 'R006.§1.AC.02'] }),
      {},
    );
    expect(merged).toEqual({
      derives: ['R005.§1.AC.01', 'R006.§1.AC.02'],
    });
  });

  it('routes bare parsedTags to the tag key', () => {
    const merged = mergeMarkdownIntoFold(
      entryStub({ parsedTags: ['security', 'auth'] }),
      {},
    );
    expect(merged).toEqual({ tag: ['security', 'auth'] });
  });

  it('splits KEY=VALUE entries from parsedTags onto their key', () => {
    const merged = mergeMarkdownIntoFold(
      entryStub({ parsedTags: ['reviewer=alice', 'priority=high'] }),
      {},
    );
    expect(merged).toEqual({
      reviewer: ['alice'],
      priority: ['high'],
    });
  });

  it('mixes bare and KEY=VALUE parsedTags correctly', () => {
    const merged = mergeMarkdownIntoFold(
      entryStub({ parsedTags: ['security', 'reviewer=alice', 'auth'] }),
      {},
    );
    expect(merged).toEqual({
      tag: ['security', 'auth'],
      reviewer: ['alice'],
    });
  });

  it('appends markdown values to existing fold values without duplication', () => {
    const folded = { reviewer: ['alice'] };
    const merged = mergeMarkdownIntoFold(
      entryStub({ parsedTags: ['reviewer=alice', 'reviewer=bob'] }),
      folded,
    );
    // alice already present from fold; bob added; alice not duplicated.
    expect(merged.reviewer).toEqual(['alice', 'bob']);
  });

  it('coexists: fold + markdown contribute different values for same key', () => {
    const folded = { reviewer: ['bob'] };
    const merged = mergeMarkdownIntoFold(
      entryStub({ parsedTags: ['reviewer=alice'] }),
      folded,
    );
    expect(merged.reviewer.sort()).toEqual(['alice', 'bob']);
  });

  it('kitchen sink: importance + lifecycle + derives + tags + KV pairs', () => {
    const merged = mergeMarkdownIntoFold(
      entryStub({
        importance: 4,
        lifecycle: { type: 'closed' },
        derivedFrom: ['R005.§1.AC.01'],
        parsedTags: ['security', 'reviewer=alice'],
      }),
      { verified: ['true'] },
    );
    expect(merged).toEqual({
      verified: ['true'],
      importance: ['4'],
      lifecycle: ['closed'],
      derives: ['R005.§1.AC.01'],
      tag: ['security'],
      reviewer: ['alice'],
    });
  });

  it('does not mutate the input fold', () => {
    const folded = { reviewer: ['alice'] };
    const snapshot = { reviewer: ['alice'] };
    mergeMarkdownIntoFold(
      entryStub({ parsedTags: ['reviewer=bob'] }),
      folded,
    );
    expect(folded).toEqual(snapshot);
  });
});

// Phase 1 safety net per DD019.§6: with the (still-active) author-event
// ingest path mirroring author tokens into the event log, the merged read
// (overlay + fold) MUST produce the same observable filter results as the
// unmerged fold-only read. This proves the merge contributes nothing new
// when the events already mirror the markdown — the prerequisite for
// safely deleting the writes in Phase 2.
//
// We do not invoke the live ingest path here; we model its effect by
// pre-populating the store with events that mirror the markdown tokens
// (which is exactly what reconcileNoteEvents would emit).
describe('Phase 1 safety-net: merged read is idempotent vs ingest-mirrored fold (DD019.§6)', () => {
  // Imitate "author has already been ingested": for each markdown token
  // on the entry, the equivalent event sits in the store under the
  // documented (key, value) decomposition.
  function eventsForEntry(entry: ClaimIndexEntry): MetadataEvent[] {
    const events: MetadataEvent[] = [];
    const stamp = (key: string, value: string) =>
      events.push({
        id: `id-${key}-${value}`,
        claimId: entry.fullyQualified,
        key,
        value,
        op: 'add',
        actor: `author:${entry.noteFilePath}`,
        date: '2026-04-25T00:00:00.000Z',
      });
    if (entry.importance !== undefined) stamp('importance', String(entry.importance));
    if (entry.lifecycle !== undefined) {
      stamp('lifecycle', entry.lifecycle.type);
      if (entry.lifecycle.type === 'superseded' && entry.lifecycle.target) {
        stamp('supersededBy', entry.lifecycle.target);
      }
    }
    for (const target of entry.derivedFrom) stamp('derives', target);
    for (const tag of entry.parsedTags) {
      const eq = tag.indexOf('=');
      if (eq > 0) stamp(tag.slice(0, eq), tag.slice(eq + 1));
      else stamp('tag', tag);
    }
    return events;
  }

  it('idempotence: --where matches identically with and without the overlay', async () => {
    const entry = entryStub({
      importance: 5,
      lifecycle: { type: 'closed' },
      derivedFrom: ['R005.§1.AC.01'],
      parsedTags: ['security', 'reviewer=alice'],
    });
    const store: MetadataStore = { [entry.fullyQualified]: eventsForEntry(entry) };
    const storage = makeStorage(store);
    const items = [{ claimId: entry.fullyQualified }];

    const filters = {
      where: [{ key: 'reviewer', value: 'alice' }],
      hasKey: [],
      missingKey: [],
    };

    // Without overlay (legacy behavior).
    const without = await applyMetadataFilters(
      items,
      (i) => i.claimId,
      storage,
      filters,
    );
    // With overlay (Phase 1 behavior).
    const withOverlay = await applyMetadataFilters(
      items,
      (i) => i.claimId,
      storage,
      filters,
      () => entry,
    );

    expect(withOverlay).toEqual(without);
    expect(withOverlay).toEqual(items);
  });

  it('idempotence across the full DC.39 normalization table', async () => {
    const entry = entryStub({
      importance: 4,
      lifecycle: { type: 'superseded', target: 'R004.§2.AC.07' },
      derivedFrom: ['R001.§1.AC.01', 'R002.§1.AC.02'],
      parsedTags: ['auth', 'compliance', 'reviewer=alice', 'priority=high'],
    });
    const store: MetadataStore = { [entry.fullyQualified]: eventsForEntry(entry) };
    const storage = makeStorage(store);
    const items = [{ claimId: entry.fullyQualified }];

    const probes: Array<{
      where: { key: string; value: string }[];
      hasKey: string[];
      missingKey: string[];
    }> = [
      { where: [{ key: 'importance', value: '4' }], hasKey: [], missingKey: [] },
      { where: [{ key: 'lifecycle', value: 'superseded' }], hasKey: [], missingKey: [] },
      { where: [{ key: 'supersededBy', value: 'R004.§2.AC.07' }], hasKey: [], missingKey: [] },
      { where: [{ key: 'derives', value: 'R001.§1.AC.01' }], hasKey: [], missingKey: [] },
      { where: [{ key: 'derives', value: 'R002.§1.AC.02' }], hasKey: [], missingKey: [] },
      { where: [{ key: 'tag', value: 'auth' }], hasKey: [], missingKey: [] },
      { where: [{ key: 'tag', value: 'compliance' }], hasKey: [], missingKey: [] },
      { where: [{ key: 'reviewer', value: 'alice' }], hasKey: [], missingKey: [] },
      { where: [{ key: 'priority', value: 'high' }], hasKey: [], missingKey: [] },
      { where: [], hasKey: ['reviewer'], missingKey: [] },
      { where: [], hasKey: [], missingKey: ['nonexistent'] },
    ];

    for (const filters of probes) {
      const without = await applyMetadataFilters(items, (i) => i.claimId, storage, filters);
      const withOverlay = await applyMetadataFilters(
        items,
        (i) => i.claimId,
        storage,
        filters,
        () => entry,
      );
      expect(withOverlay, JSON.stringify(filters)).toEqual(without);
    }
  });
});
