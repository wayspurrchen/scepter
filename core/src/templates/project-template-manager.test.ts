import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectTemplateManager } from './project-template-manager';
import * as fs from 'fs/promises';
import * as path from 'path';
import { rimraf } from 'rimraf';

describe('ProjectTemplateManager', () => {
  const testBoilerplatesPath = path.join(process.cwd(), '.test-tmp', 'test-boilerplates');
  const testBoilerplatePath = path.join(testBoilerplatesPath, 'default');
  const testProjectPath = path.join(process.cwd(), '.test-tmp', 'test-project');
  let manager: ProjectTemplateManager;

  beforeEach(async () => {
    // Create test boilerplate structure
    await fs.mkdir(testBoilerplatePath, { recursive: true });
    await fs.mkdir(path.join(testBoilerplatePath, '_scepter', 'templates'), { recursive: true });
    await fs.mkdir(path.join(testBoilerplatePath, '_scepter', '_guides'), { recursive: true });
    
    // Create sample files
    await fs.writeFile(
      path.join(testBoilerplatePath, 'scepter.config.js'),
      `module.exports = {
        noteTypes: {
          Requirement: { folder: 'requirements', shortcode: 'R', template: 'templates/requirement.hbs' },
          Decision: { folder: 'decisions', shortcode: 'D' }
        }
      };`
    );
    
    await fs.writeFile(
      path.join(testBoilerplatePath, '_scepter', 'templates', 'requirement.hbs'),
      '# {{title}}\n\n**ID**: {{id}}\n**Author**: {{author}}\n\n{{content}}'
    );
    
    await fs.writeFile(
      path.join(testBoilerplatePath, '_scepter', 'GUIDANCE.md'),
      '# Development Guide\n\nThis is the guide content.'
    );
    
    await fs.writeFile(
      path.join(testBoilerplatePath, '.gitignore'),
      'node_modules/\n.env'
    );
    
    // Create a second test boilerplate
    const minimalBoilerplatePath = path.join(testBoilerplatesPath, 'minimal');
    await fs.mkdir(minimalBoilerplatePath, { recursive: true });
    await fs.writeFile(
      path.join(minimalBoilerplatePath, 'scepter.config.json'),
      JSON.stringify({
        noteTypes: {
          Note: { folder: 'notes', shortcode: 'N' }
        }
      }, null, 2)
    );
    
    manager = new ProjectTemplateManager(testBoilerplatesPath);
  });

  afterEach(async () => {
    await rimraf(testBoilerplatesPath);
    await rimraf(testProjectPath);
  });

  describe('copyToProject', () => {
    it('should copy entire boilerplate structure to target', async () => {
      const result = await manager.copyToProject(testProjectPath, {
        sourcePath: testBoilerplatePath
      });
      
      expect(result.success).toBe(true);
      expect(result.copiedFiles).toContain('scepter.config.js');
      expect(result.copiedFiles).toContain('_scepter/templates/requirement.hbs');
      expect(result.copiedFiles).toContain('_scepter/GUIDANCE.md');
      
      // Verify files exist
      const configExists = await fs.access(path.join(testProjectPath, 'scepter.config.js'))
        .then(() => true)
        .catch(() => false);
      expect(configExists).toBe(true);
      
      const templateExists = await fs.access(path.join(testProjectPath, '_scepter', 'templates', 'requirement.hbs'))
        .then(() => true)
        .catch(() => false);
      expect(templateExists).toBe(true);
    });

    it('should respect exclude patterns', async () => {
      const result = await manager.copyToProject(testProjectPath, {
        sourcePath: testBoilerplatePath,
        exclude: ['templates/', '.gitignore']
      });
      
      expect(result.success).toBe(true);
      expect(result.copiedFiles).toContain('scepter.config.js');
      expect(result.copiedFiles).toContain('_scepter/GUIDANCE.md');
      expect(result.copiedFiles).not.toContain('_scepter/templates/requirement.hbs');
      expect(result.copiedFiles).not.toContain('.gitignore');
      expect(result.skippedFiles).toContain('_scepter/templates/requirement.hbs');
    });

    it('should skip existing files by default', async () => {
      // Create existing file
      await fs.mkdir(testProjectPath, { recursive: true });
      await fs.writeFile(
        path.join(testProjectPath, 'scepter.config.js'),
        '// Existing config'
      );
      
      const result = await manager.copyToProject(testProjectPath, {
        sourcePath: testBoilerplatePath
      });
      
      expect(result.success).toBe(true);
      expect(result.skippedFiles).toContain('scepter.config.js');
      
      // Verify original content preserved
      const content = await fs.readFile(path.join(testProjectPath, 'scepter.config.js'), 'utf-8');
      expect(content).toBe('// Existing config');
    });

    it('should overwrite files when specified', async () => {
      // Create existing file
      await fs.mkdir(testProjectPath, { recursive: true });
      await fs.writeFile(
        path.join(testProjectPath, 'scepter.config.js'),
        '// Existing config'
      );
      
      const result = await manager.copyToProject(testProjectPath, {
        sourcePath: testBoilerplatePath,
        overwrite: true
      });
      
      expect(result.success).toBe(true);
      expect(result.overwrittenFiles).toContain('scepter.config.js');
      
      // Verify content was overwritten
      const content = await fs.readFile(path.join(testProjectPath, 'scepter.config.js'), 'utf-8');
      expect(content).toContain('noteTypes');
    });

    it('should handle copy errors gracefully', async () => {
      // Make target path unwritable
      await fs.mkdir(testProjectPath, { recursive: true });
      await fs.chmod(testProjectPath, 0o444);
      
      const result = await manager.copyToProject(testProjectPath, {
        sourcePath: testBoilerplatePath
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('permission');
      
      // Restore permissions for cleanup
      await fs.chmod(testProjectPath, 0o755);
    });

    it('should create target directory if it does not exist', async () => {
      const result = await manager.copyToProject(testProjectPath, {
        sourcePath: testBoilerplatePath
      });
      
      expect(result.success).toBe(true);
      
      const dirExists = await fs.access(testProjectPath)
        .then(() => true)
        .catch(() => false);
      expect(dirExists).toBe(true);
    });

    it('should preserve file permissions', async () => {
      // Make a file executable
      const scriptPath = path.join(testBoilerplatePath, 'setup.sh');
      await fs.writeFile(scriptPath, '#!/bin/bash\necho "Setup"');
      await fs.chmod(scriptPath, 0o755);
      
      await manager.copyToProject(testProjectPath, {
        sourcePath: testBoilerplatePath
      });
      
      const stats = await fs.stat(path.join(testProjectPath, 'setup.sh'));
      expect(stats.mode & 0o111).toBeTruthy(); // Check executable bit
    });
  });

  describe('Named boilerplates', () => {
    it('should list available boilerplates', async () => {
      const boilerplates = await manager.getAvailableBoilerplates();
      expect(boilerplates).toContain('default');
      expect(boilerplates).toContain('minimal');
    });

    it('should initialize project with named boilerplate', async () => {
      await manager.initializeProject(testProjectPath, 'default');

      // Check files were copied to _scepter
      expect(await fs.access(path.join(testProjectPath, '_scepter/scepter.config.js'))
        .then(() => true).catch(() => false)).toBe(true);
      expect(await fs.access(path.join(testProjectPath, '_scepter/_scepter/templates/requirement.hbs'))
        .then(() => true).catch(() => false)).toBe(true);
    });

    it('should update config with project info', async () => {
      // Create scepter.config.json in test boilerplate
      await fs.writeFile(
        path.join(testBoilerplatePath, 'scepter.config.json'),
        JSON.stringify({
          noteTypes: { Requirement: { folder: 'requirements', shortcode: 'R' } }
        }, null, 2)
      );
      
      await manager.initializeProject(testProjectPath, 'default');
      
      const configPath = path.join(testProjectPath, '_scepter/scepter.config.json');
      const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
      
      expect(config.project).toBeDefined();
      expect(config.project.name).toBe('test-project');
      expect(config.project.createdAt).toBeDefined();
    });

    it('should handle missing boilerplate', async () => {
      await expect(manager.initializeProject(testProjectPath, 'nonexistent'))
        .rejects.toThrow('Boilerplate not found');
    });

    it('should return empty array if boilerplates directory does not exist', async () => {
      const emptyManager = new ProjectTemplateManager('/nonexistent/path');
      const boilerplates = await emptyManager.getAvailableBoilerplates();
      
      expect(boilerplates).toEqual([]);
    });
  });

  describe('validateBoilerplate', () => {
    it('should validate correct boilerplate structure', async () => {
      const result = await manager.validateBoilerplate(testBoilerplatePath);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should detect missing scepter.config.js', async () => {
      await fs.unlink(path.join(testBoilerplatePath, 'scepter.config.js'));
      
      const result = await manager.validateBoilerplate(testBoilerplatePath);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing scepter.config.js');
    });

    it('should detect missing _scepter directory', async () => {
      await rimraf(path.join(testBoilerplatePath, '_scepter'));
      
      const result = await manager.validateBoilerplate(testBoilerplatePath);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing _scepter directory');
    });

    it('should validate config syntax', async () => {
      await fs.writeFile(
        path.join(testBoilerplatePath, 'scepter.config.js'),
        'module.exports = { invalid syntax'
      );
      
      const result = await manager.validateBoilerplate(testBoilerplatePath);
      
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('Invalid scepter.config.js');
    });
  });

  describe('getBoilerplateConfig', () => {
    it('should load and parse boilerplate config', async () => {
      const config = await manager.getBoilerplateConfig(testBoilerplatePath);
      
      expect(config).toBeDefined();
      expect(config?.noteTypes.Requirement).toEqual({
        folder: 'requirements',
        shortcode: 'R',
        template: 'templates/requirement.hbs'
      });
    });

    it('should return null if config does not exist', async () => {
      await fs.unlink(path.join(testBoilerplatePath, 'scepter.config.js'));
      
      const config = await manager.getBoilerplateConfig(testBoilerplatePath);
      
      expect(config).toBeNull();
    });

    it('should handle invalid config gracefully', async () => {
      await fs.writeFile(
        path.join(testBoilerplatePath, 'scepter.config.js'),
        'module.exports = null;'
      );
      
      const config = await manager.getBoilerplateConfig(testBoilerplatePath);
      
      expect(config).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should handle non-existent source directory', async () => {
      const invalidManager = new ProjectTemplateManager('/nonexistent/boilerplate');
      
      const result = await invalidManager.copyToProject(testProjectPath, {
        sourcePath: '/nonexistent/source'
      });
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SOURCE_NOT_FOUND');
    });

    it('should handle circular symlinks', async () => {
      // Create circular symlink
      const linkPath = path.join(testBoilerplatePath, 'circular');
      await fs.symlink(testBoilerplatePath, linkPath);
      
      const result = await manager.copyToProject(testProjectPath, {
        sourcePath: testBoilerplatePath
      });
      
      // Should complete successfully, skipping the circular link
      expect(result.success).toBe(true);
      expect(result.warnings).toContain('Skipped circular symlink');
    });
  });

  describe('dry run mode', () => {
    it('should simulate copy without making changes', async () => {
      const result = await manager.copyToProject(testProjectPath, {
        sourcePath: testBoilerplatePath,
        dryRun: true
      });
      
      expect(result.success).toBe(true);
      expect(result.copiedFiles.length).toBeGreaterThan(0);
      
      // Verify no files were actually copied
      const dirExists = await fs.access(testProjectPath)
        .then(() => true)
        .catch(() => false);
      expect(dirExists).toBe(false);
    });
  });
});