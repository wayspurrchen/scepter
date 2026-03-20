import { describe, it, expect, vi } from 'vitest';
import type { Note } from '../../types/note';
import type { Reference } from '../../types/reference';

// We'll test the tree formatting logic directly
export function formatTreeView(
  notes: Note[],
  getReferencesFn: (noteId: string) => Reference[],
  getNoteByIdFn: (noteId: string) => Note | null,
  depth: number = 2,
  compact: boolean = false,
): string {
  const lines: string[] = [];
  const visited = new Set<string>();
  const noteData = new Map<string, { title: string; refCount: { incoming: number; outgoing: number } }>();

  // Pre-populate note data for all notes to ensure correct titles
  for (const note of notes) {
    noteData.set(note.id, {
      title: note.title,
      refCount: {
        incoming: note.references?.incoming?.length || 0,
        outgoing: note.references?.outgoing?.length || 0,
      },
    });
  }

  // Track paths to detect cycles
  const pathStack: string[] = [];

  const displayNote = (
    note: Note,
    linePrefix: string = '',
    continuationPrefix: string = '',
    currentDepth: number = 0,
    isRootLevel: boolean = false,
  ) => {
    // Check for cycles
    if (pathStack.includes(note.id)) {
      lines.push(linePrefix + note.id + ' ↻');
      return;
    }

    // Add to path stack
    pathStack.push(note.id);

    // Build the display text
    let displayText = '';

    // For notes being displayed as children, check if they exist in noteData
    // If not, add them to ensure we have their proper title
    if (!noteData.has(note.id)) {
      noteData.set(note.id, {
        title: note.title,
        refCount: {
          incoming: note.references?.incoming?.length || 0,
          outgoing: note.references?.outgoing?.length || 0,
        },
      });
    }

    const data = noteData.get(note.id)!;
    const refCountStr = ` (${data.refCount.incoming}/${data.refCount.outgoing})`;

    if (compact && !isRootLevel && visited.has(note.id)) {
      // In compact mode, show ellipsis for already displayed nodes (except at root level)
      displayText = note.id + '...';
    } else {
      // Always show full title
      displayText = note.id + ' ' + data.title + refCountStr;
      visited.add(note.id);
    }

    lines.push(linePrefix + displayText);

    // Don't expand beyond specified depth
    if (currentDepth >= depth) {
      pathStack.pop();
      return;
    }

    // Get outgoing references
    const outgoingRefs = getReferencesFn(note.id);
    const childNotes: Note[] = [];

    // Collect child notes
    for (const ref of outgoingRefs) {
      const childNote = getNoteByIdFn(ref.toId);
      if (childNote) {
        childNotes.push(childNote);
      }
    }

    // Display children
    for (let index = 0; index < childNotes.length; index++) {
      const child = childNotes[index];
      const isLast = index === childNotes.length - 1;
      const childLinePrefix = continuationPrefix + (isLast ? '└── → ' : '├── → ');
      const childContinuationPrefix = continuationPrefix + (isLast ? '    ' : '│   ');

      displayNote(child, childLinePrefix, childContinuationPrefix, currentDepth + 1, false);
    }

    // Remove from path stack when done
    pathStack.pop();
  };

  // Process each root note
  for (let index = 0; index < notes.length; index++) {
    const note = notes[index];
    if (index > 0) {
      lines.push(''); // Empty line between root notes
    }
    displayNote(note, '', '', 0, true);
  }

  return lines.join('\n');
}

