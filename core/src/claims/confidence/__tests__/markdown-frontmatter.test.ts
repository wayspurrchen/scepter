/**
 * Tests for the markdown-frontmatter confidence adapter.
 *
 * @validates {S003.§4.AC.01,.AC.02,.AC.03,.AC.04,.AC.05,.AC.06,.AC.07,.AC.08}
 * @validates {S003.§5.AC.02,.AC.04} cross-cutting invariants
 * @validates {DD016.§6.DC.30,.DC.31,.DC.32,.DC.33,.DC.34,.DC.35,.DC.36,.DC.37,.DC.38,.DC.39,.DC.40}
 * @validates {DD016.§9.DC.48}
 * @validates {R013.§1.AC.06} no-date format branch in markdown projection
 */

import { describe, it, expect } from 'vitest';
import matter from 'gray-matter';
import { markdownFrontmatterAdapter } from '../adapters/markdown-frontmatter.js';
import type { ConfidencePayload, ConfidenceLevel } from '../types.js';

const payload: ConfidencePayload = {
  reviewer: '👤',
  level: 4,
  date: '2026-03-11',
};

describe('markdownFrontmatterAdapter.matches', () => {
  it('S003.§4.AC.01: matches .md (case-insensitive)', () => {
    expect(markdownFrontmatterAdapter.matches('a.md')).toBe(true);
    expect(markdownFrontmatterAdapter.matches('a.MD')).toBe(true);
    expect(markdownFrontmatterAdapter.matches('path/to/note.md')).toBe(true);
  });

  it('S003.§4.AC.01: rejects non-.md extensions', () => {
    expect(markdownFrontmatterAdapter.matches('a.markdown')).toBe(false);
    expect(markdownFrontmatterAdapter.matches('a.mdown')).toBe(false);
    expect(markdownFrontmatterAdapter.matches('a.mkd')).toBe(false);
    expect(markdownFrontmatterAdapter.matches('a.ts')).toBe(false);
    expect(markdownFrontmatterAdapter.matches('a.txt')).toBe(false);
    expect(markdownFrontmatterAdapter.matches('')).toBe(false);
  });
});

