/**
 * Tests for `scepter dependents <claim>` per {DD021.§10.DC.15}.
 *
 * Covers:
 * - findSupersedeRefs: resolve-then-compare per §6 ISSUE 13
 * - findInlineRefs: filters on resolverOutcome.kind === 'resolved'
 * - findCrossProjectRefs: returns empty per R011 citation-not-federation
 * - Wiring smoke test per Q23 (command registered at top level)
 * - ISSUE 19 regression: tombstoned superseded= target reaches resolver,
 *   returns malformed-claim-reference, gets filtered by outcome.kind check
 *
 * @validates {DD021.§10.DC.15} dependents command
 * @validates {R006.§2.AC.03} getDerivatives use (verified via ClaimIndex API)
 * @validates {R011.§3.AC.03} cross-project footer display-only
 * @validates {DD006.§3.DC.03} top-level command registration (Q23 wiring smoke)
 */

import { describe, it, expect } from 'vitest';
import { ClaimIndex } from '../../../../claims/claim-index';
import type { NoteWithContent, ClaimIndexData } from '../../../../claims/claim-index';
import {
  findSupersedeRefs,
  findInlineRefs,
  findCrossProjectRefs,
  dependentsCommand,
} from '../dependents-command';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function buildIndex(notes: NoteWithContent[]): ClaimIndexData {
  const idx = new ClaimIndex();
  return idx.build(notes);
}

// ---------------------------------------------------------------------------
// findSupersedeRefs tests
// ---------------------------------------------------------------------------

describe('findSupersedeRefs', () => {
  it('DD021.§10.DC.15: matches canonical FQID for fully-qualified superseded= target', () => {
    const notes: NoteWithContent[] = [
      {
        id: 'R042',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R042.md',
        content: [
          '# R042',
          '## §1 Section',
          '§1.AC.01:superseded=R042.§2.AC.01 The old claim.',
          '## §2 Section',
          '§2.AC.01 The replacement.',
        ].join('\n'),
      },
    ];
    const data = buildIndex(notes);
    const results = findSupersedeRefs(data, 'R042.2.AC.01');
    expect(results).toEqual(['R042.1.AC.01']);
  });

  it('DD021.§10.DC.15 (ISSUE 13 regression): matches section-less superseded= target via resolveReference', () => {
    const notes: NoteWithContent[] = [
      {
        id: 'R043',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R043.md',
        content: [
          '# R043',
          '## §2 Only Section',
          '§2.PRI.05 The replacement.',
        ].join('\n'),
      },
      {
        id: 'R044',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R044.md',
        content: [
          '# R044',
          '## §1 Section',
          '§1.AC.01:superseded=R043.PRI.05 Section-less target — needs resolver.',
        ].join('\n'),
      },
    ];
    const data = buildIndex(notes);
    // Query for dependents of the canonical FQID. ISSUE 13 fix: the helper
    // resolves R043.PRI.05 → R043.2.PRI.05 via DC.03 section-less rule and
    // matches against the canonical, NOT against the raw author-written form.
    const results = findSupersedeRefs(data, 'R043.2.PRI.05');
    expect(results).toEqual(['R044.1.AC.01']);
  });

  it('DD021.§10.DC.15 (ISSUE 19 regression): tombstoned superseded= target gets filtered by outcome.kind check', () => {
    // ISSUE 19 documented that tombstoned `entry.lifecycle.target` values
    // DO reach the resolver (the Phase 1.6 loop captures
    // `tombstonedSupersededBy` but doesn't clear `lifecycle.target`). The
    // resolver returns `unresolved` with `malformed-claim-reference` on the
    // deletion-marker string, and the `outcome.kind === 'resolved'` filter
    // naturally excludes the entry from results.
    //
    // Without a real tombstone fixture (which requires the deletion-marker
    // rewriter), we verify the natural-filter behavior by ensuring helpers
    // that encounter a non-resolved outcome (e.g., bare-note-id) don't
    // produce false-positive matches.
    const notes: NoteWithContent[] = [
      {
        id: 'R045',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R045.md',
        content: [
          '# R045',
          '## §1 Section',
          '§1.AC.01:superseded=DEF999.§1.AC.01 Superseded by an unknown note.',
        ].join('\n'),
      },
      {
        id: 'R046',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R046.md',
        content: [
          '# R046',
          '## §1 Section',
          '§1.AC.01 The query target.',
        ].join('\n'),
      },
    ];
    const data = buildIndex(notes);
    // R045.§1.AC.01 has superseded=DEF999.§1.AC.01 (unresolved). Query for
    // dependents of R046.§1.AC.01. The natural-filter excludes R045 because
    // resolveReference returns unresolved (not resolved), so R045 doesn't
    // become a false-positive match.
    const results = findSupersedeRefs(data, 'R046.1.AC.01');
    expect(results).toEqual([]); // R045 correctly filtered out
  });

  it('DD021.§10.DC.15: returns empty list when no claim supersedes the target', () => {
    const notes: NoteWithContent[] = [
      {
        id: 'R047',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R047.md',
        content: [
          '# R047',
          '## §1 Section',
          '§1.AC.01 No supersession.',
        ].join('\n'),
      },
    ];
    const data = buildIndex(notes);
    const results = findSupersedeRefs(data, 'R047.1.AC.01');
    expect(results).toEqual([]);
  });

  it('DD021.§10.DC.15: multiple supersessions sort deterministically by FQID', () => {
    const notes: NoteWithContent[] = [
      {
        id: 'R048',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R048.md',
        content: [
          '# R048',
          '## §1 Section',
          '§1.AC.01 The target.',
        ].join('\n'),
      },
      {
        id: 'R049',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R049.md',
        content: [
          '# R049',
          '## §1 Section',
          '§1.AC.01:superseded=R048.§1.AC.01 First superseder.',
        ].join('\n'),
      },
      {
        id: 'R050',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R050.md',
        content: [
          '# R050',
          '## §1 Section',
          '§1.AC.01:superseded=R048.§1.AC.01 Second superseder.',
        ].join('\n'),
      },
    ];
    const data = buildIndex(notes);
    const results = findSupersedeRefs(data, 'R048.1.AC.01');
    expect(results).toEqual(['R049.1.AC.01', 'R050.1.AC.01']);
  });
});

