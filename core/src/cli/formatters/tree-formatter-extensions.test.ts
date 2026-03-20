import { describe, it, expect } from 'vitest';
import { formatTree, type TreeOptions } from './tree-formatter';
import type { Note } from '../../types/note';

describe('Tree Formatter Extensions', () => {
  const createNote = (
    id: string,
    title: string,
    tags: string[] = [],
    content: string = '',
    refs: { incoming: number; outgoing: number } = { incoming: 0, outgoing: 0 },
  ): Note => ({
    id,
    type: 'Decision',
    title,
    content,
    tags,
    created: new Date('2024-01-01'),
    references: {
      incoming: new Array(refs.incoming).fill(null).map((_, i) => ({
        fromId: `FROM${i}`,
        toId: id,
        line: 0,
      })),
      outgoing: new Array(refs.outgoing).fill(null).map((_, i) => ({
        fromId: id,
        toId: `TO${i}`,
        line: 0,
      })),
    },
  });

  describe('new formatting options', () => {
    it('should show tags inline when showInlineTags is true', () => {
      const note = createNote('D001', 'Use JWT', ['auth', 'security']);
      const allNotes = new Map([[note.id, note]]);

      const options: TreeOptions = {
        showInlineTags: true,
        showDetails: false,
      };

      const result = formatTree([note], allNotes, options);
      expect(result).toContain('[auth, security]');
      expect(result).not.toContain('Tags:'); // Should not show in details section
    });

    it('should show reference counts inline when showInlineRefCounts is true', () => {
      const note = createNote('D001', 'Use JWT', [], '', { incoming: 2, outgoing: 3 });
      const allNotes = new Map([[note.id, note]]);

      const options: TreeOptions = {
        showInlineRefCounts: true,
        showDetails: false,
      };

      const result = formatTree([note], allNotes, options);
      expect(result).toContain('(2/3)');
      expect(result).not.toContain('References:'); // Should not show in details section
    });

    it('should show character count when showCharCount is true', () => {
      const tests = [
        { size: 100, expected: '(100 chars)' },
        { size: 999, expected: '(999 chars)' },
        { size: 1000, expected: '(1.0k chars)' },
        { size: 1234, expected: '(1.2k chars)' },
        { size: 12345, expected: '(12.3k chars)' },
        { size: 123456, expected: '(123.5k chars)' },
        { size: 1234567, expected: '(1.2m chars)' },
      ];

      tests.forEach(({ size, expected }) => {
        const note = createNote('N001', 'Test', [], 'X'.repeat(size));
        const allNotes = new Map([[note.id, note]]);

        const options: TreeOptions = {
          showCharCount: true,
        };

        const result = formatTree([note], allNotes, options);
        expect(result).toContain(expected);
      });
    });

    it('should show discovery source when provided for child nodes', () => {
      const root = createNote('T001', 'Root Task');
      const child = createNote('D001', 'Test Decision');

      // Set up references
      root.references!.outgoing = [{ fromId: 'T001', toId: 'D001', line: 0 }];

      const rootWithOrigin = { ...root, _discoverySource: 'origin' as const };
      const childWithDiscovery = { ...child, _discoverySource: 'pattern' as const };

      const allNotes = new Map<string, Note & { _discoverySource?: string }>([
        ['T001', rootWithOrigin],
        ['D001', childWithDiscovery],
      ]);

      const options: TreeOptions = {
        showDiscoverySource: true,
        maxDepth: 1,
      };

      const result = formatTree([rootWithOrigin], allNotes, options);
      // Root node has no prefix
      expect(result).toContain('T001 - Root Task');
      // Pattern and tag use ~ instead of →
      expect(result).toContain('~ D001');
      expect(result).not.toContain('→ D001 - Test Decision');
    });

    it('should hide type when showType is false', () => {
      const note = createNote('D001', 'Test Decision');
      const allNotes = new Map([[note.id, note]]);

      const options: TreeOptions = {
        showType: false,
      };

      const result = formatTree([note], allNotes, options);
      expect(result).not.toContain('[Decision]');
    });

    it('should show all inline options together', () => {
      const note = createNote('D001', 'Test Decision', ['auth', 'security'], 'X'.repeat(1500), {
        incoming: 2,
        outgoing: 3,
      });
      const allNotes = new Map([[note.id, note]]);

      const options: TreeOptions = {
        showInlineTags: true,
        showInlineRefCounts: true,
        showCharCount: true,
        showType: false,
      };

      const result = formatTree([note], allNotes, options);

      // Should contain all elements in the right order
      expect(result).toContain('D001 - Test Decision [auth, security] (2/3) (1.5k chars)');
      expect(result).not.toContain('[Decision]'); // Type should be hidden
    });
  });

  describe('legend and stats', () => {
    it('should show legend when includeLegend is true', () => {
      const note = createNote('D001', 'Test');
      const allNotes = new Map([[note.id, note]]);

      const options: TreeOptions = {
        includeLegend: true,
      };

      const result = formatTree([note], allNotes, options);
      expect(result).toContain('Legend: ↻ = circular reference');
    });

    it('should show stats when includeStats is true', () => {
      const note1 = createNote('D001', 'Decision 1');
      const note2 = createNote('D002', 'Decision 2');
      const patternNote = { ...note2, _discoverySource: 'pattern' as const };

      const allNotes = new Map([
        [note1.id, note1],
        [note2.id, patternNote],
      ]);

      const options: TreeOptions = {
        includeStats: true,
        showDiscoverySource: true,
      };

      const result = formatTree([note1, patternNote], allNotes, options);
      expect(result).toContain('Stats:');
      expect(result).toContain('2 notes');
    });
  });

  describe('backward compatibility', () => {
    it('should maintain existing behavior when no new options are set', () => {
      const note = createNote('D001', 'Test Decision', ['auth'], 'Content here');
      const allNotes = new Map([[note.id, note]]);

      const result = formatTree([note], allNotes, {});

      // Should show type in brackets
      expect(result).toContain('[Decision]');
      // Should not show inline tags or ref counts
      expect(result).not.toContain('[auth]');
      expect(result).not.toContain('(0/0)');
      // Should not show char count
      expect(result).not.toContain('chars)');
    });

    it('should still support showDetails option', () => {
      const note = createNote('D001', 'Test Decision', ['auth'], 'Content here', { incoming: 1, outgoing: 2 });
      const allNotes = new Map([[note.id, note]]);

      const options: TreeOptions = {
        showDetails: true,
        showReferences: true,
      };

      const result = formatTree([note], allNotes, options);

      // Should show details in separate lines
      expect(result).toContain('Tags: auth');
      expect(result).toContain('References: 1 incoming, 2 outgoing');
    });
  });

  describe('tree structure with discovery sources', () => {
    it('should show different symbols for different discovery sources', () => {
      const note1 = createNote('T001', 'Task');
      const note2 = createNote('D001', 'Decision');
      const note3 = createNote('C001', 'Component');

      // Add discovery sources
      const taskNote = { ...note1, _discoverySource: 'origin' as const };
      const decisionNote = { ...note2, _discoverySource: 'reference' as const };
      const componentNote = { ...note3, _discoverySource: 'pattern' as const };

      // Set up references
      taskNote.references!.outgoing = [{ fromId: 'T001', toId: 'D001', line: 0 }];
      decisionNote.references!.outgoing = [{ fromId: 'D001', toId: 'C001', line: 0 }];

      const allNotes = new Map<string, Note & { _discoverySource?: string }>([
        ['T001', taskNote],
        ['D001', decisionNote],
        ['C001', componentNote],
      ]);

      const options: TreeOptions = {
        showDiscoverySource: true,
        maxDepth: 2,
      };

      const result = formatTree([taskNote], allNotes, options);

      // Origin has no prefix
      expect(result).toMatch(/^T001/m);
      // References use →
      expect(result).toContain('→ D001');
      // Pattern uses ~
      expect(result).toContain('~ C001');
    });
  });
});
