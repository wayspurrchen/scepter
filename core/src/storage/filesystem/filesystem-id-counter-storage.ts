/**
 * Filesystem adapter for ID counter persistence.
 *
 * Derives counters from existing note IDs via NoteStorage.getAllNotes()
 * rather than persisting counters to disk. The save() method is a no-op
 * for the filesystem backend since counters are derived from filenames.
 *
 * @implements {A002.§3.AC.03} Filesystem adapter for IdCounterStorage
 * @implements {DD010.§DC.13} FilesystemIdCounterStorage derives counters from NoteStorage
 */

import type { IdCounterStorage } from '../storage-backend';
import type { NoteStorage } from '../storage-backend';

export class FilesystemIdCounterStorage implements IdCounterStorage {
  constructor(private noteStorage: NoteStorage) {}

  async load(): Promise<Record<string, number>> {
    const notes = await this.noteStorage.getAllNotes();
    const counters: Record<string, number> = {};

    for (const note of notes) {
      // Extract shortcode and numeric part from note ID (e.g., "R004" -> "R", 4)
      const match = note.id.match(/^([A-Z]+)(\d+)$/);
      if (match) {
        const shortcode = match[1];
        const num = parseInt(match[2], 10);
        if (!counters[shortcode] || num > counters[shortcode]) {
          counters[shortcode] = num;
        }
      }
    }

    return counters;
  }

  async save(_counters: Record<string, number>): Promise<void> {
    // No-op for filesystem — counters are derived from filenames
  }
}
