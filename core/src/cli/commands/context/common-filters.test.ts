import { describe, it, expect } from 'vitest';
import { optionsToNoteQuery } from './common-filters';

describe('common-filters', () => {
  describe('parseCommaSeparatedValues', () => {
    it('should parse comma-separated values', () => {
      const query = optionsToNoteQuery({
        types: ['R,T,D'],
      });

      expect(query.types).toEqual(['R', 'T', 'D']);
    });

    it('should handle mixed space and comma separation', () => {
      const query = optionsToNoteQuery({
        types: ['R,T', 'D', 'Q,M'],
      });

      expect(query.types).toEqual(['R', 'T', 'D', 'Q', 'M']);
    });

    it('should trim whitespace', () => {
      const query = optionsToNoteQuery({
        types: ['R, T , D'],
      });

      expect(query.types).toEqual(['R', 'T', 'D']);
    });

    it('should filter empty values', () => {
      const query = optionsToNoteQuery({
        types: ['R,,T,,,D,'],
      });

      expect(query.types).toEqual(['R', 'T', 'D']);
    });

    it('should work for all multi-value filters', () => {
      const query = optionsToNoteQuery({
        types: ['R,T'],
        tags: ['cat1,cat2'],
        referencedBy: ['id1,id2,id3'],
        references: ['id4,id5'],
      });

      expect(query.types).toEqual(['R', 'T']);
      expect(query.tags).toEqual(['cat1', 'cat2']);
      expect(query.referencedBy).toEqual(['id1', 'id2', 'id3']);
      expect(query.references).toEqual(['id4', 'id5']);
    });

    it('should handle single values without commas', () => {
      const query = optionsToNoteQuery({
        types: ['R'],
      });

      expect(query.types).toEqual(['R']);
    });

    it('should handle edge case with only commas and spaces', () => {
      const query = optionsToNoteQuery({
        types: [',,,', '  , , '],
      });

      expect(query.types).toEqual([]);
    });
  });

  describe('optionsToNoteQuery', () => {
    it('should handle --type as alias for --types', () => {
      // Test that --type (singular) works
      const query1 = optionsToNoteQuery({
        type: ['R', 'T'],
      });
      expect(query1.types).toEqual(['R', 'T']);

      // Test that --types (plural) still works
      const query2 = optionsToNoteQuery({
        types: ['D', 'Q'],
      });
      expect(query2.types).toEqual(['D', 'Q']);

      // Test that --types takes precedence when both are provided
      const query3 = optionsToNoteQuery({
        types: ['R', 'T'],
        type: ['D', 'Q'], // This should be ignored
      });
      expect(query3.types).toEqual(['R', 'T']);

      // Test comma-separated values with --type
      const query4 = optionsToNoteQuery({
        type: ['R,T,D'],
      });
      expect(query4.types).toEqual(['R', 'T', 'D']);
    });

    it('should handle conflicting options gracefully', () => {
      const query = optionsToNoteQuery({
        hasNoRefs: true,
        minIncomingRefs: 5, // Conflicting!
      });

      // hasNoRefs should take precedence
      expect(query.hasNoRefs).toBe(true);
      expect(query.minIncomingRefs).toBe(5); // Both are set, let the API handle conflict
    });

    it('should parse dates correctly', () => {
      const query = optionsToNoteQuery({
        createdAfter: '2024-01-01',
        createdBefore: '2024-12-31',
      });

      expect(query.createdAfter).toBeInstanceOf(Date);
      expect(query.createdBefore).toBeInstanceOf(Date);
      expect(query.createdAfter?.toISOString()).toContain('2024-01-01');
      expect(query.createdBefore?.toISOString()).toContain('2024-12-31');
    });

    it('should handle invalid dates', () => {
      const query = optionsToNoteQuery({
        createdAfter: 'invalid-date',
      });

      // Invalid dates create Invalid Date objects
      expect(query.createdAfter).toBeInstanceOf(Date);
      expect(query.createdAfter?.toString()).toBe('Invalid Date');
    });

    it('should handle all pagination options', () => {
      const query = optionsToNoteQuery({
        limit: 10,
        offset: 20,
        sortBy: 'created',
        sortOrder: 'asc',
      });

      expect(query.limit).toBe(10);
      expect(query.offset).toBe(20);
      expect(query.sortBy).toBe('created');
      expect(query.sortOrder).toBe('asc');
    });

    it('should handle empty options', () => {
      const query = optionsToNoteQuery({});

      expect(query).toEqual({});
    });
  });
});
