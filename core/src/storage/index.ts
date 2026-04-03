/**
 * Storage protocol — barrel re-exports.
 *
 * @implements {DD010.§DC.08} Barrel file re-exports all interfaces and types from the storage module
 */

// Interfaces
export type {
  NoteStorage,
  ConfigStorage,
  TemplateStorage,
  VerificationStorage,
  IdCounterStorage,
} from './storage-backend';

// Types
export type {
  StorageEvent,
  Attachment,
  AttachmentContent,
  Unsubscribe,
  DeleteMode,
  StorageStatistics,
} from './storage-types';
