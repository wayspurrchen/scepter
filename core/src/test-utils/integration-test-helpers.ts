import { ConfigManager } from '../config/config-manager';
import { NoteManager } from '../notes/note-manager';
import { NoteFileManager } from '../notes/note-file-manager';
import { NoteTypeResolver } from '../notes/note-type-resolver';
import { NoteTypeTemplateManager } from '../templates/note-type-template-manager';
import { ReferenceManager } from '../references/reference-manager';
import { ProjectManager } from '../project/project-manager';
import { ContextGatherer } from '../context/context-gatherer';
import { TaskDispatcher } from '../tasks/task-dispatcher';
import type { SCEpterConfig } from '../types/config';
import * as path from 'path';
import * as fs from 'fs-extra';

/**
 * Integration test helpers for SCEpter
 * Provides common setup and teardown functionality for tests that use real file system
 */

export interface TestContext {
  projectPath: string;
  configManager: ConfigManager;
  noteManager: NoteManager;
  noteFileManager: NoteFileManager;
  noteTypeResolver: NoteTypeResolver;
  noteTypeTemplateManager: NoteTypeTemplateManager;
  referenceManager: ReferenceManager;
  projectManager?: ProjectManager;
  contextGatherer?: ContextGatherer;
  taskDispatcher?: TaskDispatcher;
}

export interface TestNote {
  id?: string;
  type: string;
  title: string;
  content: string;
  tags: string[];
}

/**
 * Default test configuration with common note types
 */
export const DEFAULT_TEST_CONFIG: SCEpterConfig = {
  noteTypes: {
    Decision: { shortcode: 'D', folder: 'decisions' },
    Requirement: { shortcode: 'R', folder: 'requirements' },
    Question: { shortcode: 'Q', folder: 'questions' },
  },
  paths: {
    notesRoot: '_scepter/notes',
    dataDir: '_scepter',
  },
};

/**
 * Options for setting up a test project
 */
export interface SetupOptions {
  /** Whether to start file watching (default: false) */
  startWatching?: boolean;
  /** Whether to initialize template manager (default: true) */
  initializeTemplates?: boolean;
  /** Whether to clean the directory before setup (default: true) */
  cleanBeforeSetup?: boolean;
}

/**
 * Creates a test project with all necessary managers initialized
 * @param suiteName - Name of the test suite (used for temp directory)
 * @param config - Optional custom configuration (defaults to DEFAULT_TEST_CONFIG)
 * @param options - Optional setup options
 * @returns TestContext with all initialized managers
 */
export async function setupTestProject(
  suiteName: string,
  config: SCEpterConfig = DEFAULT_TEST_CONFIG,
  options: SetupOptions = {},
): Promise<TestContext> {
  const { cleanBeforeSetup = true, initializeTemplates = true, startWatching = false } = options;

  const projectPath = path.join(process.cwd(), '.test-tmp', suiteName);

  // Clean and create directory
  if (cleanBeforeSetup) {
    await fs.remove(projectPath);
  }
  await fs.ensureDir(projectPath);

  // Initialize managers in correct order
  const configManager = new ConfigManager(projectPath);
  await configManager.setConfig(config);

  const noteFileManager = new NoteFileManager(projectPath, configManager);

  const noteTypeResolver = new NoteTypeResolver(configManager);
  noteTypeResolver.initialize();

  const noteTypeTemplateManager = new NoteTypeTemplateManager(projectPath, configManager);
  if (initializeTemplates) {
    await noteTypeTemplateManager.initialize();
  }

  const referenceManager = new ReferenceManager();

  const noteManager = new NoteManager(
    projectPath,
    configManager,
    noteFileManager,
    noteTypeResolver,
    noteTypeTemplateManager,
    referenceManager,
  );

  await noteManager.initialize();

  if (startWatching) {
    await noteManager.startWatching();
  }

  return {
    projectPath,
    configManager,
    noteManager,
    noteFileManager,
    noteTypeResolver,
    noteTypeTemplateManager,
    referenceManager,
  };
}

/**
 * Creates a full ProjectManager-based test context
 * Use this when testing features that require the full system
 * @param suiteName - Name of the test suite (used for temp directory)
 * @param config - Optional custom configuration (defaults to DEFAULT_TEST_CONFIG)
 * @param options - Optional setup options
 * @returns TestContext with all managers including optional ones
 */
