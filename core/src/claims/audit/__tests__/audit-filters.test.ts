/**
 * Tests for audit filter predicates.
 *
 * @validates {DD022.§10.3.DC.11} applyTargetFilter
 * @validates {DD022.§10.3.DC.12} targets MAY be absent
 * @validates {DD022.§10.3.DC.13} note-level vs claim-level matching
 * @validates {DD022.§10.3.DC.14} canonical pipeline order
 * @validates {DD022.§10.3.DC.15} applyRefsOnlyFilter
 * @validates {DD022.§10.3.DC.16} applyCodesFilter validates input
 * @validates {DD022.§10.3.DC.17} applyArchivedOptOut
 * @validates {DD022.§10.3.DC.18} applySoftDeletedOptOut
 * @validates {R016.§2.AC.01–04} target filter ACs
 * @validates {R016.§3.AC.01–03} refs-only and codes ACs
 * @validates {R016.§4.AC.03–04} lifecycle opt-out ACs
 */

import { describe, it, expect } from 'vitest';
import {
  applyRefsOnlyFilter,
  applyCodesFilter,
  applyTargetFilter,
  applyArchivedOptOut,
  applySoftDeletedOptOut,
} from '../audit-filters.js';
import type { IncidenceRecord, IncidenceCode } from '../incidence-collector.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function mkRecord(opts: {
  code: IncidenceCode;
  targetRaw: string;
  targetNoteId?: string;
  lifecycleFlag?: 'archived' | 'soft-deleted';
}): IncidenceRecord {
  return {
    code: opts.code,
    targetRaw: opts.targetRaw,
    ...(opts.targetNoteId !== undefined ? { targetNoteId: opts.targetNoteId } : {}),
    site: {
      kind: 'note-site',
      noteId: 'S099',
      line: 1,
      sourceSnippet: '',
      filePath: '_scepter/notes/S099.md',
    },
    ...(opts.lifecycleFlag !== undefined ? { lifecycleFlag: opts.lifecycleFlag } : {}),
  };
}

// ---------------------------------------------------------------------------
// applyTargetFilter
// ---------------------------------------------------------------------------

describe('applyTargetFilter', () => {
  describe('Test 1: note-level token matches both note-level and claim-level records', () => {
    it('--target R042 matches R042 and R042.§1.AC.03 records', () => {
      const records = [
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042', targetNoteId: 'R042' }),
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042.1.AC.03', targetNoteId: 'R042' }),
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R057', targetNoteId: 'R057' }),
      ];
      const filtered = applyTargetFilter(records, ['R042']);
      expect(filtered).toHaveLength(2);
      expect(filtered.every((r) => r.targetNoteId === 'R042')).toBe(true);
    });
  });

  describe('Test 2: claim-level token matches only exact claim FQID', () => {
    it('--target R042.§1.AC.03 matches only R042.1.AC.03, not bare R042', () => {
      const records = [
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042', targetNoteId: 'R042' }),
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042.1.AC.03', targetNoteId: 'R042' }),
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042.1.AC.04', targetNoteId: 'R042' }),
      ];
      const filtered = applyTargetFilter(records, ['R042.§1.AC.03']);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.targetRaw).toBe('R042.1.AC.03');
    });
  });

  describe('Test 3: accepts non-existing IDs (DC.12)', () => {
    it('--target R999 does not throw and returns matching records (zero or more)', () => {
      const records = [
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R999.1.AC.01', targetNoteId: 'R999' }),
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042', targetNoteId: 'R042' }),
      ];
      // R999 doesn't exist as an entry, but it IS cited (the canonical cleanup workflow).
      const filtered = applyTargetFilter(records, ['R999']);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.targetNoteId).toBe('R999');
    });

    it('returns empty for a target nothing cites', () => {
      const records = [
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042', targetNoteId: 'R042' }),
      ];
      const filtered = applyTargetFilter(records, ['R888']);
      expect(filtered).toHaveLength(0);
    });
  });

  describe('Test 4: normalizes § in target tokens', () => {
    it('--target R042.§1.AC.03 and --target R042.1.AC.03 produce the same filter result', () => {
      const records = [
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042.1.AC.03', targetNoteId: 'R042' }),
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042.1.AC.04', targetNoteId: 'R042' }),
      ];
      const withSection = applyTargetFilter(records, ['R042.§1.AC.03']);
      const withoutSection = applyTargetFilter(records, ['R042.1.AC.03']);
      expect(withSection).toEqual(withoutSection);
      expect(withSection).toHaveLength(1);
    });
  });

  describe('Test 4b: no-op when targets is undefined or empty', () => {
    it('returns records unchanged when targets is undefined', () => {
      const records = [
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042', targetNoteId: 'R042' }),
      ];
      expect(applyTargetFilter(records, undefined)).toEqual(records);
      expect(applyTargetFilter(records, [])).toEqual(records);
    });
  });
});

