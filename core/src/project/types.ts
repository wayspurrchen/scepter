// Type management related interfaces

/**
 * @implements {T011} Phase 3 - Added allowedStatuses info
 */
export interface TypeInfo {
  type: string;
  shortcode: string;
  folder?: string;
  noteCount: number;
  hasTemplate: boolean;
  description?: string;
  emoji?: string;
  color?: string;
  /**
   * Allowed statuses configuration for this type
   * @implements {T011.3.3} Status info in type listing
   */
  allowedStatuses?: {
    mode: 'suggest' | 'enforce' | 'none';
    values: string[];
    defaultValue?: string;
  };
}

export interface RenameOptions {
  newShortcode?: string;
  newDescription?: string;
  dryRun?: boolean;
  skipConfirmation?: boolean;
  onProgress?: (progress: ProgressInfo) => void;
}

export interface RenameResult {
  executed: boolean;
  changes: {
    configUpdates: number;
    folderRenames: number;
    noteRenames: number;
    frontmatterUpdates: number;
    referenceUpdates: {
      fileCount: number;
      totalReferences: number;
    };
    templateRenames: number;
  };
  details?: {
    oldFolder?: string;
    newFolder?: string;
    noteFiles: Array<{
      oldPath: string;
      newPath: string;
    }>;
    referenceFiles: Array<{
      path: string;
      referenceCount: number;
      examples: string[];
    }>;
  };
}

export interface DeleteOptions {
  strategy?: 'block' | 'archive' | 'move-to-uncategorized';
  targetType?: string;
  dryRun?: boolean;
  skipConfirmation?: boolean;
}

export interface DeleteResult {
  executed: boolean;
  strategy: string;
  changes: {
    configUpdates: number;
    foldersRemoved: number;
    notesAffected: number;
    notesArchived?: number;
    notesMoved?: number;
    referencesMarked?: number;
  };
  details?: {
    affectedNotes: Array<{
      id: string;
      title: string;
      path: string;
      action: 'blocked' | 'archived' | 'moved';
      newPath?: string;
    }>;
  };
}

export interface ProgressInfo {
  phase: 'analyzing' | 'updating-config' | 'renaming-files' | 'updating-references' | 'backup' | 'updating' | 'complete' | 'error';
  current: number;
  total: number;
  currentFile?: string;
  message?: string;
}

export interface ReferenceLocation {
  filePath: string;
  line: number;
  column?: number;
  text: string;
  referenceText: string;
  noteId: string;
}

export interface ReferenceUpdate {
  filePath: string;
  originalContent: string;
  updatedContent: string;
  updateCount: number;
}

// Error classes
export class TypeExistsError extends Error {
  constructor(public typeName: string) {
    super(`Note type '${typeName}' already exists`);
    this.name = 'TypeExistsError';
  }
}

export class InvalidShortcodeError extends Error {
  constructor(public shortcode: string, public reason: string) {
    super(`Invalid shortcode '${shortcode}': ${reason}`);
    this.name = 'InvalidShortcodeError';
  }
}

export class TypeNotFoundError extends Error {
  constructor(public typeName: string) {
    super(`Note type '${typeName}' not found`);
    this.name = 'TypeNotFoundError';
  }
}

export class TypeHasNotesError extends Error {
  constructor(public typeName: string, public noteCount: number) {
    super(`Cannot delete type '${typeName}': ${noteCount} notes exist`);
    this.name = 'TypeHasNotesError';
  }
}

export class FileOperationError extends Error {
  constructor(public operation: string, public path: string, public cause: Error) {
    super(`Failed to ${operation} ${path}: ${cause.message}`);
    this.name = 'FileOperationError';
  }
}