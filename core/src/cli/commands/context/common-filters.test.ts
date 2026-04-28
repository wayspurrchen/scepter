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

    describe('timestampPrecision: date snapping', () => {
      it('should snap sub-day "after" cutoffs to start of UTC day', () => {
        // Notes stored at date precision parse to UTC midnight on load, so a
        // sub-day "after" cutoff must snap to UTC start-of-day or today's
        // notes get filtered out.
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        const expectedDay = tenMinutesAgo.toISOString().split('T')[0];

        const query = optionsToNoteQuery(
          { createdAfter: '10 minutes ago' },
          { timestampPrecision: 'date' },
        );

        expect(query.createdAfter?.toISOString()).toBe(`${expectedDay}T00:00:00.000Z`);
      });

      it('should snap sub-day "before" cutoffs to end of UTC day', () => {
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        const expectedDay = tenMinutesAgo.toISOString().split('T')[0];

        const query = optionsToNoteQuery(
          { createdBefore: '10 minutes ago' },
          { timestampPrecision: 'date' },
        );

        expect(query.createdBefore?.toISOString()).toBe(`${expectedDay}T23:59:59.999Z`);
      });

      it('should snap modifiedAfter/modifiedBefore the same way', () => {
        const query = optionsToNoteQuery(
          {
            modifiedAfter: '2024-06-15T14:30:00Z',
            modifiedBefore: '2024-06-20T08:15:00Z',
          },
          { timestampPrecision: 'date' },
        );

        expect(query.modifiedAfter?.toISOString()).toBe('2024-06-15T00:00:00.000Z');
        expect(query.modifiedBefore?.toISOString()).toBe('2024-06-20T23:59:59.999Z');
      });

      it('should leave cutoffs untouched when precision is datetime', () => {
        const query = optionsToNoteQuery(
          { createdAfter: '2024-06-15T14:30:00Z' },
          { timestampPrecision: 'datetime' },
        );

        expect(query.createdAfter?.toISOString()).toBe('2024-06-15T14:30:00.000Z');
      });

      it('should default to no snapping when precision is not provided', () => {
        const query = optionsToNoteQuery({ createdAfter: '2024-06-15T14:30:00Z' });

        expect(query.createdAfter?.toISOString()).toBe('2024-06-15T14:30:00.000Z');
      });

      it('should not crash on invalid dates when snapping', () => {
        const query = optionsToNoteQuery(
          { createdAfter: 'utter-nonsense' },
          { timestampPrecision: 'date' },
        );

        expect(query.createdAfter).toBeInstanceOf(Date);
        expect(query.createdAfter?.toString()).toBe('Invalid Date');
      });
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
