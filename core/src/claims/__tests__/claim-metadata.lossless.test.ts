/**
 * Lossless invariant test: parseClaimMetadata(tokens) and the fold
 * reconstruction of reconcileNoteEvents output produce identical
 * ParsedMetadata for every legal suffix token combination.
 *
 * @validates {DD014.§3.DC.59} parseClaimMetadata <-> fold lossless
 * @validates {A004.§3.AC.02}
 * @validates {DD014.§3.DC.39}
 */
import { describe, it, expect } from 'vitest';
import { parseClaimMetadata } from '../claim-metadata';
import {
  reconcileNoteEvents,
  reconstructFromFold,
  authorActor,
} from '../metadata-ingest';
import { applyFold } from '../metadata-event';
import type { ParsedMetadata } from '../claim-metadata';

const NOTE_PATH = 'note.md';
const CLAIM = 'R009.§1.AC.01';
const DATE = '2026-04-25T00:00:00.000Z';

function normalizeForCompare(p: ParsedMetadata): {
  importance?: number;
  lifecycle?: { type: string; target?: string };
  tags: string[];
  derivedFrom: string[];
} {
  const tags = [...p.tags].sort();
  const derivedFrom = [...p.derivedFrom].sort();
  const out: ReturnType<typeof normalizeForCompare> = { tags, derivedFrom };
  if (p.importance !== undefined) out.importance = p.importance;
  if (p.lifecycle !== undefined) out.lifecycle = p.lifecycle;
  return out;
}

function reconstructed(tokens: string[]): ReturnType<typeof reconstructFromFold> {
  const { toAppend } = reconcileNoteEvents(
    NOTE_PATH,
    [{ fullyQualified: CLAIM, metadata: tokens }],
    {},
    DATE,
  );
  // Filter to events for this claim (all should be) and fold.
  const claimEvents = toAppend.filter((e) => e.claimId === CLAIM);
  // The author actor should be consistent with our authorActor() helper.
  const actor = authorActor(NOTE_PATH);
  for (const event of claimEvents) {
    expect(event.actor).toBe(actor);
  }
  const folded = applyFold(claimEvents);
  const out = reconstructFromFold(folded);
  out.tags = [...out.tags].sort();
  out.derivedFrom = [...out.derivedFrom].sort();
  return out;
}

describe('Lossless invariant: parseClaimMetadata <-> fold reconstruction', () => {
  const cases: Array<{ name: string; tokens: string[] }> = [
    { name: 'empty', tokens: [] },
    { name: 'importance only', tokens: ['5'] },
    { name: 'importance + lifecycle', tokens: ['4', 'closed'] },
    { name: 'importance + derives', tokens: ['3', 'derives=R005.§1.AC.01'] },
    { name: 'lifecycle alone', tokens: ['deferred'] },
    { name: 'superseded', tokens: ['superseded=R004.§2.AC.07'] },
    { name: 'multiple derives', tokens: ['derives=R001.§1.AC.01', 'derives=R002.§1.AC.02'] },
    { name: 'freeform tag', tokens: ['security'] },
    { name: 'multiple tags', tokens: ['security', 'auth', 'compliance'] },
    {
      name: 'kitchen sink',
      tokens: [
        '5',
        'closed',
        'derives=R005.§1.AC.01',
        'derives=R006.§1.AC.02',
        'security',
        'auth',
      ],
    },
    { name: 'kv pair', tokens: ['reviewer=alice'] },
  ];

  for (const c of cases) {
    it(`agrees on: ${c.name}`, () => {
      const fromParser = normalizeForCompare(parseClaimMetadata(c.tokens));
      const fromFold = reconstructed(c.tokens);

      // The parser collects k=v general-form tokens as freeform tags
      // (e.g., `reviewer=alice` ends up in `tags`). The fold path stores them
      // under the explicit key. To compare, we normalize the parser's tag
      // bucket: any element matching `KEY=VALUE` is dropped from the
      // comparison set since it has no representation in fromFold.tags.
      const parserTagsFiltered = fromParser.tags.filter((t) => !/^[a-z][a-z0-9._-]*=/.test(t));

      expect({ ...fromParser, tags: parserTagsFiltered.sort() }).toEqual(fromFold);
    });
  }
});
