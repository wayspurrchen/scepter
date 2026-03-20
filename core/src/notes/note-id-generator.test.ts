import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NoteIdGenerator } from './note-id-generator';
import type { SCEpterConfig } from '../types/config';

describe('NoteIdGenerator', () => {
  let generator: NoteIdGenerator;
  let config: SCEpterConfig;
  
  beforeEach(() => {
    // This will be merged into NoteManager, but testing separately for now
    config = {
      noteTypes: {
        Requirement: { folder: 'requirements', shortcode: 'R' },
        Decision: { folder: 'decisions', shortcode: 'D' },
        Question: { folder: 'questions', shortcode: 'Q' },
        Architecture: { folder: 'architecture', shortcode: 'ARCH' },
        UserStory: { folder: 'user-stories', shortcode: 'US' },
        Epic: { folder: 'epics', shortcode: 'E' },
      },
    };
    
    generator = new NoteIdGenerator(config);
  });

  describe('ID Generation', () => {
    it('should generate first ID as 00001 for each type', () => {
      expect(generator.generateNextId('Requirement')).toBe('R00001');
      expect(generator.generateNextId('Decision')).toBe('D00001');
      expect(generator.generateNextId('Question')).toBe('Q00001');
      expect(generator.generateNextId('Architecture')).toBe('ARCH00001');
      expect(generator.generateNextId('UserStory')).toBe('US00001');
    });

    it('should generate sequential IDs for same type', () => {
      expect(generator.generateNextId('Requirement')).toBe('R00001');
      expect(generator.generateNextId('Requirement')).toBe('R00002');
      expect(generator.generateNextId('Requirement')).toBe('R00003');
      
      // Different type should have its own sequence
      expect(generator.generateNextId('Decision')).toBe('D00001');
    });

    it('should maintain separate counters for each type', () => {
      // Generate some IDs
      generator.generateNextId('Requirement'); // R00001
      generator.generateNextId('Requirement'); // R00002
      generator.generateNextId('Decision');    // D00001
      generator.generateNextId('Decision');    // D00002
      generator.generateNextId('Decision');    // D00003
      
      // Check next numbers
      expect(generator.getNextNumber('Requirement')).toBe(3);
      expect(generator.getNextNumber('Decision')).toBe(4);
      expect(generator.getNextNumber('Question')).toBe(1);
    });

    it('should pad IDs with zeros to 5 digits', () => {
      expect(generator.generateNextId('Requirement')).toBe('R00001');
      
      // Skip to higher numbers
      generator.setExistingIds(['R00099']);
      expect(generator.generateNextId('Requirement')).toBe('R00100');
      
      generator.setExistingIds(['R09999']);
      expect(generator.generateNextId('Requirement')).toBe('R10000');
    });

    it('should handle IDs up to 99999', () => {
      generator.setExistingIds(['D99998']);
      expect(generator.generateNextId('Decision')).toBe('D99999');
      
      // Should handle 99999 without error
      generator.setExistingIds(['Q99999']);
      expect(generator.getCurrentCount('Question')).toBe(99999);
    });

    it('should throw error when exceeding 99999', () => {
      generator.setExistingIds(['R99999']);
      expect(() => generator.generateNextId('Requirement')).toThrow('exceeded maximum');
    });

    it('should support multi-character shortcodes', () => {
      expect(generator.generateNextId('Architecture')).toBe('ARCH00001');
      expect(generator.generateNextId('Architecture')).toBe('ARCH00002');
      
      expect(generator.generateNextId('UserStory')).toBe('US00001');
      expect(generator.generateNextId('UserStory')).toBe('US00002');
      
      // Multi-char shortcodes should maintain their own sequences
      expect(generator.getCurrentCount('Architecture')).toBe(2);
      expect(generator.getCurrentCount('UserStory')).toBe(2);
    });
  });

  describe('Existing ID Handling', () => {
    it('should scan existing IDs and set counters', () => {
      const existingIds = [
        'R00042',
        'D00017',
        'Q00003',
        'ARCH00005',
        'US00100'
      ];
      
      generator.setExistingIds(existingIds);
      
      expect(generator.getCurrentCount('Requirement')).toBe(42);
      expect(generator.getCurrentCount('Decision')).toBe(17);
      expect(generator.getCurrentCount('Question')).toBe(3);
      expect(generator.getCurrentCount('Architecture')).toBe(5);
      expect(generator.getCurrentCount('UserStory')).toBe(100);
    });

    it('should handle gaps in ID sequences', () => {
      const existingIds = [
        'R00001',
        'R00003',
        'R00010',
        'R00042'
      ];
      
      generator.setExistingIds(existingIds);
      
      // Should use highest, not count
      expect(generator.getCurrentCount('Requirement')).toBe(42);
      expect(generator.generateNextId('Requirement')).toBe('R00043');
    });

    it('should find highest ID for each type', () => {
      const existingIds = [
        'D00001',
        'D00100',
        'D00050',
        'D00200',
        'D00075'
      ];
      
      generator.setExistingIds(existingIds);
      expect(generator.getCurrentCount('Decision')).toBe(200);
    });

    it('should ignore invalid ID formats', () => {
      const mixedIds = [
        'R00001',
        'R-001',      // Invalid format
        'RR00002',    // Invalid shortcode
        '00003',      // Missing type
        'R0004',      // Wrong digit count
        'R00005',
        'Random text' // Not an ID
      ];
      
      generator.setExistingIds(mixedIds);
      
      // Should only count valid IDs
      expect(generator.getCurrentCount('Requirement')).toBe(5);
    });

    it('should handle mixed case IDs', () => {
      const mixedCaseIds = [
        'r00001',      // lowercase
        'R00002',      // uppercase
        'arch00003',   // lowercase multi-char
        'ARCH00004',   // uppercase multi-char
        'Us00005',     // mixed case
      ];
      
      generator.setExistingIds(mixedCaseIds);
      
      // Should normalize and accept all valid formats
      expect(generator.getCurrentCount('Requirement')).toBe(2);
      expect(generator.getCurrentCount('Architecture')).toBe(4);
      expect(generator.getCurrentCount('UserStory')).toBe(5);
    });

    it('should update only if existing ID is higher', () => {
      // Set initial high count
      generator.setExistingIds(['R00100']);
      expect(generator.getCurrentCount('Requirement')).toBe(100);
      
      // Try to set lower IDs
      generator.setExistingIds(['R00050', 'R00001']);
      
      // Should keep the higher count
      expect(generator.getCurrentCount('Requirement')).toBe(100);
      expect(generator.generateNextId('Requirement')).toBe('R00101');
    });
  });

  describe('ID Validation', () => {
    it('should validate ID format before generation', () => {
      // Valid types
      expect(() => generator.generateNextId('Requirement')).not.toThrow();
      expect(() => generator.generateNextId('Architecture')).not.toThrow();
      
      // Invalid types
      expect(() => generator.generateNextId('Invalid')).toThrow('Unknown note type');
      expect(() => generator.generateNextId('')).toThrow();
    });

    it('should check shortcode exists in config', () => {
      expect(generator.isValidType('Requirement')).toBe(true);
      expect(generator.isValidType('Decision')).toBe(true);
      expect(generator.isValidType('Architecture')).toBe(true);
      
      expect(generator.isValidType('Unknown')).toBe(false);
      expect(generator.isValidType('')).toBe(false);
    });

    it('should ensure ID uniqueness', async () => {
      // Mock ID existence check
      const existingIds = new Set(['R00001', 'R00002']);
      generator.setIdExistenceChecker(async (id: string) => existingIds.has(id));
      
      // Should skip existing IDs
      expect(await generator.generateUniqueId('Requirement')).toBe('R00003');
      
      existingIds.add('R00003');
      expect(await generator.generateUniqueId('Requirement')).toBe('R00004');
    });

    it('should handle concurrent generation requests', async () => {
      // Simulate concurrent ID generation
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(generator.generateNextIdAsync('Decision'));
      }
      
      const ids = await Promise.all(promises);
      const uniqueIds = new Set(ids);
      
      // All IDs should be unique
      expect(uniqueIds.size).toBe(10);
      
      // Should be sequential
      expect(ids).toContain('D00001');
      expect(ids).toContain('D00010');
    });

  });

  describe('Counter Management', () => {
    it('should get next number for type', () => {
      expect(generator.getNextNumber('Requirement')).toBe(1);
      
      generator.generateNextId('Requirement');
      expect(generator.getNextNumber('Requirement')).toBe(2);
      
      generator.generateNextId('Requirement');
      generator.generateNextId('Requirement');
      expect(generator.getNextNumber('Requirement')).toBe(4);
    });

    it('should get current count for type', () => {
      expect(generator.getCurrentCount('Decision')).toBe(0);
      
      generator.generateNextId('Decision');
      expect(generator.getCurrentCount('Decision')).toBe(1);
      
      generator.setExistingIds(['D00042']);
      expect(generator.getCurrentCount('Decision')).toBe(42);
    });

    it('should get all current counts', () => {
      generator.generateNextId('Requirement');  // R00001
      generator.generateNextId('Requirement');  // R00002
      generator.generateNextId('Decision');     // D00001
      generator.generateNextId('Architecture'); // ARCH00001
      
      const counts = generator.getAllCounts();
      
      expect(counts).toEqual({
        Requirement: 2,
        Decision: 1,
        Question: 0,
        Architecture: 1,
        UserStory: 0,
        Epic: 0
      });
    });

    it('should reset counter for specific type', () => {
      generator.generateNextId('Requirement');
      generator.generateNextId('Requirement');
      generator.generateNextId('Decision');
      
      expect(generator.getCurrentCount('Requirement')).toBe(2);
      expect(generator.getCurrentCount('Decision')).toBe(1);
      
      generator.reset('Requirement');
      
      expect(generator.getCurrentCount('Requirement')).toBe(0);
      expect(generator.getCurrentCount('Decision')).toBe(1); // Unchanged
      expect(generator.generateNextId('Requirement')).toBe('R00001');
    });

    it('should reset all counters', () => {
      // Generate some IDs
      generator.generateNextId('Requirement');
      generator.generateNextId('Decision');
      generator.generateNextId('Question');
      generator.generateNextId('Architecture');
      
      // Reset all
      generator.reset();
      
      const counts = generator.getAllCounts();
      Object.values(counts).forEach(count => {
        expect(count).toBe(0);
      });
      
      // Should start from 1 again
      expect(generator.generateNextId('Requirement')).toBe('R00001');
      expect(generator.generateNextId('Decision')).toBe('D00001');
    });

    it('should persist counters between sessions', async () => {
      const storage = {
        save: vi.fn(),
        load: vi.fn().mockResolvedValue({
          Requirement: 42,
          Decision: 17,
          Question: 3
        })
      };
      
      generator.setStorage(storage);
      
      // Load persisted counters
      await generator.loadCounters();
      expect(generator.getCurrentCount('Requirement')).toBe(42);
      expect(generator.getCurrentCount('Decision')).toBe(17);
      
      // Generate new ID
      generator.generateNextId('Requirement');
      
      // Save should be called
      await generator.saveCounters();
      expect(storage.save).toHaveBeenCalledWith(expect.objectContaining({
        Requirement: 43
      }));
    });
  });


  describe('Performance', () => {
    it('should generate IDs quickly', () => {
      const start = performance.now();
      
      for (let i = 0; i < 1000; i++) {
        generator.generateNextId('Requirement');
      }
      
      const elapsed = performance.now() - start;
      
      // Should generate 1000 IDs in less than 50ms
      expect(elapsed).toBeLessThan(50);
      
      // Average time per ID should be < 0.05ms
      expect(elapsed / 1000).toBeLessThan(0.05);
    });

    it('should handle scanning 10000+ existing IDs', () => {
      const existingIds = [];
      
      // Generate 10000 IDs across different types
      for (let i = 1; i <= 5000; i++) {
        existingIds.push(`R${i.toString().padStart(5, '0')}`);
        existingIds.push(`D${i.toString().padStart(5, '0')}`);
      }
      
      const start = performance.now();
      generator.setExistingIds(existingIds);
      const elapsed = performance.now() - start;
      
      // Should process 10000 IDs in less than 100ms
      expect(elapsed).toBeLessThan(100);
      
      // Verify counts are correct
      expect(generator.getCurrentCount('Requirement')).toBe(5000);
      expect(generator.getCurrentCount('Decision')).toBe(5000);
    });


    it('should optimize counter storage', () => {
      // Generate many IDs
      for (let i = 0; i < 1000; i++) {
        generator.generateNextId('Requirement');
      }
      
      // Memory usage should be minimal
      const counters = generator.getAllCounts();
      const json = JSON.stringify(counters);
      
      // Should be compact (just numbers, not full ID lists)
      expect(json.length).toBeLessThan(200);
    });

    it('should handle concurrent access efficiently', async () => {
      const concurrentGenerations = 100;
      const promises = [];
      
      const start = performance.now();
      
      for (let i = 0; i < concurrentGenerations; i++) {
        promises.push(
          generator.generateNextIdAsync('Decision'),
          generator.generateNextIdAsync('Requirement'),
          generator.generateNextIdAsync('Question')
        );
      }
      
      const results = await Promise.all(promises);
      const elapsed = performance.now() - start;
      
      // Should complete quickly even with contention
      expect(elapsed).toBeLessThan(100);
      
      // All IDs should be unique
      const uniqueIds = new Set(results);
      expect(uniqueIds.size).toBe(300);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid note types', () => {
      expect(() => generator.generateNextId('Invalid')).toThrow('Unknown note type: Invalid');
      expect(() => generator.generateNextId('')).toThrow('Note type is required');
      expect(() => generator.generateNextId(null as any)).toThrow('Note type is required');
      
      expect(() => generator.getNextNumber('Invalid')).toThrow('Unknown note type: Invalid');
      expect(() => generator.getCurrentCount('Invalid')).toThrow('Unknown note type: Invalid');
    });

    it('should handle malformed existing IDs', () => {
      const malformedIds = [
        'R00001',    // Valid
        'R0001a',    // Letters in number
        'R000001',   // Too many digits
        'RR00001',   // Invalid type format  
        '00001R',    // Reversed
        'R 00001',   // Space
        'R00001\n',  // Newline
        null as any,
        undefined as any,
        123 as any   // Number instead of string
      ];
      
      // Should not throw, just ignore invalid ones
      expect(() => generator.setExistingIds(malformedIds)).not.toThrow();
      
      // Should only count the valid one
      expect(generator.getCurrentCount('Requirement')).toBe(1);
    });

    it('should provide clear error messages', () => {
      try {
        generator.generateNextId('Unknown');
      } catch (error: any) {
        expect(error.message).toContain('Unknown note type');
        expect(error.message).toContain('Unknown');
      }
      
      generator.setExistingIds(['R99999']);
      try {
        generator.generateNextId('Requirement');
      } catch (error: any) {
        expect(error.message).toContain('exceeded maximum');
        expect(error.message).toContain('99999');
        expect(error.message).toContain('Requirement');
      }
    });

    it('should recover from corrupted counter state', async () => {
      const storage = {
        load: vi.fn().mockResolvedValue({
          Requirement: 'corrupted',
          Decision: -5,
          Question: null,
          Unknown: 42  // Unknown type
        }),
        save: vi.fn()
      };
      
      generator.setStorage(storage);
      await generator.loadCounters();
      
      // Should reset corrupted values to 0
      expect(generator.getCurrentCount('Requirement')).toBe(0);
      expect(generator.getCurrentCount('Decision')).toBe(0);
      expect(generator.getCurrentCount('Question')).toBe(0);
      
      // Should still generate valid IDs
      expect(generator.generateNextId('Requirement')).toBe('R00001');
    });

    it('should handle missing configuration', () => {
      // Create generator with empty config
      const emptyGenerator = new NoteIdGenerator({} as any);
      
      expect(() => emptyGenerator.generateNextId('Requirement')).toThrow('Configuration missing');
      
      // Create with partial config
      const partialGenerator = new NoteIdGenerator({
        noteTypes: {},
      });
      
      expect(() => partialGenerator.generateNextId('Requirement')).toThrow('Unknown note type');
    });
  });

  describe('Integration Considerations', () => {
    it('should work with filesystem scanning', async () => {
      // Mock filesystem scanner
      const scanner = {
        findNoteFiles: vi.fn().mockResolvedValue([
          '/notes/requirements/R00001 Login.md',
          '/notes/requirements/R00042 Security.md',
          '/notes/decisions/D00017 Database.md',
          '/notes/architecture/ARCH00003 Overview.md'
        ])
      };
      
      const fileIds = await scanner.findNoteFiles();
      const ids = fileIds.map((f: string) => {
        const match = f.match(/([A-Z]+\d{5})/); 
        return match ? match[1] : null;
      }).filter(Boolean);
      
      generator.setExistingIds(ids as string[]);
      
      expect(generator.getCurrentCount('Requirement')).toBe(42);
      expect(generator.getCurrentCount('Decision')).toBe(17);
      expect(generator.getCurrentCount('Architecture')).toBe(3);
    });

    it('should work with index-based lookups', () => {
      // Mock index
      const index = {
        Requirement: ['R00001', 'R00002', 'R00010'],
        Decision: ['D00001', 'D00005'],
        Question: ['Q00001']
      };
      
      // Set from index
      const allIds = Object.values(index).flat();
      generator.setExistingIds(allIds);
      
      expect(generator.getCurrentCount('Requirement')).toBe(10);
      expect(generator.getCurrentCount('Decision')).toBe(5);
      expect(generator.getCurrentCount('Question')).toBe(1);
    });

    it('should support both sync and async operations', async () => {
      // Sync operation
      const syncId = generator.generateNextId('Requirement');
      expect(syncId).toBe('R00001');
      
      // Async operation
      const asyncId = await generator.generateNextIdAsync('Requirement');
      expect(asyncId).toBe('R00002');
      
      // Both should use same counter
      expect(generator.getCurrentCount('Requirement')).toBe(2);
    });

    it('should integrate with NoteManager lifecycle', () => {
      // Mock NoteManager events
      const noteManager = {
        on: vi.fn(),
        generateId: (type: string) => generator.generateNextId(type)
      };
      
      // Should be able to register for events
      generator.onIdGenerated((event) => {
        noteManager.on('note:created', { noteId: event.id });
      });
      
      const id = noteManager.generateId('Decision');
      expect(id).toBe('D00001');
    });

    it('should emit events on ID generation', () => {
      const events: any[] = [];
      
      generator.on('idGenerated', (event) => {
        events.push(event);
      });
      
      generator.generateNextId('Requirement');
      generator.generateNextId('Decision');
      
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({
        type: 'Requirement',
        id: 'R00001',
        counter: 1,
        timestamp: expect.any(Date)
      });
      expect(events[1]).toEqual({
        type: 'Decision', 
        id: 'D00001',
        counter: 1,
        timestamp: expect.any(Date)
      });
    });
  });
});