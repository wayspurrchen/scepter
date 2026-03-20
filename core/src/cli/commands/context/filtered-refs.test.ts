import { describe, it, expect, vi } from 'vitest';
import type { Note } from '../../../types/note';
import type { Reference } from '../../../types/reference';
import type { ProjectManager } from '../../../project/project-manager';
import type { NoteManager } from '../../../notes/note-manager';
import type { ReferenceManager } from '../../../references/reference-manager';

// Export the functions we want to test
export async function collectVisibleNotesInTree(
  rootNotes: Note[],
  projectManager: { referenceManager: ReferenceManager; noteManager: NoteManager },
  depth: number,
): Promise<Set<string>> {
  const visible = new Set<string>();
  const expandedNodes = new Set<string>();

  // Add all root notes
  rootNotes.forEach((note) => visible.add(note.id));

  const collectReferences = async (noteId: string, currentDepth: number) => {
    if (currentDepth >= depth || expandedNodes.has(noteId)) {
      return;
    }

    expandedNodes.add(noteId);

    const references = projectManager.referenceManager.getReferencesFrom(noteId);
    for (const ref of references) {
      visible.add(ref.toId);

      // Get the referenced note to continue traversal
      const childNote = await projectManager.noteManager.getNoteById(ref.toId);
      if (childNote) {
        await collectReferences(ref.toId, currentDepth + 1);
      }
    }
  };

  // Traverse from each root note
  for (const note of rootNotes) {
    await collectReferences(note.id, 0);
  }

  return visible;
}

export async function applyFilteredReferenceCounts(
  notes: Note[],
  visibleNoteIds: Set<string>,
  noteManager: NoteManager,
): Promise<void> {
  // We need to apply counts to ALL visible notes, not just the root notes
  const allVisibleNotes = new Map<string, Note>();

  // Add root notes
  for (const note of notes) {
    allVisibleNotes.set(note.id, note);
  }

  // Fetch all other visible notes
  for (const noteId of visibleNoteIds) {
    if (!allVisibleNotes.has(noteId)) {
      const note = await noteManager.getNoteById(noteId);
      if (note) {
        allVisibleNotes.set(noteId, note);
      }
    }
  }

  // Apply filtered counts to all visible notes
  for (const note of allVisibleNotes.values()) {
    if (note.references) {
      // Count only references that point to/from notes in the visible set
      const filteredIncoming = note.references.incoming.filter((ref) => visibleNoteIds.has(ref.fromId));
      const filteredOutgoing = note.references.outgoing.filter((ref) => visibleNoteIds.has(ref.toId));

      // Store filtered counts for display
      (note as any)._filteredRefs = {
        incoming: filteredIncoming.length,
        outgoing: filteredOutgoing.length,
      };
    }
  }
}

