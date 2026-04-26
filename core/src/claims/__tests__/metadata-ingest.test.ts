/**
 * Tests for the suffix-grammar ingest reconciliation.
 *
 * @validates {DD014.§3.DC.38} reconcileNoteEvents returns toAppend/toRetract
 * @validates {DD014.§3.DC.39} Suffix-token normalization table
 * @validates {DD014.§3.DC.40} actor format author:<notepath>
 * @validates {DD014.§3.DC.41} Incremental, per-token granularity
 * @validates {DD014.§3.DC.42} Idempotent re-ingest of unchanged tokens
 * @validates {DD014.§3.DC.43} CLI events untouched by reconciliation
 */
import { describe, it, expect } from 'vitest';
import {
  authorActor,
  reconcileNoteEvents,
  tokenToKeyValues,
} from '../metadata-ingest';
import type { IngestClaimEntry } from '../metadata-ingest';
import type { MetadataEvent, MetadataStore } from '../metadata-event';

const NOTE_PATH = '_scepter/notes/reqs/R009.md';
const CLAIM = 'R009.§1.AC.01';
const DATE = '2026-04-25T00:00:00.000Z';

describe('tokenToKeyValues (DD014.§3.DC.39)', () => {
  it('maps `5` to importance=5', () => {
    expect(tokenToKeyValues('5')).toEqual([{ key: 'importance', value: '5' }]);
  });

  it('maps `closed`/`deferred`/`removed` to lifecycle=...', () => {
    expect(tokenToKeyValues('closed')).toEqual([{ key: 'lifecycle', value: 'closed' }]);
    expect(tokenToKeyValues('deferred')).toEqual([{ key: 'lifecycle', value: 'deferred' }]);
    expect(tokenToKeyValues('removed')).toEqual([{ key: 'lifecycle', value: 'removed' }]);
  });

  it('maps superseded=TARGET to TWO events', () => {
    expect(tokenToKeyValues('superseded=R004.§2.AC.07')).toEqual([
      { key: 'lifecycle', value: 'superseded' },
      { key: 'supersededBy', value: 'R004.§2.AC.07' },
    ]);
  });

  it('maps derives=TARGET to derives=...', () => {
    expect(tokenToKeyValues('derives=R005.§1.AC.01')).toEqual([
      { key: 'derives', value: 'R005.§1.AC.01' },
    ]);
  });

  it('maps freeform tokens to tag=token', () => {
    expect(tokenToKeyValues('security')).toEqual([{ key: 'tag', value: 'security' }]);
  });

  it('maps KEY=VALUE general form', () => {
    expect(tokenToKeyValues('reviewer=alice')).toEqual([{ key: 'reviewer', value: 'alice' }]);
  });
});

describe('authorActor (DD014.§3.DC.40)', () => {
  it('prefixes the notepath with author:', () => {
    expect(authorActor('_scepter/notes/reqs/R009.md')).toBe(
      'author:_scepter/notes/reqs/R009.md',
    );
  });
});

describe('reconcileNoteEvents — basic ingest (T-Ingest-1)', () => {
  it('emits an add for every (key, value) pair from the suffix tokens', () => {
    const entries: IngestClaimEntry[] = [
      {
        fullyQualified: CLAIM,
        metadata: ['5', 'closed', 'reviewer=alice', 'derives=R005.§1.AC.01'],
      },
    ];
    const store: MetadataStore = {};
    const { toAppend, toRetract } = reconcileNoteEvents(NOTE_PATH, entries, store, DATE);

    expect(toRetract).toEqual([]);
    expect(toAppend).toHaveLength(4);
    const triples = toAppend.map((e) => `${e.key}=${e.value}`).sort();
    expect(triples).toEqual([
      'derives=R005.§1.AC.01',
      'importance=5',
      'lifecycle=closed',
      'reviewer=alice',
    ]);
    for (const event of toAppend) {
      expect(event.op).toBe('add');
      expect(event.actor).toBe(authorActor(NOTE_PATH));
      expect(event.date).toBe(DATE);
      expect(event.note).toBe('inline');
      expect(event.id).toMatch(/^[a-z0-9]{24}$/);
      expect(event.claimId).toBe(CLAIM);
    }
  });

  it('explodes superseded= into TWO events', () => {
    const entries: IngestClaimEntry[] = [
      { fullyQualified: CLAIM, metadata: ['superseded=R004.§2.AC.07'] },
    ];
    const { toAppend } = reconcileNoteEvents(NOTE_PATH, entries, {}, DATE);
    expect(toAppend).toHaveLength(2);
    const pairs = toAppend.map((e) => ({ key: e.key, value: e.value })).sort((a, b) =>
      a.key.localeCompare(b.key),
    );
    expect(pairs).toEqual([
      { key: 'lifecycle', value: 'superseded' },
      { key: 'supersededBy', value: 'R004.§2.AC.07' },
    ]);
  });
});

describe('reconcileNoteEvents — idempotence (T-Ingest-4, §DC.42)', () => {
  it('emits nothing on a second run with unchanged tokens', () => {
    const entries: IngestClaimEntry[] = [
      { fullyQualified: CLAIM, metadata: ['5', 'reviewer=alice'] },
    ];
    const { toAppend: firstAppend } = reconcileNoteEvents(NOTE_PATH, entries, {}, DATE);
    expect(firstAppend).toHaveLength(2);

    // Build a store representing the prior commit.
    const store: MetadataStore = { [CLAIM]: firstAppend };
    const { toAppend, toRetract } = reconcileNoteEvents(NOTE_PATH, entries, store, DATE);

    expect(toAppend).toEqual([]);
    expect(toRetract).toEqual([]);
  });
});