export async function setupFullTestProject(
  suiteName: string,
  config: SCEpterConfig = DEFAULT_TEST_CONFIG,
  options: SetupOptions = {},
): Promise<TestContext> {
  const { cleanBeforeSetup = true, startWatching = false } = options;

  const projectPath = path.join(process.cwd(), '.test-tmp', suiteName);

  // Clean and create directory
  if (cleanBeforeSetup) {
    await fs.remove(projectPath);
  }
  await fs.ensureDir(projectPath);

  // Create config file
  const configPath = path.join(projectPath, 'scepter.config.json');
  await fs.writeJson(configPath, config, { spaces: 2 });

  // Initialize project manager
  const projectManager = new ProjectManager(projectPath);
  await projectManager.initialize();

  if (startWatching) {
    await projectManager.noteManager.startWatching();
  }

  return {
    projectPath,
    configManager: projectManager.configManager,
    noteManager: projectManager.noteManager,
    noteFileManager: projectManager.noteFileManager,
    noteTypeResolver: projectManager.noteTypeResolver,
    noteTypeTemplateManager: projectManager.noteTypeTemplateManager,
    referenceManager: projectManager.referenceManager,
    projectManager,
    contextGatherer: projectManager.contextGatherer,
    taskDispatcher: projectManager.taskDispatcher,
  };
}

/**
 * Cleans up test project
 * @param context - The test context to clean up
 */
export async function cleanupTestProject(context: TestContext): Promise<void> {
  // Stop watching if started
  if (context.noteManager) {
    await context.noteManager.stopWatching();
  }

  // Remove temp directory
  await fs.remove(context.projectPath);
}

// Note: createTestNotes removed - tests should use noteManager.createNote() directly
// to test through the real API and spot integration issues

/**
 * Verifies a file exists at the expected path
 * @param projectPath - The project root path
 * @param relativePath - Path relative to project root
 * @returns true if file exists
 */
export async function verifyFileExists(projectPath: string, relativePath: string): Promise<boolean> {
  const fullPath = path.join(projectPath, relativePath);
  return fs.pathExists(fullPath);
}

/**
 * Gets the expected path for a note file
 * @param projectPath - The project root path
 * @param noteType - The note type configuration
 * @param noteId - The note ID
 * @param title - The note title
 * @param location - 'active' | 'archive' | 'deleted'
 */
export function getExpectedNotePath(
  projectPath: string,
  noteType: { folder: string },
  noteId: string,
  title: string,
  location: 'active' | 'archive' | 'deleted' = 'active',
): string {
  const sanitizedTitle = title
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const filename = `${noteId} ${sanitizedTitle}`.substring(0, 80).trim() + '.md';

  let basePath = path.join(projectPath, '_scepter', 'notes', noteType.folder);

  if (location === 'archive') {
    basePath = path.join(basePath, '_archive');
  } else if (location === 'deleted') {
    basePath = path.join(basePath, '_deleted');
  }

  return path.join(basePath, filename);
}

/**
 * Reads note content from file
 * @param filePath - Full path to the note file
 * @returns The note content
 */
