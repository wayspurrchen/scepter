/**
 * Tests for confidence markers module.
 *
 * @validates {R004.§7.AC.01} Confidence audit: parsing and aggregation
 * @validates {R004.§7.AC.02} Confidence marking: format, insert, validate
 * @validates {R004.§7.AC.03} Auto-insert config support
 */

import { describe, it, expect } from 'vitest';
import {
  parseConfidenceAnnotation,
  formatConfidenceAnnotation,
  insertConfidenceAnnotation,
  validateReviewerLevel,
  mapReviewerArg,
} from '../confidence.js';
import type { ConfidenceLevel, ReviewerIcon } from '../confidence.js';

// ---------------------------------------------------------------------------
// parseConfidenceAnnotation
// ---------------------------------------------------------------------------

describe('parseConfidenceAnnotation', () => {
  it('parses AI annotation at line 1', () => {
    const content = '// @confidence 🤖2 2026-03-11\nconst x = 1;';
    const result = parseConfidenceAnnotation(content, 'test.ts');

    expect(result).not.toBeNull();
    expect(result!.reviewer).toBe('🤖');
    expect(result!.level).toBe(2);
    expect(result!.date).toBe('2026-03-11');
    expect(result!.line).toBe(1);
    expect(result!.filePath).toBe('test.ts');
  });

  it('parses human annotation', () => {
    const content = '// some header\n// @confidence 👤4 2026-03-12\ncode here';
    const result = parseConfidenceAnnotation(content, 'service.ts');

    expect(result).not.toBeNull();
    expect(result!.reviewer).toBe('👤');
    expect(result!.level).toBe(4);
    expect(result!.date).toBe('2026-03-12');
    expect(result!.line).toBe(2);
  });

  it('parses annotation inside JSDoc block (docblock style)', () => {
    const content = [
      '/**',
      ' * Module description',
      ' * @confidence 🤖3 2026-03-10',
      ' */',
      'export function foo() {}',
    ].join('\n');
    const result = parseConfidenceAnnotation(content, 'mod.ts');

    expect(result).not.toBeNull();
    expect(result!.level).toBe(3);
    expect(result!.date).toBe('2026-03-10');
  });

  it('parses docblock annotation with non-date trailing content', () => {
    const content = [
      '/**',
      ' * Module description',
      ' * @confidence 🤖3 - Unreviewed',
      ' */',
      'export function foo() {}',
    ].join('\n');
    const result = parseConfidenceAnnotation(content, 'mod.ts');

    expect(result).not.toBeNull();
    expect(result!.reviewer).toBe('🤖');
    expect(result!.level).toBe(3);
    expect(result!.date).toBe('- Unreviewed');
  });

  it('parses annotation with no trailing content', () => {
    const content = '// @confidence 🤖2\nconst x = 1;';
    const result = parseConfidenceAnnotation(content, 'test.ts');

    expect(result).not.toBeNull();
    expect(result!.reviewer).toBe('🤖');
    expect(result!.level).toBe(2);
    expect(result!.date).toBeUndefined();
  });

  it('returns null for no annotation', () => {
    const content = 'const x = 1;\nconst y = 2;\n';
    const result = parseConfidenceAnnotation(content, 'plain.ts');
    expect(result).toBeNull();
  });

  it('returns null when annotation is beyond line 20', () => {
    const lines = Array(20).fill('// comment line').concat([
      '// @confidence 🤖2 2026-03-11',
    ]);
    const content = lines.join('\n');
    const result = parseConfidenceAnnotation(content, 'deep.ts');
    expect(result).toBeNull();
  });

  it('parses annotation at exactly line 20', () => {
    const lines = Array(19).fill('// comment line').concat([
      '// @confidence 👤5 2026-03-11',
    ]);
    const content = lines.join('\n');
    const result = parseConfidenceAnnotation(content, 'edge.ts');

    expect(result).not.toBeNull();
    expect(result!.level).toBe(5);
    expect(result!.line).toBe(20);
  });

  it('ignores invalid level (0)', () => {
    const content = '// @confidence 🤖0 2026-03-11\n';
    const result = parseConfidenceAnnotation(content, 'bad.ts');
    expect(result).toBeNull();
  });

  it('ignores invalid level (6+)', () => {
    const content = '// @confidence 🤖6 2026-03-11\n';
    const result = parseConfidenceAnnotation(content, 'bad.ts');
    expect(result).toBeNull();
  });

  it('handles empty content', () => {
    const result = parseConfidenceAnnotation('', 'empty.ts');
    expect(result).toBeNull();
  });

  it('returns first annotation when multiple exist', () => {
    const content = [
      '// @confidence 🤖1 2026-03-10',
      '// @confidence 👤4 2026-03-11',
    ].join('\n');
    const result = parseConfidenceAnnotation(content, 'multi.ts');

    expect(result).not.toBeNull();
    expect(result!.level).toBe(1);
    expect(result!.reviewer).toBe('🤖');
  });

  it('parses all valid level/reviewer combinations', () => {
    const cases: Array<{ reviewer: string; level: number }> = [
      { reviewer: '🤖', level: 1 },
      { reviewer: '🤖', level: 2 },
      { reviewer: '🤖', level: 3 },
      { reviewer: '👤', level: 3 },
      { reviewer: '👤', level: 4 },
      { reviewer: '👤', level: 5 },
    ];

    for (const { reviewer, level } of cases) {
      const content = `// @confidence ${reviewer}${level} 2026-03-11\n`;
      const result = parseConfidenceAnnotation(content, 'test.ts');
      expect(result).not.toBeNull();
      expect(result!.reviewer).toBe(reviewer);
      expect(result!.level).toBe(level);
    }
  });
});