describe('Tree Formatter', () => {
  const createNote = (id: string, title: string, refs: { incoming: string[]; outgoing: string[] }): Note => ({
    id,
    type: 'test',
    title,
    content: `Content for ${id}`,
    tags: [],
    created: new Date('2024-01-01'),
    references: {
      incoming: refs.incoming.map((fromId) => ({ fromId, toId: id, line: 0 }) as Reference),
      outgoing: refs.outgoing.map((toId) => ({ fromId: id, toId, line: 0 }) as Reference),
    },
  });

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

  it('should respect depth limit of 0 (root only)', () => {
    const notes = [
      createNote('N001', 'First Note', { incoming: [], outgoing: ['N002'] }),
      createNote('N002', 'Second Note', { incoming: ['N001'], outgoing: ['N003'] }),
      createNote('N003', 'Third Note', { incoming: ['N002'], outgoing: [] }),
    ];

    const { getReferencesFn, getNoteByIdFn } = createMockFunctions(notes);
    const result = formatTreeView([notes[0]], getReferencesFn, getNoteByIdFn, 0);

    expect(result).toBe('N001 First Note (0/1)');
    expect(result).not.toContain('N002');
  });

  it('should respect depth limit of 1', () => {
    const notes = [
      createNote('N001', 'First Note', { incoming: [], outgoing: ['N002'] }),
      createNote('N002', 'Second Note', { incoming: ['N001'], outgoing: ['N003'] }),
      createNote('N003', 'Third Note', { incoming: ['N002'], outgoing: [] }),
    ];

    const { getReferencesFn, getNoteByIdFn } = createMockFunctions(notes);
    const result = formatTreeView([notes[0]], getReferencesFn, getNoteByIdFn, 1);

    expect(result).toContain('N001 First Note (0/1)');
    expect(result).toContain('└── → N002 Second Note (1/1)');
    expect(result).not.toContain('N003'); // Should not show depth 2
  });

  it('should respect depth limit of 2', () => {
    const notes = [
      createNote('N001', 'First Note', { incoming: [], outgoing: ['N002'] }),
      createNote('N002', 'Second Note', { incoming: ['N001'], outgoing: ['N003'] }),
      createNote('N003', 'Third Note', { incoming: ['N002'], outgoing: ['N004'] }),
      createNote('N004', 'Fourth Note', { incoming: ['N003'], outgoing: [] }),
    ];

    const { getReferencesFn, getNoteByIdFn } = createMockFunctions(notes);
    const result = formatTreeView([notes[0]], getReferencesFn, getNoteByIdFn, 2);

    expect(result).toContain('N001 First Note (0/1)');
    expect(result).toContain('└── → N002 Second Note (1/1)');
    expect(result).toContain('└── → N003 Third Note (1/1)');
    expect(result).not.toContain('N004'); // Should not show depth 3
  });

  it('should handle circular references', () => {
    const notes = [
      createNote('N001', 'First Note', { incoming: ['N003'], outgoing: ['N002'] }),
      createNote('N002', 'Second Note', { incoming: ['N001'], outgoing: ['N003'] }),
      createNote('N003', 'Third Note', { incoming: ['N002'], outgoing: ['N001'] }),
    ];

    const { getReferencesFn, getNoteByIdFn } = createMockFunctions(notes);
    const result = formatTreeView([notes[0]], getReferencesFn, getNoteByIdFn, 3);

    expect(result).toContain('N001 First Note (1/1)');
    expect(result).toContain('└── → N002 Second Note (1/1)');
    expect(result).toContain('└── → N003 Third Note (1/1)');
    expect(result).toContain('└── → N001 ↻');
  });

  it('should show multiple root notes with spacing', () => {
    const notes = [
      createNote('N001', 'First Note', { incoming: [], outgoing: [] }),
      createNote('N002', 'Second Note', { incoming: [], outgoing: [] }),
    ];

    const { getReferencesFn, getNoteByIdFn } = createMockFunctions(notes);
    const result = formatTreeView(notes, getReferencesFn, getNoteByIdFn, 1);

    const lines = result.split('\n');
    expect(lines[0]).toBe('N001 First Note (0/0)');
    expect(lines[1]).toBe(''); // Empty line
    expect(lines[2]).toBe('N002 Second Note (0/0)');
  });

  it('should handle compact mode', () => {
    const notes = [
      createNote('N001', 'First Note', { incoming: [], outgoing: ['N002', 'N003'] }),
      createNote('N002', 'Second Note', { incoming: ['N001'], outgoing: ['N003'] }),
      createNote('N003', 'Third Note', { incoming: ['N001', 'N002'], outgoing: [] }),
    ];

    const { getReferencesFn, getNoteByIdFn } = createMockFunctions(notes);
    const result = formatTreeView([notes[0]], getReferencesFn, getNoteByIdFn, 2, true);

    expect(result).toContain('N001 First Note (0/2)');
    expect(result).toContain('├── → N002 Second Note (1/1)');
    expect(result).toContain('│   └── → N003 Third Note (2/0)');
    expect(result).toContain('└── → N003...'); // Should show ellipsis in compact mode
  });

  it('should handle complex tree structure', () => {
    const notes = [
      createNote('R001', 'Root', { incoming: [], outgoing: ['C001', 'C002'] }),
      createNote('C001', 'Child 1', { incoming: ['R001'], outgoing: ['G001'] }),
      createNote('C002', 'Child 2', { incoming: ['R001'], outgoing: ['G001', 'G002'] }),
      createNote('G001', 'Grandchild 1', { incoming: ['C001', 'C002'], outgoing: [] }),
      createNote('G002', 'Grandchild 2', { incoming: ['C002'], outgoing: [] }),
    ];

    const { getReferencesFn, getNoteByIdFn } = createMockFunctions(notes);
    const result = formatTreeView([notes[0]], getReferencesFn, getNoteByIdFn, 2);

    expect(result).toContain('R001 Root (0/2)');
    expect(result).toContain('├── → C001 Child 1 (1/1)');
    expect(result).toContain('│   └── → G001 Grandchild 1 (2/0)');
    expect(result).toContain('└── → C002 Child 2 (1/2)');
    expect(result).toContain('    ├── → G001 Grandchild 1 (2/0)');
    expect(result).toContain('    └── → G002 Grandchild 2 (1/0)');
  });
});
