/**
 * Tests for formatClaimThread and formatClaimThreadJson.
 *
 * @validates {DD005.§DC.23} Tree output format with indentation and box-drawing
 * @validates {DD005.§DC.24} JSON output format
 */
import { describe, it, expect } from 'vitest';
import { formatClaimThread, formatClaimThreadJson } from '../claim-formatter';
import type { ClaimThreadNode } from '../../../claims/claim-thread';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip ANSI escape codes from a string for assertion comparisons.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[[0-9;]*m/g, '');
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const simpleThread: ClaimThreadNode = {
  claim: 'R010.1.AC.01',
  relationship: 'root',
  title: '§1.AC.01 The system MUST support widgets.',
  children: [
    {
      claim: 'DD010.DC.01',
      relationship: 'derives-into',
      title: '§DC.01 The WidgetEngine MUST register all widget types.',
      children: [],
    },
    {
      claim: 'R010.1.AC.01',
      relationship: '@implements',
      file: 'src/widgets/engine.ts',
      line: 42,
      children: [],
    },
    {
      claim: 'R010.1.AC.01',
      relationship: '@validates',
      file: 'src/widgets/__tests__/engine.test.ts',
      line: 15,
      children: [],
    },
    {
      claim: 'R010.1.AC.01',
      relationship: 'referenced-by',
      noteId: 'S010',
      line: 7,
      children: [],
    },
    {
      claim: 'R010.1.AC.01',
      relationship: 'verified',
      date: '2026-03-18',
      actor: 'developer',
      method: 'code-review',
      children: [],
    },
  ],
};

const nestedThread: ClaimThreadNode = {
  claim: 'R010.1.AC.01',
  relationship: 'root',
  title: '§1.AC.01 The system MUST support widgets.',
  children: [
    {
      claim: 'DD010.DC.01',
      relationship: 'derives-into',
      title: '§DC.01 The WidgetEngine registers types.',
      children: [
        {
          claim: 'R010.1.AC.01',
          relationship: 'derives-from',
          title: '§1.AC.01 The system MUST support widgets.',
          children: [],
        },
        {
          claim: 'DD010.DC.01',
          relationship: '@implements',
          file: 'src/widgets/engine.ts',
          line: 89,
          children: [],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests: formatClaimThread
// ---------------------------------------------------------------------------

describe('formatClaimThread', () => {
  // @validates {DD005.§DC.23} Tree contains root claim ID
  it('renders root claim ID and title on the first line', () => {
    const output = stripAnsi(formatClaimThread([simpleThread]));
    expect(output).toContain('R010.1.AC.01:');
    expect(output).toContain('The system MUST support widgets.');
  });

  // @validates {DD005.§DC.23} Tree uses box-drawing characters
  it('uses box-drawing connectors for child nodes', () => {
    const output = stripAnsi(formatClaimThread([simpleThread]));
    // Should contain tree connectors
    expect(output).toContain('\u251C\u2500'); // ├─
    expect(output).toContain('\u2514\u2500'); // └─
  });

  it('renders derives-into with claim ID and title', () => {
    const output = stripAnsi(formatClaimThread([simpleThread]));
    expect(output).toContain('derives-into:');
    expect(output).toContain('DD010.DC.01');
  });

  it('renders @implements with file path and line', () => {
    const output = stripAnsi(formatClaimThread([simpleThread]));
    expect(output).toContain('@implements:');
    expect(output).toContain('src/widgets/engine.ts:42');
  });

  it('renders @validates with file path and line', () => {
    const output = stripAnsi(formatClaimThread([simpleThread]));
    expect(output).toContain('@validates:');
    expect(output).toContain('engine.test.ts:15');
  });

  it('renders referenced-by with note ID', () => {
    const output = stripAnsi(formatClaimThread([simpleThread]));
    expect(output).toContain('referenced-by:');
    expect(output).toContain('S010');
  });

  it('renders verified with date, actor, and method', () => {
    const output = stripAnsi(formatClaimThread([simpleThread]));
    expect(output).toContain('verified:');
    expect(output).toContain('2026-03-18');
    expect(output).toContain('developer');
    expect(output).toContain('code-review');
  });

  it('renders nested tree with proper indentation', () => {
    const output = stripAnsi(formatClaimThread([nestedThread]));
    const lines = output.split('\n');
    // Root line should not be indented
    expect(lines[0]).toMatch(/^R010/);
    // First child should be indented 2 spaces + connector
    expect(lines[1]).toMatch(/^\s+[\u2514\u251C]/);
    // Grandchildren should be further indented
    const grandchildLines = lines.filter((l) => l.includes('derives-from:'));
    expect(grandchildLines.length).toBeGreaterThan(0);
  });

  it('renders multiple root nodes with blank lines between them', () => {
    const secondThread: ClaimThreadNode = {
      claim: 'R010.1.AC.02',
      relationship: 'root',
      title: '§1.AC.02 The system MUST validate widget input.',
      children: [],
    };
    const output = stripAnsi(formatClaimThread([simpleThread, secondThread]));
    expect(output).toContain('R010.1.AC.01:');
    expect(output).toContain('R010.1.AC.02:');
    // There should be a blank line between the two threads
    expect(output).toContain('\n\n');
  });
});

// ---------------------------------------------------------------------------
// Tests: formatClaimThreadJson
// ---------------------------------------------------------------------------

describe('formatClaimThreadJson', () => {
  // @validates {DD005.§DC.24} JSON with claim, relationship, children fields
  it('produces valid JSON with expected structure', () => {
    const output = formatClaimThreadJson([simpleThread]);
    const parsed = JSON.parse(output);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);

    const root = parsed[0];
    expect(root.claim).toBe('R010.1.AC.01');
    expect(root.relationship).toBe('root');
    expect(Array.isArray(root.children)).toBe(true);
    expect(root.children.length).toBe(5);
  });

  it('includes file and line for source references', () => {
    const output = formatClaimThreadJson([simpleThread]);
    const parsed = JSON.parse(output);
    const root = parsed[0];

    const implNode = root.children.find(
      (c: ClaimThreadNode) => c.relationship === '@implements',
    );
    expect(implNode).toBeDefined();
    expect(implNode.file).toBe('src/widgets/engine.ts');
    expect(implNode.line).toBe(42);
  });

  it('includes noteId for referenced-by nodes', () => {
    const output = formatClaimThreadJson([simpleThread]);
    const parsed = JSON.parse(output);
    const root = parsed[0];

    const refNode = root.children.find(
      (c: ClaimThreadNode) => c.relationship === 'referenced-by',
    );
    expect(refNode).toBeDefined();
    expect(refNode.noteId).toBe('S010');
  });

  it('includes verification details for verified nodes', () => {
    const output = formatClaimThreadJson([simpleThread]);
    const parsed = JSON.parse(output);
    const root = parsed[0];

    const verNode = root.children.find(
      (c: ClaimThreadNode) => c.relationship === 'verified',
    );
    expect(verNode).toBeDefined();
    expect(verNode.date).toContain('2026-03-18');
    expect(verNode.actor).toBe('developer');
    expect(verNode.method).toBe('code-review');
  });
});
