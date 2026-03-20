import { describe, it, expect } from 'vitest';
import {
  parseNoteId,
  parseTags,
  isValidShortcodeFormat,
  isValidNoteId,
  extractModifier,
  formatNoteId,
  generateNotePath,
  mergeTags,
} from './shared-note-utils';

describe('Shared Note Utils', () => {
  describe('parseNoteId', () => {
    it('should parse valid single-character shortcode IDs', () => {
      expect(parseNoteId('D001')).toEqual({ shortcode: 'D', number: '001' });
      expect(parseNoteId('R042')).toEqual({ shortcode: 'R', number: '042' });
      expect(parseNoteId('Q999')).toEqual({ shortcode: 'Q', number: '999' });
      expect(parseNoteId('T100')).toEqual({ shortcode: 'T', number: '100' });
      expect(parseNoteId('M001')).toEqual({ shortcode: 'M', number: '001' });
    });

    it('should parse valid multi-character shortcode IDs', () => {
      expect(parseNoteId('ARCH001')).toEqual({ shortcode: 'ARCH', number: '001' });
      expect(parseNoteId('US12345')).toEqual({ shortcode: 'US', number: '12345' });
      expect(parseNoteId('API00042')).toEqual({ shortcode: 'API', number: '00042' });
      expect(parseNoteId('DEBT99999')).toEqual({ shortcode: 'DEBT', number: '99999' });
      expect(parseNoteId('REQ00001')).toEqual({ shortcode: 'REQ', number: '00001' });
    });

    it('should return null for invalid IDs', () => {
      expect(parseNoteId('')).toBeNull();
      expect(parseNoteId('D')).toBeNull();
      expect(parseNoteId('001')).toBeNull();
      expect(parseNoteId('D00')).toBeNull(); // Too few digits
      expect(parseNoteId('D000001')).toBeNull(); // Too many digits
      expect(parseNoteId('TOOLONG001')).toBeNull(); // Shortcode too long
      expect(parseNoteId('d001')).toBeNull(); // Case sensitive
      expect(parseNoteId('D-001')).toBeNull(); // Invalid characters
    });
  });

  describe('parseTags', () => {
    it('should parse empty or undefined tags', () => {
      expect(parseTags()).toEqual([]);
      expect(parseTags('')).toEqual([]);
      expect(parseTags('  ')).toEqual([]);
    });

    it('should parse single tag', () => {
      expect(parseTags('auth')).toEqual(['auth']);
      expect(parseTags('  auth  ')).toEqual(['auth']);
    });

    it('should parse multiple tags', () => {
      expect(parseTags('auth,security')).toEqual(['auth', 'security']);
      expect(parseTags('auth, security, api')).toEqual(['auth', 'security', 'api']);
      expect(parseTags(' auth , security , api ')).toEqual(['auth', 'security', 'api']);
    });

    it('should handle hierarchical tags', () => {
      expect(parseTags('auth/jwt')).toEqual(['auth/jwt']);
      expect(parseTags('auth/jwt,api/rest')).toEqual(['auth/jwt', 'api/rest']);
      expect(parseTags('feature/auth/jwt')).toEqual(['feature/auth/jwt']);
    });

    it('should filter out empty tags', () => {
      expect(parseTags('auth,,security')).toEqual(['auth', 'security']);
      expect(parseTags(',auth,,')).toEqual(['auth']);
      expect(parseTags(',,')).toEqual([]);
    });

    it('should preserve tag case', () => {
      expect(parseTags('Auth,Security')).toEqual(['Auth', 'Security']);
      expect(parseTags('API,ui')).toEqual(['API', 'ui']);
    });
  });

  describe('isValidShortcodeFormat', () => {
    it('should validate shortcode formats', () => {
      // Valid single-character
      expect(isValidShortcodeFormat('R')).toBe(true);
      expect(isValidShortcodeFormat('D')).toBe(true);
      expect(isValidShortcodeFormat('Q')).toBe(true);

      // Valid multi-character
      expect(isValidShortcodeFormat('ARCH')).toBe(true);
      expect(isValidShortcodeFormat('US')).toBe(true);
      expect(isValidShortcodeFormat('API')).toBe(true);
      expect(isValidShortcodeFormat('DEBT')).toBe(true);
      expect(isValidShortcodeFormat('ABCDE')).toBe(true); // 5 chars max

      // Invalid
      expect(isValidShortcodeFormat('TOOLONG')).toBe(false); // > 5 chars
      expect(isValidShortcodeFormat('r')).toBe(false); // lowercase
      expect(isValidShortcodeFormat('')).toBe(false);
      expect(isValidShortcodeFormat('123')).toBe(false); // numbers
      expect(isValidShortcodeFormat('A-B')).toBe(false); // special chars
    });
  });

  describe('isValidNoteId', () => {
    it('should validate correct single-char shortcode IDs', () => {
      expect(isValidNoteId('D001')).toBe(true);
      expect(isValidNoteId('R999')).toBe(true);
      expect(isValidNoteId('Q000')).toBe(true);
      expect(isValidNoteId('T123')).toBe(true);
      expect(isValidNoteId('M456')).toBe(true);
    });

    it('should validate correct multi-char shortcode IDs', () => {
      expect(isValidNoteId('ARCH00001')).toBe(true);
      expect(isValidNoteId('US12345')).toBe(true);
      expect(isValidNoteId('API001')).toBe(true);
      expect(isValidNoteId('DEBT99999')).toBe(true);
    });

    it('should reject invalid note IDs', () => {
      expect(isValidNoteId('TOOLONG001')).toBe(false); // Shortcode too long
      expect(isValidNoteId('D01')).toBe(false); // Too few digits
      expect(isValidNoteId('D000001')).toBe(false); // Too many digits
      expect(isValidNoteId('d001')).toBe(false); // Lowercase
      expect(isValidNoteId('D')).toBe(false);
      expect(isValidNoteId('001')).toBe(false);
      expect(isValidNoteId('')).toBe(false);
    });
  });

  describe('extractModifier', () => {
    it('should extract force include modifier', () => {
      expect(extractModifier('D001+')).toEqual({
        id: 'D001',
        modifier: '+',
        forceInclude: true,
        contextOnly: false,
      });

      // Multi-char shortcodes
      expect(extractModifier('ARCH00001+')).toEqual({
        id: 'ARCH00001',
        modifier: '+',
        forceInclude: true,
        contextOnly: false,
      });
    });

    it('should extract context only modifier', () => {
      expect(extractModifier('R002.')).toEqual({
        id: 'R002',
        modifier: '.',
        forceInclude: false,
        contextOnly: true,
      });

      // Multi-char shortcodes
      expect(extractModifier('US12345.')).toEqual({
        id: 'US12345',
        modifier: '.',
        forceInclude: false,
        contextOnly: true,
      });
    });

    it('should handle IDs without modifiers', () => {
      expect(extractModifier('T003')).toEqual({
        id: 'T003',
        modifier: undefined,
        forceInclude: false,
        contextOnly: false,
      });

      expect(extractModifier('API00042')).toEqual({
        id: 'API00042',
        modifier: undefined,
        forceInclude: false,
        contextOnly: false,
      });
    });

    it('should handle invalid modifiers', () => {
      expect(extractModifier('D001*')).toEqual({
        id: 'D001*',
        modifier: undefined,
        forceInclude: false,
        contextOnly: false,
      });
    });
  });

  describe('formatNoteId', () => {
    it('should format single-char shortcode IDs with 3 digits', () => {
      expect(formatNoteId('D', '1')).toBe('D001');
      expect(formatNoteId('R', '42')).toBe('R042');
      expect(formatNoteId('Q', '999')).toBe('Q999');
      expect(formatNoteId('T', '0')).toBe('T000');
    });

    it('should format multi-char shortcode IDs with 5 digits by default', () => {
      expect(formatNoteId('ARCH', '1')).toBe('ARCH00001');
      expect(formatNoteId('US', '42')).toBe('US00042');
      expect(formatNoteId('API', '12345')).toBe('API12345');
      expect(formatNoteId('DEBT', '0')).toBe('DEBT00000');
    });

    it('should handle custom digit padding', () => {
      expect(formatNoteId('R', '1', 5)).toBe('R00001');
      expect(formatNoteId('ARCH', '42', 3)).toBe('ARCH042');
      expect(formatNoteId('US', '999', 4)).toBe('US0999');
    });

    it('should handle numbers as integers', () => {
      expect(formatNoteId('D', 1)).toBe('D001');
      expect(formatNoteId('ARCH', 42)).toBe('ARCH00042');
      expect(formatNoteId('M', 999)).toBe('M999');
    });

    it('should cap numbers at max for digit length', () => {
      expect(formatNoteId('D', '1000')).toBe('D999'); // 3 digits max = 999
      expect(formatNoteId('ARCH', 100000)).toBe('ARCH99999'); // 5 digits max = 99999
      expect(formatNoteId('R', 10000, 4)).toBe('R9999'); // 4 digits max = 9999
    });
  });

  describe('generateNotePath', () => {
    it('should generate correct note file paths with type mapping', () => {
      const typeMapping = {
        D: 'decisions',
        R: 'requirements',
        Q: 'questions',
        ARCH: 'architecture',
        US: 'user-stories',
      };

      expect(generateNotePath('D001', typeMapping)).toBe('decisions/D001.md');
      expect(generateNotePath('R042', typeMapping)).toBe('requirements/R042.md');
      expect(generateNotePath('ARCH00001', typeMapping)).toBe('architecture/ARCH00001.md');
      expect(generateNotePath('US12345', typeMapping)).toBe('user-stories/US12345.md');
    });

    it('should return null for invalid IDs', () => {
      const typeMapping = { D: 'decisions' };
      expect(generateNotePath('X001', typeMapping)).toBeNull(); // Unknown shortcode
      expect(generateNotePath('D00', typeMapping)).toBeNull(); // Invalid format
      expect(generateNotePath('', typeMapping)).toBeNull();
    });

    it('should return null for unmapped shortcodes', () => {
      const typeMapping = { D: 'decisions' };
      expect(generateNotePath('R001', typeMapping)).toBeNull(); // R not in mapping
    });
  });

  describe('mergeTags', () => {
    it('should merge empty arrays', () => {
      expect(mergeTags([], [])).toEqual([]);
    });

    it('should merge non-overlapping tags', () => {
      expect(mergeTags(['auth'], ['security'])).toEqual(['auth', 'security']);
      expect(mergeTags(['a', 'b'], ['c', 'd'])).toEqual(['a', 'b', 'c', 'd']);
    });

    it('should deduplicate overlapping tags', () => {
      expect(mergeTags(['auth', 'api'], ['api', 'security'])).toEqual(['auth', 'api', 'security']);
      expect(mergeTags(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual(['a', 'b', 'c', 'd']);
    });

    it('should preserve order with first array taking precedence', () => {
      expect(mergeTags(['z', 'a'], ['b', 'c'])).toEqual(['z', 'a', 'b', 'c']);
      expect(mergeTags(['api', 'auth'], ['auth', 'api', 'new'])).toEqual(['api', 'auth', 'new']);
    });

    it('should handle single array inputs', () => {
      expect(mergeTags(['auth', 'api'], [])).toEqual(['auth', 'api']);
      expect(mergeTags([], ['security', 'test'])).toEqual(['security', 'test']);
    });
  });
});