describe('reconcileNoteEvents — incremental edits (T-Ingest-3, §DC.41)', () => {
  it('adding a new token emits a single add', () => {
    const initial: IngestClaimEntry[] = [
      { fullyQualified: CLAIM, metadata: ['5'] },
    ];
    const { toAppend: priorAppend } = reconcileNoteEvents(NOTE_PATH, initial, {}, DATE);
    const store: MetadataStore = { [CLAIM]: priorAppend };

    const after: IngestClaimEntry[] = [
      { fullyQualified: CLAIM, metadata: ['5', 'priority=high'] },
    ];
    const { toAppend, toRetract } = reconcileNoteEvents(NOTE_PATH, after, store, DATE);
    expect(toRetract).toEqual([]);
    expect(toAppend).toHaveLength(1);
    expect(toAppend[0].key).toBe('priority');
    expect(toAppend[0].value).toBe('high');
  });

  it('removing a token emits a retract', () => {
    const initial: IngestClaimEntry[] = [
      { fullyQualified: CLAIM, metadata: ['5', 'reviewer=alice'] },
    ];
    const { toAppend: priorAppend } = reconcileNoteEvents(NOTE_PATH, initial, {}, DATE);
    const store: MetadataStore = { [CLAIM]: priorAppend };

    const after: IngestClaimEntry[] = [
      { fullyQualified: CLAIM, metadata: ['5'] },
    ];
    const { toAppend, toRetract } = reconcileNoteEvents(NOTE_PATH, after, store, DATE);

    expect(toAppend).toEqual([]);
    expect(toRetract).toHaveLength(1);
    expect(toRetract[0].op).toBe('retract');
    expect(toRetract[0].key).toBe('reviewer');
    expect(toRetract[0].value).toBe('alice');
    expect(toRetract[0].actor).toBe(authorActor(NOTE_PATH));
  });
});

describe('reconcileNoteEvents — CLI events untouched (T-Ingest-5, §DC.43)', () => {
  it('does not retract values contributed by a non-author actor', () => {
    // CLI added reviewer=bob.
    const cliEvent: MetadataEvent = {
      id: 'cuid-cli',
      claimId: CLAIM,
      key: 'reviewer',
      value: 'bob',
      op: 'add',
      actor: 'alice', // OS username, not author:
      date: DATE,
    };
    const store: MetadataStore = { [CLAIM]: [cliEvent] };

    // Author has no inline tokens for `reviewer` at all.
    const entries: IngestClaimEntry[] = [
      { fullyQualified: CLAIM, metadata: ['5'] },
    ];
    const { toAppend, toRetract } = reconcileNoteEvents(NOTE_PATH, entries, store, DATE);
    expect(toAppend).toHaveLength(1); // importance=5
    expect(toAppend[0].key).toBe('importance');
    expect(toRetract).toEqual([]);
  });

  it('coexists: author edits preserve CLI events on the same key', () => {
    const cliEvent: MetadataEvent = {
      id: 'cuid-cli',
      claimId: CLAIM,
      key: 'reviewer',
      value: 'bob',
      op: 'add',
      actor: 'alice',
      date: DATE,
    };
    const store: MetadataStore = { [CLAIM]: [cliEvent] };

    const entries: IngestClaimEntry[] = [
      { fullyQualified: CLAIM, metadata: ['reviewer=alice'] },
    ];
    const { toAppend, toRetract } = reconcileNoteEvents(NOTE_PATH, entries, store, DATE);
    expect(toAppend).toHaveLength(1);
    expect(toAppend[0].value).toBe('alice');
    expect(toAppend[0].actor).toBe(authorActor(NOTE_PATH));
    expect(toRetract).toEqual([]);
  });
});

describe('reconcileNoteEvents — actor format (T-Ingest-2, §DC.40)', () => {
  it('uses author:<notepath> with project-root-relative path', () => {
    const entries: IngestClaimEntry[] = [
      { fullyQualified: CLAIM, metadata: ['5'] },
    ];
    const { toAppend } = reconcileNoteEvents(NOTE_PATH, entries, {}, DATE);
    expect(toAppend[0].actor).toBe(`author:${NOTE_PATH}`);
  });
});

describe('reconcileNoteEvents — different note authors are isolated', () => {
  it('two notes editing the same claim do not retract each other', () => {
    const noteA = '_scepter/notes/specs/S001.md';
    const noteB = '_scepter/notes/specs/S002.md';
    // Note A previously added reviewer=alice.
    const aEvent: MetadataEvent = {
      id: 'cuid-a',
      claimId: CLAIM,
      key: 'reviewer',
      value: 'alice',
      op: 'add',
      actor: authorActor(noteA),
      date: DATE,
    };
    const store: MetadataStore = { [CLAIM]: [aEvent] };

    // Note B reconciles its own (empty) declarations.
    const entriesForB: IngestClaimEntry[] = [
      { fullyQualified: CLAIM, metadata: [] },
    ];
    const result = reconcileNoteEvents(noteB, entriesForB, store, DATE);
    expect(result.toAppend).toEqual([]);
    expect(result.toRetract).toEqual([]);
  });
});
