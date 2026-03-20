// ProjectTemplateManager - Manages copying boilerplate to new projects

import * as fs from 'fs/promises';
import * as fse from 'fs-extra';
import * as path from 'path';
import { glob } from 'glob';

export interface ProjectTemplateConfig {
  sourcePath?: string;
  exclude?: string[];
  overwrite?: boolean;
  dryRun?: boolean;
}

export interface CopyResult {
  success: boolean;
  copiedFiles: string[];
  skippedFiles: string[];
  overwrittenFiles: string[];
  warnings?: string[];
  error?: {
    message: string;
    code?: string;
  };
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export class ProjectTemplateManager {
  constructor(private boilerplatesPath: string = './boilerplates') {}

  /**
   * List available boilerplate names
   */
  async getAvailableBoilerplates(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.boilerplatesPath, { withFileTypes: true });
      return entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Initialize a project with a named boilerplate
   */
  async initializeProject(projectPath: string, boilerplateName: string): Promise<void> {
    const boilerplatePath = path.join(this.boilerplatesPath, boilerplateName);
    
    // Check if boilerplate exists
    try {
      await fs.access(boilerplatePath);
    } catch {
      throw new Error(`Boilerplate not found: ${boilerplateName}`);
    }

    // Copy boilerplate to _scepter directory
    const targetScepterPath = path.join(projectPath, '_scepter');
    const result = await this.copyToProject(targetScepterPath, {
      sourcePath: boilerplatePath,
      overwrite: false
    });

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to copy boilerplate');
    }

    // Update config with project info
    await this.updateProjectConfig(targetScepterPath, path.basename(projectPath));
  }

  /**
   * Update config with project-specific values
   */
  private async updateProjectConfig(scepterPath: string, projectName: string): Promise<void> {
    const configPath = path.join(scepterPath, 'scepter.config.json');
    
    try {
      const config = await fse.readJson(configPath);
      
      // Update project info
      if (!config.project) {
        config.project = {};
      }
      config.project.name = projectName;
      config.project.createdAt = new Date().toISOString();
      
      await fse.writeJson(configPath, config, { spaces: 2 });
    } catch (error) {
      // Config might not exist in minimal boilerplates
      const defaultConfig = {
        project: {
          name: projectName,
          createdAt: new Date().toISOString()
        }
      };
      await fse.writeJson(configPath, defaultConfig, { spaces: 2 });
    }
  }

  async copyToProject(targetPath: string, options?: ProjectTemplateConfig): Promise<CopyResult> {
    const result: CopyResult = {
      success: false,
      copiedFiles: [],
      skippedFiles: [],
      overwrittenFiles: [],
      warnings: []
    };

    try {
      // sourcePath is required - no default boilerplate path
      if (!options?.sourcePath) {
        result.error = {
          message: 'Source path is required',
          code: 'SOURCE_PATH_REQUIRED'
        };
        return result;
      }
      
      const source = options.sourcePath;
      
      // Validate source exists
      try {
        await fs.access(source);
      } catch {
        result.error = {
          message: `Source path does not exist: ${source}`,
          code: 'SOURCE_NOT_FOUND'
        };
        return result;
      }

      // Get all files from source
      const allFiles = await glob('**/*', {
        cwd: source,
        nodir: true,
        dot: true,
        follow: false // Don't follow symlinks to avoid circular references
      });

      // Filter by exclude patterns
      const files = allFiles.filter(file => {
        if (!options?.exclude) return true;
        
        return !options.exclude.some(pattern => {
          // Handle directory patterns like 'templates/'
          if (pattern.endsWith('/')) {
            const dirPattern = pattern.slice(0, -1);
            return file.includes(dirPattern + '/');
          }
          // Handle exact matches
          return file === pattern || file.endsWith('/' + pattern);
        });
      });

      // Track skipped files due to exclusion
      const excludedFiles = allFiles.filter(file => !files.includes(file));
      result.skippedFiles.push(...excludedFiles);

      // Copy each file
      for (const file of files) {
        const sourcePath = path.join(source, file);
        const targetFilePath = path.join(targetPath, file);
        const targetDir = path.dirname(targetFilePath);

        // Check if source is a symlink
        try {
          const stats = await fs.lstat(sourcePath);
          if (stats.isSymbolicLink()) {
            // Check if it's circular
            try {
              const linkTarget = await fs.realpath(sourcePath);
              if (linkTarget.startsWith(source)) {
                result.warnings = result.warnings || [];
                result.warnings.push('Skipped circular symlink');
                continue;
              }
            } catch {
              // Broken symlink
              result.warnings = result.warnings || [];
              result.warnings.push(`Skipped broken symlink: ${file}`);
              continue;
            }
          }
        } catch (error) {
          // Skip files we can't stat
          continue;
        }

        // Check if target exists
        let targetExists = false;
        try {
          await fs.access(targetFilePath);
          targetExists = true;
        } catch {}

        if (targetExists && !options?.overwrite) {
          if (!result.skippedFiles.includes(file)) {
            result.skippedFiles.push(file);
          }
          continue;
        }

        if (options?.dryRun) {
          if (targetExists) {
            result.overwrittenFiles.push(file);
          } else {
            result.copiedFiles.push(file);
          }
          continue;
        }

        // Create target directory
        await fs.mkdir(targetDir, { recursive: true });

        // Copy file
        await fs.copyFile(sourcePath, targetFilePath);

        if (targetExists) {
          result.overwrittenFiles.push(file);
        } else {
          result.copiedFiles.push(file);
        }
      }

      result.success = true;
    } catch (error) {
      result.error = {
        message: error instanceof Error ? error.message : 'Unknown error',
        code: 'COPY_ERROR'
      };
    }

    return result;
  }

