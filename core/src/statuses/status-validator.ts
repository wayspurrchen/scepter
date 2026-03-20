/**
 * Status Validator Module
 * =======================
 *
 * This module provides validation for note statuses based on configured
 * allowed values per note type. It works alongside StatusMappingResolver
 * (which handles display) to provide a complete status management solution.
 *
 * ## Core Concepts
 *
 * 1. **Allowed Statuses**: List of valid status values for a note type
 * 2. **Status Sets**: Reusable groups of statuses that can be referenced
 * 3. **Validation Modes**: 'suggest' (warn only) or 'enforce' (block invalid)
 * 4. **Default Values**: Fallback status when none is provided
 *
 * ## Configuration Syntax
 *
 * ### Shorthand Array Syntax
 * ```json
 * { "allowedStatuses": ["pending", "in-progress", "completed"] }
 * ```
 * - mode defaults to "suggest"
 * - defaultValue defaults to first element
 *
 * ### Full Object Syntax
 * ```json
 * {
 *   "allowedStatuses": {
 *     "sets": ["workflow"],
 *     "values": ["on-hold"],
 *     "mode": "enforce",
 *     "defaultValue": "pending"
 *   }
 * }
 * ```
 *
 * @implements {T011} Phase 2 - Status Validation Service
 * @implements {F003} Predefined Status Values Per Note Type
 */

import type { SCEpterConfig, AllowedStatusesConfig } from '../types/config';

/**
 * Result of validating a status value
 *
 * @implements {T011.2.1} StatusValidationResult interface
 */
export interface StatusValidationResult {
  /**
   * Whether the status is valid for the note type.
   * - For 'enforce' mode: false if status not in allowed list
   * - For 'suggest' mode: always true (but message may contain warning)
   * - For 'none' mode: always true (no validation configured)
   */
  valid: boolean;

  /**
   * The validation mode in effect for this note type.
   * - 'suggest': Warn on invalid but allow
   * - 'enforce': Block if invalid
   * - 'none': No allowedStatuses configured for this type
   */
  mode: 'suggest' | 'enforce' | 'none';

  /**
   * Error or warning message if status is not in allowed list.
   * Present when:
   * - Status is invalid in enforce mode (error)
   * - Status is invalid in suggest mode (warning)
   * - Status is undefined but default exists (info)
   */
  message?: string;

  /**
   * The list of allowed values for this type.
   * null if no allowedStatuses configured.
   */
  allowedValues?: string[];
}

/**
 * StatusValidator Class
 *
 * Validates note statuses against configured allowed values per note type.
 * Supports reusable status sets, shorthand syntax, and two validation modes.
 *
 * ## Usage
 *
 * ```typescript
 * const validator = new StatusValidator(config);
 *
 * // Check if a status is valid for a note type
 * const result = validator.validateStatus('pending', 'Task');
 * if (!result.valid) {
 *   console.error(result.message);
 * }
 *
 * // Get the default status for a note type
 * const defaultStatus = validator.getDefaultStatus('Task');
 *
 * // Get all allowed statuses for a note type
 * const allowed = validator.resolveAllowedStatuses('Task');
 * ```
 *
 * @implements {T011.2.1} StatusValidator class
 * @implements {F003} Predefined Status Values Per Note Type
 */
export class StatusValidator {
  private config: SCEpterConfig;

  constructor(config: SCEpterConfig) {
    this.config = config;
  }

  /**
   * Resolve allowed statuses for a note type by expanding sets and combining with values.
   *
   * @param noteType The note type to resolve allowed statuses for
   * @returns Array of allowed status values, or null if not configured
   *
   * @example
   * // With config:
   * // statusSets: { workflow: ["pending", "in-progress", "completed"] }
   * // Task.allowedStatuses: { sets: ["workflow"], values: ["on-hold"] }
   *
   * validator.resolveAllowedStatuses('Task');
   * // Returns: ["pending", "in-progress", "completed", "on-hold"]
   *
   * @implements {T011.2.1} resolveAllowedStatuses method
   */
  resolveAllowedStatuses(noteType: string): string[] | null {
    const noteTypeConfig = this.config.noteTypes?.[noteType];
    if (!noteTypeConfig?.allowedStatuses) {
      return null;
    }

    const allowedStatuses = noteTypeConfig.allowedStatuses;

    // Handle shorthand array syntax
    if (Array.isArray(allowedStatuses)) {
      return [...allowedStatuses];
    }

    // Handle full object syntax
    const result: string[] = [];

    // Expand referenced sets
    if (allowedStatuses.sets && this.config.statusSets) {
      for (const setName of allowedStatuses.sets) {
        const setValues = this.config.statusSets[setName];
        if (setValues) {
          result.push(...setValues);
        }
      }
    }

    // Add literal values
    if (allowedStatuses.values) {
      result.push(...allowedStatuses.values);
    }

    return result;
  }

