/**
 * Supporting types for the storage protocol interfaces.
 *
 * @implements {A002.§3.AC.01} Storage types defined in storage-types.ts
 * @implements {DD010.§DC.01} Supporting types for storage interfaces
 */

/** Backend-agnostic change notification. */
export interface StorageEvent {
  type: 'created' | 'modified' | 'deleted' | 'moved';
  noteId: string;
  path?: string;
}

/** Metadata for a folder-note asset. */
export interface Attachment {
  name: string;
  size: number;
  mimeType?: string;
}

/** Attachment with its data content. */
export interface AttachmentContent {
  name: string;
  content: Buffer;
  mimeType?: string;
}

/** Cleanup handle for watch subscriptions. */
export type Unsubscribe = () => void;

/** Mirrors existing NoteFileManager delete semantics. */
export type DeleteMode = 'archive' | 'soft-delete' | 'permanent';

/** Backend-agnostic project statistics. */
export interface StorageStatistics {
  noteCount: number;
  typeBreakdown: Record<string, number>;
  lastModified?: Date;
  totalSize?: number;
}
