/**
 * Tests for the frontmatter scanner adapter.
 *
 * @validates {R015.§3.AC.09} frontmatter list-field entries (bare-ID and claim-level)
 * @validates {R015.§3.AC.10} frontmatter `id` field for the renamed note's own file
 * @validates {DD020.§2.DC.11} frontmatter-list surface
 * @validates {DD020.§2.DC.12} frontmatter-id only emitted for renamed note's own file
 */

import { describe, it, expect } from 'vitest';
import { scanFrontmatter } from './frontmatter-scanner';
import { applyActionsToContent } from '../rewriter';

const FILE = '/proj/note.md';

const withFrontmatter = (yaml: string, body: string = '# Body'): string =>
  `---\n${yaml}\n---\n${body}\n`;

describe('scanFrontmatter — list-field entries (block form)', () => {
  it('emits frontmatter-list spans for entries under derives:', () => {
    const content = withFrontmatter(
      [
        'derives:',
        '  - R005.§1.AC.03',
        '  - R007',
      ].join('\n'),
    );
    const spans = scanFrontmatter(FILE, content);
    expect(spans).toHaveLength(2);
    expect(spans[0].surface).toBe('frontmatter-list');
    expect(spans[0].parsedAddress.noteId).toBe('R005');
    expect(spans[1].parsedAddress.noteId).toBe('R007');
  });

  it('emits spans for entries under supersedes:', () => {
    const content = withFrontmatter(
      ['supersedes:', '  - R007.§2.AC.05'].join('\n'),
    );
    const spans = scanFrontmatter(FILE, content);
    expect(spans).toHaveLength(1);
    expect(spans[0].parsedAddress.noteId).toBe('R007');
  });

  it('handles single-quoted list entries', () => {
    const content = withFrontmatter(
      ['derives:', "  - 'R005.§1.AC.03'"].join('\n'),
    );
    const spans = scanFrontmatter(FILE, content);
    expect(spans).toHaveLength(1);
    expect(spans[0].parsedAddress.noteId).toBe('R005');
    const [s, e] = spans[0].noteIdRange;
    expect(content.slice(s, e)).toBe('R005');
  });

  it('only scans within the frontmatter range (skips body)', () => {
    const content = withFrontmatter(
      'derives:\n  - R005',
      '# Body\n\nSee {R007.§1.AC.01} in prose (not frontmatter).\n',
    );
    const spans = scanFrontmatter(FILE, content);
    // Only R005 from frontmatter — body refs are caught by markdown-body scanner.
    expect(spans).toHaveLength(1);
    expect(spans[0].parsedAddress.noteId).toBe('R005');
  });

  it('closes the active list at the next top-level key', () => {
    const content = withFrontmatter(
      [
        'derives:',
        '  - R005',
        'tags:',
        '  - foo',
      ].join('\n'),
    );
    const spans = scanFrontmatter(FILE, content);
    // R005 is captured; "foo" is under tags, not a list-field we
    // recognize, and it isn't a note-ID anyway.
    expect(spans).toHaveLength(1);
    expect(spans[0].parsedAddress.noteId).toBe('R005');
  });
});

describe('scanFrontmatter — list-field entries (inline form)', () => {
  it('emits spans for inline-list entries', () => {
    const content = withFrontmatter('derives: [R005.§1.AC.03, R007]');
    const spans = scanFrontmatter(FILE, content);
    expect(spans).toHaveLength(2);
    expect(spans[0].parsedAddress.noteId).toBe('R005');
    expect(spans[1].parsedAddress.noteId).toBe('R007');
  });
});

describe('scanFrontmatter — id field', () => {
  it('emits frontmatter-id span when expectedNoteId matches', () => {
    const content = withFrontmatter('id: R005\ntags:\n  - foo');
    const spans = scanFrontmatter(FILE, content, {
      expectedNoteId: 'R005',
    });
    const idSpan = spans.find((s) => s.surface === 'frontmatter-id');
    expect(idSpan).toBeDefined();
    expect(idSpan!.parsedAddress.noteId).toBe('R005');
    const [s, e] = idSpan!.noteIdRange;
    expect(content.slice(s, e)).toBe('R005');
  });

  it('does NOT emit frontmatter-id when expectedNoteId is unset', () => {
    const content = withFrontmatter('id: R005');
    const spans = scanFrontmatter(FILE, content);
    const idSpan = spans.find((s) => s.surface === 'frontmatter-id');
    expect(idSpan).toBeUndefined();
  });

  it('does NOT emit frontmatter-id when id value does not match expectedNoteId', () => {
    const content = withFrontmatter('id: R005');
    const spans = scanFrontmatter(FILE, content, {
      expectedNoteId: 'R042',
    });
    const idSpan = spans.find((s) => s.surface === 'frontmatter-id');
    expect(idSpan).toBeUndefined();
  });
});

describe('scanFrontmatter — substitution end-to-end', () => {
  it('substitutes only the note-ID in a list entry, preserving YAML form', () => {
    const content = withFrontmatter('derives:\n  - R005.§1.AC.03');
    const spans = scanFrontmatter(FILE, content);
    const result = applyActionsToContent(content, [
      {
        span: spans[0],
        action: {
          kind: 'substitute',
          replacement: '_deleted_R005_at_20260519',
        },
      },
    ]);
    expect(result).toContain('  - _deleted_R005_at_20260519.§1.AC.03');
    expect(result.startsWith('---\nderives:\n')).toBe(true);
  });

  it('substitutes id field for rename without touching surrounding fields', () => {
    const content = withFrontmatter('id: R005\ntags:\n  - foo');
    const spans = scanFrontmatter(FILE, content, {
      expectedNoteId: 'R005',
    });
    const result = applyActionsToContent(content, [
      {
        span: spans[0],
        action: { kind: 'substitute', replacement: 'R042' },
      },
    ]);
    expect(result).toContain('id: R042');
    expect(result).toContain('tags:');
    expect(result).toContain('  - foo');
  });
});
