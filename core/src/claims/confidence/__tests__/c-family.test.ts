/**
 * Tests for the C-family confidence adapter (parse, format, insert).
 *
 * @validates {S003.§3.AC.01,.AC.02,.AC.03,.AC.04,.AC.05,.AC.06}
 * @validates {S003.§5.AC.02,.AC.04} side-effect freedom and date verbatim round-trip
 * @validates {DD016.§5.DC.19,.DC.20,.DC.21,.DC.22,.DC.23,.DC.24,.DC.25,.DC.26,.DC.27,.DC.28,.DC.29}
 * @validates {DD016.§9.DC.46,.DC.47}
 * @validates {R004.§7.AC.01,.AC.02} parse/format/insert legacy contract
 * @validates {R013.§1.AC.06} no-date format branch
 */

import { describe, it, expect } from 'vitest';
import { cFamilyAdapter } from '../adapters/c-family.js';
import type { ConfidenceLevel, ReviewerIcon, ConfidencePayload } from '../types.js';

// ---------------------------------------------------------------------------
// parse — preserves the legacy parseConfidenceAnnotation describe block
// (verbatim assertions; calls cFamilyAdapter.parse instead of legacy fn)
// ---------------------------------------------------------------------------

describe('cFamilyAdapter.parse', () => {
  it('parses AI annotation at line 1', () => {
    const content = '// @confidence 🤖2 2026-03-11\nconst x = 1;';
    const result = cFamilyAdapter.parse(content, 'test.ts');

    expect(result).not.toBeNull();
    expect(result!.reviewer).toBe('🤖');
    expect(result!.level).toBe(2);
    expect(result!.date).toBe('2026-03-11');
    expect(result!.line).toBe(1);
    expect(result!.filePath).toBe('test.ts');
  });

  it('parses human annotation', () => {
    const content = '// some header\n// @confidence 👤4 2026-03-12\ncode here';
    const result = cFamilyAdapter.parse(content, 'service.ts');

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
    const result = cFamilyAdapter.parse(content, 'mod.ts');

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
    const result = cFamilyAdapter.parse(content, 'mod.ts');

    expect(result).not.toBeNull();
    expect(result!.reviewer).toBe('🤖');
    expect(result!.level).toBe(3);
    expect(result!.date).toBe('- Unreviewed');
  });

  it('parses annotation with no trailing content', () => {
    const content = '// @confidence 🤖2\nconst x = 1;';
    const result = cFamilyAdapter.parse(content, 'test.ts');

    expect(result).not.toBeNull();
    expect(result!.reviewer).toBe('🤖');
    expect(result!.level).toBe(2);
    expect(result!.date).toBeUndefined();
  });

  it('returns null for no annotation', () => {
    const content = 'const x = 1;\nconst y = 2;\n';
    const result = cFamilyAdapter.parse(content, 'plain.ts');
    expect(result).toBeNull();
  });

  it('returns null when annotation is beyond line 20', () => {
    const lines = Array(20).fill('// comment line').concat([
      '// @confidence 🤖2 2026-03-11',
    ]);
    const content = lines.join('\n');
    const result = cFamilyAdapter.parse(content, 'deep.ts');
    expect(result).toBeNull();
  });

  it('parses annotation at exactly line 20', () => {
    const lines = Array(19).fill('// comment line').concat([
      '// @confidence 👤5 2026-03-11',
    ]);
    const content = lines.join('\n');
    const result = cFamilyAdapter.parse(content, 'edge.ts');

    expect(result).not.toBeNull();
    expect(result!.level).toBe(5);
    expect(result!.line).toBe(20);
  });

  it('ignores invalid level (0)', () => {
    const content = '// @confidence 🤖0 2026-03-11\n';
    const result = cFamilyAdapter.parse(content, 'bad.ts');
    expect(result).toBeNull();
  });

  it('ignores invalid level (6+)', () => {
    const content = '// @confidence 🤖6 2026-03-11\n';
    const result = cFamilyAdapter.parse(content, 'bad.ts');
    expect(result).toBeNull();
  });

  it('handles empty content', () => {
    const result = cFamilyAdapter.parse('', 'empty.ts');
    expect(result).toBeNull();
  });

  it('returns first annotation when multiple exist', () => {
    const content = [
      '// @confidence 🤖1 2026-03-10',
      '// @confidence 👤4 2026-03-11',
    ].join('\n');
    const result = cFamilyAdapter.parse(content, 'multi.ts');

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
      const result = cFamilyAdapter.parse(content, 'test.ts');
      expect(result).not.toBeNull();
      expect(result!.reviewer).toBe(reviewer);
      expect(result!.level).toBe(level);
    }
  });

  // DC.47 — legacy after-JSDoc-closer placement still parses
  it('S003.§3.AC.06 / DC.47: parses legacy after-JSDoc-closer placement', () => {
    const content = [
      '/**',
      ' * Module doc',
      ' */',
      '// @confidence 🤖2 2026-03-11',
      'const x = 1;',
    ].join('\n');
    const result = cFamilyAdapter.parse(content, 'legacy.ts');
    expect(result).not.toBeNull();
    expect(result!.level).toBe(2);
    expect(result!.line).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// format — dated branch verbatim from legacy + new no-date branch (DC.22)
// ---------------------------------------------------------------------------

describe('cFamilyAdapter.format', () => {
  it('formats AI annotation with no space between emoji and number', () => {
    const result = cFamilyAdapter.format('🤖', 2, '2026-03-11');
    expect(result).toBe('// @confidence 🤖2 2026-03-11');
    expect(result).not.toMatch(/🤖\s\d/);
  });

  it('formats human annotation with no space between emoji and number', () => {
    const result = cFamilyAdapter.format('👤', 4, '2026-03-11');
    expect(result).toBe('// @confidence 👤4 2026-03-11');
    expect(result).not.toMatch(/👤\s\d/);
  });

  it('formats all valid combinations', () => {
    const reviewers: ReviewerIcon[] = ['🤖', '👤'];
    const levels: ConfidenceLevel[] = [1, 2, 3, 4, 5];

    for (const reviewer of reviewers) {
      for (const level of levels) {
        const result = cFamilyAdapter.format(reviewer, level, '2026-01-01');
        expect(result).toBe(`// @confidence ${reviewer}${level} 2026-01-01`);
      }
    }
  });

  // DC.22 / S003.§3.AC.03 second sentence
  it('S003.§3.AC.03: format omits date and trailing space when date is undefined', () => {
    expect(cFamilyAdapter.format('🤖', 2)).toBe('// @confidence 🤖2');
    expect(cFamilyAdapter.format('🤖', 2, undefined)).toBe('// @confidence 🤖2');
    expect(cFamilyAdapter.format('👤', 4)).toBe('// @confidence 👤4');
  });
});

// ---------------------------------------------------------------------------
// insert — three-branch logic per S003.§3.AC.05 / DD016.§5.DC.23-DC.27
// ---------------------------------------------------------------------------

describe('cFamilyAdapter.insert', () => {
  const payload: ConfidencePayload = {
    reviewer: '👤',
    level: 4,
    date: '2026-03-11',
  };
  const annotation = '// @confidence 👤4 2026-03-11';

  it('inserts at first line for empty file', () => {
    const result = cFamilyAdapter.insert('', payload);
    expect(result).toBe(annotation);
  });

  it('S003.§3.AC.05(c): inserts as first line when no JSDoc and no //-stack', () => {
    const content = 'const x = 1;\nconst y = 2;';
    const result = cFamilyAdapter.insert(content, payload);
    const lines = result.split('\n');
    expect(lines[0]).toBe(annotation);
    expect(lines[1]).toBe('const x = 1;');
    expect(lines[2]).toBe('const y = 2;');
  });

  // DC.46 first test — replaces the legacy 'inserts after JSDoc block' (line 215)
  it('S003.§3.AC.05(a): inserts inside JSDoc block before the closer', () => {
    const content = [
      '/**',
      ' * Module doc',
      ' */',
      'const x = 1;',
    ].join('\n');
    const result = cFamilyAdapter.insert(content, payload);
    const lines = result.split('\n');
    expect(lines[0]).toBe('/**');
    expect(lines[1]).toBe(' * Module doc');
    expect(lines[2]).toBe(' * @confidence 👤4 2026-03-11');
    expect(lines[3]).toBe(' */');
    expect(lines[4]).toBe('const x = 1;');
  });

  // DC.46 second test — branch (b) contiguous stack
  it('S003.§3.AC.05(b): inserts at end of leading line-comment stack', () => {
    const content = '// header line 1\n// header line 2\nconst x = 1;';
    const result = cFamilyAdapter.insert(content, payload);
    const lines = result.split('\n');
    expect(lines[0]).toBe('// header line 1');
    expect(lines[1]).toBe('// header line 2');
    expect(lines[2]).toBe(annotation);
    expect(lines[3]).toBe('const x = 1;');
  });

  // TS001 §3.AC.02 spec-faithful regression test (per the team-lead corrigendum)
  it('S003.§3.AC.05(b): length-1 leading //-stack inserts at index 1', () => {
    // Per S003.§3.AC.05(b) "one or more leading lines" predicate — branch (b)
    // fires for a length-1 leading // block, even if subsequent non-// lines
    // appear later. Annotation lands at index 1 (after the single leading //).
    const content = '// header\n\n// later\nconst x = 1;';
    const result = cFamilyAdapter.insert(content, payload);
    const lines = result.split('\n');
    expect(lines[0]).toBe('// header');
    expect(lines[1]).toBe(annotation);
    expect(lines[2]).toBe('');
    expect(lines[3]).toBe('// later');
    expect(lines[4]).toBe('const x = 1;');
  });

  it('S003.§3.AC.04: replaces existing line-comment annotation in-place', () => {
    const content = '// @confidence 🤖1 2026-01-01\nconst x = 1;';
    const result = cFamilyAdapter.insert(content, payload);
    const lines = result.split('\n');
    expect(lines[0]).toBe(annotation);
    expect(lines[1]).toBe('const x = 1;');
  });

  it('S003.§3.AC.04: replaces existing JSDoc-internal annotation in-place preserving asterisk indent', () => {
    const content = [
      '/**',
      ' * Module doc',
      ' * @confidence 🤖1 2026-01-01',
      ' */',
      'const x = 1;',
    ].join('\n');
    const result = cFamilyAdapter.insert(content, payload);
    const lines = result.split('\n');
    expect(lines[0]).toBe('/**');
    expect(lines[1]).toBe(' * Module doc');
    expect(lines[2]).toBe(' * @confidence 👤4 2026-03-11');
    expect(lines[3]).toBe(' */');
    expect(lines[4]).toBe('const x = 1;');
  });

  it('S003.§1.AC.07: insert is idempotent per branch', () => {
    const cases: Array<{ name: string; content: string }> = [
      {
        name: 'jsdoc',
        content: ['/**', ' * Module doc', ' */', 'const x = 1;'].join('\n'),
      },
      {
        name: 'comment-stack',
        content: '// header\n// other\nconst x = 1;',
      },
      {
        name: 'bare',
        content: 'const x = 1;\nconst y = 2;',
      },
    ];

    for (const { content } of cases) {
      const once = cFamilyAdapter.insert(content, payload);
      const twice = cFamilyAdapter.insert(once, payload);
      expect(twice).toBe(once);
    }
  });

  // DC.20 / S003.§3.AC.02 — first 20 lines only
  it('S003.§3.AC.02: ignores JSDoc closer deeper than first 20 lines', () => {
    // 20 const lines, then a JSDoc spanning lines 20-25.
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) lines.push(`const x${i} = ${i};`);
    lines.push('/**', ' * Function doc', ' */');
    lines.push('function foo() {}');
    const content = lines.join('\n');
    const result = cFamilyAdapter.insert(content, payload);
    const out = result.split('\n');
    // Branch (a) does NOT trigger (no /** in first 20 lines).
    // No leading //-stack at line 0 (first line is `const x0 = 0;`).
    // Falls to branch (c): annotation at index 0.
    expect(out[0]).toBe(annotation);
    expect(out[1]).toBe('const x0 = 0;');
  });

  it('S003.§3.AC.05: file with /** in first 20 lines but closer past 20 falls to branch (c)', () => {
    // /** at line 0; const x_i for i in 1..20 (20 lines); closer at line 21+.
    const lines: string[] = ['/**'];
    for (let i = 0; i < 20; i++) lines.push(`const x${i} = ${i};`);
    lines.push(' */');
    const content = lines.join('\n');
    const result = cFamilyAdapter.insert(content, payload);
    const out = result.split('\n');
    // Branch (a) needs BOTH /** and closer in first 20 lines. Closer is past 20.
    // No leading //-stack (line 0 is /**).
    // Falls to branch (c): annotation at index 0.
    expect(out[0]).toBe(annotation);
    expect(out[1]).toBe('/**');
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting invariants per S003.§5 / TS001 §10
// ---------------------------------------------------------------------------

describe('S003.§5: c-family cross-cutting invariants', () => {
  // §5.AC.02 — date verbatim round-trip
  it('S003.§5.AC.02: date round-trips byte-identically', () => {
    const dates = ['2024-12-31', '2026-05-05', '1970-01-01', '2099-01-01'];
    for (const date of dates) {
      const inserted = cFamilyAdapter.insert('const x = 1;\n', {
        reviewer: '🤖',
        level: 2,
        date,
      });
      const parsed = cFamilyAdapter.parse(inserted, 'a.ts');
      expect(parsed!.date).toBe(date);
    }
  });

  // §5.AC.04 — adapters do not validate
  it('S003.§5.AC.04: format does not validate reviewer/level combination', () => {
    // AI level 4 is invalid at the command layer (validateReviewerLevel),
    // but the adapter accepts it and returns the formatted string.
    expect(() => cFamilyAdapter.format('🤖', 4 as ConfidenceLevel, '2026-05-05')).not.toThrow();
    expect(cFamilyAdapter.format('🤖', 4 as ConfidenceLevel, '2026-05-05')).toBe(
      '// @confidence 🤖4 2026-05-05',
    );
  });

  // §5.AC.04 — side-effect freedom (string immutability + no throws on absent)
  it('S003.§5.AC.04: parse and insert do not throw on representative inputs', () => {
    const inputs = [
      '',
      'no annotation here',
      'const x = 1;\n// not a confidence line\n',
      '// @confidence',
      '// @confidence garbage',
      '/**\n */\nfn() {}',
    ];
    for (const c of inputs) {
      expect(() => cFamilyAdapter.parse(c, 'x.ts')).not.toThrow();
      expect(() =>
        cFamilyAdapter.insert(c, { reviewer: '🤖', level: 2, date: '2026-05-05' }),
      ).not.toThrow();
    }
  });
});