// ---------------------------------------------------------------------------
// applyRefsOnlyFilter
// ---------------------------------------------------------------------------

describe('applyRefsOnlyFilter', () => {
  describe('Test 5: keeps reference-family codes, drops structural codes', () => {
    it('with refsOnly=true, only reference-family records survive', () => {
      const records = [
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042', targetNoteId: 'R042' }),
        mkRecord({ code: 'duplicate', targetRaw: 'R042.1.AC.01', targetNoteId: 'R042' }),
        mkRecord({ code: 'reference-to-archived', targetRaw: 'R057', targetNoteId: 'R057' }),
      ];
      const filtered = applyRefsOnlyFilter(records, true);
      expect(filtered).toHaveLength(2);
      expect(filtered.every((r) =>
        r.code === 'reference-to-unknown-note' || r.code === 'reference-to-archived'
      )).toBe(true);
    });

    it('with refsOnly=false, all records pass through', () => {
      const records = [
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042', targetNoteId: 'R042' }),
        mkRecord({ code: 'duplicate', targetRaw: 'R042.1.AC.01', targetNoteId: 'R042' }),
      ];
      const filtered = applyRefsOnlyFilter(records, false);
      expect(filtered).toEqual(records);
    });
  });
});

// ---------------------------------------------------------------------------
// applyCodesFilter
// ---------------------------------------------------------------------------

describe('applyCodesFilter', () => {
  describe('Test 6: keeps only records whose code is in the supplied list', () => {
    it('--codes reference-to-unknown-note keeps only that code', () => {
      const records = [
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042', targetNoteId: 'R042' }),
        mkRecord({ code: 'reference-to-archived', targetRaw: 'R057', targetNoteId: 'R057' }),
        mkRecord({ code: 'duplicate', targetRaw: 'R042.1.AC.01', targetNoteId: 'R042' }),
      ];
      const filtered = applyCodesFilter(records, ['reference-to-unknown-note']);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.code).toBe('reference-to-unknown-note');
    });
  });

  describe('Test 7: throws on unknown code, with recognized codes in error message', () => {
    it('applyCodesFilter([], ["bogus"]) throws an error listing recognized codes', () => {
      expect(() => applyCodesFilter([], ['bogus'])).toThrow(/Unknown error code/);
      expect(() => applyCodesFilter([], ['bogus'])).toThrow(/Recognized codes:/);
      expect(() => applyCodesFilter([], ['bogus'])).toThrow(/reference-to-unknown-note/);
    });

    it('does NOT throw on legacy parallel-emit codes (they are in CLAIM_ERROR_CODES)', () => {
      // The collector suppresses these, but the filter accepts them as input
      // per the strict DC.16 reading (Section 4 Finding #2). Empty result, no throw.
      expect(() => applyCodesFilter([], ['unresolved-reference'])).not.toThrow();
    });
  });

  describe('Test 7b: no-op when codes is undefined or empty', () => {
    it('returns records unchanged when codes is undefined', () => {
      const records = [mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042', targetNoteId: 'R042' })];
      expect(applyCodesFilter(records, undefined)).toEqual(records);
      expect(applyCodesFilter(records, [])).toEqual(records);
    });
  });
});

// ---------------------------------------------------------------------------
// applyArchivedOptOut / applySoftDeletedOptOut
// ---------------------------------------------------------------------------

