/**
 * Tests for derivation-related display in claim formatters.
 *
 * Covers:
 * - Phase 4: ←SOURCE indicator in trace matrix, derivedFrom in single-claim trace, --show-derived
 * - Phase 5: derivationStatus in gap reports, --show-derived expansion
 * - Phase 6: formatErrorType for all 8 derivation error types
 *
 * @validates {R006.§4.AC.01} Trace displays derivation links
 * @validates {R006.§4.AC.02} --show-derived expands derivative sub-rows
 * @validates {R006.§4.AC.03} Default trace shows ←SOURCE indicator
 * @validates {R006.§3.AC.02} derivationStatus display in gap reports
 * @validates {R006.§3.AC.03} --show-derived in gap reports
 * @validates {R006.§5.AC.01} Derivation error type labels
 * @validates {R006.§5.AC.02} Deep chain and circular error type labels
 * @validates {R006.§5.AC.03} Partial derivation coverage error type label
 */
import { describe, it, expect } from 'vitest';
import {
  formatTraceabilityMatrix,
  formatClaimTrace,
  formatGapReport,
  formatLintResults,
  clearFileCache,
} from '../claim-formatter';
import type { TraceabilityMatrix, GapReport } from '../../../claims/index';
import type { ClaimIndexEntry, ClaimCrossReference } from '../../../claims/index';
import type { ClaimTreeError } from '../../../parsers/claim/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<import('../../../claims/traceability').TraceabilityRow> & { claimId: string }): import('../../../claims/traceability').TraceabilityRow {
  return {
    claimPrefix: 'AC',
    claimNumber: 1,
    heading: 'Test claim',
    sectionPath: [1],
    metadata: [],
    derivedFrom: [],
    projections: new Map(),
    ...overrides,
  };
}

