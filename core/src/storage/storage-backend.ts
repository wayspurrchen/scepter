/**
 * Storage protocol interfaces for backend-agnostic persistence.
 *
 * All methods use Promise-based async signatures per DC.07, even where the
 * filesystem adapter wraps synchronous operations. This is non-negotiable
 * for REST and database backends where every operation is inherently async.
 *
 * @implements {A002.§2.AC.06} All storage interface methods use Promise-based async signatures
 * @implements {DD010.§DC.07} All storage interface methods MUST use Promise-based async signatures
 */

import type { Note, NoteQuery, NoteQueryResult } from '../types/note';
import type { Reference } from '../types/reference';
import type { SCEpterConfig } from '../types/config';
import type {
  MetadataEvent,
  MetadataStore,
  EventFilter,
} from '../claims/metadata-event';
import type {
  StorageEvent,
  Attachment,
  DeleteMode,
  StorageStatistics,
  Unsubscribe,
} from './storage-types';

/**
 * Note CRUD, bulk loading, and attachment operations.
 *
 * @implements {A002.§2.AC.01} NoteStorage interface for note CRUD
 * @implements {DD010.§DC.02} NoteStorage interface definition
 */
export interface NoteStorage {
  // Single-note CRUD
  getNote(id: string): Promise<Note | null>;
  createNote(note: Note): Promise<void>;
  updateNote(note: Note): Promise<void>;
  deleteNote(id: string, mode: DeleteMode): Promise<void>;
  restoreNote(id: string): Promise<void>;

  // Query
  getNotes(query: NoteQuery): Promise<NoteQueryResult>;

  // Bulk operations for initialization
  getAllNotes(): Promise<Note[]>;
  getAllReferences(): Promise<Reference[]>;

  // Type management (admin operations)
  renameNotesOfType(oldType: string, newType: string, newShortcode: string): Promise<void>;
  archiveNotesOfType(type: string): Promise<void>;
  getStatistics(): Promise<StorageStatistics>;

  // Attachments (folder-based notes)
  getAttachments(noteId: string): Promise<Attachment[]>;
  getAttachmentContent(noteId: string, name: string): Promise<Buffer>;
  putAttachment(noteId: string, name: string, content: Buffer): Promise<void>;

  // Change notification (optional)
  watch?(callback: (event: StorageEvent) => void): Unsubscribe;
}

/**
 * Configuration loading and saving.
 *
 * @implements {A002.§2.AC.02} ConfigStorage interface for configuration persistence
 * @implements {DD010.§DC.03} ConfigStorage interface definition
 */
export interface ConfigStorage {
  load(): Promise<SCEpterConfig | null>;
  save(config: SCEpterConfig): Promise<void>;
}

/**
 * Template retrieval.
 *
 * @implements {A002.§2.AC.03} TemplateStorage interface for template persistence
 * @implements {DD010.§DC.04} TemplateStorage interface definition
 */
export interface TemplateStorage {
  getTemplate(noteType: string): Promise<string | null>;
  listTemplates(): Promise<string[]>;
}

/**
 * Generalized claim metadata persistence (replaces VerificationStorage).
 *
 * Six methods, exact surface area: load (read whole store), save (write whole
 * store), append (single event), query (filter the log), fold (project to
 * key→values for one claim), watch (optional change notification).
 *
 * Replaces VerificationStorage per A004.§2.AC.03; the two MUST NOT coexist
 * in the shipped state (DD014 §9 sequences a transient overlap during
 * consumer migration only).
 *
 * @implements {A004.§2.AC.02} MetadataStorage interface (six methods)
 * @implements {A004.§2.AC.03} Replaces VerificationStorage; no parallel coexistence
 * @implements {A004.§2.AC.06} All methods Promise-based async signatures
 * @implements {DD014.§3.DC.10} VerificationStorage removed; MetadataStorage is the sole interface
 * @implements {DD014.§3.DC.11} Six methods exactly
 * @implements {DD014.§3.DC.12} Imports MetadataEvent, MetadataStore, EventFilter
 */
export interface MetadataStorage {
  load(): Promise<MetadataStore>;
  save(store: MetadataStore): Promise<void>;
  append(event: MetadataEvent): Promise<void>;
  query(filter: EventFilter): Promise<MetadataEvent[]>;
  fold(claimId: string): Promise<Record<string, string[]>>;
  watch?(callback: (event: StorageEvent) => void): Unsubscribe;
}

/**
 * Formalization of the existing IdGeneratorStorage pattern.
 *
 * This is a rename of the existing `IdGeneratorStorage` in `note-id-generator.ts`
 * for naming consistency. The old name is kept as a type alias for backwards
 * compatibility in note-id-generator.ts.
 *
 * @implements {A002.§2.AC.05} IdCounterStorage interface for ID counter persistence
 * @implements {DD010.§DC.06} IdCounterStorage formalizes existing IdGeneratorStorage pattern
 */
export interface IdCounterStorage {
  load(): Promise<Record<string, number>>;
  save(counters: Record<string, number>): Promise<void>;
}