  /**
   * Validate a status for a note type.
   *
   * @param status The status value to validate (can be undefined)
   * @param noteType The note type to validate against
   * @returns Validation result with validity, mode, message, and allowed values
   *
   * @example
   * // Enforce mode with invalid status
   * validator.validateStatus('invalid', 'Task');
   * // Returns: {
   * //   valid: false,
   * //   mode: 'enforce',
   * //   message: 'Status "invalid" is not allowed for Task. Allowed: pending, in-progress, completed',
   * //   allowedValues: ['pending', 'in-progress', 'completed']
   * // }
   *
   * // Suggest mode with invalid status
   * validator.validateStatus('invalid', 'Decision');
   * // Returns: {
   * //   valid: true,
   * //   mode: 'suggest',
   * //   message: 'Warning: Status "invalid" is not in the suggested statuses for Decision. Suggested: draft, proposed, approved',
   * //   allowedValues: ['draft', 'proposed', 'approved']
   * // }
   *
   * @implements {T011.2.1} validateStatus method
   */
  validateStatus(status: string | undefined, noteType: string): StatusValidationResult {
    const allowedValues = this.resolveAllowedStatuses(noteType);

    // No allowed statuses configured - no validation
    if (allowedValues === null) {
      return {
        valid: true,
        mode: 'none',
      };
    }

    const mode = this.getMode(noteType);
    const defaultStatus = this.getDefaultStatus(noteType);

    // Handle undefined/empty status
    if (status === undefined || status === '') {
      if (defaultStatus) {
        return {
          valid: true,
          mode,
          message: `No status provided. Default "${defaultStatus}" will be used.`,
          allowedValues,
        };
      }
      // No status and no default - valid in suggest mode, may need handling in enforce
      return {
        valid: true,
        mode,
        allowedValues,
      };
    }

    // Check if status is in allowed values
    const isAllowed = allowedValues.includes(status);

    if (isAllowed) {
      return {
        valid: true,
        mode,
        allowedValues,
      };
    }

    // Status not in allowed list
    const formattedAllowed = allowedValues.join(', ');

    if (mode === 'enforce') {
      return {
        valid: false,
        mode: 'enforce',
        message: `Status "${status}" is not allowed for ${noteType}. Allowed: ${formattedAllowed}`,
        allowedValues,
      };
    }

    // Suggest mode - valid but with warning
    return {
      valid: true,
      mode: 'suggest',
      message: `Warning: Status "${status}" is not in the suggested statuses for ${noteType}. Suggested: ${formattedAllowed}`,
      allowedValues,
    };
  }

  /**
   * Get the default status for a note type.
   *
   * For shorthand array syntax, the default is the first element.
   * For object syntax, it's the explicit defaultValue field.
   *
   * @param noteType The note type to get the default for
   * @returns The default status value, or null if not configured
   *
   * @example
   * // Shorthand: ["pending", "in-progress", "completed"]
   * validator.getDefaultStatus('Task'); // Returns: "pending"
   *
   * // Object: { sets: ["workflow"], defaultValue: "draft" }
   * validator.getDefaultStatus('Decision'); // Returns: "draft"
   *
   * @implements {T011.2.1} getDefaultStatus method
   */
  getDefaultStatus(noteType: string): string | null {
    const noteTypeConfig = this.config.noteTypes?.[noteType];
    if (!noteTypeConfig?.allowedStatuses) {
      return null;
    }

    const allowedStatuses = noteTypeConfig.allowedStatuses;

    // Shorthand array syntax - first element is default
    if (Array.isArray(allowedStatuses)) {
      return allowedStatuses.length > 0 ? allowedStatuses[0] : null;
    }

    // Object syntax - explicit defaultValue
    if (allowedStatuses.defaultValue) {
      return allowedStatuses.defaultValue;
    }

    return null;
  }

  /**
   * Check if a note type has allowed statuses configured.
   *
   * @param noteType The note type to check
   * @returns true if allowedStatuses is configured, false otherwise
   *
   * @implements {T011.2.1} hasAllowedStatuses method
   */
  hasAllowedStatuses(noteType: string): boolean {
    const noteTypeConfig = this.config.noteTypes?.[noteType];
    return noteTypeConfig?.allowedStatuses !== undefined;
  }

  /**
   * Get the validation mode for a note type.
   *
   * For shorthand array syntax, mode defaults to 'suggest'.
   * For object syntax, the explicit mode field is used.
   * If no allowedStatuses is configured, returns 'none'.
   *
   * @param noteType The note type to get the mode for
   * @returns 'suggest', 'enforce', or 'none'
   *
   * @implements {T011.2.1} getMode method
   */
  getMode(noteType: string): 'suggest' | 'enforce' | 'none' {
    const noteTypeConfig = this.config.noteTypes?.[noteType];
    if (!noteTypeConfig?.allowedStatuses) {
      return 'none';
    }

    const allowedStatuses = noteTypeConfig.allowedStatuses;

    // Shorthand array syntax - default to 'suggest'
    if (Array.isArray(allowedStatuses)) {
      return 'suggest';
    }

    // Object syntax - use explicit mode
    return allowedStatuses.mode;
  }
}
