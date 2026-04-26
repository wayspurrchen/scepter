import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import { createFilesystemProject, bootstrapFilesystemDirs, findProjectRoot } from './create-filesystem-project';
import type { SCEpterConfig } from '../../types/config';

const MINIMAL_CONFIG: SCEpterConfig = {
  noteTypes: {
    Decision: { shortcode: 'D', folder: 'decisions' },
    Requirement: { shortcode: 'R', folder: 'requirements' },
  },
  paths: {
    notesRoot: '_scepter/notes',
    dataDir: '_scepter',
  },
};

describe('createFilesystemProject', () => {
  const testDir = path.join(process.cwd(), '.test-tmp', 'fs-project-factory');

  beforeEach(async () => {
    await fs.remove(testDir);
    await fs.ensureDir(testDir);
    // Write config so factory can find it
    const configDir = path.join(testDir, '_scepter');
    await fs.ensureDir(configDir);
    await fs.writeJson(path.join(configDir, 'scepter.config.json'), MINIMAL_CONFIG, { spaces: 2 });
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  // @validates {DD014.§3.DC.45} ProjectManager exposes metadataStorage (verificationStorage removed)
  // @validates {DD014.§3.DC.47} Factory constructs FilesystemMetadataStorage
  it('should produce a ProjectManager with all storage interfaces wired', async () => {
    const pm = await createFilesystemProject(testDir);

    expect(pm).toBeDefined();
    expect(pm.noteStorage).toBeDefined();
    expect(pm.configStorage).toBeDefined();
    expect(pm.templateStorage).toBeDefined();
    expect(pm.metadataStorage).toBeDefined();
    expect(pm.idCounterStorage).toBeDefined();
  });

  it('should produce a ProjectManager with standard subsystems', async () => {
    const pm = await createFilesystemProject(testDir);

    expect(pm.configManager).toBeDefined();
    expect(pm.noteManager).toBeDefined();
    expect(pm.noteFileManager).toBeDefined();
    expect(pm.noteTypeResolver).toBeDefined();
    expect(pm.referenceManager).toBeDefined();
    expect(pm.contextGatherer).toBeDefined();
  });

  it('should load config via the storage interface', async () => {
    const pm = await createFilesystemProject(testDir);
    const config = pm.configManager.getConfig();

    expect(config.noteTypes.Decision.shortcode).toBe('D');
    expect(config.noteTypes.Requirement.shortcode).toBe('R');
  });

  it('should produce a working ProjectManager after initialize()', async () => {
    const pm = await createFilesystemProject(testDir);
    await pm.initialize();

    // Should be able to generate note IDs
    const id = await pm.noteManager.generateNoteId('Decision');
    expect(id).toMatch(/^D\d{3,5}$/);
  });

  // @validates {DD014.§3.DC.47} metadataStorage round-trips through the factory
  it('should wire metadataStorage that can append/query', async () => {
    const pm = await createFilesystemProject(testDir);

    const initial = await pm.metadataStorage!.load();
    expect(initial).toEqual({});

    await pm.metadataStorage!.append({
      id: 'evt-test-1',
      claimId: 'TEST.01',
      key: 'verified',
      value: 'true',
      op: 'add',
      actor: 'test',
      date: '2026-04-02T00:00:00.000Z',
    });

    const events = await pm.metadataStorage!.query({ claimId: 'TEST.01', key: 'verified' });
    expect(events).toHaveLength(1);
    expect(events[0].value).toBe('true');
  });

  it('should throw when no config file exists', async () => {
    const emptyDir = path.join(process.cwd(), '.test-tmp', 'fs-project-factory-empty');
    await fs.remove(emptyDir);
    await fs.ensureDir(emptyDir);

    try {
      await expect(createFilesystemProject(emptyDir)).rejects.toThrow(/[Nn]o configuration/);
    } finally {
      await fs.remove(emptyDir);
    }
  });
});

describe('bootstrapFilesystemDirs', () => {
  const testDir = path.join(process.cwd(), '.test-tmp', 'fs-bootstrap');

  beforeEach(async () => {
    await fs.remove(testDir);
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  it('should create _scepter and note type directories', async () => {
    await bootstrapFilesystemDirs(testDir, MINIMAL_CONFIG);

    expect(await fs.pathExists(path.join(testDir, '_scepter'))).toBe(true);
    expect(await fs.pathExists(path.join(testDir, '_scepter', 'notes'))).toBe(true);
    expect(await fs.pathExists(path.join(testDir, '_scepter', 'notes', 'decisions'))).toBe(true);
    expect(await fs.pathExists(path.join(testDir, '_scepter', 'notes', 'requirements'))).toBe(true);
  });

  it('should create .gitkeep in empty type directories', async () => {
    await bootstrapFilesystemDirs(testDir, MINIMAL_CONFIG);

    expect(await fs.pathExists(
      path.join(testDir, '_scepter', 'notes', 'decisions', '.gitkeep')
    )).toBe(true);
  });

  it('should be idempotent', async () => {
    await bootstrapFilesystemDirs(testDir, MINIMAL_CONFIG);
    await bootstrapFilesystemDirs(testDir, MINIMAL_CONFIG);

    expect(await fs.pathExists(path.join(testDir, '_scepter', 'notes', 'decisions'))).toBe(true);
  });
});

describe('findProjectRoot', () => {
  const testDir = path.join(process.cwd(), '.test-tmp', 'fs-find-root');

  beforeEach(async () => {
    await fs.remove(testDir);
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  it('should find root when _scepter/scepter.config.json exists', async () => {
    const configDir = path.join(testDir, '_scepter');
    await fs.ensureDir(configDir);
    await fs.writeJson(path.join(configDir, 'scepter.config.json'), {});

    const subDir = path.join(testDir, 'deep', 'nested');
    await fs.ensureDir(subDir);

    const root = await findProjectRoot(subDir);
    expect(root).toBe(testDir);
  });

  it('should return null when no project root found', async () => {
    // Use /tmp to avoid walking up into the actual scepter project
    const isolatedDir = path.join('/tmp', '.test-scepter-find-root-null');
    await fs.ensureDir(isolatedDir);
    try {
      const root = await findProjectRoot(isolatedDir);
      expect(root).toBeNull();
    } finally {
      await fs.remove(isolatedDir);
    }
  });
});
