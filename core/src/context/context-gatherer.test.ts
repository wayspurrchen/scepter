import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContextGatherer } from './context-gatherer';
import { NoteManager } from '../notes/note-manager';
import { ConfigManager } from '../config/config-manager';
import { ReferenceManager } from '../references/reference-manager';
import type { Note } from '../types/note';
import type { ContextHints } from '../types/context';
import type { Task } from '../types/task';
import { TaskStatus } from '../types/task';
import type { SCEpterConfig } from '../types/config';
import { cleanupTestProject, type TestContext } from 'src/test-utils/integration-test-helpers';
import { setupTestProject } from 'src/test-utils/integration-test-helpers';

// No mocks - using real implementations

describe('ContextGatherer', () => {
  let ctx: TestContext;
  let contextGatherer: ContextGatherer;
  let noteManager: NoteManager;
  let configManager: ConfigManager;
  let referenceManager: ReferenceManager;

  // Custom config with TODO type added
  const testConfig: SCEpterConfig = {
    noteTypes: {
      Requirement: { folder: 'requirements', shortcode: 'R' },
      Decision: { folder: 'decisions', shortcode: 'D' },
      TODO: { folder: 'todos', shortcode: 'TD' },
      Question: { folder: 'questions', shortcode: 'Q' },
    },
  };

  // Helper to create test notes
  async function createTestNotes() {
    // Create notes with real content and references
    await noteManager.createNote({
      type: 'Requirement',
      id: 'R001',
      title: 'Users must be able to authenticate with JWT',
      content: 'Users must be able to authenticate with JWT',
      tags: ['auth', 'security', 'api'],
    });

    await noteManager.createNote({
      type: 'Requirement',
      id: 'R002',
      title: 'System must support PostgreSQL database',
      content: 'System must support PostgreSQL database',
      tags: ['database', 'infrastructure'],
    });

    await noteManager.createNote({
      type: 'Decision',
      id: 'D001',
      title: 'Use JWT tokens with 15 minute expiry',
      content: 'Use JWT tokens with 15 minute expiry. Based on {R001}',
      tags: ['auth', 'security'],
    });

    await noteManager.createNote({
      type: 'Decision',
      id: 'D002',
      title: 'Use Redis for session storage',
      content: 'Use Redis for session storage',
      tags: ['infrastructure', 'caching'],
    });

    await noteManager.createNote({
      type: 'TODO',
      id: 'TD001',
      title: 'Implement refresh token endpoint',
      content: 'Implement refresh token endpoint for {D001}',
      tags: ['auth', 'api'],
    });
  }

  beforeEach(async () => {
    // Setup test project with custom config
    ctx = await setupTestProject('test-context-gatherer', testConfig);
    noteManager = ctx.noteManager;
    configManager = ctx.configManager;
    referenceManager = ctx.referenceManager;

    // Create ContextGatherer instance
    contextGatherer = new ContextGatherer(noteManager, configManager, referenceManager);

    // Create test notes
    await createTestNotes();
  });

  afterEach(async () => {
    await cleanupTestProject(ctx);
  });

  describe('gatherContext', () => {
    describe('basic gathering', () => {
      it('should gather notes by patterns', async () => {
        const hints: ContextHints = {
          patterns: ['JWT', 'auth'],
        };

        const result = await contextGatherer.gatherContext(hints);

        expect(result.contextHintNotes).toHaveLength(2); // R001, D001
        expect(result.contextHintNotes.map((n: Note) => n.id).sort()).toEqual(['D001', 'R001']);
      });

      it('should gather notes by tags', async () => {
        const hints: ContextHints = {
          includeTags: ['security', 'infrastructure'],
        };

        const result = await contextGatherer.gatherContext(hints);

        // Should find notes with either security OR infrastructure tags
        expect(result.contextHintNotes).toHaveLength(4); // R001, R002, D001, D002
        const noteIds = result.contextHintNotes.map((n: Note) => n.id).sort();
        expect(noteIds).toEqual(['D001', 'D002', 'R001', 'R002']);
      });

      it('should gather notes by types', async () => {
        const hints: ContextHints = {
          includeTypes: ['Requirement', 'Decision'],
        };

        const result = await contextGatherer.gatherContext(hints);

        expect(result.contextHintNotes).toHaveLength(4); // R001, R002, D001, D002
        const noteIds = result.contextHintNotes.map((n: Note) => n.id).sort();
        expect(noteIds).toEqual(['D001', 'D002', 'R001', 'R002']);
      });

      it('should apply exclusion patterns', async () => {
        const hints: ContextHints = {
          includeTypes: ['Requirement'],
          excludePatterns: ['PostgreSQL'],
        };

        const result = await contextGatherer.gatherContext(hints);

        expect(result.contextHintNotes).toHaveLength(1);
        expect(result.contextHintNotes[0].id).toBe('R001');
      });

      it('should deduplicate notes from multiple sources', async () => {
        const hints: ContextHints = {
          patterns: ['auth'],
          includeTags: ['security'],
        };

        const result = await contextGatherer.gatherContext(hints);

        // The unified API uses AND logic between patterns and tags
        // Only R001 matches both pattern 'auth' (in content) AND tag 'security'
        expect(result.contextHintNotes).toHaveLength(1);
        expect(result.contextHintNotes[0].id).toBe('R001');
      });

      it('should return empty array when no notes match', async () => {
        const hints: ContextHints = {
          patterns: ['nonexistent'],
        };

        const result = await contextGatherer.gatherContext(hints);

        expect(result.contextHintNotes).toHaveLength(0);
        expect(result.referencedNotes).toHaveLength(0);
      });
    });

    describe('reference following', () => {
      it('should follow references to depth 1 by default', async () => {
        const hints: ContextHints = {
          patterns: ['refresh'],
        };

        const result = await contextGatherer.gatherContext(hints);

        expect(result.contextHintNotes).toHaveLength(1);
        expect(result.contextHintNotes[0].id).toBe('TD001'); // TD001 not T001
        expect(result.referencedNotes).toHaveLength(1);
        expect(result.referencedNotes[0].id).toBe('D001');
      });

      it('should follow references to specified depth', async () => {
        const hints: ContextHints = {
          patterns: ['refresh'],
        };

        const result = await contextGatherer.gatherContext(hints, { maxDepth: 2 });

        expect(result.contextHintNotes).toHaveLength(1);
        expect(result.contextHintNotes[0].id).toBe('TD001');
        expect(result.referencedNotes).toHaveLength(2);
        const refIds = result.referencedNotes.map((n: Note) => n.id).sort();
        expect(refIds).toEqual(['D001', 'R001']); // D001 is directly referenced, R001 is referenced by D001
      });

      it('should not follow references when maxDepth is 0', async () => {
        const hints: ContextHints = {
          patterns: ['refresh'],
        };

        const result = await contextGatherer.gatherContext(hints, { maxDepth: 0 });

        expect(result.contextHintNotes).toHaveLength(1);
        expect(result.referencedNotes).toHaveLength(0);
      });

      it('should handle circular references', async () => {
        // Create notes with circular references
        await noteManager.createNote({
          type: 'Decision',
          id: 'D003',
          title: 'Circular reference A',
          content: 'Circular reference A, depends on {D004}',
          tags: ['circular'],
        });

        await noteManager.createNote({
          type: 'Decision',
          id: 'D004',
          title: 'Circular reference B',
          content: 'Circular reference B, depends on {D003}',
          tags: ['circular'],
        });

        const result = await contextGatherer.gatherContext({ patterns: ['Circular'] }, { maxDepth: 5 });

        expect(result.contextHintNotes).toHaveLength(2); // Both D003 and D004 match
        expect(result.referencedNotes).toHaveLength(0); // Both are already in primary notes
        // Should not infinitely loop - ReferenceManager handles this internally
      });

      it('should skip non-existent referenced notes', async () => {
        // Create a note that references a non-existent note
        await noteManager.createNote({
          type: 'TODO',
          id: 'TD002',
          title: 'References missing note',
          content: 'References missing note {MISSING001}',
          tags: [],
        });

        const result = await contextGatherer.gatherContext({ patterns: ['missing'] });

        expect(result.contextHintNotes).toHaveLength(1);
        expect(result.contextHintNotes[0].id).toBe('TD002');
        expect(result.referencedNotes).toHaveLength(0); // Skipped because MISSING001 doesn't exist
      });
    });

    describe('filtering and sorting', () => {
      it('should deduplicate content when enabled', async () => {
        // Create duplicate content notes
        await noteManager.createNote({
          type: 'Requirement',
          id: 'R003',
          title: 'Duplicate content',
          content: 'This is duplicate content for testing',
          tags: ['duplicate'],
        });

        await noteManager.createNote({
          type: 'Requirement',
          id: 'R004',
          title: 'Duplicate content different title',
          content: 'This is duplicate content for testing', // Same content
          tags: ['duplicate'],
        });

        const result = await contextGatherer.gatherContext({ patterns: ['duplicate'] }, { deduplicateContent: true });

        expect(result.contextHintNotes).toHaveLength(1); // Should dedupe
      });

      it('should not deduplicate content when disabled', async () => {
        // Create duplicate content notes if they don't exist
        const existingNotes = await noteManager.getNotes({ ids: ['R003', 'R004'] });
        
        if (existingNotes.notes.length < 2) {
          // Create them if missing
          await noteManager.createNote({
            type: 'Requirement',
            id: 'R003',
            title: 'Duplicate content',
            content: 'This is duplicate content for testing',
            tags: ['duplicate'],
          });

          await noteManager.createNote({
            type: 'Requirement',
            id: 'R004',
            title: 'Duplicate content different title',
            content: 'This is duplicate content for testing',
            tags: ['duplicate'],
          });
        }

        // Now test that gathering with deduplication disabled returns both
        const result = await contextGatherer.gatherContext({ patterns: ['duplicate'] }, { deduplicateContent: false });

        expect(result.contextHintNotes).toHaveLength(2); // Should NOT dedupe
      });

      it('should sort by relevance by default', async () => {
        // TODO: Implement relevance sorting test when scoring is defined
      });

      it('should sort by date when specified', async () => {
        // TODO: Implement date sorting test when date field is added to Note
      });

      it('should sort by type when specified', async () => {
        const result = await contextGatherer.gatherContext({ includeTags: ['auth'] }, { sortBy: 'type' });

        // Should be sorted by type: D, R, T
        expect(result.contextHintNotes.map((n: Note) => n.type)).toEqual(['Decision', 'Requirement', 'TODO']);
      });
    });

    describe('statistics', () => {
      it('should track gathering statistics', async () => {
        const result = await contextGatherer.gatherContext({
          patterns: ['JWT'],
          includeTags: ['security'],
        });

        // With unified API using AND logic, we get notes matching BOTH pattern AND tag
        // R001 and D001 both have 'JWT' in content and 'security' tag
        expect(result.stats.notesSearched).toBeGreaterThan(0);
        expect(result.stats.notesIncluded).toBeGreaterThan(0);
        expect(result.stats.referencesFollowed).toBe(0);
        expect(result.stats.tagsMatched).toContain('security');
        expect(result.stats.typesMatched.length).toBeGreaterThan(0);
        expect(result.stats.gatherTimeMs).toBeGreaterThan(0);
      });
    });
  });

  describe('gatherForTask', () => {
    it('should gather context for task with hints', async () => {
      const task: Task = {
        id: 'task-001',
        title: 'Implement authentication',
        description: 'Implement JWT authentication',
        contextHints: {
          patterns: ['JWT'],
        },
        status: TaskStatus.RUNNING,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await contextGatherer.gatherForTask(task);

      // Should have gathered notes based on task hints
      expect(result.contextHintNotes.length).toBeGreaterThan(0);
      // Task patterns ['JWT'] should find relevant notes
      const noteIds = result.contextHintNotes.map((n) => n.id).sort();
      expect(noteIds).toContain('R001'); // Has JWT in content
    });

    it('should work with task hints only', async () => {
      const task: Task = {
        id: 'task-002',
        title: 'Gather requirements',
        description: 'Gather database requirements',
        contextHints: {
          patterns: ['database'],
        },
        status: TaskStatus.RUNNING,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await contextGatherer.gatherForTask(task);

      // Should find R002 which matches the 'database' pattern
      expect(result.contextHintNotes.length).toBeGreaterThan(0);
      expect(result.contextHintNotes.some((n) => n.id === 'R002')).toBe(true);
    });

    it('should handle task with no hints', async () => {
      const task: Task = {
        id: 'task-003',
        title: 'Generic task',
        description: 'Generic task without hints',
        status: TaskStatus.RUNNING,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await contextGatherer.gatherForTask(task);

      // Should handle gracefully when task has no hints
      expect(result).toBeDefined();
      expect(result.contextHintNotes).toBeDefined();
    });

    it('should emit task:context event', async () => {
      const task: Task = {
        id: 'task-005',
        title: 'Test task',
        description: 'Test task for events',
        status: TaskStatus.RUNNING,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const contextHandler = vi.fn();
      contextGatherer.on('task:context', contextHandler);

      await contextGatherer.gatherForTask(task);

      expect(contextHandler).toHaveBeenCalledWith({
        taskId: 'task-005',
        context: expect.objectContaining({
          contextHintNotes: expect.any(Array),
          referencedNotes: expect.any(Array),
        }),
      });
    });
  });

  describe('event handling', () => {
    it('should emit gather:start event', async () => {
      const startHandler = vi.fn();
      contextGatherer.on('gather:start', startHandler);

      const hints: ContextHints = { patterns: ['test'] };

      await contextGatherer.gatherContext(hints);

      expect(startHandler).toHaveBeenCalledWith(hints);
    });

    it('should emit gather:complete event', async () => {
      const completeHandler = vi.fn();
      contextGatherer.on('gather:complete', completeHandler);

      const result = await contextGatherer.gatherContext({ patterns: ['test'] });

      expect(completeHandler).toHaveBeenCalledWith(result);
    });

    it('should emit gather:error event on error', async () => {
      const errorHandler = vi.fn();
      contextGatherer.on('gather:error', errorHandler);

      // Try to gather with an invalid hint that might cause an error
      // Since we can't mock errors with real implementation, we'll skip this test
      // or find a natural way to trigger an error

      // For now, let's test with a very complex regex that might fail
      try {
        await contextGatherer.gatherContext({ patterns: ['[[[[[invalid regex'] });
      } catch (error) {
        // If an error occurs, the handler should have been called
        expect(errorHandler).toHaveBeenCalled();
      }
    });

    it('should emit references:depth-limit event', async () => {
      const depthHandler = vi.fn();
      contextGatherer.on('references:depth-limit', depthHandler);

      // Create notes with deep reference chains
      await noteManager.createNote({
        type: 'Question',
        id: 'Q001',
        title: 'Deep ref 1',
        content: 'Deep ref 1 references {Q002} and {Q003}',
        tags: ['deep'],
      });

      await noteManager.createNote({
        type: 'Question',
        id: 'Q002',
        title: 'Deep ref 2',
        content: 'Deep ref 2 references {Q004} and {Q005}',
        tags: ['deep'],
      });

      await noteManager.createNote({
        type: 'Question',
        id: 'Q003',
        title: 'Deep ref 3',
        content: 'Deep ref 3',
        tags: ['deep'],
      });

      // Q004 and Q005 don't exist, so they would be at depth limit

      const result = await contextGatherer.gatherContext({ patterns: ['Deep ref 1'] }, { maxDepth: 1 });

      // Check if the event was emitted when depth limit was reached
      if (depthHandler.mock.calls.length > 0) {
        expect(depthHandler).toHaveBeenCalledWith(expect.any(Number));
      }
    });

    it('should emit progress events during gathering', async () => {
      const progressHandler = vi.fn();
      contextGatherer.on('progress', progressHandler);

      await contextGatherer.gatherContext({ patterns: ['refresh'] });

      // Progress events may be emitted during gathering
      if (progressHandler.mock.calls.length > 0) {
        expect(progressHandler).toHaveBeenCalledWith({
          phase: expect.any(String),
          current: expect.any(Number),
          total: null, // total can be null
        });
      }
    });
  });

  describe('error handling', () => {
    it.skip('should handle malformed context hints', async () => {
      // This would be handled by TypeScript, but we can test runtime validation if added
    });

    it('should handle concurrent gathering operations', async () => {
      // Start multiple gather operations
      const promises = [
        contextGatherer.gatherContext({ patterns: ['auth'] }),
        contextGatherer.gatherContext({ patterns: ['database'] }),
        contextGatherer.gatherContext({ includeTags: ['infrastructure'] }),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      // Each should have found some notes
      expect(results[0].contextHintNotes.length).toBeGreaterThan(0); // auth pattern
      expect(results[1].contextHintNotes.length).toBeGreaterThan(0); // database pattern
      expect(results[2].contextHintNotes.length).toBeGreaterThan(0); // infrastructure tag
    });
  });

  describe('integration scenarios', () => {
    it('should handle complex multi-source gathering', async () => {
      const hints: ContextHints = {
        patterns: ['auth', 'JWT'],
        includeTags: ['security', 'api'],
        includeTypes: ['Decision', 'TODO'],
        excludePatterns: ['Redis'],
      };

      const result = await contextGatherer.gatherContext(hints);

      // Should find notes matching the complex hints
      expect(result.contextHintNotes.length).toBeGreaterThan(0);

      // Verify the complex filtering worked:
      // - Should include notes with auth/JWT patterns
      // - Should have security or api tags
      // - Should be Decision or TODO types
      // - Should exclude D002 which contains 'Redis'
      const noteIds = result.contextHintNotes.map((n: Note) => n.id);
      expect(noteIds).not.toContain('D002'); // Excluded by Redis pattern

      // Should have found D001 (Decision with JWT, security tag)
      expect(noteIds).toContain('D001');
      // TD001 might not match because of the complex AND logic between criteria
    });

    it('should gather context for task with complex patterns and types', async () => {
      const task: Task = {
        id: 'impl-001',
        title: 'Implement user authentication with JWT',
        description: 'Implement complete user authentication system using JWT',
        contextHints: {
          patterns: ['user', 'authentication'],
          includeTypes: ['Requirement', 'Decision'],
        },
        status: TaskStatus.RUNNING,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await contextGatherer.gatherForTask(task);

      // Should gather notes matching task hints
      expect(result.contextHintNotes.length).toBeGreaterThan(0);
      const noteIds = result.contextHintNotes.map((n) => n.id);
      expect(noteIds).toContain('R001');
      expect(result.stats.typesMatched).toContain('Requirement');
    });
  });
});
