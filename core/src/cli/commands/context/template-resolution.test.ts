import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { resolveTemplate, substituteTemplateVariables } from './create-handler';

describe('Template resolution', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'template-test-'));

    // Create directory structure
    await fs.ensureDir(path.join(testDir, '_scepter/_templates'));
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  describe('resolution order', () => {
    it('should resolve global template', async () => {
      const globalTemplate = 'Global template content';

      await fs.writeFile(path.join(testDir, '_scepter/_templates/requirement.md'), globalTemplate);

      const templatePath = await resolveTemplate('requirement', undefined, testDir);
      expect(templatePath).toContain('_scepter/_templates/requirement.md');
    });

    it('should use default format if no templates exist', async () => {
      const templatePath = await resolveTemplate('task', undefined, testDir);
      expect(templatePath).toBeNull();
    });

    it('should handle case-insensitive type names', async () => {
      await fs.writeFile(path.join(testDir, '_scepter/_templates/task.md'), 'Task template');

      const path1 = await resolveTemplate('Task', undefined, testDir);
      const path2 = await resolveTemplate('TASK', undefined, testDir);
      const path3 = await resolveTemplate('task', undefined, testDir);

      expect(path1).toBeDefined();
      expect(path1).toBe(path2);
      expect(path2).toBe(path3);
    });
  });

  describe('template variable substitution', () => {
    it('should substitute all standard variables', () => {
      const template = `---
created: {{date}}
tags: []
---

# {{id}} {{title}}

Type: {{type}}
Date: {{date}}`;

      const variables = {
        id: 'T001',
        title: 'Test Task',
        type: 'Task',
        date: '2025-07-18',
      };

      const result = substituteTemplateVariables(template, variables);

      expect(result).toContain('created: 2025-07-18');
      expect(result).toContain('# T001 Test Task');
      expect(result).toContain('Type: Task');
    });

    it('should handle missing variables gracefully', () => {
      const template = 'ID: {{id}}, Unknown: {{unknown}}';

      const variables = {
        id: 'T001',
        // unknown is not a valid variable
      };

      const result = substituteTemplateVariables(template, variables);

      expect(result).toContain('ID: T001');
      expect(result).toContain('Unknown: {{unknown}}'); // Unchanged
    });

    it('should handle nested braces', () => {
      const template = 'Code: `{{id}}: {{title}}`';

      const variables = {
        id: 'T001',
        title: 'Test',
      };

      const result = substituteTemplateVariables(template, variables);
      expect(result).toBe('Code: `T001: Test`');
    });
  });

  describe('template discovery edge cases', () => {
    it('should handle non-existent template directories', async () => {
      // Remove template directories
      await fs.remove(path.join(testDir, '_scepter/_templates'));

      const templatePath = await resolveTemplate('task', undefined, testDir);
      expect(templatePath).toBeNull();
    });

    it('should handle template files with different extensions', async () => {
      // Create template with wrong extension
      await fs.writeFile(path.join(testDir, '_scepter/_templates/task.txt'), 'Wrong extension');

      const templatePath = await resolveTemplate('task', undefined, testDir);
      expect(templatePath).toBeNull(); // Should only find .md files
    });

    it('should handle symlinked templates', async () => {
      const actualTemplate = path.join(testDir, 'actual-template.md');
      const symlinkPath = path.join(testDir, '_scepter/_templates/task.md');

      await fs.writeFile(actualTemplate, 'Symlinked template content');
      await fs.symlink(actualTemplate, symlinkPath);

      const templatePath = await resolveTemplate('task', undefined, testDir);
      expect(templatePath).toBe(symlinkPath);

      const content = await fs.readFile(templatePath!, 'utf-8');
      expect(content).toBe('Symlinked template content');
    });
  });
});
