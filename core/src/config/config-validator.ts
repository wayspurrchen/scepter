/**
 * @implements {T003} - Validation for folder-based notes configuration fields
 * @implements {F003} - Validation for predefined status values feature
 */
import { z, ZodError } from 'zod';
import type {
  NoteTypeConfig,
  NotesConfig,
  ContextConfig,
  TaskConfig,
  PathsConfig,
  ProjectConfig,
  TemplateConfig,
  SourceCodeIntegrationConfig,
  StatusMapping,
  AllowedStatusesConfig,
  ClaimConfig,
  SCEpterConfig,
} from '../types/config';

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export class ConfigValidationError extends Error {
  constructor(public errors: ValidationError[]) {
    const errorCount = errors.length;
    const errorList = errors.map((e) => `  - ${e.field}: ${e.message}`).join('\n');

    super(`Configuration validation failed with ${errorCount} error${errorCount === 1 ? '' : 's'}:\n${errorList}`);
    this.name = 'ConfigValidationError';
  }
}

// Status Mapping Schema
export const StatusMappingSchema = z.object({
  emoji: z.string().min(1, 'Emoji is required'),
  color: z.string().min(1, 'Color is required'),
});

// Status Mappings Schema (for both global and note-type specific)
export const StatusMappingsRecordSchema = z.record(
  z.string(),
  z.union([StatusMappingSchema, z.string().min(1, 'Status alias cannot be empty')]),
);

/**
 * Schema for object-form allowed statuses configuration.
 * Validates structure but not cross-references to statusSets (done later).
 *
 * @implements {F003} Predefined Status Values Per Note Type
 */
export const AllowedStatusesConfigSchema = z.object({
  sets: z.array(z.string().min(1, 'Set name cannot be empty')).optional(),
  values: z.array(z.string().min(1, 'Status value cannot be empty')).optional(),
  mode: z.enum(['suggest', 'enforce'], {
    errorMap: () => ({ message: "Mode must be 'suggest' or 'enforce'" }),
  }).optional().default('suggest'),
  defaultValue: z.string().min(1, 'Default value cannot be empty').optional(),
}).refine(
  (data) => data.sets !== undefined || data.values !== undefined,
  { message: 'At least one of sets or values must be provided' }
).refine(
  (data) => data.mode !== 'enforce' || data.defaultValue !== undefined,
  { message: "defaultValue is required when mode is 'enforce'" }
);

/**
 * Schema for allowed statuses - either shorthand array or full object config.
 *
 * @implements {F003} Predefined Status Values Per Note Type
 */
export const AllowedStatusesSchema = z.union([
  z.array(z.string().min(1, 'Status value cannot be empty')).min(1, 'At least one status value is required'),
  AllowedStatusesConfigSchema,
]);

/**
 * Schema for statusSets at the config root level.
 * Keys must be valid identifiers, values must be non-empty string arrays.
 *
 * @implements {F003} Predefined Status Values Per Note Type
 */
export const StatusSetsSchema = z.record(
  z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Status set key must be a valid identifier'),
  z.array(z.string().min(1, 'Status value cannot be empty')).min(1, 'Status set must have at least one value'),
);

// Note Type Schema
export const NoteTypeConfigSchema = z.object({
  folder: z
    .string()
    .regex(/^[a-zA-Z0-9_\-\/]+$/, 'Folder name contains invalid characters')
    .refine((val) => !val.includes('//'), 'Folder path cannot contain double slashes')
    .optional(),
  shortcode: z
    .string()
    .min(1, 'Shortcode must be at least 1 character')
    .max(5, 'Shortcode must be at most 5 characters')
    .regex(/^[a-zA-Z0-9]+$/, 'Shortcode must contain only alphanumeric characters'),
  description: z.string().optional(),
  emoji: z.string().optional(),
  color: z.string().optional(),
  statusMappings: StatusMappingsRecordSchema.optional(),
  // Allowed statuses configuration - @implements {F003}
  allowedStatuses: AllowedStatusesSchema.optional(),
  // Folder-based note support fields
  supportsFolderFormat: z.boolean().optional(),
  folderTemplate: z.string().optional(),
  defaultFormat: z.enum(['file', 'folder']).optional(),
  allowedFileTypes: z.array(z.string()).optional(),
  maxFolderSize: z.number().positive().optional(),
});

// Notes Config Schema
export const NotesConfigSchema = z.object({
  autoCreate: z.boolean(),
  templatePath: z.string().optional(),
  fileNamePattern: z
    .string()
    .optional()
    .refine((val) => !val || val.includes('{ID}'), 'File name pattern must include {ID} placeholder'),
});

