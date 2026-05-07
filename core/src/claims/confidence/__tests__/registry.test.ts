/**
 * Tests for the confidence adapter registry.
 *
 * @validates {S003.§1.AC.03,.AC.04,.AC.05,.AC.06,.AC.07}
 * @validates {S003.§2.AC.01,.AC.02,.AC.03,.AC.04}
 * @validates {DD016.§4.DC.14,.DC.15,.DC.16,.DC.17}
 * @validates {DD016.§9.DC.49}
 */

import { describe, it, expect } from 'vitest';
import { getAdapter, __ADAPTERS_FOR_TEST } from '../registry.js';
import { cFamilyAdapter } from '../adapters/c-family.js';
import { markdownFrontmatterAdapter } from '../adapters/markdown-frontmatter.js';
import type { ConfidencePayload } from '../types.js';

describe('S003.§2.AC.05: registration order is [markdown-frontmatter, c-family]', () => {
  it('exposes adapters in literal order via test-only export', () => {
    expect(__ADAPTERS_FOR_TEST.map((a) => a.id)).toEqual([
      'markdown-frontmatter',
      'c-family-comments',
    ]);
  });
});

describe('S003.§2.AC.03: getAdapter lookup coverage', () => {
  it('returns c-family for .ts', () => {
    expect(getAdapter('foo.ts')?.id).toBe('c-family-comments');
  });

  it('returns markdown-frontmatter for .md', () => {
    expect(getAdapter('foo.md')?.id).toBe('markdown-frontmatter');
  });

  it('returns null for .unknown', () => {
    expect(getAdapter('foo.unknown')).toBeNull();
  });

  it('returns null for .txt', () => {
    expect(getAdapter('foo.txt')).toBeNull();
  });

  it('returns null for .json', () => {
    expect(getAdapter('foo.json')).toBeNull();
  });

  it('returns null for .py', () => {
    expect(getAdapter('foo.py')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getAdapter('')).toBeNull();
  });

  it('returns null for path with no extension', () => {
    expect(getAdapter('path/with/no/extension')).toBeNull();
  });
});

describe('S003.§2.AC.04: getAdapter is pure', () => {
  it('returns the same adapter instance for the same path', () => {
    expect(getAdapter('foo.ts')).toBe(getAdapter('foo.ts'));
    expect(getAdapter('foo.md')).toBe(getAdapter('foo.md'));
  });
});

describe('S003.§1.AC.03: matches purity per built-in adapter', () => {
  it('c-family matches .ts/.tsx/.js/.jsx/.css and rejects others', () => {
    expect(cFamilyAdapter.matches('a.ts')).toBe(true);
    expect(cFamilyAdapter.matches('a.tsx')).toBe(true);
    expect(cFamilyAdapter.matches('a.js')).toBe(true);
    expect(cFamilyAdapter.matches('a.jsx')).toBe(true);
    expect(cFamilyAdapter.matches('a.css')).toBe(true);
    expect(cFamilyAdapter.matches('a.md')).toBe(false);
    expect(cFamilyAdapter.matches('a.txt')).toBe(false);
    expect(cFamilyAdapter.matches('a.py')).toBe(false);
    expect(cFamilyAdapter.matches('a.json')).toBe(false);
  });

  it('markdown-frontmatter matches .md only (case-insensitive)', () => {
    expect(markdownFrontmatterAdapter.matches('a.md')).toBe(true);
    expect(markdownFrontmatterAdapter.matches('a.MD')).toBe(true);
    expect(markdownFrontmatterAdapter.matches('a.ts')).toBe(false);
    expect(markdownFrontmatterAdapter.matches('a.txt')).toBe(false);
    expect(markdownFrontmatterAdapter.matches('a.markdown')).toBe(false);
  });

  it('matches is repeatable (same input → same result)', () => {
    expect(cFamilyAdapter.matches('foo.ts')).toBe(cFamilyAdapter.matches('foo.ts'));
    expect(markdownFrontmatterAdapter.matches('foo.md')).toBe(
      markdownFrontmatterAdapter.matches('foo.md'),
    );
  });
});

describe('S003.§1.AC.04: parse returns null on absent annotation', () => {
  it('c-family: empty content', () => {
    expect(cFamilyAdapter.parse('', 'a.ts')).toBeNull();
  });

  it('c-family: content without @confidence', () => {
    expect(cFamilyAdapter.parse('const x = 1;\n', 'a.ts')).toBeNull();
  });

  it('c-family: never throws on malformed content', () => {
    expect(() => cFamilyAdapter.parse('!@#$%^', 'a.ts')).not.toThrow();
  });

  it('markdown-frontmatter: empty content', () => {
    expect(markdownFrontmatterAdapter.parse('', 'a.md')).toBeNull();
  });

  it('markdown-frontmatter: no frontmatter', () => {
    expect(markdownFrontmatterAdapter.parse('# Title\n\nbody', 'a.md')).toBeNull();
  });

  it('markdown-frontmatter: frontmatter without confidence key', () => {
    const content = '---\ncreated: 2026-05-05\n---\n\nbody';
    expect(markdownFrontmatterAdapter.parse(content, 'a.md')).toBeNull();
  });
});

describe('S003.§1.AC.05: round-trip per built-in adapter', () => {
  const payloads: readonly ConfidencePayload[] = [
    { reviewer: '🤖', level: 1, date: '2026-01-01' },
    { reviewer: '🤖', level: 3, date: '2026-05-05' },
    { reviewer: '👤', level: 3, date: '2026-05-05' },
    { reviewer: '👤', level: 5, date: '2026-12-31' },
    { reviewer: '🤖', level: 2 }, // undefined date
  ];

  for (const p of payloads) {
    it(`c-family: round-trip ${p.reviewer}${p.level}${p.date ? ' ' + p.date : ''}`, () => {
      const inserted = cFamilyAdapter.insert('const x = 1;\n', p);
      const parsed = cFamilyAdapter.parse(inserted, 'a.ts');
      expect(parsed).not.toBeNull();
      expect(parsed!.reviewer).toBe(p.reviewer);
      expect(parsed!.level).toBe(p.level);
      expect(parsed!.date).toBe(p.date);
    });

    it(`markdown-frontmatter: round-trip ${p.reviewer}${p.level}${p.date ? ' ' + p.date : ''}`, () => {
      const inserted = markdownFrontmatterAdapter.insert('# Title\n\nbody\n', p);
      const parsed = markdownFrontmatterAdapter.parse(inserted, 'a.md');
      expect(parsed).not.toBeNull();
      expect(parsed!.reviewer).toBe(p.reviewer);
      expect(parsed!.level).toBe(p.level);
      expect(parsed!.date).toBe(p.date);
    });
  }
});

describe('S003.§1.AC.06: insert preserves non-annotation content', () => {
  it('c-family: bare file content is preserved at the bottom', () => {
    const original = 'const x = 1;\nconst y = 2;\n';
    const result = cFamilyAdapter.insert(original, {
      reviewer: '🤖',
      level: 2,
      date: '2026-05-05',
    });
    expect(result).toContain('const x = 1;');
    expect(result).toContain('const y = 2;');
  });

  it('markdown-frontmatter: existing keys preserved', () => {
    const original = '---\ncreated: 2026-05-05\ntags: foo\n---\n\nbody\n';
    const result = markdownFrontmatterAdapter.insert(original, {
      reviewer: '🤖',
      level: 2,
      date: '2026-05-05',
    });
    expect(result).toContain('created: 2026-05-05');
    expect(result).toContain('tags: foo');
    expect(result).toContain('body');
  });
});
