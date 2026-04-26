/**
 * Factory function for creating filesystem-backed ProjectManager instances.
 *
 * This is the single point where the filesystem backend choice is made.
 * Switching to a different backend (e.g., SQLite) would mean calling a
 * different factory function.
 *
 * @implements {A002.§3.AC.04} Factory function for filesystem-specific wiring
 * @implements {DD010.§DC.15} createFilesystemProject() constructs filesystem wiring
 * @implements {DD010.§DC.16} bootstrapFilesystemDirs() extracts directory creation
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ConfigManager } from '../../config/config-manager';
import { NoteFileManager } from '../../notes/note-file-manager';
import { NoteTypeResolver } from '../../notes/note-type-resolver';
import { UnifiedDiscovery } from '../../discovery/unified-discovery';
import { ProjectManager } from '../../project/project-manager';
import { FilesystemNoteStorage } from './filesystem-note-storage';
import { FilesystemConfigStorage } from './filesystem-config-storage';
import { FilesystemTemplateStorage } from './filesystem-template-storage';
import { FilesystemMetadataStorage } from './filesystem-metadata-storage';
import { FilesystemIdCounterStorage } from './filesystem-id-counter-storage';
import type { SCEpterConfig } from '../../types/config';
import type { SimpleLLMFunction } from '../../llm/types';

/**
 * Bootstrap filesystem directories: ensure _scepter/, note dirs, type dirs exist.
 * Extracted from ProjectManager.initialize() — all filesystem setup lives here.
 */
export async function bootstrapFilesystemDirs(
  projectPath: string,
  config: SCEpterConfig,
): Promise<void> {
  // Ensure project directory is accessible
  try {
    await fs.access(projectPath, fs.constants.W_OK);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      try {
        await fs.mkdir(projectPath, { recursive: true });
      } catch (mkdirError: any) {
        if (mkdirError.code === 'EACCES' || mkdirError.code === 'EPERM') {
          throw new Error('Permission denied: cannot create project directory');
        }
        throw new Error(`Invalid project path: ${projectPath}`);
      }
    } else if (error.code === 'EACCES' || error.code === 'EPERM') {
      throw new Error('Permission denied: cannot access project directory');
    }
  }

  // Check existing directories for permission issues
  try {
    const entries = await fs.readdir(projectPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dirPath = path.join(projectPath, entry.name);
        try {
          await fs.access(dirPath, fs.constants.R_OK);
        } catch (error: any) {
          if (error.code === 'EACCES' || error.code === 'EPERM') {
            throw new Error(`Permission denied: cannot access directory ${entry.name}`);
          }
        }
      }
    }
  } catch (error: any) {
    if (error.message?.includes('Permission denied')) {
      throw error;
    }
    // Ignore other errors
  }

  // Create base directories
  const notesRoot = config.paths?.notesRoot || '_scepter';
  const baseDirs = [
    path.join(projectPath, config.paths?.dataDir || '_scepter'),
    path.join(projectPath, notesRoot),
  ];

  // Include optional directories only if they already exist
  const optionalDirs = [
    path.join(projectPath, '_scepter/_templates'),
    path.join(projectPath, '_scepter/_prompts'),
    path.join(projectPath, notesRoot, '_templates'),
  ];
  for (const optDir of optionalDirs) {
    try {
      const stats = await fs.stat(optDir);
      if (stats.isDirectory()) {
        baseDirs.push(optDir);
      }
    } catch {
      // Directory doesn't exist — don't create it
    }
  }

  for (const dir of baseDirs) {
    try {
      const parentDir = path.dirname(dir);
      if (parentDir !== projectPath) {
        try {
          await fs.access(parentDir, fs.constants.W_OK);
        } catch (error: any) {
          if (error.code === 'EACCES' || error.code === 'EPERM') {
            throw new Error(`Permission denied: cannot access ${parentDir}`);
          }
        }
      }
      await fs.mkdir(dir, { recursive: true });
    } catch (error: any) {
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        throw new Error(`Permission denied: ${error.message}`);
      }
      throw error;
    }
  }

  // Create note type directories with .gitkeep
  const notesRootPath = path.join(projectPath, notesRoot);
  for (const [_key, noteType] of Object.entries(config.noteTypes)) {
    if (!noteType.folder) continue;

    const noteTypePath = path.join(notesRootPath, noteType.folder);
    try {
      await fs.mkdir(noteTypePath, { recursive: true });
    } catch (error: any) {
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        throw new Error(`Permission denied: ${error.message}`);
      }
      throw error;
    }

    await ensureGitkeep(noteTypePath);
  }
}

