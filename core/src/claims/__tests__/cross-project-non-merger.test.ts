/**
 * Tests verifying that cross-project (alias-prefixed) references do NOT
 * enter the local trace matrix or the gap analysis. The mechanism is the
 * Phase 6 separation of `crossProjectRefs` from `crossRefs`; this file
 * locks the behavior in with focused tests so a future change can't
 * silently re-merge them.
 *
 * @validates {R011.§3.AC.03} cross-project not merged into trace matrix
 * @validates {R011.§3.AC.04} cross-project not in local gap analysis
 */
import { describe, it, expect } from 'vitest';
import { ClaimIndex } from '../claim-index';
import type { NoteWithContent } from '../claim-index';
import { buildTraceabilityMatrix, findGaps } from '../traceability';

describe('Cross-project trace and gap non-merger (R011.§3.AC.03/.AC.04)', () => {
  /** Build an index from a local R005 (defining ACs) plus a local DD003 that
   * cites both a local AND a cross-project claim. */
  function build(): ReturnType<ClaimIndex['build']> {
    const r5: NoteWithContent = {
      id: 'R005',
      type: 'Requirement',
      filePath: 'R005.md',
      content: [
        '# R005',
        '',
        '## §1 Section',
        '',
        '§1.AC.01 First local AC.',
        '§1.AC.02 Second local AC.',
      ].join('\n'),
    };
    const dd3: NoteWithContent = {
      id: 'DD003',
      type: 'DetailedDesign',
      filePath: 'DD003.md',
      content: [
        '# DD003',
        '',
        '## §1 Section',
        '',
        'DC.01:derives=R005.§1.AC.01 Local-derived. References {R005.§1.AC.02} and {peer/R042.§1.AC.01}.',
      ].join('\n'),
    };
    const idx = new ClaimIndex();
    return idx.build([r5, dd3]);
  }

  describe('trace matrix', () => {
    it('does not list cross-project citations as projection columns for the local note', () => {
      const data = build();
      const matrix = buildTraceabilityMatrix('R005', data);
      // No projection type should be the alias name or include peer-prefixed entries
      expect(matrix.projectionTypes).not.toContain('peer');
      expect(matrix.projectionTypes.some((t) => t.includes('peer/'))).toBe(false);
      // Projection columns should be derived only from local cross-references
      // (the local DD003 references R005.§1.AC.02 → DetailedDesign appears).
      expect(matrix.projectionTypes).toContain('DetailedDesign');
    });

    it('crossProjectRefs is populated from the alias-prefixed citation, but crossRefs is not', () => {
      const data = build();
      // Cross-project: exactly one entry, fromNoteId = DD003, alias = peer
      expect(data.crossProjectRefs).toHaveLength(1);
      expect(data.crossProjectRefs[0].aliasPrefix).toBe('peer');
      expect(data.crossProjectRefs[0].fromNoteId).toBe('DD003');
      // Local crossRefs: no entry whose toClaim contains the alias prefix
      expect(data.crossRefs.some((c) => c.toClaim.includes('peer'))).toBe(false);
      // Local crossRefs: at least one entry from DD003 → R005.1.AC.02 (the local citation)
      expect(
        data.crossRefs.some((c) => c.fromNoteId === 'DD003' && c.toClaim === 'R005.1.AC.02'),
      ).toBe(true);
    });
  });

  describe('findGaps', () => {
    it('does not include cross-project references when computing presence-in-projection', () => {
      const data = build();
      const reports = findGaps(data, ['Requirement', 'DetailedDesign', 'Source']);
      // R005.§1.AC.01 has DD003 covering it via derives=, so it has DetailedDesign coverage.
      // R005.§1.AC.02 has DD003 covering it via {R005.§1.AC.02} braced ref, so it also has DetailedDesign.
      // Neither claim has Source coverage → both should report Source as missing.
      const ac1 = reports.find((r) => r.claimId === 'R005.1.AC.01');
      const ac2 = reports.find((r) => r.claimId === 'R005.1.AC.02');
      expect(ac1).toBeDefined();
      expect(ac2).toBeDefined();
      expect(ac1!.missingFrom).toContain('Source');
      expect(ac2!.missingFrom).toContain('Source');
      // No report should have any peer-shaped projection in presentIn.
      for (const r of reports) {
        expect(r.presentIn.some((p) => p.includes('peer'))).toBe(false);
      }
    });

    it('alias-prefixed citation does NOT count as DetailedDesign coverage of the peer claim', () => {
      // The peer claim peer/R042.§1.AC.01 is not in the local index. The
      // local DD003 cites it. findGaps must not invent any local report
      // for the peer claim — peer claims don't exist in the local index.
      const data = build();
      const reports = findGaps(data, ['Requirement', 'DetailedDesign', 'Source']);
      expect(reports.some((r) => r.claimId.includes('R042') || r.claimId.includes('peer'))).toBe(false);
    });
  });
});