function makeEntry(overrides: Partial<ClaimIndexEntry> & { fullyQualified: string }): ClaimIndexEntry {
  return {
    noteId: 'DD003',
    claimId: '1.DC.01',
    sectionPath: [1],
    claimPrefix: 'DC',
    claimNumber: 1,
    heading: 'Test design claim',
    line: 5,
    endLine: 6,
    metadata: [],
    parsedTags: [],
    derivedFrom: [],
    noteType: 'DetailedDesign',
    noteFilePath: 'DD003.md',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Phase 4: Trace matrix ←SOURCE indicator
// @validates {R006.§4.AC.03}
// ---------------------------------------------------------------------------

describe('formatTraceabilityMatrix — derivation indicator', () => {
  it('should show ←SOURCE indicator for derived claims', () => {
    const matrix: TraceabilityMatrix = {
      sourceNoteId: 'DD003',
      sourceNoteType: 'DetailedDesign',
      rows: [
        makeRow({
          claimId: 'DD003.1.DC.01',
          heading: 'Design claim',
          derivedFrom: ['R005.1.AC.01'],
          projections: new Map([
            ['Requirement', [{ noteId: 'R005', noteType: 'Requirement' }]],
          ]),
        }),
      ],
      projectionTypes: ['Requirement'],
    };

    const output = formatTraceabilityMatrix(matrix);
    // The ← arrow character should appear in the output
    expect(output).toContain('\u2190R005.1.AC.01');
  });

  it('should show +N for claims derived from multiple sources', () => {
    const matrix: TraceabilityMatrix = {
      sourceNoteId: 'DD003',
      sourceNoteType: 'DetailedDesign',
      rows: [
        makeRow({
          claimId: 'DD003.1.DC.01',
          heading: 'Multi-derived claim',
          derivedFrom: ['R005.1.AC.01', 'R005.1.AC.02'],
          projections: new Map([
            ['Requirement', [{ noteId: 'R005', noteType: 'Requirement' }]],
          ]),
        }),
      ],
      projectionTypes: ['Requirement'],
    };

    const output = formatTraceabilityMatrix(matrix);
    expect(output).toContain('\u2190R005.1.AC.01+1');
  });

  it('should not show indicator for non-derived claims', () => {
    const matrix: TraceabilityMatrix = {
      sourceNoteId: 'R005',
      sourceNoteType: 'Requirement',
      rows: [
        makeRow({
          claimId: 'R005.1.AC.01',
          heading: 'Source claim',
          derivedFrom: [],
          projections: new Map([
            ['DetailedDesign', [{ noteId: 'DD003', noteType: 'DetailedDesign' }]],
          ]),
        }),
      ],
      projectionTypes: ['DetailedDesign'],
    };

    const output = formatTraceabilityMatrix(matrix);
    expect(output).not.toContain('\u2190');
  });
});

// ---------------------------------------------------------------------------
// Phase 4: formatTraceabilityMatrix --show-derived sub-row expansion
// @validates {R006.§4.AC.02}
// ---------------------------------------------------------------------------

describe('formatTraceabilityMatrix — --show-derived sub-rows', () => {
  it('should show [derived:OK] marker when all derivatives have Source coverage', () => {
    const matrix: TraceabilityMatrix = {
      sourceNoteId: 'R005',
      sourceNoteType: 'Requirement',
      rows: [
        makeRow({
          claimId: 'R005.1.AC.01',
          heading: 'Source claim with derivatives',
          derivedFrom: [],
          projections: new Map([
            ['DetailedDesign', [{ noteId: 'DD003', noteType: 'DetailedDesign' }]],
          ]),
        }),
      ],
      projectionTypes: ['DetailedDesign'],
    };

    const output = formatTraceabilityMatrix(matrix, {
      showDerived: true,
      getDerivatives: (fqid: string) =>
        fqid === 'R005.1.AC.01' ? ['DD003.1.DC.01', 'DD003.1.DC.02'] : [],
      getClaimEntry: (fqid: string) => makeEntry({
        fullyQualified: fqid,
        heading: `Derivative ${fqid}`,
      }),
      hasSourceCoverage: () => true, // all have Source coverage
    });

    expect(output).toContain('[derived:OK]');
  });

  it('should show [derived:partial N/M] marker when some derivatives lack Source coverage', () => {
    const matrix: TraceabilityMatrix = {
      sourceNoteId: 'R005',
      sourceNoteType: 'Requirement',
      rows: [
        makeRow({
          claimId: 'R005.1.AC.01',
          heading: 'Partially covered',
          derivedFrom: [],
          projections: new Map([
            ['DetailedDesign', [{ noteId: 'DD003', noteType: 'DetailedDesign' }]],
          ]),
        }),
      ],
      projectionTypes: ['DetailedDesign'],
    };

    const output = formatTraceabilityMatrix(matrix, {
      showDerived: true,
      getDerivatives: (fqid: string) =>
        fqid === 'R005.1.AC.01' ? ['DD003.1.DC.01', 'DD003.1.DC.02', 'DD003.1.DC.03'] : [],
      getClaimEntry: (fqid: string) => makeEntry({
        fullyQualified: fqid,
        heading: `Derivative ${fqid}`,
      }),
      hasSourceCoverage: (fqid: string) => fqid === 'DD003.1.DC.01', // only first has coverage
    });

    expect(output).toContain('[derived:partial 1/3]');
  });

  it('should insert indented sub-rows for each derivative', () => {
    const derivEntry1 = makeEntry({
      fullyQualified: 'DD003.1.DC.01',
      heading: 'First design claim',
    });
    const derivEntry2 = makeEntry({
      fullyQualified: 'DD003.1.DC.02',
      heading: 'Second design claim',
    });

    const matrix: TraceabilityMatrix = {
      sourceNoteId: 'R005',
      sourceNoteType: 'Requirement',
      rows: [
        makeRow({
          claimId: 'R005.1.AC.01',
          heading: 'Source claim',
          derivedFrom: [],
          projections: new Map([
            ['DetailedDesign', [{ noteId: 'DD003', noteType: 'DetailedDesign' }]],
          ]),
        }),
      ],
      projectionTypes: ['DetailedDesign'],
    };

    const output = formatTraceabilityMatrix(matrix, {
      showDerived: true,
      getDerivatives: (fqid: string) =>
        fqid === 'R005.1.AC.01' ? ['DD003.1.DC.01', 'DD003.1.DC.02'] : [],
      getClaimEntry: (fqid: string) => {
        if (fqid === 'DD003.1.DC.01') return derivEntry1;
        if (fqid === 'DD003.1.DC.02') return derivEntry2;
        return null;
      },
      hasSourceCoverage: (fqid: string) => fqid === 'DD003.1.DC.01',
    });

    // Sub-rows should contain derivative FQIDs
    expect(output).toContain('DD003.1.DC.01');
    expect(output).toContain('DD003.1.DC.02');
    // Should contain the box-drawing sub-row indicator
    expect(output).toContain('\u2514\u2500');
  });

  it('should not insert sub-rows when --show-derived is not active', () => {
    const matrix: TraceabilityMatrix = {
      sourceNoteId: 'R005',
      sourceNoteType: 'Requirement',
      rows: [
        makeRow({
          claimId: 'R005.1.AC.01',
          heading: 'Source claim',
          derivedFrom: [],
          projections: new Map([
            ['DetailedDesign', [{ noteId: 'DD003', noteType: 'DetailedDesign' }]],
          ]),
        }),
      ],
      projectionTypes: ['DetailedDesign'],
    };

    const output = formatTraceabilityMatrix(matrix, {
      showDerived: false,
      getDerivatives: () => ['DD003.1.DC.01'],
    });

    // Should not contain derivative sub-rows or markers
    expect(output).not.toContain('[derived:');
    expect(output).not.toContain('\u2514\u2500');
  });

  it('should not show markers for claims without derivatives', () => {
    const matrix: TraceabilityMatrix = {
      sourceNoteId: 'R005',
      sourceNoteType: 'Requirement',
      rows: [
        makeRow({
          claimId: 'R005.1.AC.01',
          heading: 'No derivatives claim',
          derivedFrom: [],
          projections: new Map([
            ['DetailedDesign', [{ noteId: 'DD003', noteType: 'DetailedDesign' }]],
          ]),
        }),
      ],
      projectionTypes: ['DetailedDesign'],
    };

    const output = formatTraceabilityMatrix(matrix, {
      showDerived: true,
      getDerivatives: () => [], // no derivatives
      getClaimEntry: () => null,
      hasSourceCoverage: () => false,
    });

    expect(output).not.toContain('[derived:');
    expect(output).not.toContain('\u2514\u2500');
  });

  it('should show check/cross marks for Source coverage on sub-rows', () => {
    const matrix: TraceabilityMatrix = {
      sourceNoteId: 'R005',
      sourceNoteType: 'Requirement',
      rows: [
        makeRow({
          claimId: 'R005.1.AC.01',
          heading: 'Source claim',
          derivedFrom: [],
          projections: new Map([
            ['DetailedDesign', [{ noteId: 'DD003', noteType: 'DetailedDesign' }]],
          ]),
        }),
      ],
      projectionTypes: ['DetailedDesign'],
    };

    const output = formatTraceabilityMatrix(matrix, {
      showDerived: true,
      getDerivatives: () => ['DD003.1.DC.01', 'DD003.1.DC.02'],
      getClaimEntry: (fqid: string) => makeEntry({ fullyQualified: fqid, heading: 'Deriv' }),
      hasSourceCoverage: (fqid: string) => fqid === 'DD003.1.DC.01',
    });

    // Check mark for covered, cross mark for uncovered
    expect(output).toContain('\u2713'); // ✓
    expect(output).toContain('\u2717'); // ✗
  });
});

// ---------------------------------------------------------------------------
// Phase 4: Single-claim trace derivation display
// @validates {R006.§4.AC.01}
// ---------------------------------------------------------------------------

describe('formatClaimTrace — derivation display', () => {
  it('should show "Derived from:" line when claim has derivedFrom', async () => {
    const entry = makeEntry({
      fullyQualified: 'DD003.1.DC.01',
      derivedFrom: ['R005.1.AC.01'],
    });

    const incoming: ClaimCrossReference[] = [];
    const noteTypes = new Map<string, string>([['DD003', 'DetailedDesign']]);

    const output = await formatClaimTrace(entry, incoming, noteTypes);
    expect(output).toContain('Derived from:');
    expect(output).toContain('R005.1.AC.01');
    clearFileCache();
  });

  it('should show multiple derivation sources', async () => {
    const entry = makeEntry({
      fullyQualified: 'DD003.1.DC.01',
      derivedFrom: ['R005.1.AC.01', 'R005.1.AC.02'],
    });

    const incoming: ClaimCrossReference[] = [];
    const noteTypes = new Map<string, string>([['DD003', 'DetailedDesign']]);

    const output = await formatClaimTrace(entry, incoming, noteTypes);
    expect(output).toContain('Derived from:');
    expect(output).toContain('R005.1.AC.01');
    expect(output).toContain('R005.1.AC.02');
    clearFileCache();
  });

  it('should not show "Derived from:" for non-derived claims', async () => {
    const entry = makeEntry({
      fullyQualified: 'R005.1.AC.01',
      derivedFrom: [],
    });

    const incoming: ClaimCrossReference[] = [];
    const noteTypes = new Map<string, string>([['R005', 'Requirement']]);

    const output = await formatClaimTrace(entry, incoming, noteTypes);
    expect(output).not.toContain('Derived from:');
    clearFileCache();
  });

  // @validates {R006.§4.AC.02}
  it('should show "Derivatives:" section when --show-derived is active', async () => {
    const entry = makeEntry({
      fullyQualified: 'R005.1.AC.01',
      noteId: 'R005',
      noteType: 'Requirement',
      derivedFrom: [],
    });

    const incoming: ClaimCrossReference[] = [];
    const noteTypes = new Map<string, string>([['R005', 'Requirement']]);

    const derivativeEntry = makeEntry({
      fullyQualified: 'DD003.1.DC.01',
      heading: 'Design claim for AC.01',
      derivedFrom: ['R005.1.AC.01'],
    });

    const output = await formatClaimTrace(entry, incoming, noteTypes, {
      showDerived: true,
      getDerivatives: (fqid: string) => fqid === 'R005.1.AC.01' ? ['DD003.1.DC.01'] : [],
      getClaimEntry: (fqid: string) => fqid === 'DD003.1.DC.01' ? derivativeEntry : null,
    });
    expect(output).toContain('Derivatives:');
    expect(output).toContain('DD003.1.DC.01');
    clearFileCache();
  });

  it('should not show "Derivatives:" when --show-derived is not active', async () => {
    const entry = makeEntry({
      fullyQualified: 'R005.1.AC.01',
      noteId: 'R005',
      noteType: 'Requirement',
      derivedFrom: [],
    });

    const incoming: ClaimCrossReference[] = [];
    const noteTypes = new Map<string, string>([['R005', 'Requirement']]);

    const output = await formatClaimTrace(entry, incoming, noteTypes, {
      showDerived: false,
      getDerivatives: () => ['DD003.1.DC.01'],
    });
    expect(output).not.toContain('Derivatives:');
    clearFileCache();
  });
});

// ---------------------------------------------------------------------------
// Phase 5: Gap report derivation status display
// @validates {R006.§3.AC.02}
// @validates {R006.§3.AC.03}
// ---------------------------------------------------------------------------

describe('formatGapReport — derivation status', () => {
  it('should show derivation coverage when derivationStatus is present', () => {
    const gaps: GapReport[] = [
      {
        claimId: 'R005.1.AC.01',
        presentIn: ['Requirement', 'DetailedDesign'],
        missingFrom: ['Source'],
        metadata: [],
        derivationStatus: {
          totalDerivatives: 3,
          coveredDerivatives: 2,
          uncoveredDerivatives: ['DD003.1.DC.03'],
        },
      },
    ];

    const output = formatGapReport(gaps);
    expect(output).toContain('Derivation coverage:');
    expect(output).toContain('2/3 derivatives covered');
  });

  it('should not show derivation coverage when no derivationStatus', () => {
    const gaps: GapReport[] = [
      {
        claimId: 'R005.1.AC.01',
        presentIn: ['Requirement'],
        missingFrom: ['Source'],
        metadata: [],
      },
    ];

    const output = formatGapReport(gaps);
    expect(output).not.toContain('Derivation coverage:');
  });

  it('should expand uncovered derivatives when showDerived is active', () => {
    const gaps: GapReport[] = [
      {
        claimId: 'R005.1.AC.01',
        presentIn: ['Requirement', 'DetailedDesign'],
        missingFrom: ['Source'],
        metadata: [],
        derivationStatus: {
          totalDerivatives: 2,
          coveredDerivatives: 1,
          uncoveredDerivatives: ['DD003.1.DC.02'],
        },
      },
    ];

    const output = formatGapReport(gaps, { showDerived: true });
    expect(output).toContain('Uncovered derivatives:');
    expect(output).toContain('DD003.1.DC.02');
  });

  it('should not expand uncovered derivatives when showDerived is not active', () => {
    const gaps: GapReport[] = [
      {
        claimId: 'R005.1.AC.01',
        presentIn: ['Requirement', 'DetailedDesign'],
        missingFrom: ['Source'],
        metadata: [],
        derivationStatus: {
          totalDerivatives: 2,
          coveredDerivatives: 1,
          uncoveredDerivatives: ['DD003.1.DC.02'],
        },
      },
    ];

    const output = formatGapReport(gaps);
    expect(output).not.toContain('Uncovered derivatives:');
    // Should still show the summary line
    expect(output).toContain('Derivation coverage:');
  });
});

// ---------------------------------------------------------------------------
// Phase 6: formatErrorType for derivation errors
// @validates {R006.§5.AC.01} error type labels
// @validates {R006.§5.AC.02} chain/circular labels
// @validates {R006.§5.AC.03} partial coverage label
// ---------------------------------------------------------------------------

describe('formatLintResults — derivation error types', () => {
  function makeLintError(type: string): ClaimTreeError {
    return {
      type,
      claimId: 'DD003.1.DC.01',
      line: 10,
      message: `Test message for ${type}`,
    };
  }

  it('should format invalid-derivation-target as red [INVALID-DERIVATION]', () => {
    const output = formatLintResults([makeLintError('invalid-derivation-target')]);
    expect(output).toContain('[INVALID-DERIVATION]');
  });

  it('should format deep-derivation-chain as yellow [DEEP-CHAIN]', () => {
    const output = formatLintResults([makeLintError('deep-derivation-chain')]);
    expect(output).toContain('[DEEP-CHAIN]');
  });

  it('should format partial-derivation-coverage as yellow [PARTIAL-DERIVATION]', () => {
    const output = formatLintResults([makeLintError('partial-derivation-coverage')]);
    expect(output).toContain('[PARTIAL-DERIVATION]');
  });

  it('should format circular-derivation as red [CIRCULAR-DERIVATION]', () => {
    const output = formatLintResults([makeLintError('circular-derivation')]);
    expect(output).toContain('[CIRCULAR-DERIVATION]');
  });

  it('should format self-derivation as red [SELF-DERIVATION]', () => {
    const output = formatLintResults([makeLintError('self-derivation')]);
    expect(output).toContain('[SELF-DERIVATION]');
  });

  it('should format derives-superseded-conflict as red [DERIVES-SUPERSEDED]', () => {
    const output = formatLintResults([makeLintError('derives-superseded-conflict')]);
    expect(output).toContain('[DERIVES-SUPERSEDED]');
  });

  it('should format derivation-from-removed as yellow [DERIVES-FROM-REMOVED]', () => {
    const output = formatLintResults([makeLintError('derivation-from-removed')]);
    expect(output).toContain('[DERIVES-FROM-REMOVED]');
  });

  it('should format derivation-from-superseded as yellow [DERIVES-FROM-SUPERSEDED]', () => {
    const output = formatLintResults([makeLintError('derivation-from-superseded')]);
    expect(output).toContain('[DERIVES-FROM-SUPERSEDED]');
  });

  it('should display all 8 error types correctly in a combined report', () => {
    const errors = [
      makeLintError('invalid-derivation-target'),
      makeLintError('deep-derivation-chain'),
      makeLintError('partial-derivation-coverage'),
      makeLintError('circular-derivation'),
      makeLintError('self-derivation'),
      makeLintError('derives-superseded-conflict'),
      makeLintError('derivation-from-removed'),
      makeLintError('derivation-from-superseded'),
    ];

    const output = formatLintResults(errors);
    expect(output).toContain('8 issue(s)');
    expect(output).toContain('[INVALID-DERIVATION]');
    expect(output).toContain('[DEEP-CHAIN]');
    expect(output).toContain('[PARTIAL-DERIVATION]');
    expect(output).toContain('[CIRCULAR-DERIVATION]');
    expect(output).toContain('[SELF-DERIVATION]');
    expect(output).toContain('[DERIVES-SUPERSEDED]');
    expect(output).toContain('[DERIVES-FROM-REMOVED]');
    expect(output).toContain('[DERIVES-FROM-SUPERSEDED]');
  });
});