/**
 * Construct a filesystem-backed ProjectManager.
 * This is the single entry point for the filesystem backend.
 */
export async function createFilesystemProject(
  projectPath: string,
  options?: { llmFunction?: SimpleLLMFunction },
): Promise<ProjectManager> {
  // 1. Create config manager and load config
  const configManager = new ConfigManager(projectPath);
  const configStorage = new FilesystemConfigStorage(projectPath);
  const rawConfig = await configStorage.load();
  if (!rawConfig) {
    // Fall back to trying ConfigManager's own filesystem loader
    // (which may handle additional config paths or formats)
    const loaded = await configManager.loadConfigFromFilesystem();
    if (!loaded) {
      throw new Error('No configuration file found. Please run `scepter init` first.');
    }
  } else {
    configManager.validateAndLoad(rawConfig);
  }

  const config = configManager.getConfig();

  // 2. Bootstrap filesystem directories
  await bootstrapFilesystemDirs(projectPath, config);

  // 3. Create filesystem storage adapters
  const noteFileManager = new NoteFileManager(projectPath, configManager);
  const unifiedDiscovery = new UnifiedDiscovery(projectPath, configManager);
  const noteTypeResolver = new NoteTypeResolver(configManager);

  const noteStorage = new FilesystemNoteStorage(
    noteFileManager,
    unifiedDiscovery,
    configManager,
    noteTypeResolver,
  );
  const templateStorage = new FilesystemTemplateStorage(projectPath, configManager);
  const dataDir = path.join(projectPath, config.paths?.dataDir || '_scepter');
  // @implements {DD014.§3.DC.47} factory constructs FilesystemMetadataStorage; injected as metadataStorage
  const metadataStorage = new FilesystemMetadataStorage(dataDir);
  const idCounterStorage = new FilesystemIdCounterStorage(noteStorage);

  // 4. Construct ProjectManager with storage interfaces injected
  return new ProjectManager(projectPath, {
    configManager,
    noteFileManager,
    noteTypeResolver,
    noteStorage,
    configStorage,
    templateStorage,
    metadataStorage,
    idCounterStorage,
    llmFunction: options?.llmFunction,
  });
}

/**
 * Search for a SCEpter project root by walking up the directory tree.
 * Extracted from ProjectManager.findProjectRoot() — inherently filesystem-bound.
 */
export async function findProjectRoot(startPath: string): Promise<string | null> {
  let currentPath = path.resolve(startPath);

  while (currentPath !== path.dirname(currentPath)) {
    try {
      const hasConfigJs = await fs
        .access(path.join(currentPath, 'scepter.config.js'))
        .then(() => true)
        .catch(() => false);

      const hasScepterConfigJson = await fs
        .access(path.join(currentPath, '_scepter', 'scepter.config.json'))
        .then(() => true)
        .catch(() => false);

      const hasLegacyConfigJson = await fs
        .access(path.join(currentPath, '_scepter', 'config.json'))
        .then(() => true)
        .catch(() => false);

      if (hasConfigJs || hasScepterConfigJson || hasLegacyConfigJson) {
        return currentPath;
      }
    } catch { }

    currentPath = path.dirname(currentPath);
  }

  return null;
}

async function ensureGitkeep(dirPath: string): Promise<void> {
  const gitkeepPath = path.join(dirPath, '.gitkeep');
  try {
    const files = await fs.readdir(dirPath);
    if (files.length === 0 || (files.length === 1 && files[0] === '.gitkeep')) {
      try {
        await fs.writeFile(gitkeepPath, '', { flag: 'wx' });
      } catch {
        // ignore if already exists
      }
    }
  } catch {
    // Directory doesn't exist or other error
  }
}
