import { describe, it, expect, beforeEach } from 'vitest';
import { ReferenceManager } from './reference-manager';
import type { Reference } from '../types/reference';

describe('ReferenceManager', () => {
  let referenceManager: ReferenceManager;

  beforeEach(() => {
    referenceManager = new ReferenceManager();
  });

  describe('basic reference operations', () => {
    it('should add and retrieve a reference', () => {
      const ref: Reference = {
        fromId: 'D001',
        toId: 'R001',
        line: 5
      };

      referenceManager.addReference(ref);

      const outgoing = referenceManager.getReferencesFrom('D001');
      expect(outgoing).toHaveLength(1);
      expect(outgoing[0]).toEqual(ref);

      const incoming = referenceManager.getReferencesTo('R001');
      expect(incoming).toHaveLength(1);
      expect(incoming[0]).toEqual(ref);
    });

    it('should handle multiple references from one note', () => {
      referenceManager.addReference({ fromId: 'D001', toId: 'R001' });
      referenceManager.addReference({ fromId: 'D001', toId: 'R002' });
      referenceManager.addReference({ fromId: 'D001', toId: 'ARCH001' });

      const outgoing = referenceManager.getReferencesFrom('D001');
      expect(outgoing).toHaveLength(3);
      expect(outgoing.map(r => r.toId)).toEqual(['R001', 'R002', 'ARCH001']);
    });

    it('should handle multiple references to one note', () => {
      referenceManager.addReference({ fromId: 'D001', toId: 'R001' });
      referenceManager.addReference({ fromId: 'D002', toId: 'R001' });
      referenceManager.addReference({ fromId: 'T001', toId: 'R001' });

      const incoming = referenceManager.getReferencesTo('R001');
      expect(incoming).toHaveLength(3);
      expect(incoming.map(r => r.fromId)).toEqual(['D001', 'D002', 'T001']);
    });

    it('should handle reference modifiers', () => {
      referenceManager.addReference({
        fromId: 'T001',
        toId: 'D001',
        modifier: '+',
        line: 10
      });

      referenceManager.addReference({
        fromId: 'T001',
        toId: 'R001',
        modifier: '.',
        line: 12
      });

      const refs = referenceManager.getReferencesFrom('T001');
      expect(refs[0].modifier).toBe('+');
      expect(refs[1].modifier).toBe('.');
    });

    it('should get unique referenced note IDs', () => {
      // Add duplicate references (different lines)
      referenceManager.addReference({ fromId: 'D001', toId: 'R001', line: 5 });
      referenceManager.addReference({ fromId: 'D001', toId: 'R001', line: 10 });
      referenceManager.addReference({ fromId: 'D001', toId: 'R002' });

      const referencedIds = referenceManager.getReferencedNoteIds('D001');
      expect(referencedIds).toEqual(['R001', 'R002']);
    });

    it('should return empty arrays for non-existent notes', () => {
      expect(referenceManager.getReferencesFrom('NONEXISTENT')).toEqual([]);
      expect(referenceManager.getReferencesTo('NONEXISTENT')).toEqual([]);
      expect(referenceManager.getReferencedNoteIds('NONEXISTENT')).toEqual([]);
    });
  });

  describe('followReferences', () => {
    beforeEach(() => {
      // Set up a reference graph:
      // D001 -> R001, R002
      // R001 -> ARCH001
      // R002 -> ARCH001, IMPL001
      // T001 -> D001
      referenceManager.addReference({ fromId: 'D001', toId: 'R001' });
      referenceManager.addReference({ fromId: 'D001', toId: 'R002' });
      referenceManager.addReference({ fromId: 'R001', toId: 'ARCH001' });
      referenceManager.addReference({ fromId: 'R002', toId: 'ARCH001' });
      referenceManager.addReference({ fromId: 'R002', toId: 'IMPL001' });
      referenceManager.addReference({ fromId: 'T001', toId: 'D001' });
    });

    it('should follow references to depth 1', async () => {
      const refs = await referenceManager.followReferences(['D001'], 1);
      expect(refs.sort()).toEqual(['R001', 'R002']);
    });

    it('should follow references to depth 2', async () => {
      const refs = await referenceManager.followReferences(['D001'], 2);
      expect(refs.sort()).toEqual(['ARCH001', 'IMPL001', 'R001', 'R002']);
    });

    it('should not follow references when maxDepth is 0', async () => {
      const refs = await referenceManager.followReferences(['D001'], 0);
      expect(refs).toEqual([]);
    });

    it('should handle multiple starting notes', async () => {
      const refs = await referenceManager.followReferences(['D001', 'T001'], 1);
      expect(refs.sort()).toEqual(['R001', 'R002']); // D001 already visited via T001
    });

    it('should avoid duplicates across depths', async () => {
      // Add circular reference
      referenceManager.addReference({ fromId: 'ARCH001', toId: 'R001' });
      
      const refs = await referenceManager.followReferences(['D001'], 3);
      expect(refs.sort()).toEqual(['ARCH001', 'IMPL001', 'R001', 'R002']);
    });

    it('should use provided visited set', async () => {
      const visited = new Set(['R001']); // Pre-mark R001 as visited
      const refs = await referenceManager.followReferences(['D001'], 1, visited);
      
      expect(refs).toEqual(['R002']); // R001 skipped
      expect(visited.has('D001')).toBe(true);
      expect(visited.has('R002')).toBe(true);
    });

    it('should handle circular references', async () => {
      // Create circular reference: A -> B -> C -> A
      referenceManager.addReference({ fromId: 'A', toId: 'B' });
      referenceManager.addReference({ fromId: 'B', toId: 'C' });
      referenceManager.addReference({ fromId: 'C', toId: 'A' });

      const refs = await referenceManager.followReferences(['A'], 10);
      expect(refs.sort()).toEqual(['B', 'C']);
    });
  });

  describe('removeOutgoingReferences', () => {
    beforeEach(() => {
      // Set up test references
      referenceManager.addReference({ fromId: 'D001', toId: 'R001' });
      referenceManager.addReference({ fromId: 'D001', toId: 'R002' });
      referenceManager.addReference({ fromId: 'T001', toId: 'D001' });
      referenceManager.addReference({ fromId: 'R001', toId: 'ARCH001' });
    });

    it('should remove only outgoing references from a note', () => {
      referenceManager.removeOutgoingReferences('D001');

      // Outgoing references should be removed
      expect(referenceManager.getReferencesFrom('D001')).toEqual([]);
      
      // Incoming references should be preserved
      const incomingToD001 = referenceManager.getReferencesTo('D001');
      expect(incomingToD001).toHaveLength(1);
      expect(incomingToD001[0].fromId).toBe('T001');
      
      // Other references should be unaffected
      expect(referenceManager.getReferencesFrom('R001')).toHaveLength(1);
    });
  });

  describe('removeNote', () => {
    beforeEach(() => {
      // Set up test references
      referenceManager.addReference({ fromId: 'D001', toId: 'R001' });
      referenceManager.addReference({ fromId: 'D001', toId: 'R002' });
      referenceManager.addReference({ fromId: 'T001', toId: 'D001' });
      referenceManager.addReference({ fromId: 'R001', toId: 'ARCH001' });
    });

    it('should remove all references from a note', () => {
      referenceManager.removeNote('D001');

      expect(referenceManager.getReferencesFrom('D001')).toEqual([]);
      expect(referenceManager.getReferencesTo('R001')).toEqual([]);
      expect(referenceManager.getReferencesTo('R002')).toEqual([]);
    });

    it('should remove all references to a note', () => {
      referenceManager.removeNote('R001');

      expect(referenceManager.getReferencesFrom('D001')).toHaveLength(1);
      expect(referenceManager.getReferencesFrom('D001')[0].toId).toBe('R002');
      expect(referenceManager.getReferencesTo('ARCH001')).toEqual([]);
    });

    it('should handle removing non-existent note', () => {
      expect(() => referenceManager.removeNote('NONEXISTENT')).not.toThrow();
    });
  });

  describe('validateReferences', () => {
    beforeEach(() => {
      referenceManager.addReference({ fromId: 'D001', toId: 'R001' });
      referenceManager.addReference({ fromId: 'D001', toId: 'R002' });
      referenceManager.addReference({ fromId: 'T001', toId: 'D001' });
      referenceManager.addReference({ fromId: 'T001', toId: 'MISSING001' });
      referenceManager.addReference({ fromId: 'R001', toId: 'MISSING002' });
    });

    it('should validate references against existing notes', async () => {
      const existingNotes = new Set(['D001', 'R001', 'R002', 'T001']);
      const result = await referenceManager.validateReferences(existingNotes);

      expect(result.valid).toBe(false);
      expect(result.broken).toHaveLength(2);
      expect(result.broken.map(r => r.toId).sort()).toEqual(['MISSING001', 'MISSING002']);
    });

    it('should return valid when all references exist', async () => {
      const existingNotes = new Set(['D001', 'R001', 'R002', 'T001', 'MISSING001', 'MISSING002']);
      const result = await referenceManager.validateReferences(existingNotes);

      expect(result.valid).toBe(true);
      expect(result.broken).toHaveLength(0);
    });

    it('should include source information in broken references', async () => {
      const existingNotes = new Set(['D001', 'R001', 'R002', 'T001']);
      const result = await referenceManager.validateReferences(existingNotes);

      const brokenFromT001 = result.broken.find(r => r.fromId === 'T001');
      expect(brokenFromT001).toBeDefined();
      expect(brokenFromT001!.toId).toBe('MISSING001');
    });
  });

  describe('exportGraph', () => {
    it('should export empty graph', () => {
      const graph = referenceManager.exportGraph();
      expect(graph.nodes).toEqual([]);
      expect(graph.edges).toEqual([]);
    });

    it('should export graph with nodes and edges', () => {
      referenceManager.addReference({ fromId: 'D001', toId: 'R001' });
      referenceManager.addReference({ fromId: 'D001', toId: 'R002' });
      referenceManager.addReference({ fromId: 'T001', toId: 'D001', modifier: '+' });

      const graph = referenceManager.exportGraph();
      
      expect(graph.nodes.sort()).toEqual(['D001', 'R001', 'R002', 'T001']);
      expect(graph.edges).toHaveLength(3);
      expect(graph.edges).toContainEqual({ from: 'D001', to: 'R001' });
      expect(graph.edges).toContainEqual({ from: 'D001', to: 'R002' });
      expect(graph.edges).toContainEqual({ from: 'T001', to: 'D001' });
    });

    it('should handle self-references', () => {
      referenceManager.addReference({ fromId: 'D001', toId: 'D001' });
      
      const graph = referenceManager.exportGraph();
      expect(graph.nodes).toEqual(['D001']);
      expect(graph.edges).toEqual([{ from: 'D001', to: 'D001' }]);
    });
  });

  describe('advanced queries', () => {
    beforeEach(() => {
      // Create a more complex graph
      // Requirements
      referenceManager.addReference({ fromId: 'R001', toId: 'R002' });
      referenceManager.addReference({ fromId: 'R002', toId: 'R003' });
      
      // Decisions
      referenceManager.addReference({ fromId: 'D001', toId: 'R001' });
      referenceManager.addReference({ fromId: 'D002', toId: 'R001' });
      referenceManager.addReference({ fromId: 'D002', toId: 'D001' });
      
      // TODOs
      referenceManager.addReference({ fromId: 'T001', toId: 'D001' });
      referenceManager.addReference({ fromId: 'T002', toId: 'D001' });
      referenceManager.addReference({ fromId: 'T002', toId: 'R003' });
    });

    it('should find all notes that depend on a given note', async () => {
      // What would break if we changed R001?
      const directDependents = referenceManager.getReferencesTo('R001').map(r => r.fromId);
      expect(directDependents.sort()).toEqual(['D001', 'D002']);
      
      // To find indirect dependents, we need to check what depends on D001 and D002
      const indirectDependents = new Set<string>();
      for (const dep of directDependents) {
        const refs = referenceManager.getReferencesTo(dep);
        refs.forEach(r => indirectDependents.add(r.fromId));
      }
      
      expect(Array.from(indirectDependents).sort()).toEqual(['D002', 'T001', 'T002']);
      
      // followReferences follows forward references, not backward
      // Let's test forward traversal instead
      const forwardRefs = await referenceManager.followReferences(['R001'], 2);
      expect(forwardRefs.sort()).toEqual(['R002', 'R003']);
    });

    it('should identify isolated notes', () => {
      referenceManager.addReference({ fromId: 'ISOLATED001', toId: 'ISOLATED002' });
      
      const graph = referenceManager.exportGraph();
      
      // These nodes are connected to each other but not to the main graph
      expect(referenceManager.getReferencesTo('ISOLATED001')).toEqual([]);
      expect(referenceManager.getReferencesFrom('ISOLATED002')).toEqual([]);
    });

    it('should support filtering references by modifier', () => {
      referenceManager.addReference({ fromId: 'T003', toId: 'D001', modifier: '+' });
      referenceManager.addReference({ fromId: 'T003', toId: 'R001', modifier: '.' });
      
      const allRefs = referenceManager.getReferencesFrom('T003');
      const forceIncludeRefs = allRefs.filter(r => r.modifier === '+');
      const contextOnlyRefs = allRefs.filter(r => r.modifier === '.');
      
      expect(forceIncludeRefs).toHaveLength(1);
      expect(forceIncludeRefs[0].toId).toBe('D001');
      expect(contextOnlyRefs).toHaveLength(1);
      expect(contextOnlyRefs[0].toId).toBe('R001');
    });
  });

  describe('performance considerations', () => {
    it('should handle large graphs efficiently', async () => {
      // Create a large graph
      for (let i = 0; i < 1000; i++) {
        referenceManager.addReference({ fromId: `D${i}`, toId: `R${i}` });
        if (i > 0) {
          referenceManager.addReference({ fromId: `D${i}`, toId: `D${i-1}` });
        }
      }

      const startTime = performance.now();
      const refs = await referenceManager.followReferences(['D999'], 5);
      const endTime = performance.now();

      expect(refs.length).toBeGreaterThan(0);
      expect(endTime - startTime).toBeLessThan(100); // Should complete in < 100ms
    });
  });

});