// Context Config Schema
export const ContextConfigSchema = z.object({
  defaultDepth: z.number().int('Default depth must be an integer').positive('Default depth must be positive'),
  followHints: z.boolean(),
  maxTokens: z
    .number()
    .int('Max tokens must be an integer')
    .positive('Max tokens must be positive')
    .max(1000000, 'Max tokens seems unreasonably large')
    .optional(),
  defaultVisibility: z.string().optional(),
});

// Task Config Schema
export const TaskConfigSchema = z.object({
  queuePersistence: z.boolean().optional(),
  maxConcurrent: z
    .number()
    .int('Max concurrent must be an integer')
    .positive('Max concurrent must be positive')
    .optional(),
  defaultTimeout: z.number().int('Timeout must be an integer').min(1000, 'Timeout must be at least 1000ms').optional(),
});

// Paths Config Schema
export const PathsConfigSchema = z.object({
  notesRoot: z
    .string()
    .regex(/^[a-zA-Z0-9_\-\.\/]+$/, 'Path contains invalid characters')
    .optional(),
  dataDir: z
    .string()
    .regex(/^[a-zA-Z0-9_\-\.\/]+$/, 'Path contains invalid characters')
    .optional(),
});

// Project Config Schema
export const ProjectConfigSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  version: z.string().optional(),
});

// Template Config Schema
export const TemplateConfigSchema = z.object({
  enabled: z.boolean().optional(),
  paths: z
    .object({
      types: z
        .string()
        .regex(/^[a-zA-Z0-9_\-\.\/]+$/, 'Path contains invalid characters')
        .optional(),
    })
    .optional(),
  defaultTemplate: z.string().optional(),
  globalVariables: z.record(z.any()).optional(),
});

// Source Code Integration Config Schema
export const SourceCodeIntegrationConfigSchema = z.object({
  enabled: z.boolean(),
  folders: z.array(z.string()),
  exclude: z.array(z.string()),
  extensions: z.array(z.string().regex(/^\.\w+$/, 'Extensions must start with a dot')),
  cacheSourceRefs: z.boolean().optional(),
  validateOnStartup: z.boolean().optional(),
});

// Helper to validate unique shortcodes
const validateUniqueShortcodes = (noteTypes: Record<string, NoteTypeConfig>) => {
  const shortcodes = new Set<string>();
  for (const [key, config] of Object.entries(noteTypes)) {
    const upperShortcode = config.shortcode.toUpperCase();
    if (shortcodes.has(upperShortcode)) {
      return false;
    }
    shortcodes.add(upperShortcode);
  }
  return true;
};

// Helper to validate unique folders (only checks items that have a folder defined)
const validateUniqueFolders = (items: Record<string, { folder?: string }>) => {
  const folders = new Set<string>();
  for (const [key, config] of Object.entries(items)) {
    if (!config.folder) continue;
    if (folders.has(config.folder)) {
      return false;
    }
    folders.add(config.folder);
  }
  return true;
};

// Helper to validate identifiers
const isValidIdentifier = (key: string) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(key);

// Main Config Schema (basic structure validation)
const SCEpterConfigBaseSchema = z.object({
  noteTypes: z
    .record(z.string().refine(isValidIdentifier, 'Note type key must be a valid identifier'), NoteTypeConfigSchema)
    .refine((obj) => Object.keys(obj).length > 0, 'At least one note type is required')
    .refine(validateUniqueShortcodes, 'All note type shortcodes must be unique (case-insensitive)')
    .refine(validateUniqueFolders, 'All note type folders must be unique'),

  notes: NotesConfigSchema.optional(),
  context: ContextConfigSchema.optional(),
  tasks: TaskConfigSchema.optional(),
  paths: PathsConfigSchema.optional(),
  project: ProjectConfigSchema.optional(),
  templates: TemplateConfigSchema.optional(),
  sourceCodeIntegration: SourceCodeIntegrationConfigSchema.optional(),
  statusMappings: StatusMappingsRecordSchema.optional(),
  folderNotesEnabled: z.boolean().optional(),
  // Discovery paths for note scanning
  discoveryPaths: z.array(z.string().min(1, 'Discovery path cannot be empty')).optional(),
  discoveryExclude: z.array(z.string().min(1, 'Exclude pattern cannot be empty')).optional(),
  // Timestamp precision for note metadata
  timestampPrecision: z.enum(['date', 'datetime']).optional().default('date'),
  // Status sets for reusable status value collections - @implements {F003}
  statusSets: StatusSetsSchema.optional(),
  // Claim-level addressability configuration
  // @implements {R004.§7.AC.03} Confidence config validation
  claims: z.object({
    bracelessMatching: z.boolean().optional().default(true),
    projectionTypes: z.array(z.string()).optional(),
    confidence: z.object({
      autoInsert: z.boolean().optional().default(true),
    }).optional(),
  }).optional(),
});

