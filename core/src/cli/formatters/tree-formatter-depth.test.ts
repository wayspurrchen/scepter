import { describe, it, expect } from 'vitest';
import { formatTreeView } from './tree-formatter.test';
import type { Note } from '../../types/note';
import type { Reference } from '../../types/reference';

describe('Tree Formatter Depth Limits', () => {
  // Create a deeply nested structure
  const createDeepStructure = () => {
    const notes: Note[] = [];

    // Create 30 notes with complex interconnections
    for (let i = 1; i <= 30; i++) {
      const id = `N${i.toString().padStart(3, '0')}`;
      const incoming: string[] = [];
      const outgoing: string[] = [];

      // Each note references the next 3 notes (creating a complex graph)
      for (let j = 1; j <= 3; j++) {
        const targetId = `N${(((i + j - 1) % 30) + 1).toString().padStart(3, '0')}`;
        outgoing.push(targetId);
      }

      // Add incoming references
      for (let j = 1; j <= 30; j++) {
        if (j !== i) {
          const sourceId = `N${j.toString().padStart(3, '0')}`;
          for (let k = 1; k <= 3; k++) {
            if (((j + k - 1) % 30) + 1 === i) {
              incoming.push(sourceId);
            }
          }
        }
      }

      notes.push({
        id,
        type: 'test',
        title: `Note ${i}`,
        content: `Content for note ${i}`,
        tags: [],
        created: new Date('2024-01-01'),
        references: {
          incoming: incoming.map((fromId) => ({ fromId, toId: id, line: 0 }) as Reference),
          outgoing: outgoing.map((toId) => ({ fromId: id, toId, line: 0 }) as Reference),
        },
      });
    }

    return notes;
  };

  const createMockFunctions = (notes: Note[]) => {
    const noteMap = new Map(notes.map((n) => [n.id, n]));

    const getReferencesFn = (noteId: string): Reference[] => {
      const note = noteMap.get(noteId);
      return note?.references?.outgoing || [];
    };

    const getNoteByIdFn = (noteId: string): Note | null => {
      return noteMap.get(noteId) || null;
    };

    return { getReferencesFn, getNoteByIdFn };
  };

  it('should strictly limit output at depth 0', () => {
    const notes = createDeepStructure();
    const { getReferencesFn, getNoteByIdFn } = createMockFunctions(notes);

    // Show only first 5 notes with depth 0
    const result = formatTreeView(notes.slice(0, 5), getReferencesFn, getNoteByIdFn, 0);
    const lines = result.split('\n');

    // Should have exactly 9 lines: 5 notes + 4 empty lines between them
    expect(lines.length).toBe(9);

    // No tree branches should appear
    expect(result).not.toContain('├──');
    expect(result).not.toContain('└──');
  });

  it('should limit expansion at depth 1', () => {
    const notes = createDeepStructure();
    const { getReferencesFn, getNoteByIdFn } = createMockFunctions(notes);

    // Show only first 3 notes with depth 1
    const result = formatTreeView(notes.slice(0, 3), getReferencesFn, getNoteByIdFn, 1);
    const lines = result.split('\n');

    // Each note has 3 children, so: 3 root notes + 2 empty lines + (3 * 3) child nodes = 14 lines
    expect(lines.length).toBe(14);

    // Should contain first level branches
    expect(result).toContain('├──');
    expect(result).toContain('└──');

    // But no second level indentation
    expect(result).not.toContain('│   ├──');
    expect(result).not.toContain('│   └──');
  });

  it('should limit expansion at depth 2', () => {
    const notes = createDeepStructure();
    const { getReferencesFn, getNoteByIdFn } = createMockFunctions(notes);

    // Show only first 2 notes with depth 2
    const result = formatTreeView(notes.slice(0, 2), getReferencesFn, getNoteByIdFn, 2);
    const lines = result.split('\n');

    // Should contain second level indentation
    expect(result).toContain('│   ├──');
    expect(result).toContain('│   └──');

    // But no third level
    expect(result).not.toContain('│   │   ├──');

    // Should have reasonable number of lines
    expect(lines.length).toBeLessThan(50);
  });

  it('should handle 24 notes with depth 2 reasonably', () => {
    const notes = createDeepStructure().slice(0, 24);
    const { getReferencesFn, getNoteByIdFn } = createMockFunctions(notes);

    const result = formatTreeView(notes, getReferencesFn, getNoteByIdFn, 2);
    const lines = result.split('\n');

    // With 24 root notes and depth 2, we expect a lot of output but not 800+ lines
    // Each root note can expand to show its children (depth 1) and their children (depth 2)
    // console.log(`Total lines for 24 notes at depth 2: ${lines.length}`);

    // Should be significantly less than 800 lines
    expect(lines.length).toBeLessThan(400);

    // With 24 notes, each showing 3 children at depth 1 and 3 more at depth 2
    // We get approximately: 24 root + 23 empty lines + (24 * 3) + (24 * 3 * 3) = ~293 lines
    expect(lines.length).toBeGreaterThan(200);
    expect(lines.length).toBeLessThan(400);
  });

  it('should show reasonable output for typical use case', () => {
    const notes = createDeepStructure().slice(0, 10);
    const { getReferencesFn, getNoteByIdFn } = createMockFunctions(notes);

    // Typical use: show 10 notes with depth 2
    const result = formatTreeView(notes, getReferencesFn, getNoteByIdFn, 2);
    const lines = result.split('\n');

    // Should be manageable
    expect(lines.length).toBeLessThan(200);
  });

  it('should properly detect circular references', () => {
    // Create a simple circular structure
    const notes: Note[] = [
      {
        id: 'A',
        type: 'test',
        title: 'Note A',
        content: 'Content A',
        tags: [],
        created: new Date('2024-01-01'),
        references: {
          incoming: [{ fromId: 'C', toId: 'A', line: 0 } as Reference],
          outgoing: [{ fromId: 'A', toId: 'B', line: 0 } as Reference],
        },
      },
      {
        id: 'B',
        type: 'test',
        title: 'Note B',
        content: 'Content B',
        tags: [],
        created: new Date('2024-01-01'),
        references: {
          incoming: [{ fromId: 'A', toId: 'B', line: 0 } as Reference],
          outgoing: [{ fromId: 'B', toId: 'C', line: 0 } as Reference],
        },
      },
      {
        id: 'C',
        type: 'test',
        title: 'Note C',
        content: 'Content C',
        tags: [],
        created: new Date('2024-01-01'),
        references: {
          incoming: [{ fromId: 'B', toId: 'C', line: 0 } as Reference],
          outgoing: [{ fromId: 'C', toId: 'A', line: 0 } as Reference],
        },
      },
    ];

    const { getReferencesFn, getNoteByIdFn } = createMockFunctions(notes);

    // Show with depth 5 to ensure we'd hit the cycle
    const result = formatTreeView([notes[0]], getReferencesFn, getNoteByIdFn, 5);

    // Should detect the circular reference
    expect(result).toContain('↻');

    // Should show the path A -> B -> C -> A [↻]
    expect(result).toContain('A Note A');
    expect(result).toContain('└── → B Note B');
    expect(result).toContain('    └── → C Note C');
    expect(result).toContain('        └── → A ↻');
  });
});