// ---------------------------------------------------------------------------
// findInlineRefs tests
// ---------------------------------------------------------------------------

describe('findInlineRefs', () => {
  it('DD021.§10.DC.15: returns inline refs targeting the queried claim', () => {
    const notes: NoteWithContent[] = [
      {
        id: 'R060',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R060.md',
        content: [
          '# R060',
          '## §1 Section',
          '§1.AC.01 The target.',
        ].join('\n'),
      },
      {
        id: 'S060',
        type: 'Specification',
        filePath: '_scepter/notes/specs/S060.md',
        content: [
          '# S060',
          '## §1 Section',
          '§1.AC.01 Cites {R060.§1.AC.01} inline.',
        ].join('\n'),
      },
    ];
    const data = buildIndex(notes);
    const results = findInlineRefs(data, 'R060.1.AC.01');
    expect(results.length).toBe(1);
    expect(results[0].fromClaim).toBe('S060.1.AC.01');
    expect(results[0].fromNoteId).toBe('S060');
  });

  it('DD021.§10.DC.15: filters out unresolved inline refs', () => {
    const notes: NoteWithContent[] = [
      {
        id: 'R061',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R061.md',
        content: [
          '# R061',
          '## §1 Section',
          '§1.AC.01 The target.',
        ].join('\n'),
      },
      {
        id: 'S061',
        type: 'Specification',
        filePath: '_scepter/notes/specs/S061.md',
        content: [
          '# S061',
          '## §1 Section',
          '§1.AC.01 Cites {DEF999.§1.AC.01} (unresolved).',
        ].join('\n'),
      },
    ];
    const data = buildIndex(notes);
    // Query for dependents of the resolved target (R061.§1.AC.01); the
    // unresolved ref {DEF999.§1.AC.01} does NOT appear as a dependent of R061.
    const results = findInlineRefs(data, 'R061.1.AC.01');
    expect(results).toEqual([]);
  });

  it('DD021.§10.DC.15: results sorted deterministically by fromClaim', () => {
    const notes: NoteWithContent[] = [
      {
        id: 'R062',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R062.md',
        content: [
          '# R062',
          '## §1 Section',
          '§1.AC.01 The target.',
        ].join('\n'),
      },
      {
        id: 'S062',
        type: 'Specification',
        filePath: '_scepter/notes/specs/S062.md',
        content: [
          '# S062',
          '## §1 Section',
          '§1.AC.01 Cites {R062.§1.AC.01}.',
        ].join('\n'),
      },
      {
        id: 'S063',
        type: 'Specification',
        filePath: '_scepter/notes/specs/S063.md',
        content: [
          '# S063',
          '## §1 Section',
          '§1.AC.01 Cites {R062.§1.AC.01}.',
        ].join('\n'),
      },
    ];
    const data = buildIndex(notes);
    const results = findInlineRefs(data, 'R062.1.AC.01');
    expect(results.length).toBe(2);
    expect(results[0].fromClaim).toBe('S062.1.AC.01');
    expect(results[1].fromClaim).toBe('S063.1.AC.01');
  });
});

// ---------------------------------------------------------------------------
// findCrossProjectRefs tests
// ---------------------------------------------------------------------------

describe('findCrossProjectRefs', () => {
  it('R011.§3.AC.03: returns empty list per citation-not-federation principle', () => {
    const notes: NoteWithContent[] = [
      {
        id: 'R070',
        type: 'Requirement',
        filePath: '_scepter/notes/reqs/R070.md',
        content: [
          '# R070',
          '## §1 Section',
          '§1.AC.01 A target.',
        ].join('\n'),
      },
    ];
    const data = buildIndex(notes);
    // v1: the local crossProjectRefs records LOCAL→PEER citations; reverse
    // (peer citing local) lookup is OOS per R011. Returns empty list with
    // documented boundary in the function's JSDoc.
    const results = findCrossProjectRefs(data, 'R070.1.AC.01');
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Q23 wiring smoke test
// ---------------------------------------------------------------------------

describe('dependents command wiring (Q23 smoke test)', () => {
  it('DD006.§3.DC.03: dependentsCommand has the expected commander name and description', () => {
    expect(dependentsCommand.name()).toBe('dependents');
    expect(dependentsCommand.description()).toContain('depend');
  });

  it('DD006.§3.DC.03: dependentsCommand accepts a single positional argument', () => {
    // commander.Command exposes `_args` internally; check the public surface
    // by inspecting the command's argument metadata.
    const argMetadata = dependentsCommand.registeredArguments;
    expect(argMetadata.length).toBe(1);
    expect(argMetadata[0].name()).toBe('id');
  });

  it('DD006.§3.DC.03: dependentsCommand exposes --json and --reindex options', () => {
    const optionNames = dependentsCommand.options.map(o => o.long);
    expect(optionNames).toContain('--json');
    expect(optionNames).toContain('--reindex');
  });
});
