import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import { ConfigManager } from '../../config/config-manager';
import { NoteFileManager } from '../../notes/note-file-manager';
import { NoteTypeResolver } from '../../notes/note-type-resolver';
import { UnifiedDiscovery } from '../../discovery/unified-discovery';
import { FilesystemNoteStorage } from './filesystem-note-storage';
import { FilesystemIdCounterStorage } from './filesystem-id-counter-storage';

describe('FilesystemIdCounterStorage', () => {
  const testDir = path.join(process.cwd(), '.test-tmp', 'fs-id-counter-storage');

  beforeEach(async () => {
    await fs.remove(testDir);
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  async function createStorage(): Promise<FilesystemIdCounterStorage> {
    const configManager = new ConfigManager(testDir);
    await configManager.setConfig({
      noteTypes: {
        Decision: { shortcode: 'D', folder: 'decisions' },
        Requirement: { shortcode: 'R', folder: 'requirements' },
      },
      paths: { notesRoot: '_scepter/notes', dataDir: '_scepter' },
    });

    await fs.ensureDir(path.join(testDir, '_scepter', 'notes', 'decisions'));
    await fs.ensureDir(path.join(testDir, '_scepter', 'notes', 'requirements'));

    const noteFileManager = new NoteFileManager(testDir, configManager);
    const noteTypeResolver = new NoteTypeResolver(configManager);
    noteTypeResolver.initialize();
    const unifiedDiscovery = new UnifiedDiscovery(testDir, configManager);
    await unifiedDiscovery.initialize();

    const noteStorage = new FilesystemNoteStorage(
      noteFileManager, unifiedDiscovery, configManager, noteTypeResolver,
    );
    return new FilesystemIdCounterStorage(noteStorage);
  }

  it('should return empty counters for empty project', async () => {
    const storage = await createStorage();
    const counters = await storage.load();
    expect(counters).toEqual({});
  });

  it('should derive counters from existing notes', async () => {
    // Create directories first, then note files
    const decisionsDir = path.join(testDir, '_scepter', 'notes', 'decisions');
    const reqsDir = path.join(testDir, '_scepter', 'notes', 'requirements');
    await fs.ensureDir(decisionsDir);
    await fs.ensureDir(reqsDir);

    await fs.writeFile(
      path.join(decisionsDir, 'D003 Third.md'),
      '---\ncreated: 2026-04-01\ntags: []\n---\n\n# D003 - Third\n\n',
    );
    await fs.writeFile(
      path.join(decisionsDir, 'D001 First.md'),
      '---\ncreated: 2026-04-01\ntags: []\n---\n\n# D001 - First\n\n',
    );
    await fs.writeFile(
      path.join(reqsDir, 'R005 Req.md'),
      '---\ncreated: 2026-04-01\ntags: []\n---\n\n# R005 - Req\n\n',
    );

    const storage = await createStorage();
    const counters = await storage.load();

    expect(counters['D']).toBe(3);
    expect(counters['R']).toBe(5);
  });

  it('should be a no-op on save', async () => {
    const storage = await createStorage();
    // Should not throw
    await storage.save({ D: 100, R: 200 });
  });
});
