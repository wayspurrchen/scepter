export interface StatusMapping {
  emoji: string;
  color: string;
}

/**
 * Configuration for allowed statuses on a note type.
 * Supports referencing reusable status sets and/or literal values.
 *
 * @implements {F003} Predefined Status Values Per Note Type
 */
export interface AllowedStatusesConfig {
  /**
   * References to keys in the top-level `statusSets` configuration.
   * The values from all referenced sets are combined with `values`.
   */
  sets?: string[];

  /**
   * Literal status values allowed for this note type.
   * Combined with values from referenced `sets`.
   */
  values?: string[];

  /**
   * Validation mode:
   * - 'suggest': Warn on invalid status but allow creation
   * - 'enforce': Block creation if status is invalid
   */
  mode: 'suggest' | 'enforce';

  /**
   * Default status to apply when creating a note without specifying one.
   * Required when mode is 'enforce'.
   */
  defaultValue?: string;
}

export interface NoteTypeConfig {
  folder?: string;
  shortcode: string;
  description?: string;
  emoji?: string;
  color?: string;
  statusMappings?: Record<string, StatusMapping | string>;

  /**
   * Predefined status values for this note type.
   *
   * Shorthand array syntax: `["pending", "in-progress", "completed"]`
   * - Defaults to mode: "suggest" and defaultValue: first element
   *
   * Object syntax for full control:
   * ```json
   * {
   *   "sets": ["workflow"],
   *   "values": ["on-hold"],
   *   "mode": "enforce",
   *   "defaultValue": "pending"
   * }
   * ```
   *
   * @implements {F003} Predefined Status Values Per Note Type
   */
  allowedStatuses?: string[] | AllowedStatusesConfig;

  // NEW: Folder-based note support fields
  // @implements {E002} - Exploration for folder-based notes configuration
  // @implements {T003} - Implementation of folder-based notes configuration
  supportsFolderFormat?: boolean;     // Opt-out of folder format for this type (defaults to true if global enabled)
  folderTemplate?: string;             // Template name for folder structure
  defaultFormat?: 'file' | 'folder';  // Default format when creating
  allowedFileTypes?: string[];        // Allowed file extensions in folder
  maxFolderSize?: number;             // Max size in MB for folder contents
}

export interface NotesConfig {
  autoCreate: boolean;
  templatePath?: string;
  fileNamePattern?: string;
}

export interface ContextConfig {
  defaultDepth: number;
  followHints: boolean;
  maxTokens?: number;
  defaultVisibility?: string;
}

export interface TaskConfig {
  queuePersistence?: boolean;
  maxConcurrent?: number;
  defaultTimeout?: number;
}

export interface PathsConfig {
  notesRoot?: string;
  dataDir?: string;
}

export interface ProjectConfig {
  name?: string;
  description?: string;
  version?: string;
}

export interface TemplateConfig {
  enabled?: boolean;
  paths?: {
    types?: string;
  };
  defaultTemplate?: string;
  globalVariables?: Record<string, any>;
}

export interface SourceCodeIntegrationConfig {
  enabled: boolean;
  folders: string[];
  exclude: string[];
  extensions: string[];
  cacheSourceRefs?: boolean;
  validateOnStartup?: boolean;
}

/**
 * Object form of a project alias target. The `path` field is required;
 * additional fields (description, future extensions) are optional. The
 * shorthand string form (`"alias": "../peer"`) is equivalent to
 * `{ path: "../peer" }`.
 *
 * @implements {R011.§1.AC.01} projectAliases target shape
 * @implements {R011.§1.AC.02} object form leaves room for future fields
 */
export interface ProjectAliasTarget {
  /** Filesystem path to a peer SCEpter project root. Resolved relative to the
   * config file's directory; supports absolute paths and `~` expansion. */
  path: string;
  /** Optional human-readable description of the peer project. */
  description?: string;
}

/**
 * Discriminated value form for a single alias entry. The string form is
 * shorthand for `{ path: <string> }`; the object form permits extension.
 *
 * @implements {R011.§1.AC.02} string-or-object alias value
 */
export type ProjectAliasValue = string | ProjectAliasTarget;