describe('markdownFrontmatterAdapter.parse', () => {
  it('returns null on empty content', () => {
    expect(markdownFrontmatterAdapter.parse('', 'a.md')).toBeNull();
  });

  it('returns null on .md with no frontmatter', () => {
    expect(markdownFrontmatterAdapter.parse('# Title\n\nbody', 'a.md')).toBeNull();
  });

  it('returns null on frontmatter with no confidence key', () => {
    const content = '---\ncreated: 2026-05-05\ntags: [foo]\n---\n\nbody';
    expect(markdownFrontmatterAdapter.parse(content, 'a.md')).toBeNull();
  });

  // S003.§4.AC.02 — non-string confidence values
  it('S003.§4.AC.02: parse rejects confidence: <number>', () => {
    const content = '---\nconfidence: 4\n---\n\nbody';
    expect(markdownFrontmatterAdapter.parse(content, 'a.md')).toBeNull();
  });

  it('S003.§4.AC.02: parse rejects confidence: <object>', () => {
    const content = '---\nconfidence:\n  reviewer: ai\n  level: 2\n---\n\nbody';
    expect(markdownFrontmatterAdapter.parse(content, 'a.md')).toBeNull();
  });

  it('S003.§4.AC.02: parse rejects confidence: <array>', () => {
    const content = '---\nconfidence:\n  - foo\n  - bar\n---\n\nbody';
    expect(markdownFrontmatterAdapter.parse(content, 'a.md')).toBeNull();
  });

  it('S003.§4.AC.02: parse rejects confidence: <boolean>', () => {
    const content = '---\nconfidence: true\n---\n\nbody';
    expect(markdownFrontmatterAdapter.parse(content, 'a.md')).toBeNull();
  });

  // S003.§4.AC.02 — payload regex rejection
  it('S003.§4.AC.02: parse rejects malformed string (non-emoji prefix)', () => {
    const content = '---\nconfidence: "X2 2026-05-05"\n---\n\nbody';
    expect(markdownFrontmatterAdapter.parse(content, 'a.md')).toBeNull();
  });

  it('S003.§4.AC.02: parse rejects malformed string (missing level digit)', () => {
    const content = '---\nconfidence: "🤖 2026-05-05"\n---\n\nbody';
    expect(markdownFrontmatterAdapter.parse(content, 'a.md')).toBeNull();
  });

  it('S003.§4.AC.02: parse rejects malformed string (multi-digit level)', () => {
    const content = '---\nconfidence: "🤖22 2026-05-05"\n---\n\nbody';
    expect(markdownFrontmatterAdapter.parse(content, 'a.md')).toBeNull();
  });

  it('S003.§4.AC.02: parse rejects out-of-range level digit', () => {
    const content = '---\nconfidence: "🤖0 2026-05-05"\n---\n\nbody';
    expect(markdownFrontmatterAdapter.parse(content, 'a.md')).toBeNull();
  });

  it('S003.§4.AC.02: payload regex permits non-ISO trailing date capture (validation deferred to command layer)', () => {
    const content = '---\nconfidence: "🤖2 not-a-date"\n---\n\nbody';
    const result = markdownFrontmatterAdapter.parse(content, 'a.md');
    expect(result).not.toBeNull();
    expect(result!.date).toBe('not-a-date');
  });

  it('S003.§4.AC.03: parse returns ConfidenceAnnotation with payload + line', () => {
    const content = '---\ncreated: 2026-05-05\nconfidence: "🤖2 2026-05-05"\n---\n\nbody';
    const result = markdownFrontmatterAdapter.parse(content, 'a.md');
    expect(result).not.toBeNull();
    expect(result!.reviewer).toBe('🤖');
    expect(result!.level).toBe(2);
    expect(result!.date).toBe('2026-05-05');
    expect(result!.line).toBe(3); // confidence is at line 3 (1-indexed)
    expect(result!.filePath).toBe('a.md');
  });

  // DC.32 / DC.33 — line number for various positions
  it('DC.33: line number when confidence is the first frontmatter key', () => {
    const content = '---\nconfidence: "🤖2 2026-05-05"\ntags: [foo]\n---\n\nbody';
    const result = markdownFrontmatterAdapter.parse(content, 'a.md');
    expect(result!.line).toBe(2);
  });

  it('DC.33: line number when confidence is the last frontmatter key', () => {
    const content = '---\ntags: [foo]\ncreated: 2026-05-05\nconfidence: "🤖2 2026-05-05"\n---\n\nbody';
    const result = markdownFrontmatterAdapter.parse(content, 'a.md');
    expect(result!.line).toBe(4);
  });

  it('DC.33: parse without no-date date field returns date undefined', () => {
    const content = '---\nconfidence: "🤖2"\n---\n\nbody';
    const result = markdownFrontmatterAdapter.parse(content, 'a.md');
    expect(result).not.toBeNull();
    expect(result!.date).toBeUndefined();
  });

  // S003 Edge case 2: parse swallows malformed YAML
  it('S003 Edge case 2: parse on malformed YAML returns null without throwing', () => {
    const malformed = '---\nunclosed: "quote\n---\nbody';
    let result: ReturnType<typeof markdownFrontmatterAdapter.parse> = null;
    expect(() => {
      result = markdownFrontmatterAdapter.parse(malformed, 'bad.md');
    }).not.toThrow();
    expect(result).toBeNull();
  });
});

describe('markdownFrontmatterAdapter.format', () => {
  it('S003.§4.AC.04: format produces bare payload value with date', () => {
    expect(markdownFrontmatterAdapter.format('🤖', 2, '2026-05-05')).toBe('🤖2 2026-05-05');
    expect(markdownFrontmatterAdapter.format('👤', 4, '2026-03-11')).toBe('👤4 2026-03-11');
  });

  it('S003.§4.AC.04: format omits date and trailing space when undefined', () => {
    expect(markdownFrontmatterAdapter.format('🤖', 2)).toBe('🤖2');
    expect(markdownFrontmatterAdapter.format('🤖', 2, undefined)).toBe('🤖2');
    expect(markdownFrontmatterAdapter.format('👤', 4)).toBe('👤4');
  });

  it('S003.§4.AC.04: format does not pre-quote', () => {
    const result = markdownFrontmatterAdapter.format('🤖', 2, '2026-05-05');
    expect(result.startsWith('"')).toBe(false);
    expect(result.endsWith('"')).toBe(false);
  });
});

