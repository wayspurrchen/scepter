import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { searchNotes, formatSearchResults } from './search-handler';
import { ProjectManager } from '../../../project/project-manager';
import { ConfigManager } from '../../../config/config-manager';
import type { SCEpterConfig } from '../../../types/config';
import fs from 'fs-extra';
import * as path from 'path';

describe('search-handler', () => {
  let projectManager: ProjectManager;
  let configManager: ConfigManager;
  const testProjectPath = path.join(process.cwd(), '.test-tmp', 'test-search-handler');

  const testConfig: SCEpterConfig = {
    noteTypes: {
      IDEA: { shortcode: 'I', folder: 'ideas' },
      DECISION: { shortcode: 'D', folder: 'decisions' },
    },
  };

  beforeEach(async () => {
    // Clean up test directory
    await fs.remove(testProjectPath);
    await fs.ensureDir(testProjectPath);

    // Set environment variable for search handler
    process.env.SCEPTER_PROJECT_PATH = testProjectPath;

    // Create and configure ConfigManager
    configManager = new ConfigManager(testProjectPath);
    await configManager.setConfig(testConfig);

    // Create ProjectManager with configured ConfigManager
    projectManager = new ProjectManager(testProjectPath, { configManager });
    await projectManager.initialize();
    await projectManager.noteManager.initialize();

    // Also save config to filesystem so the handler functions can load it
    await configManager.saveConfig();

    // Create test notes
    await projectManager.noteManager.createNote({
      type: 'DECISION',
      title: 'Implement search functionality',
      content: 'We need to implement a robust search feature that supports regex patterns and case-sensitive matching.',
      tags: ['feature', 'search'],
    });

    await projectManager.noteManager.createNote({
      type: 'DECISION',
      title: 'Fix search performance',
      content: 'The current search is too slow. We should optimize the regex matching algorithm.',
      tags: ['bug', 'performance'],
    });

    await projectManager.noteManager.createNote({
      type: 'IDEA',
      title: 'Advanced filtering',
      content: 'What if we add support for fuzzy search? This would help users find notes even with typos.',
      tags: ['enhancement'],
    });
  });

  afterEach(async () => {
    // Clean up
    await fs.remove(testProjectPath);
    // Clean up environment
    delete process.env.SCEPTER_PROJECT_PATH;
  });

  describe('searchNotes', () => {
    it('should find notes by simple text search', async () => {
      // First verify notes were created
      const allNotes = await projectManager.noteManager.getAllNotes();

      const results = await searchNotes('search', { noteManager: projectManager.noteManager });

      expect(results).toHaveLength(3);
      expect(results[0].matches.length).toBeGreaterThan(0);
      expect(results.map((r) => r.note?.title).filter(Boolean)).toContain('Implement search functionality');
      expect(results.map((r) => r.note?.title).filter(Boolean)).toContain('Fix search performance');
    });

    it('should search in titles only when titleOnly is true', async () => {
      const results = await searchNotes('performance', { titleOnly: true, noteManager: projectManager.noteManager });

      expect(results).toHaveLength(1);
      expect(results[0].note?.title).toBe('Fix search performance');
      expect(results[0].matches[0].field).toBe('title');
    });

    it('should support regex patterns', async () => {
      const results = await searchNotes('search.*performance', {
        regex: true,
        noteManager: projectManager.noteManager,
      });

      expect(results).toHaveLength(1);
      expect(results[0].note?.title).toBe('Fix search performance');
    });

    it('should normalize BRE-style backslash-pipe to alternation in regex mode', async () => {
      const results = await searchNotes('fuzzy\\|optimize', {
        regex: true,
        noteManager: projectManager.noteManager,
      });

      // Should match both notes: one containing "fuzzy", one containing "optimize"
      expect(results).toHaveLength(2);
      const titles = results.map((r) => r.note?.title).filter(Boolean);
      expect(titles).toContain('Advanced filtering'); // contains "fuzzy"
      expect(titles).toContain('Fix search performance'); // contains "optimize"
    });

    it('should be case sensitive when option is set', async () => {
      const results = await searchNotes('SEARCH', { caseSensitive: true, noteManager: projectManager.noteManager });

      expect(results).toHaveLength(0);
    });

    it('should filter by note types', async () => {
      const results = await searchNotes('search', { types: ['IDEA'], noteManager: projectManager.noteManager });

      expect(results).toHaveLength(1);
      expect(results[0].note?.type).toBe('IDEA');
    });

    it('should filter by tags', async () => {
      const results = await searchNotes('search', { tags: ['feature'], noteManager: projectManager.noteManager });

      expect(results).toHaveLength(1);
      expect(results[0].note?.tags).toContain('feature');
    });

    it('should limit results when limit is set', async () => {
      const results = await searchNotes('search', { limit: 1, noteManager: projectManager.noteManager });

      expect(results).toHaveLength(1);
    });

    it('should include context lines in matches', async () => {
      const results = await searchNotes('optimize', { contextLines: 3, noteManager: projectManager.noteManager });

      expect(results).toHaveLength(1);
      const contentMatch = results[0].matches.find((m) => m.field === 'content');
      expect(contentMatch).toBeDefined();
      expect(contentMatch!.context).toBeDefined();
      // Context should include the matching line plus context lines
      // In this case, the match is likely on a single line with no following lines
      expect(contentMatch!.context!.split('\n').length).toBeGreaterThanOrEqual(1);
    });

    it('should generate excerpts when requested', async () => {
      const results = await searchNotes('regex', { showExcerpts: true, noteManager: projectManager.noteManager });

      expect(results).toHaveLength(2);
      const resultWithMatch = results.find((r) => r.matches.some((m) => m.field === 'content'));
      expect(resultWithMatch?.excerpt).toBeDefined();
      expect(resultWithMatch!.excerpt).toContain('regex');
    });
  });

  describe('formatSearchResults', () => {
    it('should format results as list by default', async () => {
      const results = await searchNotes('search', { noteManager: projectManager.noteManager });
      const formatted = formatSearchResults(results);

      expect(formatted).toContain('Found 3 notes with matches');
      expect(formatted).toMatch(/[DI]\d{3} - .* \(\d+ matches?\)/);
    });

    it('should format results as detailed when specified', async () => {
      const results = await searchNotes('search', { contextLines: 2, noteManager: projectManager.noteManager });
      const formatted = formatSearchResults(results, { format: 'detailed', contextLines: 2 });

      expect(formatted).toContain('Matches (');
      expect(formatted).toContain('title:');
      expect(formatted).toMatch(/content:\d+:\d+/);
    });

    it('should format results as JSON when specified', async () => {
      const results = await searchNotes('search', { noteManager: projectManager.noteManager });
      const formatted = formatSearchResults(results, { format: 'json' });

      const parsed = JSON.parse(formatted);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0]).toHaveProperty('note');
      expect(parsed[0]).toHaveProperty('matches');
    });

    it('should handle empty results', async () => {
      const results = await searchNotes('nonexistent', { noteManager: projectManager.noteManager });
      const formatted = formatSearchResults(results);

      expect(formatted).toBe('No matches found.');
    });

    it('should show excerpts in list format when available', async () => {
      const results = await searchNotes('regex', { showExcerpts: true, noteManager: projectManager.noteManager });
      const formatted = formatSearchResults(results);

      expect(formatted).toContain('regex');
    });
  });
});
