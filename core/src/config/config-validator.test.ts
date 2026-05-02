import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigValidator, ConfigValidationError } from './config-validator';
import type { SCEpterConfig } from '../types/config';

describe('ConfigValidator', () => {
  let validator: ConfigValidator;

  beforeEach(() => {
    validator = new ConfigValidator();
  });

  describe('Custom Validation Rules', () => {
    it('should ensure all shortcodes are unique (case-insensitive)', () => {
      const config: SCEpterConfig = {
        noteTypes: {
          Requirement: { folder: 'requirements', shortcode: 'R' },
          Review: { folder: 'reviews', shortcode: 'r' }, // Duplicate (case-insensitive)!
        },
      };

      const errors = validator.validate(config);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.message.includes('unique'))).toBe(true);
    });

    it('should ensure all note type folders are unique', () => {
      const config: SCEpterConfig = {
        noteTypes: {
          Requirement: { folder: 'requirements', shortcode: 'R' },
          Rule: { folder: 'requirements', shortcode: 'RL' }, // Duplicate folder!
        },
      };

      const errors = validator.validate(config);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.message.includes('unique'))).toBe(true);
    });

    it('should validate note type keys are valid identifiers', () => {
      const config = {
        noteTypes: {
          Valid_Key: { folder: 'valid', shortcode: 'VK' },
          '123Invalid': { folder: 'invalid', shortcode: 'IV' }, // Starts with number
          'has-dash': { folder: 'dash', shortcode: 'HD' }, // Contains dash
        },
      };

      const errors = validator.validate(config);
      expect(errors.filter((e) => e.message.includes('valid identifier')).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Error Handling', () => {
    it('should throw ConfigValidationError with validateOrThrow', () => {
      const config: SCEpterConfig = {
        noteTypes: {
          Invalid: { folder: 'test', shortcode: 'TOOLONG' },
        },
      };

      expect(() => validator.validateOrThrow(config)).toThrow(ConfigValidationError);

      try {
        validator.validateOrThrow(config);
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigValidationError);
        if (error instanceof ConfigValidationError) {
          expect(error.errors.length).toBeGreaterThan(0);
          expect(error.message).toContain('Configuration validation failed');
          expect(error.message).toContain('error');
        }
      }
    });

    it('should report all validation errors, not just the first', () => {
      const config = {
        noteTypes: {
          Invalid1: { folder: 'test', shortcode: 'TOOLONG' },
          Invalid2: { folder: 'test', shortcode: 'BAD!' }, // Multiple errors
        },
      };

      const errors = validator.validate(config);
      expect(errors.length).toBeGreaterThanOrEqual(2);

      // Should include errors for:
      // - TOOLONG shortcode
      // - BAD! shortcode
      // - Duplicate folder
    });

    it('should format field paths correctly in errors', () => {
      const config: SCEpterConfig = {
        noteTypes: {
          Invalid: { folder: 'test', shortcode: 'TOOLONG' },
        },
      };

      const errors = validator.validate(config);
      expect(errors[0].field).toContain('noteTypes.Invalid.shortcode');
      expect(errors[0].severity).toBe('error');
    });

    it('should handle completely invalid config gracefully', () => {
      const invalidConfigs = [
        null,
        undefined,
        'string',
        123,
        [],
        {
          /* empty object */
        },
        { noteTypes: 'not an object' },
      ];

      invalidConfigs.forEach((config) => {
        expect(() => validator.validateOrThrow(config)).toThrow();
      });
    });
  });

  /**
   * @validates {R004.§7.AC.03} Confidence config validation
   */
  describe('Confidence config validation', () => {
    const baseConfig: SCEpterConfig = {
      noteTypes: {
        Requirement: { folder: 'requirements', shortcode: 'R' },
      },
    };

    it('should accept claims.confidence with autoInsert true', () => {
      const config = {
        ...baseConfig,
        claims: { confidence: { autoInsert: true } },
      };
      const errors = validator.validate(config);
      expect(errors).toHaveLength(0);
    });

    it('should accept claims.confidence with autoInsert false', () => {
      const config = {
        ...baseConfig,
        claims: { confidence: { autoInsert: false } },
      };
      const errors = validator.validate(config);
      expect(errors).toHaveLength(0);
    });

    it('should accept claims.confidence with no autoInsert (defaults to true)', () => {
      const config = {
        ...baseConfig,
        claims: { confidence: {} },
      };
      const errors = validator.validate(config);
      expect(errors).toHaveLength(0);
    });

    it('should accept claims without confidence field', () => {
      const config = {
        ...baseConfig,
        claims: { bracelessMatching: true },
      };
      const errors = validator.validate(config);
      expect(errors).toHaveLength(0);
    });

    it('should reject claims.confidence.autoInsert with non-boolean', () => {
      const config = {
        ...baseConfig,
        claims: { confidence: { autoInsert: 'yes' } },
      };
      const errors = validator.validate(config);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  /**
   * @validates {R011.§1.AC.01} projectAliases configuration field
   * @validates {R011.§1.AC.02} string-or-object alias value
   * @validates {R011.§1.AC.04} alias name constraints
   * @validates {R011.§1.AC.05} shortcode collision detection
   */
  describe('projectAliases (R011)', () => {
    const baseConfig: SCEpterConfig = {
      noteTypes: {
        Requirement: { folder: 'reqs', shortcode: 'R' },
      },
    };

    it('accepts a kebab-case alias name with shorthand string path', () => {
      const config = {
        ...baseConfig,
        projectAliases: { 'vendor-lib': '../vendor-lib' },
      };
      const errors = validator.validate(config);
      expect(errors).toHaveLength(0);
    });

    it('accepts a kebab-case alias name with object form', () => {
      const config = {
        ...baseConfig,
        projectAliases: {
          'vendor-lib': { path: '../vendor-lib', description: 'Upstream library' },
        },
      };
      const errors = validator.validate(config);
      expect(errors).toHaveLength(0);
    });

    it('rejects uppercase alias names (note-ID-like)', () => {
      const config = {
        ...baseConfig,
        projectAliases: { Vendor: '../vendor' },
      };
      const errors = validator.validate(config);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'projectAliases.Vendor')).toBe(true);
    });

    it('rejects alias names with leading hyphen', () => {
      const config = {
        ...baseConfig,
        projectAliases: { '-vendor': '../vendor' },
      };
      const errors = validator.validate(config);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects alias names with trailing hyphen', () => {
      const config = {
        ...baseConfig,
        projectAliases: { 'vendor-': '../vendor' },
      };
      const errors = validator.validate(config);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects single-character alias names', () => {
      const config = {
        ...baseConfig,
        projectAliases: { v: '../vendor' },
      };
      const errors = validator.validate(config);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects alias names matching the note-ID regex', () => {
      const config = {
        ...baseConfig,
        projectAliases: { R042: '../vendor' },
      };
      // R042 fails the lowercase-start rule first, but it would also fail
      // the note-ID-collision check. Either rejection is acceptable.
      const errors = validator.validate(config);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects alias names containing slash', () => {
      const config = {
        ...baseConfig,
        projectAliases: { 'vend/or': '../vendor' },
      };
      const errors = validator.validate(config);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects alias names that collide (case-insensitive) with a note-type shortcode', () => {
      const config: SCEpterConfig = {
        noteTypes: {
          Requirement: { folder: 'reqs', shortcode: 'R' },
        },
        projectAliases: { r: '../vendor' },
      };
      const errors = validator.validate(config);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.message.includes('collides'))).toBe(true);
    });

    it('rejects alias targets with empty string path', () => {
      const config = {
        ...baseConfig,
        projectAliases: { 'vendor-lib': '' },
      };
      const errors = validator.validate(config);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects alias target object with missing path', () => {
      const config = {
        ...baseConfig,
        projectAliases: { 'vendor-lib': { description: 'no path' } },
      };
      const errors = validator.validate(config);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('accepts multiple aliases together', () => {
      const config = {
        ...baseConfig,
        projectAliases: {
          'vendor-lib': '../vendor-lib',
          'team-platform': { path: '~/projects/team-platform' },
        },
      };
      const errors = validator.validate(config);
      expect(errors).toHaveLength(0);
    });
  });
});
