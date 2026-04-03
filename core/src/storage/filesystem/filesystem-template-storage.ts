/**
 * Filesystem adapter for template retrieval.
 *
 * Extracts the filesystem I/O from NoteTypeTemplateManager.loadTemplates().
 * After extraction, NoteTypeTemplateManager receives template content via the
 * TemplateStorage interface instead of reading files directly.
 *
 * @implements {A002.§3.AC.03} Filesystem adapter for TemplateStorage
 * @implements {DD010.§DC.11} FilesystemTemplateStorage wraps NoteTypeTemplateManager I/O
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { TemplateStorage } from '../storage-backend';
import type { ConfigManager } from '../../config/config-manager';

const TEMPLATE_EXTENSIONS = ['.md', '.markdown', '.txt'];

export class FilesystemTemplateStorage implements TemplateStorage {
  constructor(
    private projectPath: string,
    private configManager: ConfigManager,
  ) {}

  private getTemplatePath(): string {
    try {
      const config = this.configManager.getConfig();
      const customPath = config?.templates?.paths?.types;
      if (customPath) {
        return path.join(this.projectPath, customPath);
      }
    } catch {
      // Config not loaded yet, use default path
    }
    return path.join(this.projectPath, '_scepter', 'templates', 'types');
  }

  private isTemplateFile(filename: string): boolean {
    return TEMPLATE_EXTENSIONS.some(ext => filename.endsWith(ext));
  }

  async getTemplate(noteType: string): Promise<string | null> {
    const templateDir = this.getTemplatePath();

    for (const ext of TEMPLATE_EXTENSIONS) {
      const filePath = path.join(templateDir, `${noteType}${ext}`);
      try {
        return await fs.readFile(filePath, 'utf-8');
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          continue;
        }
        throw error;
      }
    }

    return null;
  }

  async listTemplates(): Promise<string[]> {
    const templateDir = this.getTemplatePath();

    try {
      const files = await fs.readdir(templateDir);
      return files
        .filter(f => this.isTemplateFile(f))
        .map(f => path.basename(f, path.extname(f)));
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }
}
