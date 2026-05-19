/**
 * Tests for the self-prefix scanner adapter.
 *
 * @validates {R015.§3.AC.12} self-prefixed claim definitions inside renamed note
 * @validates {R015.§3.AC.13} delete scope: scanner only runs against renamed note's own file
 * @validates {DD020.§2.DC.14} self-prefix-heading and self-prefix-paragraph spans
 */

import { describe, it, expect } from 'vitest';
import { scanSelfPrefixes } from './self-prefix-scanner';
import { applyActionsToContent } from '../rewriter';

const FILE = '/proj/r005.md';

describe('scanSelfPrefixes — heading form', () => {
  it('emits a self-prefix-heading span for ### R005.LOCK.03', () => {
    const content =
      '# Doc\n\n### R005.LOCK.03 The lock MUST be exclusive within a schema scope.\n';
    const spans = scanSelfPrefixes(FILE, content, {
      expectedNoteId: 'R005',
    });
    expect(spans).toHaveLength(1);
    expect(spans[0].surface).toBe('self-prefix-heading');
    expect(spans[0].parsedAddress.noteId).toBe('R005');
    const [s, e] = spans[0].noteIdRange;
    expect(content.slice(s, e)).toBe('R005');
  });

  it('emits a span for #### with a section path', () => {
    const content = '#### R005.§3.LOCK.03 — A description.\n';
    const spans = scanSelfPrefixes(FILE, content, {
      expectedNoteId: 'R005',
    });
    expect(spans).toHaveLength(1);
    expect(spans[0].surface).toBe('self-prefix-heading');
  });

  it('does NOT emit a span when expectedNoteId does not match the prefix', () => {
    const content = '### R005.LOCK.03 — desc';
    const spans = scanSelfPrefixes(FILE, content, {
      expectedNoteId: 'R042',
    });
    expect(spans).toHaveLength(0);
  });

  it('does NOT match plain prose mentions (not heading)', () => {
    const content = 'See R005.LOCK.03 below.\n';
    const spans = scanSelfPrefixes(FILE, content, {
      expectedNoteId: 'R005',
    });
    expect(spans).toHaveLength(0);
  });
});

describe('scanSelfPrefixes — bold-paragraph form', () => {
  it('emits a self-prefix-paragraph span for **R005.§3.LOCK.03**', () => {
    const content =
      '**R005.§3.LOCK.03**: For migration sessions, the schema lock is held.\n';
    const spans = scanSelfPrefixes(FILE, content, {
      expectedNoteId: 'R005',
    });
    expect(spans).toHaveLength(1);
    expect(spans[0].surface).toBe('self-prefix-paragraph');
    expect(spans[0].parsedAddress.noteId).toBe('R005');
    const [s, e] = spans[0].noteIdRange;
    expect(content.slice(s, e)).toBe('R005');
  });

  it('does NOT match a bold ref that is not at line start', () => {
    const content = 'See **R005.LOCK.03** elsewhere.\n';
    const spans = scanSelfPrefixes(FILE, content, {
      expectedNoteId: 'R005',
    });
    expect(spans).toHaveLength(0);
  });
});

describe('scanSelfPrefixes — substitution end-to-end', () => {
  it('rewrites every self-prefix to the target ID', () => {
    const content = [
      '# R005',
      '',
      '### R005.LOCK.03 The lock.',
      '',
      '**R005.§2.LOCK.04**: Bold paragraph form.',
      '',
      '#### R005.§3.LOCK.05 — Another heading.',
    ].join('\n');
    const spans = scanSelfPrefixes(FILE, content, {
      expectedNoteId: 'R005',
    });
    expect(spans).toHaveLength(3);
    const edits = spans.map((span) => ({
      span,
      action: { kind: 'substitute' as const, replacement: 'R042' },
    }));
    const result = applyActionsToContent(content, edits);
    expect(result).toContain('### R042.LOCK.03');
    expect(result).toContain('**R042.§2.LOCK.04**');
    expect(result).toContain('#### R042.§3.LOCK.05 — Another heading.');
  });
});