export interface SCEpterConfig {
  noteTypes: Record<string, NoteTypeConfig>;
  notes?: NotesConfig;
  context?: ContextConfig;
  tasks?: TaskConfig;
  paths?: PathsConfig;
  project?: ProjectConfig;
  templates?: TemplateConfig;
  sourceCodeIntegration?: SourceCodeIntegrationConfig;
  statusMappings?: Record<string, StatusMapping | string>;
  folderNotesEnabled?: boolean; // Global enable/disable for folder-based notes (defaults to true)

  /**
   * Map from alias name to peer SCEpter project. Aliases declared here
   * may be used as a `<alias>/<reference>` prefix in note content and
   * code annotations to cite peer-project notes and claims for display.
   * Read-only citation only — peer claims do not enter the local index,
   * derivation graph, gap report, or trace matrix.
   *
   * @implements {R011.§1.AC.01} projectAliases configuration field
   * @implements {DD015.§1.DC.02} field name `projectAliases` (camelCase, matches existing convention)
   */
  projectAliases?: Record<string, ProjectAliasValue>;

  /**
   * Directories to scan for notes. Each entry is relative to the project root.
   * Defaults to ["_scepter"] for backward compatibility.
   * Use ["."] to scan the entire project, or specific directories like
   * ["product", "technical", "business"].
   */
  discoveryPaths?: string[];

  /**
   * Glob patterns to exclude from note discovery.
   * Defaults to sensible ignores (node_modules, .git, dist, etc.).
   * Merged with built-in excludes — user patterns are additive.
   */
  discoveryExclude?: string[];

  /**
   * Controls the precision of timestamps written to note metadata.
   * - 'date': YYYY-MM-DD (default)
   * - 'datetime': Full ISO 8601 (e.g. 2025-07-20T16:45:22.099Z)
   */
  timestampPrecision?: 'date' | 'datetime';

  /**
   * Reusable sets of status values that can be referenced by note types.
   *
   * Example:
   * ```json
   * {
   *   "statusSets": {
   *     "workflow": ["pending", "in-progress", "blocked", "completed"],
   *     "product": ["draft", "proposed", "approved", "rejected"]
   *   }
   * }
   * ```
   *
   * Note types can then reference these sets in their `allowedStatuses.sets` field.
   *
   * @implements {F003} Predefined Status Values Per Note Type
   */
  statusSets?: Record<string, string[]>;

  /**
   * Configuration for claim-level addressability.
   * Controls how sub-note claims are parsed and referenced.
   */
  claims?: ClaimConfig;
}

export interface ClaimConfig {
  /** Whether bare note IDs (without braces) are recognized as references. Default: true */
  bracelessMatching?: boolean;
  /**
   * Note types expected to appear as projection targets in gap analysis.
   * Only these types will be checked for coverage gaps.
   * If omitted, all note types are used (current default behavior).
   *
   * Example: ["Requirement", "DetailedDesign", "Source"]
   */
  projectionTypes?: string[];
  /**
   * Configuration for file-level confidence markers.
   * @implements {R004.§7.AC.03} Confidence auto-insert config
   */
  confidence?: {
    /** Whether to auto-insert confidence annotations on file creation. Default: true */
    autoInsert?: boolean;
  };
}

// Demo config
export const defaultConfig: SCEpterConfig = {
  noteTypes: {
    Requirement: {
      folder: 'requirements',
      shortcode: 'R',
      description: 'Functional and non-functional requirements for the project',
    },
    Decision: {
      folder: 'decisions',
      shortcode: 'D',
      description: 'Technical and architectural decisions with rationale',
    },
    Question: {
      folder: 'questions',
      shortcode: 'Q',
      description: 'Open questions that need resolution or investigation',
    },
    TODO: {
      folder: 'todos',
      shortcode: 'T',
      description: 'Action items and tasks to be completed',
    },
    Assumption: {
      folder: 'assumptions',
      shortcode: 'A',
      description: 'Working assumptions that may need validation',
    },
    Component: {
      folder: 'components',
      shortcode: 'C',
      description: 'System components and their specifications',
    },
    Milestone: {
      folder: 'milestones',
      shortcode: 'M',
      description: 'Project milestones and major deliverables',
    },
  },

  paths: {
    notesRoot: '_scepter',
    dataDir: '_scepter',
  },
};
