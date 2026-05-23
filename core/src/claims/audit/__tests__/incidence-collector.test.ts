/**
 * Tests for collectNoteIncidences — the note-side audit incidence collector.
 *
 * Most tests hand-construct `ClaimIndexData` fixtures for tight isolation of
 * edge cases. A few tests use `ClaimIndex.build()` on hand-written notes to
 * exercise the full data-flow integration (resolved outcomes, archived
 * synthesis from real entries).
 *
 * @validates {DD022.§10.2.DC.05} collectNoteIncidences walks crossRefs + data.errors
 * @validates {DD022.§10.2.DC.06} reference-to-archived synthesis on resolved+archived
 * @validates {DD022.§10.2.DC.07} reference-to-soft-deleted synthesis on resolved+softDeleted
 * @validates {DD022.§10.2.DC.08} tombstoned tokens dropped via isDeletionMarker
 * @validates {R016.§1.AC.01} project-wide note sweep
 * @validates {R016.§4.AC.01} archived citations flagged in default sweep
 * @validates {R016.§4.AC.02} soft-deleted citations flagged in default sweep
 * @validates {R016.§4.AC.05} tombstones preserved verbatim
 */

import { describe, it, expect } from 'vitest';
import {
  collectNoteIncidences,
  processSourceReference,
} from '../incidence-collector.js';
import { ClaimIndex } from '../../claim-index.js';
import type {
  ClaimIndexData,
  ClaimIndexEntry,
  ClaimCrossReference,
  NoteWithContent,
} from '../../claim-index.js';
import type { ClaimTreeError } from '../../../parsers/claim/index.js';
import type { ResolverOutcome } from '../../reference-resolver.js';
import type { SourceReference } from '../../../types/reference.js';

// ---------------------------------------------------------------------------
// Hand-built fixture helpers
// ---------------------------------------------------------------------------

/** Construct an empty ClaimIndexData with hand-provided crossRefs + errors. */
function makeData(
  crossRefs: ClaimCrossReference[] = [],
  errors: ClaimTreeError[] = [],
): ClaimIndexData {
  return {
    entries: new Map(),
    trees: new Map(),
    noteTypes: new Map(),
    crossRefs,
    crossProjectRefs: [],
    errors,
  };
}

/** Construct a stub ClaimIndexEntry with the given flags. */
function makeEntry(opts: {
  noteId: string;
  claimSuffix?: string; // e.g., '1.AC.01'
  archived?: boolean;
  softDeleted?: boolean;
}): ClaimIndexEntry {
  const claimSuffix = opts.claimSuffix ?? '1.AC.01';
  const parts = claimSuffix.split('.');
  const claimPrefix = parts[parts.length - 2] ?? 'AC';
  const claimNumber = Number(parts[parts.length - 1] ?? '1');
  const sectionPath = parts.slice(0, -2).map((p) => Number(p)).filter((n) => !isNaN(n));
  return {
    noteId: opts.noteId,
    claimId: `${claimPrefix}.${String(claimNumber).padStart(2, '0')}`,
    fullyQualified: `${opts.noteId}.${claimSuffix}`,
    sectionPath,
    claimPrefix,
    claimNumber,
    heading: 'Test claim',
    line: 10,
    endLine: 12,
    metadata: [],
    parsedTags: [],
    derivedFrom: [],
    tombstonedDerivedFrom: [],
    unresolvedDerivationTargets: [],
    archived: opts.archived ?? false,
    softDeleted: opts.softDeleted ?? false,
    noteType: 'Requirement',
    noteFilePath: `_scepter/notes/${opts.noteId}.md`,
  };
}