describe('applyArchivedOptOut', () => {
  describe('Test 8: drops reference-to-archived, keeps reference-to-unknown-note', () => {
    it('with includeArchivedAsValid=true, archived records dropped', () => {
      const records = [
        mkRecord({ code: 'reference-to-archived', targetRaw: 'R057', targetNoteId: 'R057', lifecycleFlag: 'archived' }),
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042', targetNoteId: 'R042' }),
      ];
      const filtered = applyArchivedOptOut(records, true);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.code).toBe('reference-to-unknown-note');
    });

    it('with includeArchivedAsValid=false (default), all records pass through', () => {
      const records = [
        mkRecord({ code: 'reference-to-archived', targetRaw: 'R057', targetNoteId: 'R057', lifecycleFlag: 'archived' }),
      ];
      expect(applyArchivedOptOut(records, false)).toEqual(records);
    });
  });
});

describe('applySoftDeletedOptOut', () => {
  describe('Test 9: drops reference-to-soft-deleted, keeps other codes', () => {
    it('with includeSoftDeletedAsValid=true, soft-deleted records dropped', () => {
      const records = [
        mkRecord({ code: 'reference-to-soft-deleted', targetRaw: 'R099', targetNoteId: 'R099', lifecycleFlag: 'soft-deleted' }),
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042', targetNoteId: 'R042' }),
      ];
      const filtered = applySoftDeletedOptOut(records, true);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.code).toBe('reference-to-unknown-note');
    });

    it('with includeSoftDeletedAsValid=false (default), all records pass through', () => {
      const records = [
        mkRecord({ code: 'reference-to-soft-deleted', targetRaw: 'R099', targetNoteId: 'R099', lifecycleFlag: 'soft-deleted' }),
      ];
      expect(applySoftDeletedOptOut(records, false)).toEqual(records);
    });
  });
});

// ---------------------------------------------------------------------------
// Conjunction order (DC.14)
// ---------------------------------------------------------------------------

describe('Pipeline conjunction', () => {
  describe('Test 10: --refs-only --codes non-monotonic produces empty (DC.03 example)', () => {
    it('refs-only suppresses non-monotonic; the codes filter then has nothing to keep', () => {
      const records = [
        mkRecord({ code: 'non-monotonic', targetRaw: 'R042.1.AC.01', targetNoteId: 'R042' }),
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R057', targetNoteId: 'R057' }),
      ];

      // Pipeline order per DC.14: refs-only → codes → target → archived → soft-deleted.
      let out = records;
      out = applyRefsOnlyFilter(out, true);
      // After refs-only: only reference-to-unknown-note remains.
      expect(out.map((r) => r.code)).toEqual(['reference-to-unknown-note']);
      out = applyCodesFilter(out, ['non-monotonic']);
      // After codes filter to non-monotonic: empty.
      expect(out).toHaveLength(0);
    });
  });

  describe('Test 11: pipeline is identity when all flags inactive', () => {
    it('passes records through unchanged', () => {
      const records = [
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042', targetNoteId: 'R042' }),
        mkRecord({ code: 'reference-to-archived', targetRaw: 'R057', targetNoteId: 'R057', lifecycleFlag: 'archived' }),
        mkRecord({ code: 'duplicate', targetRaw: 'R042.1.AC.01', targetNoteId: 'R042' }),
      ];

      let out = records;
      out = applyRefsOnlyFilter(out, false);
      out = applyCodesFilter(out, undefined);
      out = applyTargetFilter(out, undefined);
      out = applyArchivedOptOut(out, false);
      out = applySoftDeletedOptOut(out, false);

      expect(out).toEqual(records);
    });
  });

  describe('Test 12: archived + soft-deleted opt-outs compose', () => {
    it('both flags set: both lifecycle codes dropped, others retained', () => {
      const records = [
        mkRecord({ code: 'reference-to-archived', targetRaw: 'R057', targetNoteId: 'R057', lifecycleFlag: 'archived' }),
        mkRecord({ code: 'reference-to-soft-deleted', targetRaw: 'R099', targetNoteId: 'R099', lifecycleFlag: 'soft-deleted' }),
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042', targetNoteId: 'R042' }),
      ];

      let out = records;
      out = applyArchivedOptOut(out, true);
      out = applySoftDeletedOptOut(out, true);

      expect(out).toHaveLength(1);
      expect(out[0]?.code).toBe('reference-to-unknown-note');
    });
  });
});
