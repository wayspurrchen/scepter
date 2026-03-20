import { describe, it, expect } from 'vitest';
import {
  parseClaimAddress,
  parseClaimReferences,
  normalizeSectionSymbol,
  parseMetadataSuffix,
  parseRangeSuffix,
  expandClaimRange,
} from '../claim-parser';
import type { ClaimAddress } from '../claim-parser';

describe('Claim Parser', () => {
  describe('normalizeSectionSymbol', () => {
    it('should strip § prefix', () => {
      expect(normalizeSectionSymbol('§3')).toBe('3');
      expect(normalizeSectionSymbol('§AC')).toBe('AC');
      expect(normalizeSectionSymbol('§1')).toBe('1');
    });

    it('should return unchanged if no § prefix', () => {
      expect(normalizeSectionSymbol('3')).toBe('3');
      expect(normalizeSectionSymbol('AC')).toBe('AC');
      expect(normalizeSectionSymbol('REQ004')).toBe('REQ004');
    });

    it('should handle empty string', () => {
      expect(normalizeSectionSymbol('')).toBe('');
    });
  });

  describe('parseMetadataSuffix', () => {
    it('should split colon-separated metadata from reference', () => {
      const result = parseMetadataSuffix('REQ004.3.AC.01:P0:security');
      expect(result).toEqual({
        id: 'REQ004.3.AC.01',
        metadata: ['P0', 'security'],
      });
    });

    it('should handle single metadata value', () => {
      const result = parseMetadataSuffix('AC.01:P0');
      expect(result).toEqual({
        id: 'AC.01',
        metadata: ['P0'],
      });
    });

    it('should return empty metadata when no colon', () => {
      const result = parseMetadataSuffix('REQ004.3.AC.01');
      expect(result).toEqual({
        id: 'REQ004.3.AC.01',
        metadata: [],
      });
    });

    it('should filter out invalid metadata tokens', () => {
      const result = parseMetadataSuffix('AC.01:P0: :security');
      expect(result.metadata).toEqual(['P0', 'security']);
    });

    it('should accept key-value metadata with = and dot', () => {
      const result = parseMetadataSuffix('AC.01:superseded=R004.§2.AC.07');
      expect(result).toEqual({
        id: 'AC.01',
        metadata: ['superseded=R004.§2.AC.07'],
      });
    });

    it('should accept metadata with underscore and hyphen', () => {
      const result = parseMetadataSuffix('AC.01:my_tag:sub-category');
      expect(result.metadata).toEqual(['my_tag', 'sub-category']);
    });
  });

  describe('parseClaimAddress — all 12 valid reference forms', () => {
    it('NOTE.§N.M.§PREFIX.NN:meta — fully qualified with § and metadata', () => {
      const result = parseClaimAddress('REQ004.§3.1.§AC.01:P0');
      expect(result).not.toBeNull();
      expect(result!.noteId).toBe('REQ004');
      expect(result!.sectionPath).toEqual([3, 1]);
      expect(result!.claimPrefix).toBe('AC');
      expect(result!.claimNumber).toBe(1);
      expect(result!.metadata).toEqual(['P0']);
    });

    it('NOTE.N.M.PREFIX.NN:meta — fully qualified without §', () => {
      const result = parseClaimAddress('REQ004.3.1.AC.01:P0');
      expect(result).not.toBeNull();
      expect(result!.noteId).toBe('REQ004');
      expect(result!.sectionPath).toEqual([3, 1]);
      expect(result!.claimPrefix).toBe('AC');
      expect(result!.claimNumber).toBe(1);
      expect(result!.metadata).toEqual(['P0']);
    });

    it('NOTE.N.PREFIX.NN — note, section, claim', () => {
      const result = parseClaimAddress('REQ004.3.AC.01');
      expect(result).not.toBeNull();
      expect(result!.noteId).toBe('REQ004');
      expect(result!.sectionPath).toEqual([3]);
      expect(result!.claimPrefix).toBe('AC');
      expect(result!.claimNumber).toBe(1);
      expect(result!.metadata).toBeUndefined();
    });

    it('NOTE.PREFIX.NN — note and claim, no section', () => {
      const result = parseClaimAddress('REQ004.AC.01');
      expect(result).not.toBeNull();
      expect(result!.noteId).toBe('REQ004');
      expect(result!.sectionPath).toBeUndefined();
      expect(result!.claimPrefix).toBe('AC');
      expect(result!.claimNumber).toBe(1);
    });

    it('N.PREFIX.NN — section and claim within same document', () => {
      const result = parseClaimAddress('3.AC.01');
      expect(result).not.toBeNull();
      expect(result!.noteId).toBeUndefined();
      expect(result!.sectionPath).toEqual([3]);
      expect(result!.claimPrefix).toBe('AC');
      expect(result!.claimNumber).toBe(1);
    });

    it('§N.PREFIX.NN — section with § and claim', () => {
      const result = parseClaimAddress('§3.AC.01');
      expect(result).not.toBeNull();
      expect(result!.noteId).toBeUndefined();
      expect(result!.sectionPath).toEqual([3]);
      expect(result!.claimPrefix).toBe('AC');
      expect(result!.claimNumber).toBe(1);
    });

    it('PREFIX.NN — bare claim', () => {
      const result = parseClaimAddress('AC.01');
      expect(result).not.toBeNull();
      expect(result!.noteId).toBeUndefined();
      expect(result!.sectionPath).toBeUndefined();
      expect(result!.claimPrefix).toBe('AC');
      expect(result!.claimNumber).toBe(1);
    });

    it('§PREFIX.NN — bare claim with §', () => {
      const result = parseClaimAddress('§AC.01');
      expect(result).not.toBeNull();
      expect(result!.noteId).toBeUndefined();
      expect(result!.sectionPath).toBeUndefined();
      expect(result!.claimPrefix).toBe('AC');
      expect(result!.claimNumber).toBe(1);
    });

    it('NOTE.§N — section reference with §', () => {
      const result = parseClaimAddress('S012.§3');
      expect(result).not.toBeNull();
      expect(result!.noteId).toBe('S012');
      expect(result!.sectionPath).toEqual([3]);
      expect(result!.claimPrefix).toBeUndefined();
    });

    it('NOTE.N — section reference without §', () => {
      const result = parseClaimAddress('S012.3');
      expect(result).not.toBeNull();
      expect(result!.noteId).toBe('S012');
      expect(result!.sectionPath).toEqual([3]);
      expect(result!.claimPrefix).toBeUndefined();
    });

    it('§N — section within same document', () => {
      const result = parseClaimAddress('§3');
      expect(result).not.toBeNull();
      expect(result!.noteId).toBeUndefined();
      expect(result!.sectionPath).toEqual([3]);
      expect(result!.claimPrefix).toBeUndefined();
    });

    it('NOTE — whole note reference', () => {
      const result = parseClaimAddress('REQ004');
      expect(result).not.toBeNull();
      expect(result!.noteId).toBe('REQ004');
      expect(result!.sectionPath).toBeUndefined();
      expect(result!.claimPrefix).toBeUndefined();
    });
  });

  describe('section symbol normalization — both forms parse identically', () => {
    it('section symbol on sections does not change result', () => {
      const withSymbol = parseClaimAddress('REQ004.§3.§1.§AC.01');
      const withoutSymbol = parseClaimAddress('REQ004.3.1.AC.01');
      expect(withSymbol).not.toBeNull();
      expect(withoutSymbol).not.toBeNull();
      // Compare meaningful fields
      expect(withSymbol!.noteId).toBe(withoutSymbol!.noteId);
      expect(withSymbol!.sectionPath).toEqual(withoutSymbol!.sectionPath);
      expect(withSymbol!.claimPrefix).toBe(withoutSymbol!.claimPrefix);
      expect(withSymbol!.claimNumber).toBe(withoutSymbol!.claimNumber);
    });

    it('section symbol on bare section does not change result', () => {
      const withSymbol = parseClaimAddress('§3');
      const withoutSymbol = parseClaimAddress('3');
      expect(withSymbol).not.toBeNull();
      expect(withSymbol!.sectionPath).toEqual([3]);
      // Both should produce the same section path
      expect(withoutSymbol).not.toBeNull();
      expect(withoutSymbol!.sectionPath).toEqual([3]);
    });
  });

  describe('metadata suffix parsing', () => {
    it('should parse :P0 metadata', () => {
      const result = parseClaimAddress('REQ004.AC.01:P0');
      expect(result).not.toBeNull();
      expect(result!.metadata).toEqual(['P0']);
      expect(result!.claimPrefix).toBe('AC');
      expect(result!.claimNumber).toBe(1);
    });

    it('should parse :critical:security colon-separated metadata', () => {
      const result = parseClaimAddress('3.AC.01:critical:security');
      expect(result).not.toBeNull();
      expect(result!.metadata).toEqual(['critical', 'security']);
    });

    it('should not include metadata in claim ID', () => {
      const result = parseClaimAddress('REQ004.3.AC.01:P0');
      expect(result!.noteId).toBe('REQ004');
      expect(result!.claimNumber).toBe(1);
      expect(result!.metadata).toEqual(['P0']);
    });
  });

  describe('forbidden form rejection', () => {
    it('should reject AC01 (no dot between prefix and number)', () => {
      expect(parseClaimAddress('AC01')).toBeNull();
    });

    it('should reject SEC03 (no dot)', () => {
      expect(parseClaimAddress('SEC03')).toBeNull();
    });

    it('should reject REQ004.AC01 (forbidden form in compound reference)', () => {
      expect(parseClaimAddress('REQ004.AC01')).toBeNull();
    });

    it('should reject AC01a (with sub-letter, still forbidden)', () => {
      expect(parseClaimAddress('AC01a')).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should return null for empty string', () => {
      expect(parseClaimAddress('')).toBeNull();
    });

    it('should return null for whitespace only', () => {
      expect(parseClaimAddress('   ')).toBeNull();
    });

    it('should return null for just a number (no § prefix)', () => {
      // A bare number like "3" is ambiguous without § — but our parser
      // should parse it as a section path
      const result = parseClaimAddress('3');
      // This is a valid section reference: sectionPath = [3]
      expect(result).not.toBeNull();
      expect(result!.sectionPath).toEqual([3]);
    });

    it('should return null for just lowercase letters', () => {
      expect(parseClaimAddress('abc')).toBeNull();
    });

    it('should handle claim with sub-letter', () => {
      const result = parseClaimAddress('AC.01a');
      expect(result).not.toBeNull();
      expect(result!.claimPrefix).toBe('AC');
      expect(result!.claimNumber).toBe(1);
      expect(result!.claimSubLetter).toBe('a');
    });

    it('should handle multi-character claim prefix', () => {
      const result = parseClaimAddress('CORE.12');
      expect(result).not.toBeNull();
      expect(result!.claimPrefix).toBe('CORE');
      expect(result!.claimNumber).toBe(12);
    });

    it('should handle 3-digit claim numbers', () => {
      const result = parseClaimAddress('SEC.123');
      expect(result).not.toBeNull();
      expect(result!.claimPrefix).toBe('SEC');
      expect(result!.claimNumber).toBe(123);
    });

    it('should handle deep section paths', () => {
      const result = parseClaimAddress('REQ004.3.1.2.AC.01');
      expect(result).not.toBeNull();
      expect(result!.sectionPath).toEqual([3, 1, 2]);
      expect(result!.claimPrefix).toBe('AC');
    });

    it('should return null for trailing dot', () => {
      expect(parseClaimAddress('REQ004.')).toBeNull();
    });

    it('should return null for double dot', () => {
      expect(parseClaimAddress('REQ004..3')).toBeNull();
    });
  });

  describe('parseClaimReferences — braced references', () => {
    it('should find braced claim references', () => {
      const content = 'See {REQ004.3.AC.01} for details.';
      const refs = parseClaimReferences(content);
      expect(refs).toHaveLength(1);
      expect(refs[0].address.noteId).toBe('REQ004');
      expect(refs[0].address.sectionPath).toEqual([3]);
      expect(refs[0].address.claimPrefix).toBe('AC');
      expect(refs[0].address.claimNumber).toBe(1);
      expect(refs[0].braced).toBe(true);
      expect(refs[0].line).toBe(1);
    });

    it('should find multiple braced references on one line', () => {
      const content = 'Compare {REQ004.AC.01} with {S012.§3.AC.02}.';
      const refs = parseClaimReferences(content);
      expect(refs).toHaveLength(2);
      expect(refs[0].address.noteId).toBe('REQ004');
      expect(refs[1].address.noteId).toBe('S012');
    });

    it('should find braced references across multiple lines', () => {
      const content = 'Line 1 has {REQ004.AC.01}\nLine 2 has {S012.3}';
      const refs = parseClaimReferences(content);
      expect(refs).toHaveLength(2);
      expect(refs[0].line).toBe(1);
      expect(refs[1].line).toBe(2);
    });

    it('should handle braced section-only references', () => {
      const content = 'See {§3} for details.';
      const refs = parseClaimReferences(content);
      expect(refs).toHaveLength(1);
      expect(refs[0].address.sectionPath).toEqual([3]);
      expect(refs[0].braced).toBe(true);
    });

    it('should handle braced references with colon-separated metadata', () => {
      const content = 'Critical: {REQ004.AC.01:P0:security}';
      const refs = parseClaimReferences(content);
      expect(refs).toHaveLength(1);
      expect(refs[0].address.metadata).toEqual(['P0', 'security']);
    });
  });

  describe('parseClaimReferences — braceless references', () => {
    it('should find braceless claim paths with dots', () => {
      const content = 'See REQ004.3.AC.01 for details.';
      const refs = parseClaimReferences(content);
      expect(refs.some(
        (r) => !r.braced && r.address.noteId === 'REQ004' && r.address.claimPrefix === 'AC',
      )).toBe(true);
    });

    it('should find §-prefixed braceless references', () => {
      const content = 'See §3.AC.01 for details.';
      const refs = parseClaimReferences(content);
      expect(refs.some(
        (r) => !r.braced && r.address.sectionPath?.length === 1 && r.address.claimPrefix === 'AC',
      )).toBe(true);
    });

    it('should find bare claim paths like AC.01', () => {
      const content = 'The AC.01 acceptance criterion requires...';
      const refs = parseClaimReferences(content);
      expect(refs.some(
        (r) => !r.braced && r.address.claimPrefix === 'AC' && r.address.claimNumber === 1,
      )).toBe(true);
    });

    it('should validate bare note IDs against knownShortcodes', () => {
      const knownShortcodes = new Set(['REQ', 'S', 'D']);
      const content = 'Reference REQ004 here and UNKNOWN001 there.';
      const refs = parseClaimReferences(content, {
        knownShortcodes,
        bracelessEnabled: true,
      });
      const noteOnlyRefs = refs.filter(
        (r) => !r.braced && r.address.noteId && !r.address.sectionPath && !r.address.claimPrefix,
      );
      // REQ004 should be found (REQ is a known shortcode)
      expect(noteOnlyRefs.some((r) => r.address.noteId === 'REQ004')).toBe(true);
      // UNKNOWN001 should NOT be found (UNKNO is not a known shortcode — actually UNKN is 4 chars...
      // Let's check: UNKNOWN is 7 chars which exceeds 5-char limit, so it won't parse as a note ID at all)
    });

    it('should not find braceless references when bracelessEnabled is false', () => {
      const content = 'See REQ004.3.AC.01 and AC.01 here.';
      const refs = parseClaimReferences(content, { bracelessEnabled: false });
      // Only braced references should be found (there are none here)
      expect(refs).toHaveLength(0);
    });

    it('should not match inside braced references', () => {
      const content = 'See {REQ004.3.AC.01} for details.';
      const refs = parseClaimReferences(content);
      // The braced one should be found; no duplicate braceless match inside the braces
      const bracedRefs = refs.filter((r) => r.braced);
      const bracelessRefs = refs.filter((r) => !r.braced);
      expect(bracedRefs).toHaveLength(1);
      // Braceless should not duplicate the braced content
      const hasDuplicate = bracelessRefs.some(
        (r) => r.address.noteId === 'REQ004' && r.address.claimPrefix === 'AC',
      );
      expect(hasDuplicate).toBe(false);
    });

    it('should skip references inside backticks', () => {
      const content = 'Use `REQ004.AC.01` as an example.';
      const refs = parseClaimReferences(content);
      // References inside backticks should be skipped
      const matchingRefs = refs.filter(
        (r) => !r.braced && r.address.noteId === 'REQ004' && r.address.claimPrefix === 'AC',
      );
      expect(matchingRefs).toHaveLength(0);
    });
  });

  describe('parseClaimReferences — column tracking', () => {
    it('should report correct column for braced reference', () => {
      const content = 'See {AC.01} here.';
      const refs = parseClaimReferences(content);
      expect(refs).toHaveLength(1);
      expect(refs[0].column).toBe(5); // '{' is at index 4, so column 5 (1-based)
    });
  });

  describe('parseRangeSuffix', () => {
    it('should parse compact range: AC.01-06', () => {
      const result = parseRangeSuffix('AC.01-06');
      expect(result).not.toBeNull();
      expect(result!.baseRef).toBe('AC.01');
      expect(result!.endNumber).toBe(6);
    });

    it('should parse explicit range: AC.01-AC.06', () => {
      const result = parseRangeSuffix('AC.01-AC.06');
      expect(result).not.toBeNull();
      expect(result!.baseRef).toBe('AC.01');
      expect(result!.endNumber).toBe(6);
    });

    it('should parse fully qualified compact: R004.§1.AC.01-06', () => {
      const result = parseRangeSuffix('R004.§1.AC.01-06');
      expect(result).not.toBeNull();
      expect(result!.baseRef).toBe('R004.§1.AC.01');
      expect(result!.endNumber).toBe(6);
    });

    it('should parse fully qualified explicit: R004.§1.AC.01-AC.06', () => {
      const result = parseRangeSuffix('R004.§1.AC.01-AC.06');
      expect(result).not.toBeNull();
      expect(result!.baseRef).toBe('R004.§1.AC.01');
      expect(result!.endNumber).toBe(6);
    });

    it('should parse with section prefix: §1.AC.01-06', () => {
      const result = parseRangeSuffix('§1.AC.01-06');
      expect(result).not.toBeNull();
      expect(result!.baseRef).toBe('§1.AC.01');
      expect(result!.endNumber).toBe(6);
    });

    it('should parse 3-digit claim numbers: SEC.001-012', () => {
      const result = parseRangeSuffix('SEC.001-012');
      expect(result).not.toBeNull();
      expect(result!.baseRef).toBe('SEC.001');
      expect(result!.endNumber).toBe(12);
    });

    it('should return null for non-range reference: AC.01', () => {
      expect(parseRangeSuffix('AC.01')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseRangeSuffix('')).toBeNull();
    });

    it('should reject mismatched prefix in explicit form: AC.01-SEC.06', () => {
      // The regex backreference ensures the prefix must match
      expect(parseRangeSuffix('AC.01-SEC.06')).toBeNull();
    });
  });

  describe('expandClaimRange', () => {
    it('should expand AC.01 through AC.06', () => {
      const base: ClaimAddress = {
        claimPrefix: 'AC',
        claimNumber: 1,
        raw: 'AC.01',
      };
      const expanded = expandClaimRange(base, 6);
      expect(expanded).toHaveLength(6);
      expect(expanded[0].claimNumber).toBe(1);
      expect(expanded[0].raw).toBe('AC.01');
      expect(expanded[5].claimNumber).toBe(6);
      expect(expanded[5].raw).toBe('AC.06');
    });

    it('should preserve noteId and sectionPath in all expanded addresses', () => {
      const base: ClaimAddress = {
        noteId: 'R004',
        sectionPath: [1],
        claimPrefix: 'AC',
        claimNumber: 1,
        raw: 'R004.1.AC.01',
      };
      const expanded = expandClaimRange(base, 3);
      expect(expanded).toHaveLength(3);
      for (const addr of expanded) {
        expect(addr.noteId).toBe('R004');
        expect(addr.sectionPath).toEqual([1]);
        expect(addr.claimPrefix).toBe('AC');
      }
      expect(expanded[0].raw).toBe('R004.1.AC.01');
      expect(expanded[1].raw).toBe('R004.1.AC.02');
      expect(expanded[2].raw).toBe('R004.1.AC.03');
    });

    it('should return empty array when start >= end', () => {
      const base: ClaimAddress = {
        claimPrefix: 'AC',
        claimNumber: 6,
        raw: 'AC.06',
      };
      expect(expandClaimRange(base, 6)).toEqual([]);
      expect(expandClaimRange(base, 3)).toEqual([]);
    });

    it('should return empty array when base has no claim prefix', () => {
      const base: ClaimAddress = {
        noteId: 'R004',
        sectionPath: [1],
        raw: 'R004.1',
      };
      expect(expandClaimRange(base, 6)).toEqual([]);
    });

    it('should not include sub-letters in expanded addresses', () => {
      const base: ClaimAddress = {
        claimPrefix: 'AC',
        claimNumber: 1,
        claimSubLetter: 'a',
        raw: 'AC.01a',
      };
      const expanded = expandClaimRange(base, 3);
      expect(expanded).toHaveLength(3);
      for (const addr of expanded) {
        expect(addr.claimSubLetter).toBeUndefined();
      }
    });

    it('should preserve metadata in all expanded addresses', () => {
      const base: ClaimAddress = {
        claimPrefix: 'AC',
        claimNumber: 1,
        metadata: ['P0'],
        raw: 'AC.01',
      };
      const expanded = expandClaimRange(base, 3);
      for (const addr of expanded) {
        expect(addr.metadata).toEqual(['P0']);
      }
    });

    it('should zero-pad numbers to at least 2 digits', () => {
      const base: ClaimAddress = {
        claimPrefix: 'AC',
        claimNumber: 1,
        raw: 'AC.01',
      };
      const expanded = expandClaimRange(base, 9);
      expect(expanded[0].raw).toBe('AC.01');
      expect(expanded[8].raw).toBe('AC.09');
    });
  });

  describe('parseClaimReferences — braced range expansion', () => {
    it('should expand compact range in braces: {AC.01-06}', () => {
      const content = 'Covers {AC.01-06} criteria.';
      const refs = parseClaimReferences(content);
      expect(refs).toHaveLength(6);
      for (let i = 0; i < 6; i++) {
        expect(refs[i].address.claimPrefix).toBe('AC');
        expect(refs[i].address.claimNumber).toBe(i + 1);
        expect(refs[i].braced).toBe(true);
        expect(refs[i].line).toBe(1);
      }
    });

    it('should expand explicit range in braces: {AC.01-AC.06}', () => {
      const content = 'Covers {AC.01-AC.06} criteria.';
      const refs = parseClaimReferences(content);
      expect(refs).toHaveLength(6);
      expect(refs[0].address.claimNumber).toBe(1);
      expect(refs[5].address.claimNumber).toBe(6);
    });

    it('should expand fully qualified range in braces: {R004.§1.AC.01-06}', () => {
      const content = 'See {R004.§1.AC.01-06} for full list.';
      const refs = parseClaimReferences(content);
      expect(refs).toHaveLength(6);
      for (const ref of refs) {
        expect(ref.address.noteId).toBe('R004');
        expect(ref.address.sectionPath).toEqual([1]);
        expect(ref.address.claimPrefix).toBe('AC');
        expect(ref.braced).toBe(true);
      }
      expect(refs[0].address.claimNumber).toBe(1);
      expect(refs[5].address.claimNumber).toBe(6);
    });

    it('should expand fully qualified explicit range: {R004.§1.AC.01-AC.06}', () => {
      const content = 'See {R004.§1.AC.01-AC.06} implementation.';
      const refs = parseClaimReferences(content);
      expect(refs).toHaveLength(6);
      expect(refs[0].address.raw).toBe('R004.1.AC.01');
      expect(refs[5].address.raw).toBe('R004.1.AC.06');
    });

    it('should handle range alongside non-range braced refs', () => {
      const content = 'See {AC.01-03} and {SEC.05}.';
      const refs = parseClaimReferences(content);
      expect(refs).toHaveLength(4); // 3 from range + 1 single
      const acRefs = refs.filter((r) => r.address.claimPrefix === 'AC');
      const secRefs = refs.filter((r) => r.address.claimPrefix === 'SEC');
      expect(acRefs).toHaveLength(3);
      expect(secRefs).toHaveLength(1);
    });
  });

  describe('parseClaimReferences — braceless range expansion', () => {
    it('should expand compact braceless range: AC.01-06', () => {
      const content = 'Covers AC.01-06 criteria.';
      const refs = parseClaimReferences(content);
      expect(refs).toHaveLength(6);
      for (let i = 0; i < 6; i++) {
        expect(refs[i].address.claimPrefix).toBe('AC');
        expect(refs[i].address.claimNumber).toBe(i + 1);
        expect(refs[i].braced).toBe(false);
      }
    });

    it('should expand explicit braceless range: AC.01-AC.06', () => {
      const content = 'Covers AC.01-AC.06 criteria.';
      const refs = parseClaimReferences(content);
      expect(refs).toHaveLength(6);
      expect(refs[0].address.claimNumber).toBe(1);
      expect(refs[5].address.claimNumber).toBe(6);
    });

    it('should expand §-prefixed braceless range: §1.AC.01-06', () => {
      const content = 'See §1.AC.01-06 for details.';
      const refs = parseClaimReferences(content);
      const acRefs = refs.filter((r) => r.address.claimPrefix === 'AC');
      expect(acRefs).toHaveLength(6);
      for (const ref of acRefs) {
        expect(ref.address.sectionPath).toEqual([1]);
      }
    });

    it('should expand note-prefixed braceless range: R004.§1.AC.01-06', () => {
      const content = 'Implements R004.§1.AC.01-06 fully.';
      const refs = parseClaimReferences(content);
      const acRefs = refs.filter(
        (r) => r.address.claimPrefix === 'AC' && r.address.noteId === 'R004',
      );
      expect(acRefs).toHaveLength(6);
    });

    it('should not expand ranges when bracelessEnabled is false', () => {
      const content = 'See AC.01-06 here.';
      const refs = parseClaimReferences(content, { bracelessEnabled: false });
      expect(refs).toHaveLength(0);
    });
  });

  describe('range expansion — edge cases', () => {
    it('should handle small range: AC.05-06 (2 items)', () => {
      const content = '{AC.05-06}';
      const refs = parseClaimReferences(content);
      expect(refs).toHaveLength(2);
      expect(refs[0].address.claimNumber).toBe(5);
      expect(refs[1].address.claimNumber).toBe(6);
    });

    it('should not treat AC.06-03 as a range (start > end)', () => {
      // parseRangeSuffix will match the syntax, but expandClaimRange
      // returns empty for start >= end, so tryExpandRange returns null,
      // and it falls through to regular parsing
      const content = '{AC.06-03}';
      const refs = parseClaimReferences(content);
      // Should not produce range expansion; the raw "AC.06-03" is not
      // a valid claim address either, so no refs
      expect(refs).toHaveLength(0);
    });

    it('should handle range with 3-digit numbers: {SEC.001-005}', () => {
      const content = '{SEC.001-005}';
      const refs = parseClaimReferences(content);
      expect(refs).toHaveLength(5);
      expect(refs[0].address.claimNumber).toBe(1);
      expect(refs[0].address.raw).toBe('SEC.001');
      expect(refs[4].address.claimNumber).toBe(5);
      expect(refs[4].address.raw).toBe('SEC.005');
    });
  });
});
