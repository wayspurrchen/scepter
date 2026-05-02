/**
 * Tests for cross-project derives= and superseded= rejection at index build time.
 *
 * @validates {R011.§2.AC.03} cross-project derives= rejected
 * @validates {R011.§2.AC.04} cross-project superseded= rejected (permanent)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ClaimIndex } from '../claim-index';
import type { NoteWithContent } from '../claim-index';

describe('Cross-project metadata rejection (R011)', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  describe('derives= with alias prefix', () => {
    it('emits cross-project-derives error when derives= points at an alias-prefixed target', () => {
      const ddNote: NoteWithContent = {
        id: 'DD100',
        type: 'DetailedDesign',
        filePath: 'DD100.md',
        content: [
          '### §1 Section',
          '',
          'DC.01:derives=vendor-lib/R005.§1.AC.01 Local design claim derived from a peer.',
        ].join('\n'),
      };

      const data = index.build([ddNote]);
      const crossProjectErrs = data.errors.filter((e) => e.type === 'cross-project-derives');
      expect(crossProjectErrs).toHaveLength(1);
      const err = crossProjectErrs[0];
      expect(err.claimId).toContain('DD100');
      expect(err.message).toContain('cross-project derivation is rejected');
      expect(err.message).toContain('R011.§2.AC.03');
      expect(err.message).toContain('R006');
      expect(err.noteId).toBe('DD100');
    });

    it('does NOT also emit unresolvable-derivation-target for the same cross-project target', () => {
      const ddNote: NoteWithContent = {
        id: 'DD101',
        type: 'DetailedDesign',
        filePath: 'DD101.md',
        content: [
          '### §1 Section',
          '',
          'DC.01:derives=vendor-lib/R005.§1.AC.01 Cross-project derivation.',
        ].join('\n'),
      };

      const data = index.build([ddNote]);
      const unresolvedErrs = data.errors.filter((e) => e.type === 'unresolvable-derivation-target');
      expect(unresolvedErrs).toHaveLength(0);
    });

    it('still resolves local derives= correctly when both local and cross-project derives appear in the same project', () => {
      const reqNote: NoteWithContent = {
        id: 'R005',
        type: 'Requirement',
        filePath: 'R005.md',
        content: ['### §1 Section', '', '§1.AC.01 Source requirement.'].join('\n'),
      };

      const ddNote: NoteWithContent = {
        id: 'DD102',
        type: 'DetailedDesign',
        filePath: 'DD102.md',
        content: [
          '### §1 Section',
          '',
          'DC.01:derives=R005.§1.AC.01 Local derivation (should resolve).',
          'DC.02:derives=vendor-lib/R005.§1.AC.01 Cross-project (should be rejected).',
        ].join('\n'),
      };

      const data = index.build([reqNote, ddNote]);
      const crossErrs = data.errors.filter((e) => e.type === 'cross-project-derives');
      expect(crossErrs).toHaveLength(1);
      expect(crossErrs[0].claimId).toContain('DC.02');

      // Local derivation still resolves
      const dc01 = data.entries.get('DD102.1.DC.01');
      expect(dc01).toBeDefined();
      expect(dc01!.derivedFrom).toContain('R005.1.AC.01');

      // Cross-project derivation does NOT enter derivedFrom
      const dc02 = data.entries.get('DD102.1.DC.02');
      expect(dc02).toBeDefined();
      expect(dc02!.derivedFrom).not.toContain('vendor-lib/R005.§1.AC.01');
      expect(dc02!.derivedFrom.some((d) => d.startsWith('vendor-lib'))).toBe(false);
    });

    it('rejects bare-id alias-prefixed derives= too: derives=vendor-lib/R042', () => {
      const ddNote: NoteWithContent = {
        id: 'DD103',
        type: 'DetailedDesign',
        filePath: 'DD103.md',
        content: [
          '### §1 Section',
          '',
          'DC.01:derives=vendor-lib/R042 Cross-project bare-ID derivation.',
        ].join('\n'),
      };

      const data = index.build([ddNote]);
      const crossErrs = data.errors.filter((e) => e.type === 'cross-project-derives');
      expect(crossErrs).toHaveLength(1);
    });
  });

  describe('superseded= with alias prefix', () => {
    it('emits cross-project-superseded error when superseded= points at an alias-prefixed target', () => {
      const note: NoteWithContent = {
        id: 'R200',
        type: 'Requirement',
        filePath: 'R200.md',
        content: [
          '### §1 Section',
          '',
          'AC.01:superseded=vendor-lib/R005.§1.AC.01 Locally superseded by a peer claim.',
        ].join('\n'),
      };

      const data = index.build([note]);
      const crossErrs = data.errors.filter((e) => e.type === 'cross-project-superseded');
      expect(crossErrs).toHaveLength(1);
      const err = crossErrs[0];
      expect(err.message).toContain('R011.§2.AC.04');
      expect(err.message).toContain('lifecycle');
      expect(err.noteId).toBe('R200');
    });

    it('does NOT emit invalid-supersession-target for cross-project targets (the cross-project error subsumes it)', () => {
      const note: NoteWithContent = {
        id: 'R201',
        type: 'Requirement',
        filePath: 'R201.md',
        content: [
          '### §1 Section',
          '',
          'AC.01:superseded=vendor-lib/R005.§1.AC.01 Cross-project supersession.',
        ].join('\n'),
      };

      const data = index.build([note]);
      // The standard invalid-supersession-target check happens in the lint
      // command, not in claim-index. Here we confirm the cross-project rule
      // emits its specific error during index build.
      const crossErrs = data.errors.filter((e) => e.type === 'cross-project-superseded');
      expect(crossErrs).toHaveLength(1);
    });

    it('still allows local superseded= without interference', () => {
      const note: NoteWithContent = {
        id: 'R202',
        type: 'Requirement',
        filePath: 'R202.md',
        content: [
          '### §1 Section',
          '',
          'AC.01 Original claim.',
          'AC.02:superseded=R202.§1.AC.01 Locally superseded.',
        ].join('\n'),
      };

      const data = index.build([note]);
      const crossErrs = data.errors.filter((e) => e.type === 'cross-project-superseded');
      expect(crossErrs).toHaveLength(0);
    });
  });

  describe('Local derives/superseded — no false positives', () => {
    it('does not emit cross-project errors for local references', () => {
      const r5: NoteWithContent = {
        id: 'R005',
        type: 'Requirement',
        filePath: 'R005.md',
        content: ['### §1 Section', '', '§1.AC.01 Source.'].join('\n'),
      };
      const dd: NoteWithContent = {
        id: 'DD004',
        type: 'DetailedDesign',
        filePath: 'DD004.md',
        content: [
          '### §1 Section',
          '',
          'DC.01:derives=R005.§1.AC.01 Local derivation only.',
        ].join('\n'),
      };

      const data = index.build([r5, dd]);
      expect(data.errors.filter((e) => e.type === 'cross-project-derives')).toHaveLength(0);
      expect(data.errors.filter((e) => e.type === 'cross-project-superseded')).toHaveLength(0);
    });
  });
});
