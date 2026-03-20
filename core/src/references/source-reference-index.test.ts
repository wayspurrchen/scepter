import { beforeEach, describe, it, expect } from 'vitest';
import { SourceReferenceIndex } from './source-reference-index.js';
import type { SourceReference } from '../types/reference.js';

describe('SourceReferenceIndex', () => {
  let index: SourceReferenceIndex;

  beforeEach(() => {
    index = new SourceReferenceIndex();
  });

  const createReference = (
    filePath: string, 
    noteId: string, 
    line: number = 1
  ): SourceReference => ({
    fromId: `source:${filePath}`,
    toId: noteId,
    sourceType: 'source',
    filePath,
    line,
    language: 'javascript',
    referenceType: 'mentions'
  });

  describe('addReference', () => {
    it('should add a reference and update mappings', () => {
      const ref = createReference('/src/test.js', 'Q001', 10);
      
      index.addReference(ref);
      
      const stats = index.getStats();
      expect(stats.totalFiles).toBe(1);
      expect(stats.totalNotes).toBe(1);
      expect(stats.totalReferences).toBe(1);
    });

    it('should replace existing reference at same file:line', () => {
      const ref1 = createReference('/src/test.js', 'Q001', 10);
      const ref2 = createReference('/src/test.js', 'Q002', 10);
      
      index.addReference(ref1);
      index.addReference(ref2);
      
      const stats = index.getStats();
      expect(stats.totalReferences).toBe(1);
      expect(index.getReferencesToNote('Q001')).toHaveLength(0);
      expect(index.getReferencesToNote('Q002')).toHaveLength(1);
    });

    it('should handle multiple references to same note', () => {
      const ref1 = createReference('/src/a.js', 'Q001', 10);
      const ref2 = createReference('/src/b.js', 'Q001', 20);
      const ref3 = createReference('/src/a.js', 'Q001', 30);
      
      index.addReference(ref1);
      index.addReference(ref2);
      index.addReference(ref3);
      
      const refs = index.getReferencesToNote('Q001');
      expect(refs).toHaveLength(3);
      
      const stats = index.getStats();
      expect(stats.totalFiles).toBe(2);
      expect(stats.totalNotes).toBe(1);
    });
  });

  describe('removeReference', () => {
    it('should remove a reference and update mappings', () => {
      const ref = createReference('/src/test.js', 'Q001', 10);
      
      index.addReference(ref);
      index.removeReference(ref);
      
      const stats = index.getStats();
      expect(stats.totalFiles).toBe(0);
      expect(stats.totalNotes).toBe(0);
      expect(stats.totalReferences).toBe(0);
    });

    it('should handle removing non-existent reference', () => {
      const ref = createReference('/src/test.js', 'Q001', 10);
      
      expect(() => index.removeReference(ref)).not.toThrow();
    });
  });

  describe('getReferencesToNote', () => {
    beforeEach(() => {
      // Add test references
      index.addReference(createReference('/src/a.js', 'Q001', 10));
      index.addReference(createReference('/src/b.js', 'Q001', 20));
      index.addReference(createReference('/src/a.js', 'Q002', 30));
      index.addReference(createReference('/src/c.js', 'Q001', 5));
    });

    it('should return all references to a note sorted by file and line', () => {
      const refs = index.getReferencesToNote('Q001');
      
      expect(refs).toHaveLength(3);
      expect(refs[0].filePath).toBe('/src/a.js');
      expect(refs[0].line).toBe(10);
      expect(refs[1].filePath).toBe('/src/b.js');
      expect(refs[2].filePath).toBe('/src/c.js');
    });

    it('should return empty array for unknown note', () => {
      const refs = index.getReferencesToNote('Q999');
      
      expect(refs).toHaveLength(0);
    });
  });

  describe('getReferencesFromFile', () => {
    beforeEach(() => {
      index.addReference(createReference('/src/test.js', 'Q001', 10));
      index.addReference(createReference('/src/test.js', 'Q002', 20));
      index.addReference(createReference('/src/test.js', 'Q003', 15));
      index.addReference(createReference('/src/other.js', 'Q001', 5));
    });

    it('should return all references from a file sorted by line', () => {
      const refs = index.getReferencesFromFile('/src/test.js');
      
      expect(refs).toHaveLength(3);
      expect(refs[0].line).toBe(10);
      expect(refs[1].line).toBe(15);
      expect(refs[2].line).toBe(20);
    });

    it('should return empty array for unknown file', () => {
      const refs = index.getReferencesFromFile('/src/unknown.js');
      
      expect(refs).toHaveLength(0);
    });
  });

  describe('removeFileReferences', () => {
    it('should remove all references from a file', () => {
      index.addReference(createReference('/src/test.js', 'Q001', 10));
      index.addReference(createReference('/src/test.js', 'Q002', 20));
      index.addReference(createReference('/src/other.js', 'Q001', 5));
      
      index.removeFileReferences('/src/test.js');
      
      const refs = index.getReferencesFromFile('/src/test.js');
      expect(refs).toHaveLength(0);
      
      const otherRefs = index.getReferencesFromFile('/src/other.js');
      expect(otherRefs).toHaveLength(1);
      
      const stats = index.getStats();
      expect(stats.totalFiles).toBe(1);
      expect(stats.totalReferences).toBe(1);
    });
  });

  describe('utility methods', () => {
    it('should check if note has source references', () => {
      expect(index.hasSourceReferences('Q001')).toBe(false);
      
      index.addReference(createReference('/src/test.js', 'Q001', 10));
      
      expect(index.hasSourceReferences('Q001')).toBe(true);
    });

    it('should get source reference count for a note', () => {
      expect(index.getSourceReferenceCount('Q001')).toBe(0);
      
      index.addReference(createReference('/src/a.js', 'Q001', 10));
      index.addReference(createReference('/src/b.js', 'Q001', 20));
      
      expect(index.getSourceReferenceCount('Q001')).toBe(2);
    });

    it('should get all references', () => {
      index.addReference(createReference('/src/a.js', 'Q001', 10));
      index.addReference(createReference('/src/b.js', 'Q002', 20));
      
      const allRefs = index.getAllReferences();
      
      expect(allRefs).toHaveLength(2);
      expect(allRefs.some(r => r.toId === 'Q001')).toBe(true);
      expect(allRefs.some(r => r.toId === 'Q002')).toBe(true);
    });

    it('should clear all data', () => {
      index.addReference(createReference('/src/test.js', 'Q001', 10));
      index.addReference(createReference('/src/test.js', 'Q002', 20));
      
      index.clear();
      
      const stats = index.getStats();
      expect(stats.totalFiles).toBe(0);
      expect(stats.totalNotes).toBe(0);
      expect(stats.totalReferences).toBe(0);
    });
  });
});