  async getAvailableTemplates(): Promise<string[]> {
    // This method is deprecated in favor of getAvailableBoilerplates
    return this.getAvailableBoilerplates();
  }

  async validateBoilerplate(boilerplatePath?: string): Promise<ValidationResult> {
    const errors: string[] = [];
    const pathToValidate = boilerplatePath || this.boilerplatesPath;

    try {
      await fs.access(pathToValidate);
    } catch {
      errors.push(`Boilerplate path does not exist: ${pathToValidate}`);
    }

    if (errors.length === 0) {
      // Check for required files and directories
      try {
        await fs.access(path.join(pathToValidate, 'scepter.config.js'));
      } catch {
        errors.push('Missing scepter.config.js');
      }

      try {
        const scepterStats = await fs.stat(path.join(pathToValidate, '_scepter'));
        if (!scepterStats.isDirectory()) {
          errors.push('_scepter exists but is not a directory');
        }
      } catch {
        errors.push('Missing _scepter directory');
      }

      // Check config syntax if file exists
      if (!errors.some(e => e.includes('scepter.config.js'))) {
        try {
          const configPath = path.join(pathToValidate, 'scepter.config.js');
          const configContent = await fs.readFile(configPath, 'utf-8');
          // Basic syntax check
          new Function(configContent);
        } catch {
          errors.push('Invalid scepter.config.js syntax');
        }
      }

      // Optional: Check for template subdirectories (not required for valid boilerplate)
      // These will be created when templates are added
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  async getBoilerplateConfig(boilerplatePath?: string): Promise<any> {
    try {
      const pathToUse = boilerplatePath || this.boilerplatesPath;
      const configPath = path.join(pathToUse, 'scepter.config.js');
      const content = await fs.readFile(configPath, 'utf-8');
      
      // Create a sandboxed environment to evaluate the config
      const sandbox = {
        module: { exports: {} },
        exports: {},
        require: () => ({}), // Mock require for safety
        __dirname: path.dirname(configPath),
        __filename: configPath
      };
      
      // Evaluate the config
      const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', content);
      fn(sandbox.module, sandbox.exports, sandbox.require, sandbox.__dirname, sandbox.__filename);
      
      const result = sandbox.module.exports || sandbox.exports;
      // Return null if the config is empty or invalid
      if (!result || typeof result !== 'object' || Object.keys(result).length === 0) {
        return null;
      }
      return result;
    } catch {
      return null;
    }
  }
}