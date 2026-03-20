import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseEditorContent, createNote, openInEditor } from './create-handler.js';
import { formatPaginationInfo, listNotes } from './list-handler.js';
import { showNotes } from './show-handler.js';
import type { ListResult } from './list-handler.js';
import type { CommandContext } from '../base-command.js';
import { ProjectManager } from '../../../project/project-manager.js';
import { ConfigManager } from '../../../config/config-manager.js';
import type { SCEpterConfig } from '../../../types/config.js';
import * as path from 'path';
import fs from 'fs-extra';

describe('Command Handlers', () => {
  let projectManager: ProjectManager;
  let configManager: ConfigManager;
  const testProjectPath = path.join(process.cwd(), '.test-tmp', 'test-handlers');

  const testConfig: SCEpterConfig = {
    noteTypes: {
      Decision: { shortcode: 'D', folder: 'decisions' },
      Requirement: { shortcode: 'R', folder: 'requirements' },
      Question: { shortcode: 'Q', folder: 'questions' },
    },
  };

  beforeEach(async () => {
    // Clean up test directory
    await fs.remove(testProjectPath);
    await fs.ensureDir(testProjectPath);

    // Create and configure ConfigManager
    configManager = new ConfigManager(testProjectPath);
    await configManager.setConfig(testConfig);

    // Create ProjectManager with configured ConfigManager
    projectManager = new ProjectManager(testProjectPath, { configManager });
    await projectManager.initialize();
    await projectManager.noteManager.initialize();

    // Also save config to filesystem so the handler functions can load it
    await configManager.saveConfig();
  });

  afterEach(async () => {
    // Clean up
    await fs.remove(testProjectPath);
  });

  describe('parseEditorContent', () => {
    it('should parse editor template content', () => {
      const content = `# Decision Note

## Title
My Important Decision

## Content
This is the decision content
with multiple lines

## Tags
architecture, performance

---
# This is a comment and should be ignored`;

      const result = parseEditorContent(content);

      expect(result).not.toBeNull();
      expect(result!.title).toBe('My Important Decision');
      expect(result!.content).toBe('This is the decision content\nwith multiple lines');
      expect(result!.tags).toEqual(['architecture', 'performance']);
    });

    it('should return null for empty content', () => {
      const content = `# Decision Note

## Title
[Enter title here]

## Content
[Enter content here]

## Tags
[Enter comma-separated tags]`;

      const result = parseEditorContent(content);

      expect(result).toBeNull();
    });

    it('should handle missing sections', () => {
      const content = `## Content
Just some content`;

      const result = parseEditorContent(content);

      expect(result).not.toBeNull();
      expect(result!.content).toBe('Just some content');
      expect(result!.title).toBeUndefined();
      expect(result!.tags).toBeUndefined();
    });

    it('should handle content with no tags section', () => {
      const content = `## Title
A Title

## Content
Some content here`;

      const result = parseEditorContent(content);

      expect(result).not.toBeNull();
      expect(result!.title).toBe('A Title');
      expect(result!.content).toBe('Some content here');
      expect(result!.tags).toBeUndefined();
    });

    it('should ignore content after separator', () => {
      const content = `## Title
My Title

## Content
Content before separator

---
This should be ignored
## Tags
ignored, tags`;

      const result = parseEditorContent(content);

      expect(result).not.toBeNull();
      expect(result!.title).toBe('My Title');
      expect(result!.content).toBe('Content before separator');
      expect(result!.tags).toBeUndefined();
    });
  });

  describe('formatPaginationInfo', () => {
    it('should format pagination info correctly', () => {
      const result: ListResult = {
        notes: new Array(10).fill({}),
        totalCount: 50,
        hasMore: true,
        output: '',
        isStats: false,
      };

      const info = formatPaginationInfo(result, 20);
      expect(info).toBe('Showing 21-30 of 50 notes');
    });

    it('should return null when no pagination needed', () => {
      const result: ListResult = {
        notes: new Array(10).fill({}),
        totalCount: 10,
        hasMore: false,
        output: '',
        isStats: false,
      };

      const info = formatPaginationInfo(result);
      expect(info).toBeNull();
    });

    it('should handle first page', () => {
      const result: ListResult = {
        notes: new Array(20).fill({}),
        totalCount: 100,
        hasMore: true,
        output: '',
        isStats: false,
      };

      const info = formatPaginationInfo(result, 0);
      expect(info).toBe('Showing 1-20 of 100 notes');
    });

    it('should handle partial last page', () => {
      const result: ListResult = {
        notes: new Array(5).fill({}),
        totalCount: 45,
        hasMore: false,
        output: '',
        isStats: false,
      };

      const info = formatPaginationInfo(result, 40);
      expect(info).toBe('Showing 41-45 of 45 notes');
    });
  });

  describe('showNotes', () => {
    it('should handle invalid IDs gracefully', async () => {
      const context: CommandContext = {
        projectManager,
        projectPath: testProjectPath,
      };
      const result = await showNotes(['D999', 'INVALID'], {}, context);

      expect(result.notFound).toContain('D999');
      expect(result.notFound).toContain('INVALID');
    });

    it('should handle empty ID list', async () => {
      const context: CommandContext = {
        projectManager,
        projectPath: testProjectPath,
      };
      const result = await showNotes([], {}, context);

      expect(result.notes).toHaveLength(0);
      expect(result.output).toBe('');
    });
  });

  describe('listNotes', () => {
    it('should generate statistics for empty project', async () => {
      const context: CommandContext = {
        projectManager,
        projectPath: testProjectPath,
      };
      const result = await listNotes(
        {
          stats: true,
        },
        context,
      );

      expect(result.isStats).toBe(true);
      expect(result.output).toContain('Total notes: 0');
    });

    it('should handle table format with empty results', async () => {
      const context: CommandContext = {
        projectManager,
        projectPath: testProjectPath
      };
      const result = await listNotes(
        {
          format: 'table',
        },
        context,
      );

      expect(result.output).toContain('ID');
      expect(result.output).toContain('Type');
      expect(result.output).toContain('Title');
    });
  });

  describe('createNote', () => {
    it('should create note with provided data', async () => {
      const context = { projectManager, projectPath: testProjectPath };
      const result = await createNote(
        'Decision',
        {
          title: 'Use microservices',
          content: 'We will use microservices architecture',
          tags: ['architecture'],
        },
        context
      );

      expect(result.output).toContain('D001 - Use microservices');
      expect(result.note.title).toBe('Use microservices');
      expect(result.note.content).toBe('We will use microservices architecture');
      expect(result.note.tags).toEqual(['architecture']);
    });

    it('should create note from stdin content', async () => {
      const context = { projectManager, projectPath: testProjectPath };
      const result = await createNote(
        'Decision',
        {
          title: 'Architecture Decision',
          content: 'This is the decision content from stdin',
          tags: ['architecture', 'design'],
        },
        context
      );

      expect(result.output).toContain('D001 - Architecture Decision');
      expect(result.note.title).toBe('Architecture Decision');
      expect(result.note.content).toBe('This is the decision content from stdin');
      expect(result.note.tags).toEqual(['architecture', 'design']);
    });
  });
});
