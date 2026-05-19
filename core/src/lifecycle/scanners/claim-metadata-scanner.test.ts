/**
 * Tests for the claim-metadata scanner adapter.
 *
 * @validates {R015.§3.AC.11} :derives= and :superseded= TARGET portions
 * @validates {DD020.§2.DC.13} claim-metadata-derives and claim-metadata-superseded surfaces
 */

import { describe, it, expect } from 'vitest';
import { scanClaimMetadata } from './claim-metadata-scanner';
import { applyActionsToContent } from '../rewriter';

const FILE = '/proj/dd.md';

describe('scanClaimMetadata — derives=', () => {
  it('emits a claim-metadata-derives span for the TARGET portion', () => {
    const content =
      '### DC.01:derives=R005.§1.AC.03 — A design claim derived from R005.';
    const spans = scanClaimMetadata(FILE, content);
    expect(spans).toHaveLength(1);
    expect(spans[0].surface).toBe('claim-metadata-derives');
    expect(spans[0].parsedAddress.noteId).toBe('R005');
    const [s, e] = spans[0].noteIdRange;
    expect(content.slice(s, e)).toBe('R005');
  });

  it('handles multiple derives= in one document', () => {
    const content = [
      '§1.DC.01:derives=R005.§1.AC.01 — First',
      '§1.DC.02:derives=R007.§2.AC.03 — Second',
      '§1.DC.03:derives=R005.§3.AC.05 — Third',
    ].join('\n');
    const spans = scanClaimMetadata(FILE, content);
    expect(spans).toHaveLength(3);
    expect(spans.map((s) => s.parsedAddress.noteId)).toEqual([
      'R005',
      'R007',
      'R005',
    ]);
  });

  it('does NOT emit a span for derives= with a value that fails to parse', () => {
    const content = '### DC.01:derives=garbage — Not a valid address';
    const spans = scanClaimMetadata(FILE, content);
    // "garbage" lowercase fails NOTE_ID_RE and is not a valid claim form.
    expect(spans).toHaveLength(0);
  });
});

describe('scanClaimMetadata — superseded=', () => {
  it('emits a claim-metadata-superseded span', () => {
    const content =
      '§5.AC.04:superseded=R042.§2.AC.07 — Replaced by another claim.';
    const spans = scanClaimMetadata(FILE, content);
    expect(spans).toHaveLength(1);
    expect(spans[0].surface).toBe('claim-metadata-superseded');
    expect(spans[0].parsedAddress.noteId).toBe('R042');
  });

  it('captures cross-project supersession targets (alias-prefixed)', () => {
    const content =
      '§5.AC.04:superseded=vendor-lib/R042.§2.AC.07 — Cross-project.';
    const spans = scanClaimMetadata(FILE, content);
    expect(spans).toHaveLength(1);
    expect(spans[0].parsedAddress.aliasPrefix).toBe('vendor-lib');
    expect(spans[0].parsedAddress.noteId).toBe('R042');
  });
});

describe('scanClaimMetadata — substitution', () => {
  it('rewrites only the note-ID, preserving the trailing claim path and metadata syntax', () => {
    const content = '§1.DC.01:derives=R005.§1.AC.03 — A claim.';
    const spans = scanClaimMetadata(FILE, content);
    const result = applyActionsToContent(content, [
      {
        span: spans[0],
        action: {
          kind: 'substitute',
          replacement: '_deleted_R005_at_20260519',
        },
      },
    ]);
    expect(result).toBe(
      '§1.DC.01:derives=_deleted_R005_at_20260519.§1.AC.03 — A claim.',
    );
  });

  it('rewrites both kinds of metadata when the target matches', () => {
    const content = [
      '§1.DC.01:derives=R005.§1.AC.03 — A.',
      '§2.AC.05:superseded=R005.§1.AC.03 — B.',
    ].join('\n');
    const spans = scanClaimMetadata(FILE, content);
    const edits = spans.map((span) => ({
      span,
      action: {
        kind: 'substitute' as const,
        replacement: '_deleted_R005_at_20260519',
      },
    }));
    const result = applyActionsToContent(content, edits);
    expect(result).toContain(
      ':derives=_deleted_R005_at_20260519.§1.AC.03',
    );
    expect(result).toContain(
      ':superseded=_deleted_R005_at_20260519.§1.AC.03',
    );
  });
});
