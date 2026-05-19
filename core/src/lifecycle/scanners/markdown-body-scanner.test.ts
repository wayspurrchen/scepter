/**
 * Tests for the markdown-body scanner adapter.
 *
 * @validates {R015.§3.AC.01} braced refs covered (note-level, claim-level, range, compact-multi)
 * @validates {R015.§3.AC.02} bare-section refs not emitted (noop)
 * @validates {R015.§3.AC.03} trailing inline metadata preserved
 * @validates {R015.§3.AC.04} parser decoration-transparency
 * @validates {R015.§3.AC.05} alias-prefixed refs flagged via parsedAddress
 * @validates {DD020.§2.DC.03} markdown-body scanner emits span for every recognized reference form
 * @validates {DD020.§2.DC.06} surrounding markdown decoration preserved verbatim
 */

import { describe, it, expect } from 'vitest';
import { scanMarkdownBody } from './markdown-body-scanner';
import { applyActionsToContent } from '../rewriter';

const FILE = '/proj/a.md';

describe('scanMarkdownBody — braced references', () => {
  it('emits a span for a note-level braced ref', () => {
    const content = 'See {R005} for details.';
    const spans = scanMarkdownBody(FILE, content);
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.surface).toBe('markdown-body');
    expect(span.parsedAddress.noteId).toBe('R005');
    expect(span.originalText).toBe('R005');
    // Note-ID range is exactly the bare ID, after the `{`.
    const [start, end] = span.noteIdRange;
    expect(content.slice(start, end)).toBe('R005');
  });

  it('emits a span for a claim-level fully qualified ref', () => {
    const content = '{R005.§1.AC.03}';
    const spans = scanMarkdownBody(FILE, content);
    expect(spans).toHaveLength(1);
    expect(spans[0].parsedAddress.noteId).toBe('R005');
    const [s, e] = spans[0].noteIdRange;
    expect(content.slice(s, e)).toBe('R005');
  });

  it('emits a span for a compact-multi reference', () => {
    const content = '{R005.§1.AC.01,.AC.03,.AC.05}';
    const spans = scanMarkdownBody(FILE, content);
    // parseClaimAddress may yield a single ClaimAddress for the compact form;
    // the scanner emits at least one span pointing at the note-ID portion.
    expect(spans.length).toBeGreaterThanOrEqual(1);
    const noteIdSpan = spans[0];
    expect(noteIdSpan.parsedAddress.noteId).toBe('R005');
    const [s, e] = noteIdSpan.noteIdRange;
    expect(content.slice(s, e)).toBe('R005');
  });

  it('emits a span for a range reference', () => {
    const content = '{R005.§1.AC.01-05}';
    const spans = scanMarkdownBody(FILE, content);
    expect(spans.length).toBeGreaterThanOrEqual(1);
    const noteIdSpan = spans[0];
    expect(noteIdSpan.parsedAddress.noteId).toBe('R005');
  });

  it('emits a span carrying aliasPrefix for cross-project refs', () => {
    const content = '{vendor-lib/R005.§1.AC.03}';
    const spans = scanMarkdownBody(FILE, content);
    expect(spans).toHaveLength(1);
    expect(spans[0].parsedAddress.aliasPrefix).toBe('vendor-lib');
    expect(spans[0].parsedAddress.noteId).toBe('R005');
    const [s, e] = spans[0].noteIdRange;
    expect(content.slice(s, e)).toBe('R005');
  });

  it('does not emit a span for a bare-section ref ({§1.AC.03}, {AC.03})', () => {
    const content = 'See {§1.AC.03} and {AC.03}.';
    const spans = scanMarkdownBody(FILE, content);
    // Neither has a noteId; the scanner drops them.
    const withoutNoteId = spans.filter(
      (s) => s.parsedAddress.noteId === undefined,
    );
    expect(withoutNoteId).toEqual([]);
  });

  it('emits one span per braced ref on a multi-ref line', () => {
    const content = 'A:{R005}, B:{R007}, C:{R005.§1.AC.03}.';
    const spans = scanMarkdownBody(FILE, content);
    expect(spans).toHaveLength(3);
    expect(spans.map((s) => s.parsedAddress.noteId)).toEqual([
      'R005',
      'R007',
      'R005',
    ]);
  });

  it('preserves trailing inline metadata in surrounding text', () => {
    const content = '{R005.§1.AC.03} [inherent]';
    const spans = scanMarkdownBody(FILE, content);
    expect(spans).toHaveLength(1);
    // After substitution, [inherent] must remain.
    const result = applyActionsToContent(content, [
      {
        span: spans[0],
        action: { kind: 'substitute', replacement: 'XXX' },
      },
    ]);
    expect(result).toBe('{XXX.§1.AC.03} [inherent]');
  });
});

describe('scanMarkdownBody — braceless references', () => {
  it('emits a span for a braceless ref when shortcode is known', () => {
    const content = 'See R005.§1.AC.03 for details.';
    const spans = scanMarkdownBody(FILE, content, {
      knownShortcodes: new Set(['R']),
    });
    expect(spans).toHaveLength(1);
    expect(spans[0].parsedAddress.noteId).toBe('R005');
  });

  it('does not emit a braceless ref when shortcode is unknown', () => {
    const content = 'See R005.§1.AC.03 for details.';
    const spans = scanMarkdownBody(FILE, content, {
      knownShortcodes: new Set(['S']), // R not registered
    });
    expect(spans).toHaveLength(0);
  });

  it('does not emit a braceless ref when knownShortcodes is unset', () => {
    const content = 'See R005.§1.AC.03 for details.';
    const spans = scanMarkdownBody(FILE, content);
    expect(spans).toHaveLength(0);
  });

  it('does not double-count refs already matched as braced', () => {
    const content = '{R005.§1.AC.03}';
    const spans = scanMarkdownBody(FILE, content, {
      knownShortcodes: new Set(['R']),
    });
    expect(spans).toHaveLength(1);
  });
});

describe('scanMarkdownBody — end-to-end substitution', () => {
  it('substitutes only the note-ID across multiple refs in one document', () => {
    const content = [
      '# Doc',
      '',
      'See {R005} and {R005.§1.AC.03} for details.',
      'Also {R007.§2.AC.05} and {vendor-lib/R005} (skipped by predicate).',
    ].join('\n');
    const spans = scanMarkdownBody(FILE, content);
    // Filter to R005 (non-alias) matches only — that's what the
    // delete predicate would mutate.
    const r005 = spans.filter(
      (s) =>
        s.parsedAddress.noteId === 'R005' &&
        s.parsedAddress.aliasPrefix === undefined,
    );
    const edits = r005.map((span) => ({
      span,
      action: { kind: 'substitute' as const, replacement: 'XXX' },
    }));
    const result = applyActionsToContent(content, edits);
    expect(result).toBe(
      [
        '# Doc',
        '',
        'See {XXX} and {XXX.§1.AC.03} for details.',
        'Also {R007.§2.AC.05} and {vendor-lib/R005} (skipped by predicate).',
      ].join('\n'),
    );
  });
});
