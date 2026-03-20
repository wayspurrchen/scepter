/**
 * Status Validator Tests
 *
 * @implements {T011.2.2} Tests for status validator
 * @implements {F003} Predefined Status Values Per Note Type
 */

import { describe, it, expect } from 'vitest';
import { StatusValidator, type StatusValidationResult } from './status-validator';
import type { SCEpterConfig } from '../types/config';

describe('StatusValidator', () => {
  // Base configuration for tests
  const baseConfig: SCEpterConfig = {
    noteTypes: {
      Task: { folder: 'tasks', shortcode: 'T' },
      Decision: { folder: 'decisions', shortcode: 'D' },
    },
  };

  describe('resolveAllowedStatuses', () => {
    it('should return null when no allowedStatuses configured', () => {
      const validator = new StatusValidator(baseConfig);

      const result = validator.resolveAllowedStatuses('Task');

      expect(result).toBeNull();
    });

    it('should return null for non-existent note type', () => {
      const validator = new StatusValidator(baseConfig);

      const result = validator.resolveAllowedStatuses('NonExistent');

      expect(result).toBeNull();
    });

    it('should return values directly for shorthand array syntax', () => {
      const config: SCEpterConfig = {
        ...baseConfig,
        noteTypes: {
          ...baseConfig.noteTypes,
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            allowedStatuses: ['pending', 'in-progress', 'completed'],
          },
        },
      };
      const validator = new StatusValidator(config);

      const result = validator.resolveAllowedStatuses('Task');

      expect(result).toEqual(['pending', 'in-progress', 'completed']);
    });

    it('should expand status sets', () => {
      const config: SCEpterConfig = {
        ...baseConfig,
        statusSets: {
          workflow: ['pending', 'in-progress', 'blocked', 'completed'],
        },
        noteTypes: {
          ...baseConfig.noteTypes,
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            allowedStatuses: {
              sets: ['workflow'],
              mode: 'suggest',
            },
          },
        },
      };
      const validator = new StatusValidator(config);

      const result = validator.resolveAllowedStatuses('Task');

      expect(result).toEqual(['pending', 'in-progress', 'blocked', 'completed']);
    });

    it('should expand multiple status sets', () => {
      const config: SCEpterConfig = {
        ...baseConfig,
        statusSets: {
          workflow: ['pending', 'in-progress', 'completed'],
          product: ['draft', 'proposed', 'approved'],
        },
        noteTypes: {
          ...baseConfig.noteTypes,
          Feature: {
            folder: 'features',
            shortcode: 'F',
            allowedStatuses: {
              sets: ['workflow', 'product'],
              mode: 'suggest',
            },
          },
        },
      };
      const validator = new StatusValidator(config);

      const result = validator.resolveAllowedStatuses('Feature');

      expect(result).toEqual([
        'pending',
        'in-progress',
        'completed',
        'draft',
        'proposed',
        'approved',
      ]);
    });

    it('should combine sets with additional values', () => {
      const config: SCEpterConfig = {
        ...baseConfig,
        statusSets: {
          workflow: ['pending', 'in-progress', 'completed'],
        },
        noteTypes: {
          ...baseConfig.noteTypes,
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            allowedStatuses: {
              sets: ['workflow'],
              values: ['on-hold', 'cancelled'],
              mode: 'suggest',
            },
          },
        },
      };
      const validator = new StatusValidator(config);

      const result = validator.resolveAllowedStatuses('Task');

      expect(result).toEqual(['pending', 'in-progress', 'completed', 'on-hold', 'cancelled']);
    });

    it('should return only values when no sets referenced', () => {
      const config: SCEpterConfig = {
        ...baseConfig,
        noteTypes: {
          ...baseConfig.noteTypes,
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            allowedStatuses: {
              values: ['custom-1', 'custom-2'],
              mode: 'suggest',
            },
          },
        },
      };
      const validator = new StatusValidator(config);

      const result = validator.resolveAllowedStatuses('Task');

      expect(result).toEqual(['custom-1', 'custom-2']);
    });

    it('should ignore non-existent set references gracefully', () => {
      const config: SCEpterConfig = {
        ...baseConfig,
        statusSets: {
          workflow: ['pending', 'completed'],
        },
        noteTypes: {
          ...baseConfig.noteTypes,
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            allowedStatuses: {
              sets: ['workflow', 'nonexistent'],
              values: ['extra'],
              mode: 'suggest',
            },
          },
        },
      };
      const validator = new StatusValidator(config);

      const result = validator.resolveAllowedStatuses('Task');

      // Should include workflow values and extra, but not error on nonexistent
      expect(result).toEqual(['pending', 'completed', 'extra']);
    });

    it('should return a copy of the array (not reference)', () => {
      const config: SCEpterConfig = {
        ...baseConfig,
        noteTypes: {
          ...baseConfig.noteTypes,
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            allowedStatuses: ['pending', 'completed'],
          },
        },
      };
      const validator = new StatusValidator(config);

      const result1 = validator.resolveAllowedStatuses('Task');
      const result2 = validator.resolveAllowedStatuses('Task');

      expect(result1).not.toBe(result2);
      expect(result1).toEqual(result2);
    });
  });

  describe('validateStatus', () => {
    describe('no configuration', () => {
      it('should return valid with mode "none" when no allowedStatuses configured', () => {
        const validator = new StatusValidator(baseConfig);

        const result = validator.validateStatus('anything', 'Task');

        expect(result.valid).toBe(true);
        expect(result.mode).toBe('none');
        expect(result.message).toBeUndefined();
        expect(result.allowedValues).toBeUndefined();
      });

      it('should return valid with mode "none" for non-existent note type', () => {
        const validator = new StatusValidator(baseConfig);

        const result = validator.validateStatus('anything', 'NonExistent');

        expect(result.valid).toBe(true);
        expect(result.mode).toBe('none');
      });
    });

    describe('enforce mode', () => {
      const enforceConfig: SCEpterConfig = {
        ...baseConfig,
        statusSets: {
          workflow: ['pending', 'in-progress', 'completed'],
        },
        noteTypes: {
          ...baseConfig.noteTypes,
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            allowedStatuses: {
              sets: ['workflow'],
              mode: 'enforce',
              defaultValue: 'pending',
            },
          },
        },
      };

      it('should return valid for allowed status', () => {
        const validator = new StatusValidator(enforceConfig);

        const result = validator.validateStatus('in-progress', 'Task');

        expect(result.valid).toBe(true);
        expect(result.mode).toBe('enforce');
        expect(result.message).toBeUndefined();
        expect(result.allowedValues).toEqual(['pending', 'in-progress', 'completed']);
      });

      it('should return invalid for disallowed status', () => {
        const validator = new StatusValidator(enforceConfig);

        const result = validator.validateStatus('invalid-status', 'Task');

        expect(result.valid).toBe(false);
        expect(result.mode).toBe('enforce');
        expect(result.message).toBe(
          'Status "invalid-status" is not allowed for Task. Allowed: pending, in-progress, completed'
        );
        expect(result.allowedValues).toEqual(['pending', 'in-progress', 'completed']);
      });

      it('should indicate default will be used when status is undefined', () => {
        const validator = new StatusValidator(enforceConfig);

        const result = validator.validateStatus(undefined, 'Task');

        expect(result.valid).toBe(true);
        expect(result.mode).toBe('enforce');
        expect(result.message).toBe('No status provided. Default "pending" will be used.');
        expect(result.allowedValues).toEqual(['pending', 'in-progress', 'completed']);
      });

      it('should indicate default will be used when status is empty string', () => {
        const validator = new StatusValidator(enforceConfig);

        const result = validator.validateStatus('', 'Task');

        expect(result.valid).toBe(true);
        expect(result.mode).toBe('enforce');
        expect(result.message).toBe('No status provided. Default "pending" will be used.');
      });
    });

    describe('suggest mode', () => {
      const suggestConfig: SCEpterConfig = {
        ...baseConfig,
        noteTypes: {
          ...baseConfig.noteTypes,
          Decision: {
            folder: 'decisions',
            shortcode: 'D',
            allowedStatuses: {
              values: ['draft', 'proposed', 'approved', 'rejected'],
              mode: 'suggest',
              defaultValue: 'draft',
            },
          },
        },
      };

      it('should return valid for allowed status', () => {
        const validator = new StatusValidator(suggestConfig);

        const result = validator.validateStatus('proposed', 'Decision');

        expect(result.valid).toBe(true);
        expect(result.mode).toBe('suggest');
        expect(result.message).toBeUndefined();
        expect(result.allowedValues).toEqual(['draft', 'proposed', 'approved', 'rejected']);
      });

      it('should return valid with warning for non-suggested status', () => {
        const validator = new StatusValidator(suggestConfig);

        const result = validator.validateStatus('custom-status', 'Decision');

        expect(result.valid).toBe(true);
        expect(result.mode).toBe('suggest');
        expect(result.message).toBe(
          'Warning: Status "custom-status" is not in the suggested statuses for Decision. Suggested: draft, proposed, approved, rejected'
        );
        expect(result.allowedValues).toEqual(['draft', 'proposed', 'approved', 'rejected']);
      });

      it('should indicate default will be used when status is undefined', () => {
        const validator = new StatusValidator(suggestConfig);

        const result = validator.validateStatus(undefined, 'Decision');

        expect(result.valid).toBe(true);
        expect(result.mode).toBe('suggest');
        expect(result.message).toBe('No status provided. Default "draft" will be used.');
      });
    });

    describe('shorthand array syntax', () => {
      const shorthandConfig: SCEpterConfig = {
        ...baseConfig,
        noteTypes: {
          ...baseConfig.noteTypes,
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            allowedStatuses: ['pending', 'in-progress', 'completed'],
          },
        },
      };

      it('should default to suggest mode', () => {
        const validator = new StatusValidator(shorthandConfig);

        const result = validator.validateStatus('invalid', 'Task');

        expect(result.valid).toBe(true);
        expect(result.mode).toBe('suggest');
        expect(result.message).toContain('Warning');
      });

      it('should use first element as default', () => {
        const validator = new StatusValidator(shorthandConfig);

        const result = validator.validateStatus(undefined, 'Task');

        expect(result.message).toBe('No status provided. Default "pending" will be used.');
      });

      it('should validate against literal values', () => {
        const validator = new StatusValidator(shorthandConfig);

        expect(validator.validateStatus('pending', 'Task').valid).toBe(true);
        expect(validator.validateStatus('in-progress', 'Task').valid).toBe(true);
        expect(validator.validateStatus('completed', 'Task').valid).toBe(true);
      });
    });
  });

  describe('getDefaultStatus', () => {
    it('should return null when no allowedStatuses configured', () => {
      const validator = new StatusValidator(baseConfig);

      const result = validator.getDefaultStatus('Task');

      expect(result).toBeNull();
    });

    it('should return null for non-existent note type', () => {
      const validator = new StatusValidator(baseConfig);

      const result = validator.getDefaultStatus('NonExistent');

      expect(result).toBeNull();
    });

    it('should return first element for shorthand array syntax', () => {
      const config: SCEpterConfig = {
        ...baseConfig,
        noteTypes: {
          ...baseConfig.noteTypes,
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            allowedStatuses: ['draft', 'active', 'done'],
          },
        },
      };
      const validator = new StatusValidator(config);

      const result = validator.getDefaultStatus('Task');

      expect(result).toBe('draft');
    });

    it('should return null for empty shorthand array', () => {
      const config: SCEpterConfig = {
        ...baseConfig,
        noteTypes: {
          ...baseConfig.noteTypes,
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            allowedStatuses: [],
          },
        },
      };
      const validator = new StatusValidator(config);

      const result = validator.getDefaultStatus('Task');

      expect(result).toBeNull();
    });

    it('should return explicit defaultValue for object syntax', () => {
      const config: SCEpterConfig = {
        ...baseConfig,
        noteTypes: {
          ...baseConfig.noteTypes,
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            allowedStatuses: {
              values: ['pending', 'active', 'done'],
              mode: 'enforce',
              defaultValue: 'active', // Not the first value
            },
          },
        },
      };
      const validator = new StatusValidator(config);

      const result = validator.getDefaultStatus('Task');

      expect(result).toBe('active');
    });

    it('should return null when object syntax has no defaultValue', () => {
      const config: SCEpterConfig = {
        ...baseConfig,
        noteTypes: {
          ...baseConfig.noteTypes,
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            allowedStatuses: {
              values: ['pending', 'active', 'done'],
              mode: 'suggest',
              // No defaultValue
            },
          },
        },
      };
      const validator = new StatusValidator(config);

      const result = validator.getDefaultStatus('Task');

      expect(result).toBeNull();
    });
  });

  describe('hasAllowedStatuses', () => {
    it('should return false when no allowedStatuses configured', () => {
      const validator = new StatusValidator(baseConfig);

      expect(validator.hasAllowedStatuses('Task')).toBe(false);
    });

    it('should return false for non-existent note type', () => {
      const validator = new StatusValidator(baseConfig);

      expect(validator.hasAllowedStatuses('NonExistent')).toBe(false);
    });

    it('should return true for shorthand array syntax', () => {
      const config: SCEpterConfig = {
        ...baseConfig,
        noteTypes: {
          ...baseConfig.noteTypes,
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            allowedStatuses: ['pending', 'completed'],
          },
        },
      };
      const validator = new StatusValidator(config);

      expect(validator.hasAllowedStatuses('Task')).toBe(true);
    });

    it('should return true for object syntax', () => {
      const config: SCEpterConfig = {
        ...baseConfig,
        noteTypes: {
          ...baseConfig.noteTypes,
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            allowedStatuses: {
              values: ['pending'],
              mode: 'suggest',
            },
          },
        },
      };
      const validator = new StatusValidator(config);

      expect(validator.hasAllowedStatuses('Task')).toBe(true);
    });

    it('should return true even for empty array (edge case)', () => {
      const config: SCEpterConfig = {
        ...baseConfig,
        noteTypes: {
          ...baseConfig.noteTypes,
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            allowedStatuses: [],
          },
        },
      };
      const validator = new StatusValidator(config);

      // Empty array is still a configured value
      expect(validator.hasAllowedStatuses('Task')).toBe(true);
    });
  });

  describe('getMode', () => {
    it('should return "none" when no allowedStatuses configured', () => {
      const validator = new StatusValidator(baseConfig);

      expect(validator.getMode('Task')).toBe('none');
    });

    it('should return "none" for non-existent note type', () => {
      const validator = new StatusValidator(baseConfig);

      expect(validator.getMode('NonExistent')).toBe('none');
    });

    it('should return "suggest" for shorthand array syntax', () => {
      const config: SCEpterConfig = {
        ...baseConfig,
        noteTypes: {
          ...baseConfig.noteTypes,
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            allowedStatuses: ['pending', 'completed'],
          },
        },
      };
      const validator = new StatusValidator(config);

      expect(validator.getMode('Task')).toBe('suggest');
    });

    it('should return explicit mode for object syntax', () => {
      const suggestConfig: SCEpterConfig = {
        ...baseConfig,
        noteTypes: {
          ...baseConfig.noteTypes,
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            allowedStatuses: {
              values: ['pending'],
              mode: 'suggest',
            },
          },
        },
      };
      const enforceConfig: SCEpterConfig = {
        ...baseConfig,
        noteTypes: {
          ...baseConfig.noteTypes,
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            allowedStatuses: {
              values: ['pending'],
              mode: 'enforce',
              defaultValue: 'pending',
            },
          },
        },
      };

      expect(new StatusValidator(suggestConfig).getMode('Task')).toBe('suggest');
      expect(new StatusValidator(enforceConfig).getMode('Task')).toBe('enforce');
    });
  });

  describe('complex scenarios', () => {
    it('should handle multiple note types with different configurations', () => {
      const config: SCEpterConfig = {
        noteTypes: {
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            allowedStatuses: {
              values: ['pending', 'in-progress', 'completed'],
              mode: 'enforce',
              defaultValue: 'pending',
            },
          },
          Decision: {
            folder: 'decisions',
            shortcode: 'D',
            allowedStatuses: ['draft', 'proposed', 'approved'], // Shorthand
          },
          Question: {
            folder: 'questions',
            shortcode: 'Q',
            // No allowedStatuses
          },
        },
      };
      const validator = new StatusValidator(config);

      // Task: enforce mode
      const taskInvalid = validator.validateStatus('invalid', 'Task');
      expect(taskInvalid.valid).toBe(false);
      expect(taskInvalid.mode).toBe('enforce');

      // Decision: suggest mode (shorthand default)
      const decisionInvalid = validator.validateStatus('invalid', 'Decision');
      expect(decisionInvalid.valid).toBe(true);
      expect(decisionInvalid.mode).toBe('suggest');
      expect(decisionInvalid.message).toContain('Warning');

      // Question: no configuration
      const questionAny = validator.validateStatus('anything', 'Question');
      expect(questionAny.valid).toBe(true);
      expect(questionAny.mode).toBe('none');
    });

    it('should handle status sets shared across multiple note types', () => {
      const config: SCEpterConfig = {
        statusSets: {
          lifecycle: ['draft', 'active', 'archived'],
          approval: ['pending', 'approved', 'rejected'],
        },
        noteTypes: {
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            allowedStatuses: {
              sets: ['lifecycle'],
              mode: 'suggest',
            },
          },
          Decision: {
            folder: 'decisions',
            shortcode: 'D',
            allowedStatuses: {
              sets: ['lifecycle', 'approval'],
              mode: 'enforce',
              defaultValue: 'draft',
            },
          },
        },
      };
      const validator = new StatusValidator(config);

      // Task has only lifecycle statuses
      expect(validator.resolveAllowedStatuses('Task')).toEqual(['draft', 'active', 'archived']);

      // Decision has lifecycle + approval statuses
      expect(validator.resolveAllowedStatuses('Decision')).toEqual([
        'draft',
        'active',
        'archived',
        'pending',
        'approved',
        'rejected',
      ]);

      // 'approved' is valid for Decision but not in Task's list
      const taskApproved = validator.validateStatus('approved', 'Task');
      expect(taskApproved.valid).toBe(true); // suggest mode allows
      expect(taskApproved.message).toContain('Warning');

      const decisionApproved = validator.validateStatus('approved', 'Decision');
      expect(decisionApproved.valid).toBe(true);
      expect(decisionApproved.message).toBeUndefined();
    });

    it('should handle empty statusSets object', () => {
      const config: SCEpterConfig = {
        statusSets: {},
        noteTypes: {
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            allowedStatuses: {
              sets: ['nonexistent'],
              values: ['fallback'],
              mode: 'suggest',
            },
          },
        },
      };
      const validator = new StatusValidator(config);

      // Should only have the fallback value
      expect(validator.resolveAllowedStatuses('Task')).toEqual(['fallback']);
    });

    it('should handle case-sensitive status matching', () => {
      const config: SCEpterConfig = {
        ...baseConfig,
        noteTypes: {
          ...baseConfig.noteTypes,
          Task: {
            folder: 'tasks',
            shortcode: 'T',
            allowedStatuses: {
              values: ['Pending', 'IN-PROGRESS', 'completed'],
              mode: 'enforce',
              defaultValue: 'Pending',
            },
          },
        },
      };
      const validator = new StatusValidator(config);

      // Exact match should work
      expect(validator.validateStatus('Pending', 'Task').valid).toBe(true);
      expect(validator.validateStatus('IN-PROGRESS', 'Task').valid).toBe(true);
      expect(validator.validateStatus('completed', 'Task').valid).toBe(true);

      // Different case should fail
      expect(validator.validateStatus('pending', 'Task').valid).toBe(false);
      expect(validator.validateStatus('in-progress', 'Task').valid).toBe(false);
      expect(validator.validateStatus('COMPLETED', 'Task').valid).toBe(false);
    });
  });
});