export async function readNoteContent(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

/**
 * Test data factory functions for creating consistent test notes
 */
export const testData = {
  /**
   * Creates a decision note
   */
  decision: (overrides: Partial<TestNote> = {}): TestNote => ({
    type: 'Decision',
    title: 'Architecture Decision',
    content: 'We have decided on the architecture',
    tags: ['architecture'],
    ...overrides,
  }),

  /**
   * Creates a requirement note
   */
  requirement: (overrides: Partial<TestNote> = {}): TestNote => ({
    type: 'Requirement',
    title: 'System Requirement',
    content: 'The system must fulfill this requirement',
    tags: ['functional'],
    ...overrides,
  }),

  /**
   * Creates a question note
   */
  question: (overrides: Partial<TestNote> = {}): TestNote => ({
    type: 'Question',
    title: 'Technical Question',
    content: 'How should we approach this?',
    tags: ['needs-answer'],
    ...overrides,
  }),

  /**
   * Creates a TODO note
   */
  todo: (overrides: Partial<TestNote> = {}): TestNote => ({
    type: 'TODO',
    title: 'Implementation Task',
    content: 'Implement this feature',
    tags: ['task'],
    ...overrides,
  }),

  /**
   * Creates a set of interconnected notes with references
   */
  withReferences: (): TestNote[] => [
    {
      id: 'D001',
      type: 'Decision',
      title: 'Use microservices',
      content: 'We will use microservices architecture',
      tags: ['architecture'],
    },
    {
      id: 'R001',
      type: 'Requirement',
      title: 'Must scale horizontally',
      content: 'System must scale. Supports {D001}',
      tags: ['performance'],
    },
    {
      id: 'T001',
      type: 'TODO',
      title: 'Implement service mesh',
      content: 'Implement service mesh for {D001} based on {R001}',
      tags: ['implementation'],
    },
  ],
};

/**
 * Common test data for notes (deprecated - use testData factory functions instead)
 * @deprecated Use testData factory functions for more flexibility
 */
export const TEST_NOTES = {
  decision1: testData.decision({
    id: 'D001',
    title: 'Use microservices architecture',
    content: 'We will use microservices for better scalability',
    tags: ['architecture', 'scalability'],
  }),
  requirement1: testData.requirement({
    id: 'R001',
    title: 'Users must authenticate',
    content: 'Users must authenticate using JWT. See {D001}',
    tags: ['auth', 'security'],
  }),
  question1: testData.question({
    id: 'Q001',
    title: 'Which database to use?',
    content: 'Should we use PostgreSQL or MongoDB?',
    tags: ['database', 'architecture'],
  }),
  todo1: testData.todo({
    id: 'T001',
    title: 'Implement authentication',
    content: 'Implement JWT authentication based on {R001}',
    tags: ['implementation', 'auth'],
  }),
};

/**
 * Waits for file system operations to complete
 * Useful when testing file watching features
 */
export async function waitForFileSystem(ms: number = 100): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates a note file manually (simulating external creation)
 * Useful for testing file watching and orphaned file detection
 */
export async function createNoteFileManually(
  projectPath: string,
  noteType: { folder: string },
  filename: string,
  content: string,
): Promise<string> {
  const notePath = path.join(projectPath, '_scepter', 'notes', noteType.folder);
  await fs.ensureDir(notePath);
  const filePath = path.join(notePath, filename);
  await fs.writeFile(filePath, content);
  return filePath;
}

/**
 * Assertion helpers for common test scenarios
 */
export const assertions = {
  async fileExists(filePath: string): Promise<void> {
    const exists = await fs.pathExists(filePath);
    if (!exists) {
      throw new Error(`Expected file to exist: ${filePath}`);
    }
  },

  async fileNotExists(filePath: string): Promise<void> {
    const exists = await fs.pathExists(filePath);
    if (exists) {
      throw new Error(`Expected file to not exist: ${filePath}`);
    }
  },

  async fileContains(filePath: string, content: string): Promise<void> {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    if (!fileContent.includes(content)) {
      throw new Error(`Expected file to contain "${content}" but it doesn't`);
    }
  },

  async noteInLocation(
    context: TestContext,
    noteId: string,
    location: 'active' | 'archive' | 'deleted',
  ): Promise<void> {
    const note = await context.noteManager.getNoteById(noteId);
    if (!note) {
      throw new Error(`Note ${noteId} not found`);
    }

    const filePath = await context.noteManager.findNoteFile(noteId);
    if (!filePath) {
      throw new Error(`File for note ${noteId} not found`);
    }

    const expectedInPath =
      location === 'active'
        ? !filePath.includes('_archive') && !filePath.includes('_deleted')
        : filePath.includes(`_${location}`);

    if (!expectedInPath) {
      throw new Error(`Expected note ${noteId} to be in ${location} location`);
    }
  },
};

/**
 * Path utilities for common test scenarios
 */
export const paths = {
  /**
   * Gets the notes root directory path
   */
  notesRoot: (projectPath: string): string => path.join(projectPath, '_scepter', 'notes'),

  /**
   * Gets the path for a specific note type folder
   */
  noteTypeFolder: (projectPath: string, noteTypeFolder: string): string => {
    return path.join(projectPath, '_scepter', 'notes', noteTypeFolder);
  },

  /**
   * Gets the expected path for a note file (wrapper around getExpectedNotePath)
   */
  notePath: (
    projectPath: string,
    noteType: { folder: string },
    noteId: string,
    title: string,
    location?: 'active' | 'archive' | 'deleted',
  ): string => getExpectedNotePath(projectPath, noteType, noteId, title, location),
};
