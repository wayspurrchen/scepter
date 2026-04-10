import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { ProjectManager } from '../../src/project/project-manager';
import { UnifiedDiscovery } from '../../src/discovery/unified-discovery';
import { ConfigManager } from '../../src/config/config-manager';
import type { Note } from '../../src/types/note';

describe('Task Discovery Integration', () => {
  let testDir: string;
  let projectManager: ProjectManager;
  let discovery: UnifiedDiscovery;
  let configManager: ConfigManager;

  beforeEach(async () => {
    // Create real test directory
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scepter-test-'));

    // Create project structure
    await createProjectStructure(testDir);

    // Initialize managers
    projectManager = new ProjectManager(testDir);
    await projectManager.initialize();

    // Create discovery with config manager
    configManager = new ConfigManager(testDir);
    const config = await configManager.loadConfigFromFilesystem();
    if (config) {
      await configManager.setConfig(config);
    }
    discovery = new UnifiedDiscovery(testDir, configManager);
    await discovery.initialize();
  });

  afterEach(async () => {
    await discovery?.stopWatching();
    // Clean up test directory
    await fs.remove(testDir);
  });

  async function createProjectStructure(dir: string) {
    // Create config
    const config = {
      noteTypes: {
        Requirement: { shortcode: 'R', folder: 'requirements' },
        Decision: { shortcode: 'D', folder: 'decisions' },
      },
      paths: {
        notesRoot: '_scepter/notes',
        dataDir: '_scepter',
      },
    };

    await fs.ensureDir(path.join(dir, '_scepter'));
    await fs.writeJson(path.join(dir, '_scepter/scepter.config.json'), config);

    // Create directories
    await fs.ensureDir(path.join(dir, '_scepter/notes/requirements'));
    await fs.ensureDir(path.join(dir, '_scepter/notes/decisions'));
    await fs.ensureDir(path.join(dir, '_scepter/tasks'));
  }

  describe('discovering tasks', () => {
    it('should discover tasks from _scepter/tasks/', async () => {
      // Create tasks in flat tasks folder
      await createTask(testDir, 'T001', 'Document auth flows');
      await createTask(testDir, 'T002', 'Setup database');
      await createTask(testDir, 'T003', 'Configure CI pipeline');

      const notes = await discovery.discoverAll();
      const tasks = notes.filter((n) => n.type === 'Task');

      expect(tasks).toHaveLength(3);
      expect(tasks.map((t) => t.id).sort()).toEqual(['T001', 'T002', 'T003']);
    });

    it('should maintain global ID uniqueness', async () => {
      // Create tasks with sequential IDs
      await createTask(testDir, 'T001', 'First task');
      await createTask(testDir, 'T002', 'Second task');
      await createTask(testDir, 'T003', 'Third task');

      const notes = await discovery.discoverAll();
      const taskIds = notes.filter((n) => n.type === 'Task').map((t) => t.id);

      // Check uniqueness
      expect(new Set(taskIds).size).toBe(taskIds.length);
      expect(taskIds.sort()).toEqual(['T001', 'T002', 'T003']);
    });
  });

  describe('task file changes', () => {
    it('should handle task file additions', async () => {
      const addedNotes: Note[] = [];
      discovery.on('note:added', (note) => addedNotes.push(note));

      await discovery.watch();

      // Give chokidar time to be ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Add new task file
      await createTask(testDir, 'T001', 'New task');

      // Wait for file watcher to detect the addition
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(addedNotes).toHaveLength(1);
      expect(addedNotes[0]).toMatchObject({
        id: 'T001',
        type: 'Task',
      });
    });

    it('should handle task file updates', async () => {
      await createTask(testDir, 'T001', 'Original task');

      const changedNotes: Note[] = [];
      discovery.on('note:changed', (note) => changedNotes.push(note));

      await discovery.watch();

      // Give chokidar time to be ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Update task file
      const taskPath = path.join(testDir, '_scepter/tasks/T001 Original task.md');
      const content = await fs.readFile(taskPath, 'utf-8');
      await fs.writeFile(taskPath, content.replace('pending', 'in_progress'));

      // Wait for file watcher
      await new Promise((resolve) => setTimeout(resolve, 500));

      // chokidar may emit multiple change events for a single write
      expect(changedNotes.length).toBeGreaterThanOrEqual(1);
      expect(changedNotes[0].id).toBe('T001');
    });

    it('should handle task file deletions', async () => {
      await createTask(testDir, 'T001', 'Task to delete');

      // Discover first so the note is in the index
      await discovery.discoverAll();

      const deletedNotes: string[] = [];
      discovery.on('note:deleted', (id) => deletedNotes.push(id));

      await discovery.watch();

      // Give chokidar time to be ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Delete task file
      const taskPath = path.join(testDir, '_scepter/tasks/T001 Task to delete.md');
      await fs.remove(taskPath);

      // Wait for file watcher
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(deletedNotes).toHaveLength(1);
      expect(deletedNotes[0]).toBe('T001');
    });
  });

  describe('status-based filtering', () => {
    it('should support filtering tasks by status', async () => {
      await createTask(testDir, 'T001', 'Pending task', 'pending');
      await createTask(testDir, 'T002', 'Active task', 'in_progress');
      await createTask(testDir, 'T003', 'Done task', 'completed');

      const notes = await discovery.discoverAll();
      const tasks = notes.filter((n) => n.type === 'Task');

      // Filter by status
      const pendingTasks = tasks.filter((t) => t.metadata?.status === 'pending');
      const activeTasks = tasks.filter((t) => t.metadata?.status === 'in_progress');
      const completedTasks = tasks.filter((t) => t.metadata?.status === 'completed');

      expect(pendingTasks).toHaveLength(1);
      expect(activeTasks).toHaveLength(1);
      expect(completedTasks).toHaveLength(1);
    });
  });

  describe('cross-reference discovery', () => {
    it('should resolve references between tasks and notes', async () => {
      // Create requirement note
      await createNote(
        testDir,
        'requirements',
        'R001',
        'Auth requirement',
        'Authentication must support MFA. See {T001} for implementation.',
      );

      // Create task referencing requirement
      await createTask(
        testDir,
        'T001',
        'Implement MFA',
        'pending',
        'Implements {R001} authentication requirement.',
      );

      const notes = await discovery.discoverAll();

      // Both should be discovered
      expect(notes.find((n) => n.id === 'R001')).toBeDefined();
      expect(notes.find((n) => n.id === 'T001')).toBeDefined();

      // Task should be correctly typed
      const task = notes.find((n) => n.id === 'T001');
      expect(task?.type).toBe('Task');
    });

    it('should handle task-to-task references', async () => {
      await createTask(
        testDir,
        'T001',
        'Research auth options',
        'completed',
        'Research different authentication approaches.',
      );

      await createTask(
        testDir,
        'T002',
        'Implement auth',
        'pending',
        'Based on research from {T001}, implement JWT auth.',
      );

      const notes = await discovery.discoverAll();
      const tasks = notes.filter((n) => n.type === 'Task');

      expect(tasks).toHaveLength(2);

      // Content should contain references
      const implTask = tasks.find((t) => t.id === 'T002');
      expect(implTask?.content).toContain('{T001}');
    });
  });

  describe('integration with NoteManager', () => {
    it('should make tasks available through NoteManager', async () => {
      await createTask(testDir, 'T001', 'Test task');

      // Re-scan to pick up the task
      await projectManager.noteManager.rescan();

      const allNotes = await projectManager.noteManager.getAllNotes();
      const task = allNotes.find((n) => n.id === 'T001');

      expect(task).toBeDefined();
      expect(task?.type).toBe('Task');
    });

    it('should support filtering by Task type', async () => {
      await createTask(testDir, 'T001', 'Task 1');
      await createTask(testDir, 'T002', 'Task 2');
      await createNote(testDir, 'requirements', 'R001', 'Requirement 1', 'Content');

      await projectManager.noteManager.rescan();

      const tasks = await projectManager.noteManager.getNotesByType('Task');

      expect(tasks).toHaveLength(2);
      expect(tasks.every((t) => t.type === 'Task')).toBe(true);
    });
  });

  // Helper functions
  async function createTask(
    baseDir: string,
    id: string,
    title: string,
    status = 'pending',
    content = '',
  ) {
    const taskContent = `---
created: ${new Date().toISOString()}
status: ${status}
priority: medium
categories: []
---

# ${id} ${title}

${content}`;

    const taskDir = path.join(baseDir, '_scepter/tasks');
    await fs.ensureDir(taskDir);
    const taskPath = path.join(taskDir, `${id} ${title}.md`);
    await fs.writeFile(taskPath, taskContent);
  }

  async function createNote(baseDir: string, type: string, id: string, title: string, content: string) {
    const noteContent = `---
created: ${new Date().toISOString()}
categories: []
---

# ${id} ${title}

${content}`;

    const notePath = path.join(baseDir, '_scepter/notes', type, `${id} ${title}.md`);
    await fs.writeFile(notePath, noteContent);
  }
});
