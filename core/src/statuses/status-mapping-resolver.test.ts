import { describe, it, expect, vi } from 'vitest';
import { StatusMappingResolver, DEFAULT_STATUS_MAPPINGS } from './status-mapping-resolver';
import { type SCEpterConfig } from '../types/config';

describe('StatusMappingResolver', () => {
  describe('resolve', () => {
    const baseConfig: SCEpterConfig = {
      noteTypes: {
        Task: { folder: 'tasks', shortcode: 'T' },
      },

    };

    it('should resolve default status mappings', () => {
      const resolver = new StatusMappingResolver(baseConfig);

      const result = resolver.resolve('pending');
      expect(result).toEqual({
        emoji: '🔵',
        color: 'blue',
      });
    });

    it('should resolve aliases', () => {
      const resolver = new StatusMappingResolver(baseConfig);

      const result = resolver.resolve('done');
      expect(result).toEqual({
        emoji: '✅',
        color: 'green',
      });
    });

    it('should prioritize global mappings over defaults', () => {
      const config: SCEpterConfig = {
        ...baseConfig,
        statusMappings: {
          pending: {
            emoji: '⏳',
            color: 'orange',
          },
        },
      };
      const resolver = new StatusMappingResolver(config);

      const result = resolver.resolve('pending');
      expect(result).toEqual({
        emoji: '⏳',
        color: 'orange',
      });
    });

    it('should prioritize note-type specific mappings over global', () => {
      const config: SCEpterConfig = {
        ...baseConfig,
        noteTypes: {
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            statusMappings: {
              pending: {
                emoji: '📋',
                color: 'purple',
              },
            },
          },
        },
        statusMappings: {
          pending: {
            emoji: '⏳',
            color: 'orange',
          },
        },
      };
      const resolver = new StatusMappingResolver(config);

      const result = resolver.resolve('pending', 'Task');
      expect(result).toEqual({
        emoji: '📋',
        color: 'purple',
      });
    });

    it('should handle aliases in global mappings', () => {
      const config: SCEpterConfig = {
        ...baseConfig,
        statusMappings: {
          'custom-done': 'completed',
          completed: {
            emoji: '💯',
            color: 'gold',
          },
        },
      };
      const resolver = new StatusMappingResolver(config);

      const result = resolver.resolve('custom-done');
      expect(result).toEqual({
        emoji: '💯',
        color: 'gold',
      });
    });

    it('should handle aliases in note-type specific mappings', () => {
      const config: SCEpterConfig = {
        ...baseConfig,
        noteTypes: {
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            statusMappings: {
              'task-done': 'completed',
              completed: {
                emoji: '🎯',
                color: 'teal',
              },
            },
          },
        },
      };
      const resolver = new StatusMappingResolver(config);

      const result = resolver.resolve('task-done', 'Task');
      expect(result).toEqual({
        emoji: '🎯',
        color: 'teal',
      });
    });

    it('should handle multi-level aliases', () => {
      const config: SCEpterConfig = {
        ...baseConfig,
        statusMappings: {
          finished: 'done', // Points to 'done' which points to 'completed'
        },
      };
      const resolver = new StatusMappingResolver(config);

      const result = resolver.resolve('finished');
      expect(result).toEqual({
        emoji: '✅',
        color: 'green',
      });
    });

    it('should detect and handle circular references', () => {
      const config: SCEpterConfig = {
        ...baseConfig,
        statusMappings: {
          status1: 'status2',
          status2: 'status3',
          status3: 'status1', // Circular reference
        },
      };
      const resolver = new StatusMappingResolver(config);

      // Mock console.warn
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = resolver.resolve('status1');
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith('Circular reference detected in status mapping: status1');

      warnSpy.mockRestore();
    });

    it('should return null for non-existent status', () => {
      const resolver = new StatusMappingResolver(baseConfig);

      const result = resolver.resolve('non-existent-status');
      expect(result).toBeNull();
    });

  });

  describe('getAllMappings', () => {
    it('should return all default mappings', () => {
      const resolver = new StatusMappingResolver({
        noteTypes: {},
  
      });

      const mappings = resolver.getAllMappings();

      // Check some key mappings
      expect(mappings['pending']).toEqual({
        emoji: '🔵',
        color: 'blue',
      });
      expect(mappings['done']).toEqual({
        emoji: '✅',
        color: 'green',
      }); // Alias resolved
      expect(mappings['in_progress']).toEqual({
        emoji: '🟡',
        color: 'yellow',
      }); // Alias resolved
    });

    it('should merge mappings from all sources', () => {
      const config: SCEpterConfig = {
        noteTypes: {
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            statusMappings: {
              'task-specific': {
                emoji: '📝',
                color: 'indigo',
              },
            },
          },
        },
  
        statusMappings: {
          'global-status': {
            emoji: '🌍',
            color: 'cyan',
          },
        },
      };
      const resolver = new StatusMappingResolver(config);

      const mappings = resolver.getAllMappings('Task');

      // Should include default, global, and note-type specific
      expect(mappings['pending']).toBeDefined();
      expect(mappings['global-status']).toEqual({
        emoji: '🌍',
        color: 'cyan',
      });
      expect(mappings['task-specific']).toEqual({
        emoji: '📝',
        color: 'indigo',
      });
    });

    it('should resolve all aliases in the final result', () => {
      const config: SCEpterConfig = {
        noteTypes: {},
  
        statusMappings: {
          alias1: 'alias2',
          alias2: 'completed',
        },
      };
      const resolver = new StatusMappingResolver(config);

      const mappings = resolver.getAllMappings();

      // All aliases should resolve to actual mappings
      expect(mappings['alias1']).toEqual({
        emoji: '✅',
        color: 'green',
      });
      expect(mappings['alias2']).toEqual({
        emoji: '✅',
        color: 'green',
      });
    });
  });


  describe('complex scenarios', () => {
    it('should handle mixed aliases and mappings across all levels', () => {
      const config: SCEpterConfig = {
        noteTypes: {
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            statusMappings: {
              'task-todo': 'global-todo', // Points to global alias
              'task-done': {
                emoji: '🏁',
                color: 'checkered',
              },
            },
          },
        },
  
        statusMappings: {
          'global-todo': 'pending', // Points to default
          'global-done': 'task-done', // Points to note-type specific (when resolved for Task)
          pending: {
            emoji: '🚀',
            color: 'rocket',
          },
        },
      };
      const resolver = new StatusMappingResolver(config);

      // Task-specific alias -> global alias -> global mapping
      const taskTodo = resolver.resolve('task-todo', 'Task');
      expect(taskTodo).toEqual({
        emoji: '🚀',
        color: 'rocket',
      });

      // Global alias -> note-type specific mapping
      const globalDone = resolver.resolve('global-done', 'Task');
      expect(globalDone).toEqual({
        emoji: '🏁',
        color: 'checkered',
      });

      // Direct note-type specific mapping
      const taskDone = resolver.resolve('task-done', 'Task');
      expect(taskDone).toEqual({
        emoji: '🏁',
        color: 'checkered',
      });
    });

    it('should handle undefined note type gracefully', () => {
      const config: SCEpterConfig = {
        noteTypes: {
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            statusMappings: {
              pending: {
                emoji: '📋',
                color: 'purple',
              },
            },
          },
        },
  
      };
      const resolver = new StatusMappingResolver(config);

      // Should not use Task-specific mapping when noteType is undefined
      const result = resolver.resolve('pending');
      expect(result).toEqual({
        emoji: '🔵',
        color: 'blue',
      }); // Default mapping
    });
  });
});