describe('markdownFrontmatterAdapter.insert', () => {
  // S003.§4.AC.05 — case (1) no frontmatter
  it('S003.§4.AC.05: insert creates frontmatter when absent', () => {
    const content = '# R042 - Foo\n\nbody text\n';
    const result = markdownFrontmatterAdapter.insert(content, payload);
    // Re-parse to confirm round-trip closure
    const parsed = markdownFrontmatterAdapter.parse(result, 'r.md');
    expect(parsed).not.toBeNull();
    expect(parsed!.reviewer).toBe('👤');
    expect(parsed!.level).toBe(4);
    expect(parsed!.date).toBe('2026-03-11');
    // Body is preserved
    expect(result).toContain('# R042 - Foo');
    expect(result).toContain('body text');
  });

  // S003.§4.AC.06 — case (2) frontmatter without key
  it('S003.§4.AC.06: insert adds confidence key when frontmatter exists without it', () => {
    const content = '---\ncreated: 2026-05-05\ntags: [foo]\n---\n\n# R042\n';
    const result = markdownFrontmatterAdapter.insert(content, payload);
    const parsedYaml = matter(result);
    expect(parsedYaml.data.confidence).toBe('👤4 2026-03-11');
    expect(parsedYaml.data.created).toBeDefined();
    expect(parsedYaml.data.tags).toEqual(['foo']);
    expect(parsedYaml.content.trim()).toBe('# R042');
  });

  // S003.§4.AC.07 — case (3) frontmatter with key
  it('S003.§4.AC.07: insert replaces existing confidence value preserving siblings', () => {
    const content =
      '---\ncreated: 2026-05-05\nconfidence: "🤖2 2026-05-05"\ntags: [foo]\n---\n\nbody\n';
    const result = markdownFrontmatterAdapter.insert(content, payload);
    const parsedYaml = matter(result);
    expect(parsedYaml.data.confidence).toBe('👤4 2026-03-11');
    expect(parsedYaml.data.created).toBeDefined();
    expect(parsedYaml.data.tags).toEqual(['foo']);
    expect(parsedYaml.content.trim()).toBe('body');
  });

  // S003.§4.AC.08 — idempotence modulo trailing newline
  it('S003.§4.AC.08: insert is idempotent modulo trailing newline (no frontmatter)', () => {
    const content = '# Title\n\nbody\n';
    const once = markdownFrontmatterAdapter.insert(content, payload);
    const twice = markdownFrontmatterAdapter.insert(once, payload);
    // Tolerate at most one trailing newline difference per DC.38
    expect(twice.replace(/\n+$/, '\n')).toBe(once.replace(/\n+$/, '\n'));
  });

  it('S003.§4.AC.08: insert is idempotent modulo trailing newline (frontmatter without key)', () => {
    const content = '---\ncreated: 2026-05-05\n---\n\nbody\n';
    const once = markdownFrontmatterAdapter.insert(content, payload);
    const twice = markdownFrontmatterAdapter.insert(once, payload);
    expect(twice.replace(/\n+$/, '\n')).toBe(once.replace(/\n+$/, '\n'));
  });

  it('S003.§4.AC.08: insert is idempotent modulo trailing newline (frontmatter with key)', () => {
    const content = '---\nconfidence: "🤖2 2026-05-05"\n---\n\nbody\n';
    const once = markdownFrontmatterAdapter.insert(content, payload);
    const twice = markdownFrontmatterAdapter.insert(once, payload);
    expect(twice.replace(/\n+$/, '\n')).toBe(once.replace(/\n+$/, '\n'));
  });

  // S003 Edge case 2 — insert propagates gray-matter throws.
  // gray-matter caches its rejection of any particular malformed input
  // within a single test module, so the input here MUST be unique and
  // not used by any earlier test in this file (otherwise the second
  // matter() call returns the cached "no frontmatter" result instead of
  // throwing). The duplicate-mapping-key shape below reliably throws on
  // first-encounter inputs through js-yaml.
  it('S003 Edge case 2: insert propagates gray-matter throws on malformed YAML', () => {
    const malformed =
      '---\nedge_case_2_unique_key: 1\nedge_case_2_unique_key: 2\n---\nbody';
    expect(() => markdownFrontmatterAdapter.insert(malformed, payload)).toThrow();
  });
});

describe('S003.§5: markdown-frontmatter cross-cutting invariants', () => {
  it('S003.§5.AC.02: date round-trips byte-identically', () => {
    const dates = ['2024-12-31', '2026-05-05', '1970-01-01', '2099-01-01'];
    for (const date of dates) {
      const inserted = markdownFrontmatterAdapter.insert('# Title\n\nbody\n', {
        reviewer: '🤖',
        level: 2,
        date,
      });
      const parsed = markdownFrontmatterAdapter.parse(inserted, 'a.md');
      expect(parsed!.date).toBe(date);
    }
  });

  it('S003.§5.AC.04: format does not validate reviewer/level combination', () => {
    expect(() =>
      markdownFrontmatterAdapter.format('🤖', 4 as ConfidenceLevel, '2026-05-05'),
    ).not.toThrow();
  });

  it('S003.§5.AC.04: parse does not throw on representative bad inputs', () => {
    const inputs = [
      '',
      'no frontmatter at all',
      '---\n---\n',
      '---\nconfidence: 4\n---\n',
      '---\nconfidence:\n  nested: yes\n---\n',
    ];
    for (const c of inputs) {
      expect(() => markdownFrontmatterAdapter.parse(c, 'x.md')).not.toThrow();
    }
  });
});
