/**
 * Tests for tombstoned-reference recognition at the claim-index layer.
 *
 * These tests validate that `:derives=_deleted_R005_at_<date>.§1.AC.03`
 * and `:superseded=_deleted_R005_at_<date>.§1.AC.03` are recognized as
 * lifecycle state and captured on dedicated fields, NOT reported as
 * broken references.
 *
 * Acceptance fixture for DD020 §9 Phase 2 ("Hand-craft a fixture project
 * containing a note with `:derives=_deleted_R005_at_20260519.§1.AC.03`").
 *
 * @validates {R015.§5.AC.01} linter does not flag tombstoned derives=/superseded=
 * @validates {DD020.§5.DC.01} consumer-side tombstone recognition for derives=
 * @validates {DD020.§5.DC.01} consumer-side tombstone recognition for superseded=
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ClaimIndex } from '../claim-index';
import type { NoteWithContent } from '../claim-index';
import { validateDerivationLinks } from '../../cli/commands/claims/lint-command';

// A note whose claim derives from a tombstoned target.
// R005 was hard-deleted on 2026-05-19; the rewriter replaced the note-ID
// portion of S001's `derives=` target with the marker.
const tombstonedDerivesNote: NoteWithContent = {
  id: 'S001',
  type: 'Specification',
  filePath: '_scepter/notes/specifications/S001.md',
  content: [
    '# S001 Spec',
    '',
    '### §1 Implementation',
    '',
    '§1.IMPL.01:derives=_deleted_R005_at_20260519.§1.AC.03 Derives from a tombstoned claim.',
  ].join('\n'),
};

const tombstonedSupersededNote: NoteWithContent = {
  id: 'R007',
  type: 'Requirement',
  filePath: '_scepter/notes/requirements/R007.md',
  content: [
    '# R007 Reqs',
    '',
    '### §1 Auth',
    '',
    '§1.AC.01:superseded=_deleted_R005_at_20260519.§1.AC.03 Superseded by a tombstoned claim.',
  ].join('\n'),
};

// A liveness control: a normal note with a real derives= target.
const liveDerivesNote: NoteWithContent = {
  id: 'R042',
  type: 'Requirement',
  filePath: '_scepter/notes/requirements/R042.md',
  content: [
    '# R042 Live',
    '',
    '### §1 Section',
    '',
    '§1.AC.01 Live source claim.',
  ].join('\n'),
};

const liveDerivedFromNote: NoteWithContent = {
  id: 'DD050',
  type: 'DetailedDesign',
  filePath: '_scepter/notes/dd/DD050.md',
  content: [
    '# DD050 Live Derivation',
    '',
    '### §1 Section',
    '',
    '§1.DC.01:derives=R042.§1.AC.01 Derives from a live claim.',
  ].join('\n'),
};

describe('Tombstone recognition — derives= target', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('does not emit unresolvable-derivation-target on a tombstoned derives=', () => {
    const data = index.build([tombstonedDerivesNote]);

    const derivErrors = data.errors.filter(
      (e) => e.type === 'unresolvable-derivation-target',
    );
    expect(derivErrors).toEqual([]);
  });

  it('captures the tombstoned target on tombstonedDerivedFrom', () => {
    const data = index.build([tombstonedDerivesNote]);

    const entry = data.entries.get('S001.1.IMPL.01');
    expect(entry).toBeDefined();
    expect(entry!.tombstonedDerivedFrom).toEqual([
      '_deleted_R005_at_20260519.§1.AC.03',
    ]);
  });

  it('leaves derivedFrom empty for a claim with only a tombstoned target', () => {
    const data = index.build([tombstonedDerivesNote]);

    const entry = data.entries.get('S001.1.IMPL.01');
    expect(entry!.derivedFrom).toEqual([]);
  });

  it('still resolves a live derives= target alongside a tombstoned one', () => {
    const mixedNote: NoteWithContent = {
      id: 'DD051',
      type: 'DetailedDesign',
      filePath: '_scepter/notes/dd/DD051.md',
      content: [
        '# DD051',
        '',
        '### §1 Section',
        '',
        '§1.DC.01:derives=R042.§1.AC.01:derives=_deleted_R005_at_20260519.§1.AC.03 Mixed.',
      ].join('\n'),
    };
    const data = index.build([liveDerivesNote, mixedNote]);

    const entry = data.entries.get('DD051.1.DC.01');
    expect(entry).toBeDefined();
    expect(entry!.derivedFrom).toEqual(['R042.1.AC.01']);
    expect(entry!.tombstonedDerivedFrom).toEqual([
      '_deleted_R005_at_20260519.§1.AC.03',
    ]);
  });

  it('preserves the existing behavior for live derives= targets', () => {
    const data = index.build([liveDerivesNote, liveDerivedFromNote]);

    const entry = data.entries.get('DD050.1.DC.01');
    expect(entry).toBeDefined();
    expect(entry!.derivedFrom).toEqual(['R042.1.AC.01']);
    expect(entry!.tombstonedDerivedFrom).toEqual([]);

    const errs = data.errors.filter(
      (e) => e.type === 'unresolvable-derivation-target',
    );
    expect(errs).toEqual([]);
  });
});

describe('Tombstone recognition — superseded= target', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('does not emit cross-project-superseded on a tombstoned target', () => {
    const data = index.build([tombstonedSupersededNote]);

    const supersededErrors = data.errors.filter(
      (e) => e.type === 'cross-project-superseded',
    );
    expect(supersededErrors).toEqual([]);
  });

  it('captures the tombstoned target on tombstonedSupersededBy', () => {
    const data = index.build([tombstonedSupersededNote]);

    const entry = data.entries.get('R007.1.AC.01');
    expect(entry).toBeDefined();
    expect(entry!.tombstonedSupersededBy).toBe(
      '_deleted_R005_at_20260519.§1.AC.03',
    );
  });

  it('does not set tombstonedSupersededBy when the target is live', () => {
    const liveSupersededNote: NoteWithContent = {
      id: 'R008',
      type: 'Requirement',
      filePath: '_scepter/notes/requirements/R008.md',
      content: [
        '# R008 Reqs',
        '',
        '### §1 Section',
        '',
        '§1.AC.01:superseded=R042.§1.AC.01 Superseded by a live claim.',
      ].join('\n'),
    };
    const data = index.build([liveDerivesNote, liveSupersededNote]);

    const entry = data.entries.get('R008.1.AC.01');
    expect(entry).toBeDefined();
    expect(entry!.tombstonedSupersededBy).toBeUndefined();
  });

  it('does not set tombstonedSupersededBy on a claim with no supersession', () => {
    const data = index.build([liveDerivesNote]);
    const entry = data.entries.get('R042.1.AC.01');
    expect(entry).toBeDefined();
    expect(entry!.tombstonedSupersededBy).toBeUndefined();
  });
});

describe('Tombstone recognition — lint integration', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('validateDerivationLinks produces no errors on a tombstoned derives=', () => {
    const data = index.build([tombstonedDerivesNote]);
    const errors = validateDerivationLinks('S001', data, index);
    expect(errors).toEqual([]);
  });

  it('validateDerivationLinks still catches a real broken derives=', () => {
    const badDerivesNote: NoteWithContent = {
      id: 'DD060',
      type: 'DetailedDesign',
      filePath: '_scepter/notes/dd/DD060.md',
      content: [
        '# DD060',
        '',
        '### §1 Section',
        '',
        '§1.DC.01:derives=R999.§1.AC.01 Derives from a non-existent claim.',
      ].join('\n'),
    };
    const data = index.build([badDerivesNote]);
    // R999 does not exist → expect unresolvable-derivation-target in
    // index errors. (validateDerivationLinks only catches invalid-derivation-target
    // for targets that resolve via index but become stale; here it's the
    // earlier upstream catch.)
    const indexErrors = data.errors.filter(
      (e) => e.type === 'unresolvable-derivation-target',
    );
    expect(indexErrors.length).toBeGreaterThan(0);
  });
});

describe('Tombstone recognition — datetime precision', () => {
  let index: ClaimIndex;

  beforeEach(() => {
    index = new ClaimIndex();
  });

  it('recognizes a YYYYMMDDHHMM-form tombstone target', () => {
    const note: NoteWithContent = {
      id: 'S002',
      type: 'Specification',
      filePath: '_scepter/notes/specifications/S002.md',
      content: [
        '# S002',
        '',
        '### §1 Section',
        '',
        '§1.IMPL.01:derives=_deleted_R005_at_202605191430.§1.AC.03 Datetime precision.',
      ].join('\n'),
    };
    const data = index.build([note]);

    const entry = data.entries.get('S002.1.IMPL.01');
    expect(entry).toBeDefined();
    expect(entry!.tombstonedDerivedFrom).toEqual([
      '_deleted_R005_at_202605191430.§1.AC.03',
    ]);
    const errs = data.errors.filter(
      (e) => e.type === 'unresolvable-derivation-target',
    );
    expect(errs).toEqual([]);
  });
});
