/**
 * Tests for the index loading entry point per {DD021.§10.DC.16}.
 *
 * DC.16 binds `ensureIndex()` (the shared loader for every claim CLI
 * command) to pass `{ includeArchived: true }` to `noteManager.getNotes()`
 * so that archived-tagged notes are present in the `NoteWithContent[]`
 * passed to `ClaimIndex.build()`. Without the flag, the default
 * note-manager filter at `note-manager.ts:1315-1317` excludes archived
 * notes from the result, and the resolver's `reference-to-archived`
 * code degenerates to `reference-to-unknown-note` (per
 * {DD021.§10.DC.05/.06}).
 *
 * DC.17 is the downstream half of the plumbing chain: the loader passes
 * `note.tags` into each `NoteWithContent.tags`, which `ClaimIndex.build()`
 * reads to populate `entry.archived`. The loader-side half is tested
 * here; the build-side half is tested in file #4
 * (`archive-resolution.test.ts`).
 *
 * Verification strategy:
 *
 *   1. **Structural-source assertions** (following the precedent from
 *      `search-command.test.ts:143-151`): read `ensure-index.ts` source
 *      and assert it calls `noteManager.getNotes({ includeArchived: true })`
 *      and forwards `note.tags` into `NoteWithContent.tags`.
 *   2. **Counterfactual**: read `note-manager.ts:1315-1317` and confirm
 *      the default filter still excludes archived (so the flag's
 *      necessity is verified at the source-of-truth site).
 *   3. **End-to-end via a duck-typed mock `ProjectManager`**: build a
 *      minimal mock exposing `noteManager.getNotes`,
 *      `noteManager.getAggregatedContents`, and `claimIndex`, then
 *      invoke `ensureIndex()` and verify the mock's `getNotes` was
 *      called with `{ includeArchived: true }` AND archived entries
 *      appear in the resulting index with `entry.archived === true`.
 *
 * @validates {DD021.§10.DC.16} ensureIndex passes includeArchived: true
 * @validates {DD021.§10.DC.17} NoteWithContent.tags plumbing — note.tags forwarded
 * @validates {R015.§1.AC.04a} archived notes stay in-index for resolution
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ensureIndex,
  _clearEnsureIndexCacheForTest,
} from '../ensure-index';
import { ClaimIndex } from '../../../../claims/claim-index';

// ---------------------------------------------------------------------------
// Source-file path constants
// ---------------------------------------------------------------------------

const ENSURE_INDEX_SRC = readFileSync(
  join(__dirname, '..', 'ensure-index.ts'),
  'utf-8',
);

const NOTE_MANAGER_SRC = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'notes', 'note-manager.ts'),
  'utf-8',
);

// ---------------------------------------------------------------------------
// Structural-source assertions for DC.16 — loader passes includeArchived
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.16: ensureIndex passes includeArchived: true to noteManager.getNotes()', () => {
  it('ensure-index.ts source contains the includeArchived: true call', () => {
    // The exact call signature documented at DD021.§10.DC.16 — the
    // loader MUST invoke getNotes with this option bag.
    expect(ENSURE_INDEX_SRC).toMatch(
      /noteManager\.getNotes\(\s*\{\s*includeArchived:\s*true\s*\}\s*\)/,
    );
  });

  it('ensure-index.ts has @implements {DD021.§10.DC.16} annotation at the loader call site', () => {
    // The annotation is the load-bearing trace marker between DC.16 and
    // the call site. Removing it orphans the AC trace.
    expect(ENSURE_INDEX_SRC).toMatch(
      /@implements\s+\{DD021\.§10\.DC\.16\}/,
    );
  });

  it('ensure-index.ts cites the {R015.§1.AC.04a} invariant in the loader rationale', () => {
    // The comment block at the call site explains WHY: archived notes
    // MUST stay in-index for resolution. The R015.§1.AC.04a citation
    // anchors that rationale to the upstream requirement.
    expect(ENSURE_INDEX_SRC).toMatch(/R015\.§1\.AC\.04a/);
  });
});

// ---------------------------------------------------------------------------
// Structural-source assertions for DC.17 — note.tags forwarded into
// NoteWithContent.tags so ClaimIndex.build() can populate entry.archived
// ---------------------------------------------------------------------------

describe('DD021.§10.DC.17: ensure-index.ts forwards note.tags into NoteWithContent.tags', () => {
  it('ensure-index.ts source assigns note.tags to the NoteWithContent.tags field', () => {
    // The plumbing chain: noteManager.getNotes returns Note[] (each
    // with a .tags string[]), ensureIndex maps each Note to a
    // NoteWithContent which MUST carry .tags forward. ClaimIndex.build
    // reads this field at entry-construction time per DC.17.
    expect(ENSURE_INDEX_SRC).toMatch(/tags:\s*note\.tags/);
  });

  it('ensure-index.ts has @implements {DD021.§10.DC.17} annotation at the tags plumbing site', () => {
    expect(ENSURE_INDEX_SRC).toMatch(
      /@implements\s+\{DD021\.§10\.DC\.17\}/,
    );
  });
});

// ---------------------------------------------------------------------------
// Counterfactual — confirm the default note-manager filter still excludes
// archived. This is what makes DC.16's flag load-bearing: without it,
// archived notes don't reach the index.
// ---------------------------------------------------------------------------

describe('Counterfactual: note-manager.ts default excludes archived notes', () => {
  it('note-manager.ts:getNotes filters out archived when includeArchived is falsy', () => {
    // The default branch at note-manager.ts:1315-1317 — verifies the
    // source-of-truth condition that DC.16's flag overrides.
    expect(NOTE_MANAGER_SRC).toMatch(
      /if\s*\(\s*!query\.includeArchived\s*&&\s*!query\.onlyArchived\s*\)\s*\{[^}]*archived/,
    );
  });
});

// ---------------------------------------------------------------------------
// End-to-end via duck-typed mock ProjectManager
// ---------------------------------------------------------------------------

type MockNote = {
  id: string;
  type: string;
  filePath: string;
  content: string;
  tags: string[];
};

function makeMockProjectManager(notes: MockNote[]): {
  pm: any;
  getNotesCalls: Array<{ includeArchived?: boolean; [k: string]: any }>;
} {
  const getNotesCalls: Array<{ includeArchived?: boolean; [k: string]: any }> = [];
  const claimIndex = new ClaimIndex();
  const pm = {
    noteManager: {
      async getNotes(query: any) {
        getNotesCalls.push(query);
        // Honor the includeArchived flag the same way note-manager.ts
        // does (the default filter at L1315-1317) so the mock's
        // behavior matches production.
        let filtered = notes;
        if (!query?.includeArchived && !query?.onlyArchived) {
          filtered = notes.filter(n => !n.tags.includes('archived'));
        }
        return { notes: filtered, totalCount: filtered.length, hasMore: false };
      },
      async getAggregatedContents(noteId: string) {
        const n = notes.find(x => x.id === noteId);
        return n?.content ?? '';
      },
    },
    claimIndex,
    sourceScanner: undefined,
  };
  return { pm, getNotesCalls };
}

describe('ensureIndex end-to-end: includeArchived flag propagates and archived notes appear in index', () => {
  beforeEach(() => {
    // The module-level cache persists across tests in the same process.
    // Clear it so each test sees a fresh build.
    _clearEnsureIndexCacheForTest();
  });

  it('ensureIndex calls noteManager.getNotes with includeArchived: true', async () => {
    const { pm, getNotesCalls } = makeMockProjectManager([
      {
        id: 'R001',
        type: 'Requirement',
        filePath: 'R001.md',
        content: '# R001\n## §1\n§1.AC.01 Active claim.',
        tags: [],
      },
    ]);

    await ensureIndex(pm);
    expect(getNotesCalls.length).toBeGreaterThanOrEqual(1);
    expect(getNotesCalls[0]).toEqual({ includeArchived: true });
  });

  it('archived notes appear in the resulting index after ensureIndex', async () => {
    const { pm } = makeMockProjectManager([
      {
        id: 'R001',
        type: 'Requirement',
        filePath: 'R001.md',
        content: '# R001\n## §1\n§1.AC.01 Active claim.',
        tags: [],
      },
      {
        id: 'R057',
        type: 'Requirement',
        filePath: 'R057.md',
        content: '# R057\n## §1\n§1.AC.08 Archived claim.',
        tags: ['archived'],
      },
    ]);

    const data = await ensureIndex(pm);
    // The archived entry MUST be in the index — DC.16's load-bearing
    // outcome. R015.§1.AC.04a's "archived notes stay in-index for
    // resolution" invariant fails without this.
    expect(data.entries.get('R057.1.AC.08')).toBeDefined();
    // The active entry should also be present (control case).
    expect(data.entries.get('R001.1.AC.01')).toBeDefined();
  });

  it('archived entries have entry.archived === true via the tags plumbing chain', async () => {
    const { pm } = makeMockProjectManager([
      {
        id: 'R057',
        type: 'Requirement',
        filePath: 'R057.md',
        content: '# R057\n## §1\n§1.AC.08 Archived claim.',
        tags: ['archived'],
      },
      {
        id: 'R001',
        type: 'Requirement',
        filePath: 'R001.md',
        content: '# R001\n## §1\n§1.AC.01 Active claim.',
        tags: [],
      },
    ]);

    const data = await ensureIndex(pm);
    // Verifies the full chain: note.tags (input) → NoteWithContent.tags
    // (loader-side plumbing per DC.17) → entry.archived (build-side
    // population per DC.17 second half). End-to-end DC.16 + DC.17.
    expect(data.entries.get('R057.1.AC.08')?.archived).toBe(true);
    expect(data.entries.get('R001.1.AC.01')?.archived).toBe(false);
  });

  it('counterfactual via mock: without includeArchived, the mock filter excludes archived (and the index would be missing them)', async () => {
    // Bypass ensureIndex and invoke the mock noteManager directly
    // without the flag. The mock replicates the production filter at
    // note-manager.ts:1315-1317, so the result mirrors what would
    // happen if ensureIndex stopped passing the flag.
    const { pm } = makeMockProjectManager([
      {
        id: 'R057',
        type: 'Requirement',
        filePath: 'R057.md',
        content: '# R057\n## §1\n§1.AC.08 Archived.',
        tags: ['archived'],
      },
      {
        id: 'R001',
        type: 'Requirement',
        filePath: 'R001.md',
        content: '# R001\n## §1\n§1.AC.01 Active.',
        tags: [],
      },
    ]);

    // Call WITHOUT the flag — simulates a regression where ensureIndex
    // drops the option bag.
    const result = await pm.noteManager.getNotes({});
    const ids = result.notes.map((n: MockNote) => n.id);
    expect(ids).not.toContain('R057');
    expect(ids).toContain('R001');
    // Confirms: the flag IS load-bearing — without it, R057 (archived)
    // would never reach ClaimIndex.build, and entry.archived plumbing
    // would have nothing to populate from.
  });

  it('multiple ensureIndex calls use the cache; reindex: true bypasses cache and re-invokes getNotes', async () => {
    const { pm, getNotesCalls } = makeMockProjectManager([
      {
        id: 'R001',
        type: 'Requirement',
        filePath: 'R001.md',
        content: '# R001\n## §1\n§1.AC.01 Active.',
        tags: [],
      },
    ]);

    await ensureIndex(pm);
    expect(getNotesCalls.length).toBe(1);
    // Second call without reindex should hit the cache — no second
    // getNotes invocation.
    await ensureIndex(pm);
    expect(getNotesCalls.length).toBe(1);
    // Forcing reindex bypasses cache; flag MUST still be passed.
    await ensureIndex(pm, { reindex: true });
    expect(getNotesCalls.length).toBe(2);
    expect(getNotesCalls[1]).toEqual({ includeArchived: true });
  });
});
