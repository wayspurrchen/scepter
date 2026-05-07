/**
 * Lossless invariant: parseClaimMetadata(tokens) produces the documented
 * ParsedMetadata shape for every legal suffix-token combination.
 *
 * Originally this test round-tripped tokens through reconcileNoteEvents →
 * applyFold → reconstructFromFold and asserted equality. Under the
 * read-time overlay model authored by DD019, no such round-trip exists —
 * the markdown projection is read directly from ClaimIndexEntry fields
 * populated by parseClaimMetadata at index build time. The lossless
 * property therefore reduces to a parser-only invariant: every legal
 * token combination produces the documented ParsedMetadata shape, and
 * KEY=VALUE general-form tokens are surfaced through `tags` in their
 * original on-disk shape (the merge layer in metadata-filters splits
 * them back into (key, value) pairs at filter time per DD019.§3.DC.13).
 *
 * @validates {DD019.§3.DC.45} Lossless invariant retained as a parser-only test
 * @validates {A004.§3.AC.02} Read-time normalization table semantics
 */
import { describe, it, expect } from 'vitest';
import { parseClaimMetadata } from '../claim-metadata';
import type { ParsedMetadata } from '../claim-metadata';

interface Expected {
  importance?: number;
  lifecycle?: { type: string; target?: string };
  tags: string[];
  derivedFrom: string[];
}

function snapshot(p: ParsedMetadata): Expected {
  const out: Expected = {
    tags: [...p.tags].sort(),
    derivedFrom: [...p.derivedFrom].sort(),
  };
  if (p.importance !== undefined) out.importance = p.importance;
  if (p.lifecycle !== undefined) out.lifecycle = p.lifecycle;
  return out;
}

describe('Lossless invariant: parseClaimMetadata produces documented shape', () => {
  const cases: Array<{ name: string; tokens: string[]; expected: Expected }> = [
    {
      name: 'empty',
      tokens: [],
      expected: { tags: [], derivedFrom: [] },
    },
    {
      name: 'importance only',
      tokens: ['5'],
      expected: { tags: [], derivedFrom: [], importance: 5 },
    },
    {
      name: 'importance + lifecycle (closed)',
      tokens: ['4', 'closed'],
      expected: {
        tags: [],
        derivedFrom: [],
        importance: 4,
        lifecycle: { type: 'closed' },
      },
    },
    {
      name: 'importance + derives',
      tokens: ['3', 'derives=R005.§1.AC.01'],
      expected: {
        tags: [],
        derivedFrom: ['R005.§1.AC.01'],
        importance: 3,
      },
    },
    {
      name: 'lifecycle alone (deferred)',
      tokens: ['deferred'],
      expected: {
        tags: [],
        derivedFrom: [],
        lifecycle: { type: 'deferred' },
      },
    },
    {
      name: 'superseded=TARGET preserves the target',
      tokens: ['superseded=R004.§2.AC.07'],
      expected: {
        tags: [],
        derivedFrom: [],
        lifecycle: { type: 'superseded', target: 'R004.§2.AC.07' },
      },
    },
    {
      name: 'multiple derives entries collected independently',
      tokens: ['derives=R001.§1.AC.01', 'derives=R002.§1.AC.02'],
      expected: {
        tags: [],
        derivedFrom: ['R001.§1.AC.01', 'R002.§1.AC.02'],
      },
    },
    {
      name: 'freeform tag',
      tokens: ['security'],
      expected: { tags: ['security'], derivedFrom: [] },
    },
    {
      name: 'multiple freeform tags',
      tokens: ['security', 'auth', 'compliance'],
      expected: {
        tags: ['auth', 'compliance', 'security'],
        derivedFrom: [],
      },
    },
    {
      name: 'KEY=VALUE token surfaced verbatim through tags (split at filter time)',
      tokens: ['reviewer=alice'],
      expected: { tags: ['reviewer=alice'], derivedFrom: [] },
    },
    {
      name: 'kitchen sink: importance + lifecycle + derives + tags',
      tokens: [
        '5',
        'closed',
        'derives=R005.§1.AC.01',
        'derives=R006.§1.AC.02',
        'security',
        'auth',
      ],
      expected: {
        tags: ['auth', 'security'],
        derivedFrom: ['R005.§1.AC.01', 'R006.§1.AC.02'],
        importance: 5,
        lifecycle: { type: 'closed' },
      },
    },
  ];

  for (const c of cases) {
    it(`produces the documented shape for: ${c.name}`, () => {
      const parsed = snapshot(parseClaimMetadata(c.tokens));
      const expected: Expected = {
        ...c.expected,
        tags: [...c.expected.tags].sort(),
        derivedFrom: [...c.expected.derivedFrom].sort(),
      };
      expect(parsed).toEqual(expected);
    });
  }

  it('first importance digit wins; subsequent digits become tags only when outside 1-5', () => {
    const parsed = snapshot(parseClaimMetadata(['5', '4']));
    expect(parsed.importance).toBe(5);
    // The second digit is in range 1-5 so it is silently ignored, not tagged.
    expect(parsed.tags).toEqual([]);
  });

  it('digits outside 1-5 are surfaced as freeform tags', () => {
    const parsed = snapshot(parseClaimMetadata(['7']));
    expect(parsed.importance).toBeUndefined();
    expect(parsed.tags).toEqual(['7']);
  });

  it('multiple lifecycle tags: first wins (lint catches separately)', () => {
    const parsed = snapshot(parseClaimMetadata(['closed', 'deferred']));
    expect(parsed.lifecycle).toEqual({ type: 'closed' });
  });
});