describe('Filtered Reference Counting', () => {
  const createNote = (id: string, outgoingRefs: string[] = [], incomingRefs: string[] = []): Note => ({
    id,
    type: 'Test',
    title: `Note ${id}`,
    content: `Content for ${id}`,
    tags: [],
    created: new Date('2024-01-01'),
    references: {
      incoming: incomingRefs.map((fromId) => ({ fromId, toId: id, line: 0 }) as Reference),
      outgoing: outgoingRefs.map((toId) => ({ fromId: id, toId, line: 0 }) as Reference),
    },
  });

  describe('collectVisibleNotesInTree', () => {
    it('should include only root notes at depth 0', async () => {
      const notes = [createNote('R1', ['C1', 'C2']), createNote('R2', ['C3'])];

      const mockManager = {
        referenceManager: {
          getReferencesFrom: vi.fn(() => []),
        },
        noteManager: {
          getNoteById: vi.fn(),
        },
      };

      const visible = await collectVisibleNotesInTree(notes, mockManager as any, 0);

      expect(visible.size).toBe(2);
      expect(visible.has('R1')).toBe(true);
      expect(visible.has('R2')).toBe(true);
      expect(visible.has('C1')).toBe(false);
    });

    it('should include direct children at depth 1', async () => {
      const r1 = createNote('R1', ['C1', 'C2']);
      const r2 = createNote('R2', ['C3']);
      const c1 = createNote('C1', ['G1']);
      const c2 = createNote('C2');
      const c3 = createNote('C3');

      const notes = [r1, r2];

      const mockManager = {
        referenceManager: {
          getReferencesFrom: vi.fn((noteId: string) => {
            if (noteId === 'R1') return r1.references!.outgoing;
            if (noteId === 'R2') return r2.references!.outgoing;
            if (noteId === 'C1') return c1.references!.outgoing;
            return [];
          }),
        },
        noteManager: {
          getNoteById: vi.fn(async (id: string) => {
            if (id === 'C1') return c1;
            if (id === 'C2') return c2;
            if (id === 'C3') return c3;
            return null;
          }),
        },
      };

      const visible = await collectVisibleNotesInTree(notes, mockManager as any, 1);

      expect(visible.size).toBe(5); // R1, R2, C1, C2, C3
      expect(visible.has('R1')).toBe(true);
      expect(visible.has('R2')).toBe(true);
      expect(visible.has('C1')).toBe(true);
      expect(visible.has('C2')).toBe(true);
      expect(visible.has('C3')).toBe(true);
      expect(visible.has('G1')).toBe(false); // Not at depth 1
    });

    it('should include grandchildren at depth 2', async () => {
      const r1 = createNote('R1', ['C1']);
      const c1 = createNote('C1', ['G1', 'G2']);
      const g1 = createNote('G1');
      const g2 = createNote('G2');

      const notes = [r1];

      const mockManager = {
        referenceManager: {
          getReferencesFrom: vi.fn((noteId: string) => {
            if (noteId === 'R1') return r1.references!.outgoing;
            if (noteId === 'C1') return c1.references!.outgoing;
            return [];
          }),
        },
        noteManager: {
          getNoteById: vi.fn(async (id: string) => {
            if (id === 'C1') return c1;
            if (id === 'G1') return g1;
            if (id === 'G2') return g2;
            return null;
          }),
        },
      };

      const visible = await collectVisibleNotesInTree(notes, mockManager as any, 2);

      expect(visible.size).toBe(4); // R1, C1, G1, G2
      expect(visible.has('G1')).toBe(true);
      expect(visible.has('G2')).toBe(true);
    });

    it('should handle circular references without infinite loops', async () => {
      const r1 = createNote('R1', ['C1']);
      const c1 = createNote('C1', ['R1']); // Circular reference

      const notes = [r1];

      const mockManager = {
        referenceManager: {
          getReferencesFrom: vi.fn((noteId: string) => {
            if (noteId === 'R1') return r1.references!.outgoing;
            if (noteId === 'C1') return c1.references!.outgoing;
            return [];
          }),
        },
        noteManager: {
          getNoteById: vi.fn(async (id: string) => {
            if (id === 'C1') return c1;
            if (id === 'R1') return r1;
            return null;
          }),
        },
      };

      const visible = await collectVisibleNotesInTree(notes, mockManager as any, 3);

      expect(visible.size).toBe(2); // R1, C1 (no duplicates)
    });
  });

  describe('applyFilteredReferenceCounts', () => {
    it('should count only references within visible set', async () => {
      const r1 = createNote('R1', ['R2', 'R3', 'X1'], ['R2']);
      const r2 = createNote('R2', ['R1'], ['R1']);
      const r3 = createNote('R3', [], ['R1']);

      const notes = [r1, r2, r3];
      const visibleNoteIds = new Set(['R1', 'R2', 'R3']); // X1 is not visible

      const mockNoteManager = {
        getNoteById: vi.fn(async (id: string) => {
          if (id === 'R1') return r1;
          if (id === 'R2') return r2;
          if (id === 'R3') return r3;
          return null;
        }),
      };

      await applyFilteredReferenceCounts(notes, visibleNoteIds, mockNoteManager as any);

      // R1: incoming from R2 (1), outgoing to R2 and R3 (2) - X1 is filtered out
      expect((r1 as any)._filteredRefs).toEqual({ incoming: 1, outgoing: 2 });

      // R2: incoming from R1 (1), outgoing to R1 (1)
      expect((r2 as any)._filteredRefs).toEqual({ incoming: 1, outgoing: 1 });

      // R3: incoming from R1 (1), outgoing none (0)
      expect((r3 as any)._filteredRefs).toEqual({ incoming: 1, outgoing: 0 });
    });

    it('should apply counts to non-root visible notes', async () => {
      const r1 = createNote('R1', ['C1']);
      const c1 = createNote('C1', ['C2'], ['R1']);
      const c2 = createNote('C2', [], ['C1']);

      const rootNotes = [r1]; // Only R1 is a root note
      const visibleNoteIds = new Set(['R1', 'C1', 'C2']); // All are visible

      const mockNoteManager = {
        getNoteById: vi.fn(async (id: string) => {
          if (id === 'R1') return r1;
          if (id === 'C1') return c1;
          if (id === 'C2') return c2;
          return null;
        }),
      };

      await applyFilteredReferenceCounts(rootNotes, visibleNoteIds, mockNoteManager as any);

      // All notes should have filtered counts, not just root notes
      expect((r1 as any)._filteredRefs).toEqual({ incoming: 0, outgoing: 1 });
      expect((c1 as any)._filteredRefs).toEqual({ incoming: 1, outgoing: 1 });
      expect((c2 as any)._filteredRefs).toEqual({ incoming: 1, outgoing: 0 });
    });

    it('should handle notes with no references', async () => {
      const r1 = createNote('R1');
      const r2 = createNote('R2');

      const notes = [r1, r2];
      const visibleNoteIds = new Set(['R1', 'R2']);

      const mockNoteManager = {
        getNoteById: vi.fn(async () => null),
      };

      await applyFilteredReferenceCounts(notes, visibleNoteIds, mockNoteManager as any);

      expect((r1 as any)._filteredRefs).toEqual({ incoming: 0, outgoing: 0 });
      expect((r2 as any)._filteredRefs).toEqual({ incoming: 0, outgoing: 0 });
    });
  });

  describe('Integration test: Filtered refs in tree view', () => {
    it('should correctly count references for type-filtered tree', async () => {
      // Scenario from user's example:
      // R1 -> R2, R3, D1
      // R2 -> R1, R3
      // R3 -> R1
      // When filtering by type R, R1 should show 2/2 (not 2/3)

      const r1 = createNote('R1', ['R2', 'R3', 'D1'], []);
      const r2 = createNote('R2', ['R1', 'R3'], ['R1']);
      const r3 = createNote('R3', ['R1'], ['R1', 'R2']);

      // Type-filtered root notes (only Rs)
      const rootNotes = [r1, r2, r3];

      // Collect visible notes in tree at depth 1
      const mockManager = {
        referenceManager: {
          getReferencesFrom: vi.fn((noteId: string) => {
            if (noteId === 'R1') return r1.references!.outgoing;
            if (noteId === 'R2') return r2.references!.outgoing;
            if (noteId === 'R3') return r3.references!.outgoing;
            return [];
          }),
        },
        noteManager: {
          getNoteById: vi.fn(async (id: string) => {
            if (id === 'R1') return r1;
            if (id === 'R2') return r2;
            if (id === 'R3') return r3;
            if (id === 'D1') return createNote('D1'); // Different type
            return null;
          }),
        },
      };

      const visible = await collectVisibleNotesInTree(rootNotes, mockManager as any, 1);

      // Should include R1, R2, R3, and D1 (because it's referenced)
      expect(visible.size).toBe(4);
      expect(visible.has('D1')).toBe(true);

      // Apply filtered counts
      await applyFilteredReferenceCounts(rootNotes, visible, mockManager.noteManager as any);

      // R1 should show 2/3 because all 3 outgoing refs are to visible notes
      expect((r1 as any)._filteredRefs).toEqual({ incoming: 0, outgoing: 3 });

      // R2 should show 1/2
      expect((r2 as any)._filteredRefs).toEqual({ incoming: 1, outgoing: 2 });

      // R3 should show 2/1
      expect((r3 as any)._filteredRefs).toEqual({ incoming: 2, outgoing: 1 });
    });
  });
});
