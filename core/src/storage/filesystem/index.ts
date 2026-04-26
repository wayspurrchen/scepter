/**
 * Filesystem storage adapters — barrel re-exports.
 *
 * @implements {DD010.§DC.14} Barrel file re-exports all filesystem adapter classes
 */

export { FilesystemNoteStorage } from './filesystem-note-storage';
export { FilesystemConfigStorage } from './filesystem-config-storage';
export { FilesystemTemplateStorage } from './filesystem-template-storage';
export { FilesystemMetadataStorage } from './filesystem-metadata-storage';
export { FilesystemIdCounterStorage } from './filesystem-id-counter-storage';
export { createFilesystemProject, bootstrapFilesystemDirs, findProjectRoot } from './create-filesystem-project';
export {
  validateStructure,
  getValidationReport,
  getCleanupSuggestions,
  countFilesInDirectory,
  getLastModifiedInDirectory,
  getDirectorySize,
} from './filesystem-project-utils';
export type {
  ValidationError as FilesystemValidationError,
  ValidationReport as FilesystemValidationReport,
  CleanupSuggestion as FilesystemCleanupSuggestion,
} from './filesystem-project-utils';