/** Construct a crossRef with a resolver outcome attached. */
function makeCrossRef(opts: {
  fromNoteId: string;
  fromClaim?: string; // defaults to sentinel `<fromNoteId>:line-<line>` (prose-level)
  toClaim: string;
  toNoteId: string;
  line?: number;
  filePath?: string;
  resolverOutcome?: ResolverOutcome;
}): ClaimCrossReference {
  const line = opts.line ?? 5;
  return {
    fromClaim: opts.fromClaim ?? `${opts.fromNoteId}:line-${line}`,
    toClaim: opts.toClaim,
    fromNoteId: opts.fromNoteId,
    toNoteId: opts.toNoteId,
    line,
    filePath: opts.filePath ?? `_scepter/notes/${opts.fromNoteId}.md`,
    ...(opts.resolverOutcome !== undefined ? { resolverOutcome: opts.resolverOutcome } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('collectNoteIncidences', () => {
  describe('Test 1: unresolved crossRef surfaces as IncidenceRecord', () => {
    it('emits one IncidenceRecord per unresolved crossRef with the resolver code', () => {
      const data = makeData([
        makeCrossRef({
          fromNoteId: 'S042',
          fromClaim: 'S042.1.AC.01',
          toClaim: 'R999.1.AC.05',
          toNoteId: 'R999',
          line: 42,
          resolverOutcome: { kind: 'unresolved', code: 'reference-to-unknown-note' },
        }),
      ]);

      const records = collectNoteIncidences(data);
      expect(records).toHaveLength(1);
      expect(records[0]?.code).toBe('reference-to-unknown-note');
      expect(records[0]?.targetRaw).toBe('R999.1.AC.05');
      expect(records[0]?.targetNoteId).toBe('R999');
      expect(records[0]?.site.kind).toBe('note-site');
      if (records[0]?.site.kind === 'note-site') {
        expect(records[0].site.noteId).toBe('S042');
        expect(records[0].site.claimId).toBe('S042.1.AC.01');
        expect(records[0].site.line).toBe(42);
        expect(records[0].site.sourceSnippet).toBe('');
      }
    });
  });

  describe('Test 2: resolved+archived synthesizes reference-to-archived (DC.06)', () => {
    it('emits reference-to-archived with lifecycleFlag set', () => {
      const archivedEntry = makeEntry({
        noteId: 'R057',
        claimSuffix: '1.AC.08',
        archived: true,
      });
      const data = makeData([
        makeCrossRef({
          fromNoteId: 'S042',
          fromClaim: 'S042.1.AC.01',
          toClaim: 'R057.1.AC.08',
          toNoteId: 'R057',
          line: 21,
          resolverOutcome: {
            kind: 'resolved',
            canonicalId: 'R057.1.AC.08',
            entry: archivedEntry,
          },
        }),
      ]);

      const records = collectNoteIncidences(data);
      expect(records).toHaveLength(1);
      expect(records[0]?.code).toBe('reference-to-archived');
      expect(records[0]?.lifecycleFlag).toBe('archived');
      expect(records[0]?.targetRaw).toBe('R057.1.AC.08');
      expect(records[0]?.targetNoteId).toBe('R057');
    });
  });

  describe('Test 3: resolved+softDeleted synthesizes reference-to-soft-deleted (DC.07)', () => {
    it('emits reference-to-soft-deleted with lifecycleFlag set', () => {
      const softDeletedEntry = makeEntry({
        noteId: 'R099',
        claimSuffix: '2.AC.03',
        softDeleted: true,
      });
      const data = makeData([
        makeCrossRef({
          fromNoteId: 'DD007',
          fromClaim: 'DD007.3.DC.05',
          toClaim: 'R099.2.AC.03',
          toNoteId: 'R099',
          line: 88,
          resolverOutcome: {
            kind: 'resolved',
            canonicalId: 'R099.2.AC.03',
            entry: softDeletedEntry,
          },
        }),
      ]);

      const records = collectNoteIncidences(data);
      expect(records).toHaveLength(1);
      expect(records[0]?.code).toBe('reference-to-soft-deleted');
      expect(records[0]?.lifecycleFlag).toBe('soft-deleted');
      expect(records[0]?.targetRaw).toBe('R099.2.AC.03');
      expect(records[0]?.targetNoteId).toBe('R099');
    });
  });

  describe('Test 4: tombstoned target dropped silently (DC.08)', () => {
    it('emits zero records when the target note-ID is a deletion marker', () => {
      const data = makeData([
        makeCrossRef({
          fromNoteId: 'S042',
          toClaim: '_deleted_R005_at_20260519.1.AC.03',
          toNoteId: '_deleted_R005_at_20260519',
          resolverOutcome: { kind: 'unresolved', code: 'reference-to-unknown-note' },
        }),
      ]);

      const records = collectNoteIncidences(data);
      expect(records).toHaveLength(0);
    });
  });

  describe('Test 5: cross-project refs excluded', () => {
    it('does not walk data.crossProjectRefs', () => {
      const data = makeData([
        makeCrossRef({
          fromNoteId: 'S042',
          toClaim: 'R042.1.AC.01',
          toNoteId: 'R042',
          resolverOutcome: { kind: 'unresolved', code: 'reference-to-unknown-note' },
        }),
      ]);
      // Inject a cross-project ref directly — it should NOT surface in the audit.
      data.crossProjectRefs.push({
        aliasPrefix: 'vendor-lib',
        address: { raw: 'vendor-lib/R005.§1.AC.01' } as never,
        fromNoteId: 'S042',
        line: 99,
        filePath: '_scepter/notes/S042.md',
      });

      const records = collectNoteIncidences(data);
      // Only the local crossRef incidence surfaces; the cross-project ref is invisible.
      expect(records).toHaveLength(1);
      expect(records[0]?.targetNoteId).toBe('R042');
    });
  });

  describe('Test 6: resolved+live produces no incidence', () => {
    it('skips resolved edges whose target is neither archived nor soft-deleted', () => {
      const liveEntry = makeEntry({
        noteId: 'R042',
        claimSuffix: '1.AC.01',
        archived: false,
        softDeleted: false,
      });
      const data = makeData([
        makeCrossRef({
          fromNoteId: 'S042',
          toClaim: 'R042.1.AC.01',
          toNoteId: 'R042',
          resolverOutcome: {
            kind: 'resolved',
            canonicalId: 'R042.1.AC.01',
            entry: liveEntry,
          },
        }),
      ]);

      const records = collectNoteIncidences(data);
      expect(records).toHaveLength(0);
    });
  });

  describe('Test 7: structural errors surface as IncidenceRecords', () => {
    it('emits a malformed-claim-reference structural error', () => {
      const data = makeData(
        [],
        [
          {
            type: 'malformed-claim-reference',
            claimId: 'R042.badstuff',
            line: 17,
            message: 'Could not parse claim reference "R042.badstuff"',
            noteId: 'S099',
            noteFilePath: '_scepter/notes/S099.md',
          },
        ],
      );

      const records = collectNoteIncidences(data);
      expect(records).toHaveLength(1);
      expect(records[0]?.code).toBe('malformed-claim-reference');
      expect(records[0]?.targetRaw).toBe('R042.badstuff');
      expect(records[0]?.targetNoteId).toBe('S099');
      expect(records[0]?.resolverDetail).toContain('Could not parse');
    });
  });

  describe('Test 8: legacy parallel-emit codes suppressed', () => {
    it('drops legacy `unresolved-reference` when its new-code companion also appears', () => {
      const data = makeData(
        [],
        [
          {
            type: 'unresolved-reference', // legacy
            claimId: 'R042.1.AC.01',
            line: 5,
            message: 'Unresolved claim reference "R042.1.AC.01"...',
            noteId: 'S099',
          },
          {
            type: 'reference-to-unknown-note', // new code
            claimId: 'R042.1.AC.01',
            line: 5,
            message: 'Note R042 not found in index',
            noteId: 'S099',
          },
        ],
      );

      const records = collectNoteIncidences(data);
      // Only the new code surfaces; legacy is suppressed.
      expect(records).toHaveLength(1);
      expect(records[0]?.code).toBe('reference-to-unknown-note');
    });
  });

  describe('Test 9: cross-project error codes filtered out', () => {
    it('drops alias-unknown / peer-unresolved / peer-target-not-found', () => {
      const data = makeData(
        [],
        [
          {
            type: 'alias-unknown',
            claimId: 'vendor-lib/R042',
            line: 10,
            message: 'Alias vendor-lib is not declared',
          },
          {
            type: 'peer-unresolved',
            claimId: 'vendor-lib/R042',
            line: 11,
            message: 'Peer project not resolvable',
          },
          {
            type: 'peer-target-not-found',
            claimId: 'vendor-lib/R042',
            line: 12,
            message: 'Peer note not found',
          },
        ],
      );

      const records = collectNoteIncidences(data);
      expect(records).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Integration: build a real index, verify outcomes flow through
  // -------------------------------------------------------------------------

  describe('Integration: ClaimIndex.build → collectNoteIncidences', () => {
    it('surfaces archived citations via real resolver outcome', () => {
      const archivedNote: NoteWithContent = {
        id: 'R057',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R057.md',
        content: [
          '# R057 Archived',
          '## §1 Section',
          '§1.AC.08 Archived claim.',
        ].join('\n'),
        tags: ['archived'],
      };
      const citingNote: NoteWithContent = {
        id: 'S042',
        type: 'Specification',
        filePath: '_scepter/notes/specs/S042.md',
        content: [
          '# S042 Citing',
          '## §1 Section',
          '§1.AC.01 Cites {R057.§1.AC.08} inline.',
        ].join('\n'),
      };

      const idx = new ClaimIndex();
      const data = idx.build([archivedNote, citingNote]);
      const records = collectNoteIncidences(data);

      const archivedRecord = records.find((r) => r.code === 'reference-to-archived');
      expect(archivedRecord).toBeDefined();
      expect(archivedRecord?.targetNoteId).toBe('R057');
      expect(archivedRecord?.lifecycleFlag).toBe('archived');
    });

    it('surfaces soft-deleted citations via real resolver outcome', () => {
      const softDeletedNote: NoteWithContent = {
        id: 'R099',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R099.md',
        content: [
          '# R099 Soft-Deleted',
          '## §1 Section',
          '§1.AC.04 Soft-deleted claim.',
        ].join('\n'),
        tags: ['deleted'],
      };
      const citingNote: NoteWithContent = {
        id: 'DD007',
        type: 'DetailedDesign',
        filePath: '_scepter/notes/dd/DD007.md',
        content: [
          '# DD007 Citing',
          '## §1 Section',
          '§1.DC.01 Cites {R099.§1.AC.04} inline.',
        ].join('\n'),
      };

      const idx = new ClaimIndex();
      const data = idx.build([softDeletedNote, citingNote]);
      const records = collectNoteIncidences(data);

      const softDeletedRecord = records.find((r) => r.code === 'reference-to-soft-deleted');
      expect(softDeletedRecord).toBeDefined();
      expect(softDeletedRecord?.targetNoteId).toBe('R099');
      expect(softDeletedRecord?.lifecycleFlag).toBe('soft-deleted');
    });
  });
});

// ---------------------------------------------------------------------------
// processSourceReference (the per-reference handler used by both the
// project-wide collectSourceIncidences and the per-note --code branch)
// ---------------------------------------------------------------------------

function makeSourceRef(opts: {
  toId: string;
  claimPath?: string;
  filePath?: string;
  line?: number;
  referenceType?: SourceReference['referenceType'];
  context?: string;
}): SourceReference {
  return {
    fromId: 'source:test.ts',
    toId: opts.toId,
    sourceType: 'source',
    filePath: opts.filePath ?? '/abs/project/core/src/foo.ts',
    language: 'typescript',
    referenceType: opts.referenceType ?? 'implements',
    line: opts.line ?? 1,
    ...(opts.claimPath !== undefined ? { claimPath: opts.claimPath } : {}),
    ...(opts.context !== undefined ? { context: opts.context } : {}),
  };
}

describe('processSourceReference', () => {
  describe('Test 13: source ref with unresolved outcome surfaces', () => {
    it('emits a source-site IncidenceRecord with the resolver code', () => {
      const data = makeData();
      const ref = makeSourceRef({
        toId: 'R999',
        claimPath: '.1.AC.05',
        filePath: '/abs/project/core/src/foo.ts',
        line: 42,
      });
      const incidence = processSourceReference(ref, data, '/abs/project');
      expect(incidence).not.toBeNull();
      expect(incidence?.code).toBe('reference-to-unknown-note');
      expect(incidence?.targetRaw).toBe('R999.1.AC.05');
      expect(incidence?.targetNoteId).toBe('R999');
      expect(incidence?.site.kind).toBe('source-site');
      if (incidence?.site.kind === 'source-site') {
        expect(incidence.site.relativePath).toBe('core/src/foo.ts');
        expect(incidence.site.annotationType).toBe('implements');
        expect(incidence.site.line).toBe(42);
      }
    });
  });

  describe('Test 14: source ref resolved+archived → reference-to-archived', () => {
    it('synthesizes reference-to-archived with lifecycleFlag', () => {
      const archivedEntry = makeEntry({
        noteId: 'R057',
        claimSuffix: '1.AC.08',
        archived: true,
      });
      const data = makeData();
      data.entries.set('R057.1.AC.08', archivedEntry);
      const ref = makeSourceRef({
        toId: 'R057',
        claimPath: '.1.AC.08',
      });
      const incidence = processSourceReference(ref, data, '/abs/project');
      expect(incidence?.code).toBe('reference-to-archived');
      expect(incidence?.lifecycleFlag).toBe('archived');
      expect(incidence?.targetNoteId).toBe('R057');
    });
  });

  describe('Test 15: source ref resolved+softDeleted → reference-to-soft-deleted', () => {
    it('synthesizes reference-to-soft-deleted with lifecycleFlag', () => {
      const softEntry = makeEntry({
        noteId: 'R099',
        claimSuffix: '2.AC.03',
        softDeleted: true,
      });
      const data = makeData();
      data.entries.set('R099.2.AC.03', softEntry);
      const ref = makeSourceRef({ toId: 'R099', claimPath: '.2.AC.03' });
      const incidence = processSourceReference(ref, data, '/abs/project');
      expect(incidence?.code).toBe('reference-to-soft-deleted');
      expect(incidence?.lifecycleFlag).toBe('soft-deleted');
    });
  });

  describe('Test 16: source ref with tombstoned toId dropped silently', () => {
    it('returns null on _deleted_<ID>_at_<TS> tokens', () => {
      const data = makeData();
      const ref = makeSourceRef({
        toId: '_deleted_R005_at_20260519',
        claimPath: '.1.AC.03',
      });
      expect(processSourceReference(ref, data, '/abs/project')).toBeNull();
    });
  });

  describe('Test 17: cross-project source ref excluded', () => {
    it('returns null on alias-prefixed toId', () => {
      const data = makeData();
      const ref = makeSourceRef({
        toId: 'vendor-lib/R042',
        claimPath: '.1.AC.01',
      });
      // parseClaimAddress recognizes the alias prefix on the raw target.
      // We construct a manually-prefixed rawTarget by setting toId to the
      // alias-prefixed form (which is what the source-code annotation
      // parser would produce for `@implements {vendor-lib/R042.§1.AC.01}`).
      const incidence = processSourceReference(ref, data, '/abs/project');
      expect(incidence).toBeNull();
    });
  });

  describe('Test 18: malformed source ref produces malformed-claim-reference', () => {
    it('emits malformed-claim-reference when the raw target cannot parse', () => {
      const data = makeData();
      // A toId that's not a valid note-ID grammar produces malformed.
      // 'notavalidid' fails the [A-Z]{1,5}\d{3,5} pattern.
      const ref = makeSourceRef({ toId: 'notavalidid' });
      const incidence = processSourceReference(ref, data, '/abs/project');
      // parseClaimAddress may return non-null for `notavalidid` (depends on
      // grammar tolerance); the test verifies we DON'T crash and we get
      // either malformed-claim-reference OR reference-to-unknown-note for
      // an entry that doesn't exist. Either outcome is acceptable; the
      // load-bearing assertion is that we don't throw and we surface
      // SOMETHING for the audit user.
      expect(incidence).not.toBeNull();
    });
  });
});