// ---------------------------------------------------------------------------
// formatConfidenceAnnotation
// ---------------------------------------------------------------------------

describe('formatConfidenceAnnotation', () => {
  it('formats AI annotation with no space between emoji and number', () => {
    const result = formatConfidenceAnnotation('🤖', 2, '2026-03-11');
    expect(result).toBe('// @confidence 🤖2 2026-03-11');
    // Verify no space between emoji and number
    expect(result).not.toMatch(/🤖\s\d/);
  });

  it('formats human annotation with no space between emoji and number', () => {
    const result = formatConfidenceAnnotation('👤', 4, '2026-03-11');
    expect(result).toBe('// @confidence 👤4 2026-03-11');
    expect(result).not.toMatch(/👤\s\d/);
  });

  it('formats all valid combinations', () => {
    const reviewers: ReviewerIcon[] = ['🤖', '👤'];
    const levels: ConfidenceLevel[] = [1, 2, 3, 4, 5];

    for (const reviewer of reviewers) {
      for (const level of levels) {
        const result = formatConfidenceAnnotation(reviewer, level, '2026-01-01');
        expect(result).toBe(`// @confidence ${reviewer}${level} 2026-01-01`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// insertConfidenceAnnotation
// ---------------------------------------------------------------------------

describe('insertConfidenceAnnotation', () => {
  const annotation = '// @confidence 👤4 2026-03-11';

  it('inserts at first line for empty file', () => {
    const result = insertConfidenceAnnotation('', annotation);
    expect(result).toBe(annotation);
  });

  it('inserts at first line when no JSDoc exists', () => {
    const content = 'const x = 1;\nconst y = 2;';
    const result = insertConfidenceAnnotation(content, annotation);
    const lines = result.split('\n');
    expect(lines[0]).toBe(annotation);
    expect(lines[1]).toBe('const x = 1;');
  });

  it('inserts after JSDoc block', () => {
    const content = [
      '/**',
      ' * Module doc',
      ' */',
      'const x = 1;',
    ].join('\n');
    const result = insertConfidenceAnnotation(content, annotation);
    const lines = result.split('\n');
    expect(lines[0]).toBe('/**');
    expect(lines[1]).toBe(' * Module doc');
    expect(lines[2]).toBe(' */');
    expect(lines[3]).toBe(annotation);
    expect(lines[4]).toBe('const x = 1;');
  });

  it('replaces existing annotation in-place', () => {
    const content = [
      '// @confidence 🤖2 2026-03-10',
      'const x = 1;',
    ].join('\n');
    const result = insertConfidenceAnnotation(content, annotation);
    const lines = result.split('\n');
    expect(lines[0]).toBe(annotation);
    expect(lines[1]).toBe('const x = 1;');
    expect(lines.length).toBe(2);
  });

  it('replaces existing annotation within JSDoc', () => {
    const content = [
      '/**',
      ' * Module',
      ' */',
      '// @confidence 🤖1 2026-01-01',
      'code here',
    ].join('\n');
    const result = insertConfidenceAnnotation(content, annotation);
    const lines = result.split('\n');
    expect(lines[3]).toBe(annotation);
    expect(lines.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// validateReviewerLevel
// ---------------------------------------------------------------------------

describe('validateReviewerLevel', () => {
  it('accepts AI levels 1-3', () => {
    expect(validateReviewerLevel('🤖', 1).valid).toBe(true);
    expect(validateReviewerLevel('🤖', 2).valid).toBe(true);
    expect(validateReviewerLevel('🤖', 3).valid).toBe(true);
  });

  it('rejects AI level 4-5', () => {
    expect(validateReviewerLevel('🤖', 4).valid).toBe(false);
    expect(validateReviewerLevel('🤖', 5).valid).toBe(false);
    expect(validateReviewerLevel('🤖', 4).message).toContain('1-3');
  });

  it('accepts Human levels 3-5', () => {
    expect(validateReviewerLevel('👤', 3).valid).toBe(true);
    expect(validateReviewerLevel('👤', 4).valid).toBe(true);
    expect(validateReviewerLevel('👤', 5).valid).toBe(true);
  });

  it('rejects Human levels 1-2', () => {
    expect(validateReviewerLevel('👤', 1).valid).toBe(false);
    expect(validateReviewerLevel('👤', 2).valid).toBe(false);
    expect(validateReviewerLevel('👤', 1).message).toContain('3-5');
  });
});

// ---------------------------------------------------------------------------
// mapReviewerArg
// ---------------------------------------------------------------------------

describe('mapReviewerArg', () => {
  it('maps "ai" to 🤖', () => {
    expect(mapReviewerArg('ai')).toBe('🤖');
  });

  it('maps "human" to 👤', () => {
    expect(mapReviewerArg('human')).toBe('👤');
  });

  it('is case-insensitive', () => {
    expect(mapReviewerArg('AI')).toBe('🤖');
    expect(mapReviewerArg('Human')).toBe('👤');
    expect(mapReviewerArg('HUMAN')).toBe('👤');
  });

  it('returns null for unknown arg', () => {
    expect(mapReviewerArg('bot')).toBeNull();
    expect(mapReviewerArg('')).toBeNull();
  });
});
