// NoteTypeTemplateManager - Manages note type templates for LLM context

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { watch, FSWatcher } from 'chokidar';
import { ConfigManager } from '../config/config-manager';

export interface TemplateMetadata {
  type: string;
  hasTemplate: boolean;
  sections: string[];
  fields: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

export class NoteTypeTemplateManager extends EventEmitter {
  private initialized = false;
  private templates = new Map<string, string>();
  private watcher?: FSWatcher;
  private templatePath!: string; // Initialized in constructor via updateTemplatePath()

  constructor(
    private projectPath: string,
    private configManager: ConfigManager
  ) {
    super();
    this.updateTemplatePath();
  }

  private updateTemplatePath(): void {
    try {
      const config = this.configManager.getConfig();
      const customPath = config?.templates?.paths?.types;
      if (customPath) {
        this.templatePath = path.join(this.projectPath, customPath);
      } else {
        this.templatePath = path.join(this.projectPath, '_scepter', 'templates', 'types');
      }
    } catch {
      // Config not loaded yet, use default path
      this.templatePath = path.join(this.projectPath, '_scepter', 'templates', 'types');
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Update path based on config
    this.updateTemplatePath();
    
    // Load all templates
    await this.loadTemplates();
    
    this.initialized = true;
    this.emit('initialized', {
      templatesFound: Array.from(this.templates.keys()),
      templatePath: this.templatePath
    });
  }

  private async loadTemplates(): Promise<void> {
    this.templates.clear();

    // Skip loading if templates are disabled
    try {
      const config = this.configManager.getConfig();
      if (config?.templates?.enabled === false) {
        return;
      }
    } catch {
      // Config not loaded yet, proceed with loading
    }

    try {
      const files = await fs.readdir(this.templatePath);
      const templateFiles = files.filter(f => this.isTemplateFile(f));

      for (const file of templateFiles) {
        const type = path.basename(file, path.extname(file));
        try {
          const content = await fs.readFile(path.join(this.templatePath, file), 'utf-8');
          this.templates.set(type, content);
        } catch {
          // Skip files we can't read
        }
      }
    } catch (error) {
      // Template directory doesn't exist yet
      if ((error as any).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private isTemplateFile(filename: string): boolean {
    const extensions = ['.md', '.markdown', '.txt'];
    return extensions.some(ext => filename.endsWith(ext));
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getAvailableTemplates(): string[] {
    if (!this.initialized) {
      throw new Error('Not initialized');
    }
    return Array.from(this.templates.keys());
  }

  async getTemplateContent(noteType: string): Promise<string | null> {
    if (!this.initialized) {
      throw new Error('Not initialized');
    }
    
    try {
      const config = this.configManager.getConfig();
      if (config?.templates?.enabled === false) {
        return null;
      }
    } catch {
      // Config not loaded yet, proceed
    }
    
    return this.templates.get(noteType) || null;
  }

  hasTemplateForType(noteType: string): boolean {
    return this.templates.has(noteType);
  }

  async getTemplateMetadata(noteType: string): Promise<TemplateMetadata> {
    const content = this.templates.get(noteType);
    if (!content) {
      return {
        type: noteType,
        hasTemplate: false,
        sections: [],
        fields: []
      };
    }

    // Extract sections (## headers)
    const sections = Array.from(content.matchAll(/^## (.+)$/gm))
      .map(match => match[1].trim());

    // Extract fields (lines with colons) - more flexible pattern
    const fields = Array.from(content.matchAll(/^[*-]?\s*\*{0,2}([A-Za-z]+)\*{0,2}\s*:\s*/gm))
      .map(match => match[1])
      .filter((field, index, self) => self.indexOf(field) === index); // unique

    return {
      type: noteType,
      hasTemplate: true,
      sections,
      fields
    };
  }

  async startWatching(): Promise<void> {
    if (this.watcher) {
      return;
    }

    this.watcher = watch(this.templatePath, {
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: {
        stabilityThreshold: 50,
        pollInterval: 10
      }
    });

    this.watcher.on('add', async (filePath) => {
      if (this.isTemplateFile(filePath)) {
        const type = path.basename(filePath, path.extname(filePath));
        const content = await fs.readFile(filePath, 'utf-8');
        this.templates.set(type, content);
        this.emit('template-added', { type, path: filePath });
        this.emit('templateAdded', { type, path: filePath }); // Legacy event name
      }
    });

    this.watcher.on('change', async (filePath) => {
      if (this.isTemplateFile(filePath)) {
        const type = path.basename(filePath, path.extname(filePath));
        const content = await fs.readFile(filePath, 'utf-8');
        this.templates.set(type, content);
        this.emit('template-updated', { type, path: filePath });
        this.emit('templateUpdated', { type, path: filePath }); // Legacy event name
      }
    });

    this.watcher.on('unlink', (filePath) => {
      if (this.isTemplateFile(filePath)) {
        const type = path.basename(filePath, path.extname(filePath));
        this.templates.delete(type);
        this.emit('template-removed', { type, path: filePath });
        this.emit('templateRemoved', { type, path: filePath }); // Legacy event name
      }
    });
  }

  async stopWatching(): Promise<void> {
    if (this.watcher) {
      // Race chokidar close against a short timeout. See note-file-manager.ts
      // stopWatching for the macOS Sonoma fs_events teardown issue.
      const closed = this.watcher.close().catch(() => {});
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 250));
      await Promise.race([closed, timeout]);
      this.watcher = undefined;
    }
  }

  async getAllTemplateContent(): Promise<Record<string, string>> {
    if (!this.initialized) {
      throw new Error('Not initialized');
    }
    
    try {
      const config = this.configManager.getConfig();
      if (config?.templates?.enabled === false) {
        return {};
      }
    } catch {
      // Config not loaded yet, proceed
    }
    
    return Object.fromEntries(this.templates);
  }

  validateTemplate(content: string, noteType?: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!content || content.trim().length === 0) {
      errors.push('Template content is empty');
    }

    // Check for required structure
    if (!content.includes('#')) {
      warnings.push('Template has no headers');
    }

    if (noteType) {
      // Type-specific validation
      const expectedTitle = new RegExp(`^#\s+${noteType}\b`, 'im');
      if (!expectedTitle.test(content)) {
        warnings.push(`Template title doesn't match note type: ${noteType}`);
      }
      
      // Check for expected fields based on type
      if (noteType === 'Requirement') {
        if (!/^[*-]?\s*ID\s*:/mi.test(content)) {
          warnings.push('Missing expected field: ID');
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  async refresh(): Promise<void> {
    await this.loadTemplates();
    this.emit('refreshed', {
      templateCount: this.templates.size
    });
  }

  getStats(): { templateCount: number } {
    return {
      templateCount: this.templates.size
    };
  }
}