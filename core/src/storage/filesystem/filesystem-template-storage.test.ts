import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import { FilesystemTemplateStorage } from './filesystem-template-storage';
import { ConfigManager } from '../../config/config-manager';

describe('FilesystemTemplateStorage', () => {
  const testDir = path.join(process.cwd(), '.test-tmp', 'fs-template-storage');
  let storage: FilesystemTemplateStorage;
  let configManager: ConfigManager;

  beforeEach(async () => {
    await fs.remove(testDir);
    await fs.ensureDir(testDir);

    configManager = new ConfigManager(testDir);
    await configManager.setConfig({
      noteTypes: { Decision: { shortcode: 'D', folder: 'decisions' } },
    });

    storage = new FilesystemTemplateStorage(testDir, configManager);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  it('should return null when no template exists', async () => {
    const content = await storage.getTemplate('Decision');
    expect(content).toBeNull();
  });

  it('should return empty list when template dir does not exist', async () => {
    const templates = await storage.listTemplates();
    expect(templates).toEqual([]);
  });

  it('should find a .md template', async () => {
    const templateDir = path.join(testDir, '_scepter', 'templates', 'types');
    await fs.ensureDir(templateDir);
    await fs.writeFile(path.join(templateDir, 'Decision.md'), '# {{id}} - {{title}}');

    const content = await storage.getTemplate('Decision');
    expect(content).toBe('# {{id}} - {{title}}');
  });

  it('should list available templates', async () => {
    const templateDir = path.join(testDir, '_scepter', 'templates', 'types');
    await fs.ensureDir(templateDir);
    await fs.writeFile(path.join(templateDir, 'Decision.md'), 'template1');
    await fs.writeFile(path.join(templateDir, 'Requirement.md'), 'template2');
    await fs.writeFile(path.join(templateDir, 'not-a-template.json'), '{}');

    const templates = await storage.listTemplates();
    expect(templates).toContain('Decision');
    expect(templates).toContain('Requirement');
    expect(templates).not.toContain('not-a-template');
  });

  it('should try multiple extensions', async () => {
    const templateDir = path.join(testDir, '_scepter', 'templates', 'types');
    await fs.ensureDir(templateDir);
    await fs.writeFile(path.join(templateDir, 'Decision.txt'), 'txt template');

    const content = await storage.getTemplate('Decision');
    expect(content).toBe('txt template');
  });

  it('should use custom template path from config', async () => {
    await configManager.setConfig({
      noteTypes: { Decision: { shortcode: 'D', folder: 'decisions' } },
      templates: { paths: { types: 'custom/templates' } },
    });

    const templateDir = path.join(testDir, 'custom', 'templates');
    await fs.ensureDir(templateDir);
    await fs.writeFile(path.join(templateDir, 'Decision.md'), 'custom template');

    const content = await storage.getTemplate('Decision');
    expect(content).toBe('custom template');
  });
});
