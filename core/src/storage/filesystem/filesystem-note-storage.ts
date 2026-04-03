/**
 * Filesystem adapter for note CRUD, bulk loading, and attachment operations.
 *
 * Delegates to NoteFileManager, UnifiedDiscovery, and supporting parsers.
 * The getFilePath() method is filesystem-specific and NOT on the NoteStorage interface.
 *
 * @implements {A002.§3.AC.02} FilesystemNoteStorage implements NoteStorage
 * @implements {DD010.§DC.09} FilesystemNoteStorage delegates to NoteFileManager + UnifiedDiscovery
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import matter from 'gray-matter';
import type { NoteStorage } from '../storage-backend';
import type { Note, NoteQuery, NoteQueryResult } from '../../types/note';
import type { Reference } from '../../types/reference';
import type {
  StorageEvent,
  Attachment,
  DeleteMode,
  StorageStatistics,
  Unsubscribe,
} from '../storage-types';
import type { NoteFileManager } from '../../notes/note-file-manager';
import type { UnifiedDiscovery } from '../../discovery/unified-discovery';
import type { ConfigManager } from '../../config/config-manager';
import type { NoteTypeResolver } from '../../notes/note-type-resolver';
import { parseNoteMentions } from '../../parsers/note/note-parser';
import { scanFolderContents, getFolderFileMetadata } from '../../notes/folder-utils';

export class FilesystemNoteStorage implements NoteStorage {
  constructor(
    private noteFileManager: NoteFileManager,
    private unifiedDiscovery: UnifiedDiscovery,
    private configManager: ConfigManager,
    private noteTypeResolver: NoteTypeResolver,
  ) {}

  /**
   * Filesystem-specific: get the file path for a note.
   * NOT on the NoteStorage interface — this is a concrete-type concern.
   */
  getFilePath(noteId: string): string | undefined {
    return this.noteFileManager.getFilePath(noteId);
  }

  async getNote(id: string): Promise<Note | null> {
    const filePath = await this.noteFileManager.findNoteFile(id);
    if (!filePath) return null;

    const content = await this.noteFileManager.readFileByPath(filePath);
    if (!content) return null;

    const { data: frontmatter, content: body } = matter(content);
    const noteType = this.noteTypeResolver.getTypeFromNoteId(id);
    if (!noteType) return null;

    const filename = path.basename(filePath);
    const titleMatch = filename.match(/^[A-Z]+\d+\s+(.+)\.md$/);
    const title = frontmatter.title || (titleMatch ? titleMatch[1] : filename.replace('.md', ''));

    let tags: string[] = [];
    if (frontmatter.tags) {
      if (Array.isArray(frontmatter.tags)) {
        tags = frontmatter.tags;
      } else if (typeof frontmatter.tags === 'string') {
        tags = frontmatter.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
      }
    }

    return {
      id,
      type: noteType,
      title,
      content: body,
      tags,
      created: frontmatter.created ? new Date(frontmatter.created) : new Date(),
      modified: frontmatter.modified ? new Date(frontmatter.modified) : undefined,
      filePath,
      metadata: { ...frontmatter },
    };
  }

  async createNote(note: Note): Promise<void> {
    await this.noteFileManager.createNoteFile(note);
  }

  async updateNote(note: Note): Promise<void> {
    await this.noteFileManager.updateNoteFile(note);
  }

  async deleteNote(id: string, mode: DeleteMode): Promise<void> {
    switch (mode) {
      case 'archive':
        await this.noteFileManager.archiveNoteFile(id);
        break;
      case 'soft-delete':
        await this.noteFileManager.deleteNoteFile(id);
        break;
      case 'permanent':
        await this.noteFileManager.purgeNoteFile(id);
        break;
    }
  }

  async restoreNote(id: string): Promise<void> {
    await this.noteFileManager.restoreNoteFile(id);
  }

  async getNotes(query: NoteQuery): Promise<NoteQueryResult> {
    // Filesystem adapter: load all then filter in memory
    const allNotes = await this.getAllNotes();
    let filtered = allNotes;

    if (query.ids) {
      const ids = new Set(query.ids);
      filtered = filtered.filter(n => ids.has(n.id));
    }
    if (query.types) {
      const types = new Set(query.types);
      filtered = filtered.filter(n => types.has(n.type));
    }
    if (query.tags) {
      filtered = filtered.filter(n => query.tags!.some(t => n.tags.includes(t)));
    }
    if (query.search) {
      const term = query.search.toLowerCase();
      filtered = filtered.filter(n =>
        n.title.toLowerCase().includes(term) ||
        n.content.toLowerCase().includes(term)
      );
    }
    if (query.statuses) {
      const statuses = new Set(query.statuses);
      filtered = filtered.filter(n => n.metadata?.status && statuses.has(n.metadata.status));
    }

    const totalCount = filtered.length;

    if (query.sortBy) {
      filtered.sort((a, b) => {
        let cmp = 0;
        switch (query.sortBy) {
          case 'created': cmp = a.created.getTime() - b.created.getTime(); break;
          case 'title': cmp = a.title.localeCompare(b.title); break;
          case 'type': cmp = a.type.localeCompare(b.type); break;
          case 'id': cmp = a.id.localeCompare(b.id); break;
          default: cmp = 0;
        }
        return query.sortOrder === 'desc' ? -cmp : cmp;
      });
    }

    if (query.offset) {
      filtered = filtered.slice(query.offset);
    }
    if (query.limit) {
      filtered = filtered.slice(0, query.limit);
    }

    return {
      notes: filtered,
      totalCount,
      hasMore: query.limit ? totalCount > (query.offset || 0) + query.limit : false,
    };
  }

  async getAllNotes(): Promise<Note[]> {
    return this.unifiedDiscovery.discoverAll();
  }

  async getAllReferences(): Promise<Reference[]> {
    const allNotes = await this.getAllNotes();
    const refs: Reference[] = [];

    for (const note of allNotes) {
      const mentions = parseNoteMentions(note.content);
      for (const mention of mentions) {
        if (mention.id && mention.id !== note.id) {
          refs.push({
            fromId: note.id,
            toId: mention.id,
            sourceType: 'note',
          });
        }
      }
    }

    return refs;
  }

  async renameNotesOfType(
    oldType: string,
    newType: string,
    newShortcode: string,
  ): Promise<void> {
    const allNotes = await this.getAllNotes();
    const notesOfType = allNotes.filter(n => n.type === oldType);

    for (const note of notesOfType) {
      const oldId = note.id;
      // Derive new ID: replace old shortcode prefix with new one
      const oldShortcode = oldId.replace(/\d+$/, '');
      const numericPart = oldId.slice(oldShortcode.length);
      const newId = `${newShortcode}${numericPart}`;

      const updatedNote: Note = {
        ...note,
        id: newId,
        type: newType,
      };

      // Create new file and remove old
      await this.noteFileManager.createNoteFile(updatedNote);
      const oldPath = this.noteFileManager.getFilePath(oldId);
      if (oldPath) {
        await this.noteFileManager.removeFile(oldPath);
      }
    }
  }

  async archiveNotesOfType(type: string): Promise<void> {
    const allNotes = await this.getAllNotes();
    const notesOfType = allNotes.filter(n => n.type === type);

    for (const note of notesOfType) {
      await this.noteFileManager.archiveNoteFile(note.id);
    }
  }

  async getStatistics(): Promise<StorageStatistics> {
    const allNotes = await this.getAllNotes();
    const typeBreakdown: Record<string, number> = {};
    let lastModified: Date | undefined;

    for (const note of allNotes) {
      typeBreakdown[note.type] = (typeBreakdown[note.type] || 0) + 1;
      const noteDate = note.modified || note.created;
      if (!lastModified || noteDate > lastModified) {
        lastModified = noteDate;
      }
    }

    return {
      noteCount: allNotes.length,
      typeBreakdown,
      lastModified,
    };
  }

  async getAttachments(noteId: string): Promise<Attachment[]> {
    const note = await this.getNote(noteId);
    if (!note?.folderPath) return [];

    const fileMetadata = await getFolderFileMetadata(note.folderPath);
    return fileMetadata.map(f => ({
      name: f.path,
      size: f.size,
      mimeType: this.inferMimeType(f.path),
    }));
  }

  async getAttachmentContent(noteId: string, name: string): Promise<Buffer> {
    const note = await this.getNote(noteId);
    if (!note?.folderPath) {
      throw new Error(`Note ${noteId} is not a folder-based note`);
    }

    return fs.readFile(path.join(note.folderPath, name));
  }

  async putAttachment(noteId: string, name: string, content: Buffer): Promise<void> {
    const note = await this.getNote(noteId);
    if (!note?.folderPath) {
      throw new Error(`Note ${noteId} is not a folder-based note`);
    }

    await fs.writeFile(path.join(note.folderPath, name), content);
  }

  watch(callback: (event: StorageEvent) => void): Unsubscribe {
    const onCreated = (e: { noteId: string; filePath: string }) => {
      callback({ type: 'created', noteId: e.noteId, path: e.filePath });
    };
    const onModified = (e: { noteId: string; filePath: string }) => {
      callback({ type: 'modified', noteId: e.noteId, path: e.filePath });
    };
    const onDeleted = (e: { noteId: string; filePath?: string }) => {
      callback({ type: 'deleted', noteId: e.noteId, path: e.filePath });
    };

    this.noteFileManager.on('file:created', onCreated);
    this.noteFileManager.on('file:modified', onModified);
    this.noteFileManager.on('file:deleted', onDeleted);
    this.noteFileManager.on('file:archived', onDeleted);

    return () => {
      this.noteFileManager.off('file:created', onCreated);
      this.noteFileManager.off('file:modified', onModified);
      this.noteFileManager.off('file:deleted', onDeleted);
      this.noteFileManager.off('file:archived', onDeleted);
    };
  }

  private inferMimeType(filename: string): string | undefined {
    const ext = path.extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.md': 'text/markdown',
      '.json': 'application/json',
      '.yaml': 'text/yaml',
      '.yml': 'text/yaml',
      '.csv': 'text/csv',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
    };
    return mimeMap[ext];
  }
}