/**
 * Helper to resolve all allowed status values for a note type,
 * expanding referenced status sets.
 *
 * @implements {F003} Predefined Status Values Per Note Type
 */
function resolveAllowedStatusValues(
  allowedStatuses: string[] | AllowedStatusesConfig,
  statusSets: Record<string, string[]> | undefined,
): string[] {
  // Shorthand array syntax
  if (Array.isArray(allowedStatuses)) {
    return allowedStatuses;
  }

  // Object syntax - combine sets and values
  const values: string[] = [];

  // Add values from referenced sets
  if (allowedStatuses.sets) {
    for (const setName of allowedStatuses.sets) {
      const setValues = statusSets?.[setName];
      if (setValues) {
        values.push(...setValues);
      }
    }
  }

  // Add literal values
  if (allowedStatuses.values) {
    values.push(...allowedStatuses.values);
  }

  return values;
}

/**
 * Validates cross-references between allowedStatuses and statusSets.
 * - Ensures all referenced sets in allowedStatuses.sets exist in statusSets
 * - Ensures defaultValue is in the resolved allowed values
 *
 * @implements {F003} Predefined Status Values Per Note Type
 */
function validateStatusSetsReferences(config: z.infer<typeof SCEpterConfigBaseSchema>): ValidationError[] {
  const errors: ValidationError[] = [];
  const statusSets = config.statusSets;

  for (const [noteTypeName, noteTypeConfig] of Object.entries(config.noteTypes)) {
    const allowedStatuses = noteTypeConfig.allowedStatuses;

    if (!allowedStatuses) continue;

    // Skip validation for shorthand array syntax (no set references)
    if (Array.isArray(allowedStatuses)) continue;

    const objConfig = allowedStatuses as AllowedStatusesConfig;

    // Validate that referenced sets exist
    if (objConfig.sets) {
      for (const setName of objConfig.sets) {
        if (!statusSets || !statusSets[setName]) {
          errors.push({
            field: `noteTypes.${noteTypeName}.allowedStatuses.sets`,
            message: `Referenced status set '${setName}' does not exist in statusSets`,
            severity: 'error',
          });
        }
      }
    }

    // Validate that defaultValue is in the resolved allowed values
    if (objConfig.defaultValue) {
      const resolvedValues = resolveAllowedStatusValues(allowedStatuses, statusSets);
      if (!resolvedValues.includes(objConfig.defaultValue)) {
        errors.push({
          field: `noteTypes.${noteTypeName}.allowedStatuses.defaultValue`,
          message: `Default value '${objConfig.defaultValue}' is not in the allowed status values: [${resolvedValues.join(', ')}]`,
          severity: 'error',
        });
      }
    }
  }

  return errors;
}

// Main Config Schema with cross-reference validation
export const SCEpterConfigSchema = SCEpterConfigBaseSchema;

export class ConfigValidator {
  validate(config: unknown): ValidationError[] {
    const errors: ValidationError[] = [];

    // Phase 1: Zod schema validation (structure)
    try {
      SCEpterConfigSchema.parse(config);
    } catch (error) {
      if (error instanceof ZodError) {
        errors.push(...this.formatZodErrors(error));
      } else {
        throw error;
      }
    }

    // If basic structure validation failed, don't run cross-reference checks
    if (errors.length > 0) {
      return errors;
    }

    // Phase 2: Cross-reference validation (statusSets references, defaultValue checks)
    // At this point we know config is valid per the base schema
    const typedConfig = config as z.infer<typeof SCEpterConfigBaseSchema>;
    errors.push(...validateStatusSetsReferences(typedConfig));

    return errors;
  }

  validateOrThrow(config: unknown): void {
    const errors = this.validate(config);
    if (errors.length > 0) {
      throw new ConfigValidationError(errors);
    }
  }

  private formatZodErrors(error: ZodError): ValidationError[] {
    return error.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
      severity: 'error' as const,
    }));
  }
}
