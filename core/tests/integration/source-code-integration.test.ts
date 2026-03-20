import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import fs from 'fs-extra';
import * as path from 'path';
import { ProjectManager } from '../../src/project/project-manager';
import { ConfigManager } from '../../src/config/config-manager';
import type { SCEpterConfig } from '../../src/types/config';

describe('Source Code Integration', () => {
  const testDir = path.join(process.cwd(), '.test-tmp', 'scepter-source-test');
  const projectPath = path.join(testDir, 'test-project');
  let projectManager: ProjectManager;

  beforeEach(async () => {
    // Clean up and create test directory
    await fs.remove(testDir);
    await fs.ensureDir(projectPath);

    // Create test config with source code integration enabled
    const config: Partial<SCEpterConfig> = {
      noteTypes: {
        Question: { shortcode: 'Q', folder: 'questions' },
        Decision: { shortcode: 'D', folder: 'decisions' },
        Task: { shortcode: 'T', folder: 'tasks' },
      },

      sourceCodeIntegration: {
        enabled: true,
        folders: ['src', 'tests'],
        exclude: ['node_modules/**', '**/*.test.js'],
        extensions: ['.js', '.ts', '.py'],
      },
    };

    // Write config file as JSON in the expected location
    await fs.ensureDir(path.join(projectPath, '_scepter'));
    await fs.writeFile(path.join(projectPath, '_scepter/scepter.config.json'), JSON.stringify(config, null, 2));

    // Create source directories
    await fs.ensureDir(path.join(projectPath, 'src'));
    await fs.ensureDir(path.join(projectPath, 'tests'));
    await fs.ensureDir(path.join(projectPath, '_scepter/notes/questions'));
    await fs.ensureDir(path.join(projectPath, '_scepter/notes/decisions'));

    projectManager = new ProjectManager(projectPath);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  it('should discover and index source code references', async () => {
    // Create some notes
    await fs.writeFile(
      path.join(projectPath, '_scepter/notes/questions/Q001.md'),
      '# Q001 - How to implement authentication?\n\nContent here.',
    );

    await fs.writeFile(
      path.join(projectPath, '_scepter/notes/decisions/D001.md'),
      '# D001 - Use JWT tokens\n\nContent here.',
    );

    // Create source files with references
    await fs.writeFile(
      path.join(projectPath, 'src/auth.js'),
      `// @implements {Q001}
export function authenticate(user) {
  // Implementation based on {D001}
  return generateJWT(user);
}`,
    );

    await fs.writeFile(
      path.join(projectPath, 'src/utils.js'),
      `// Utility functions
// @see {D001} for authentication approach
export function validateToken(token) {
  return true;
}`,
    );

    // Load config from filesystem first
    await projectManager.configManager.loadConfigFromFilesystem();

    // Initialize project manager
    await projectManager.initialize();

    // Verify source scanner is initialized
    expect(projectManager.sourceScanner).toBeDefined();

    // Get references to Q001
    const q001Refs = projectManager.sourceScanner!.getReferencesToNote('Q001');
    expect(q001Refs).toHaveLength(1);
    expect(q001Refs[0]).toMatchObject({
      toId: 'Q001',
      filePath: path.join(projectPath, 'src/auth.js'),
      referenceType: 'implements',
      line: 1,
    });

    // Get references from auth.js
    const authRefs = projectManager.sourceScanner!.getReferencesFromFile(path.join(projectPath, 'src/auth.js'));
    expect(authRefs).toHaveLength(2);
    expect(authRefs.map((r) => r.toId)).toContain('Q001');
    expect(authRefs.map((r) => r.toId)).toContain('D001');

    // Verify reference manager integration
    const refManager = projectManager.referenceManager;
    const allQ001Refs = refManager.getReferencesTo('Q001', true);

    // Should include source references
    expect(allQ001Refs.some((r) => r.sourceType === 'source')).toBe(true);

    // Check reference counts
    const counts = refManager.getReferenceCounts('D001');
    expect(counts.source).toBe(2); // Referenced in both auth.js and utils.js
    expect(counts.total).toBeGreaterThanOrEqual(2);
  });

  it('should handle Python files correctly', async () => {
    await fs.writeFile(
      path.join(projectPath, '_scepter/notes/questions/Q002.md'),
      '# Q002 - How to process data?\n\nContent here.',
    );

    await fs.writeFile(
      path.join(projectPath, 'src/processor.py'),
      `# Data processing module
# @addresses {Q002}

def process_data(data):
    """
    Process data according to specification {Q002}
    """
    return data
`,
    );

    // Load config from filesystem first
    await projectManager.configManager.loadConfigFromFilesystem();

    await projectManager.initialize();

    const pythonRefs = projectManager.sourceScanner!.getReferencesFromFile(path.join(projectPath, 'src/processor.py'));

    expect(pythonRefs).toHaveLength(2);
    expect(pythonRefs[0]).toMatchObject({
      toId: 'Q002',
      language: 'python',
      referenceType: 'addresses',
      line: 2,
    });
  });

  it('should respect exclude patterns', async () => {
    // Create file in excluded pattern
    await fs.writeFile(path.join(projectPath, 'src/auth.test.js'), '// Test file with {Q001} reference');

    // Create file in node_modules (excluded)
    await fs.ensureDir(path.join(projectPath, 'node_modules'));
    await fs.writeFile(path.join(projectPath, 'node_modules/lib.js'), '// Library with {Q001} reference');

    // Load config from filesystem first
    await projectManager.configManager.loadConfigFromFilesystem();

    await projectManager.initialize();

    // Should not find references from excluded files
    const testRefs = projectManager.sourceScanner!.getReferencesFromFile(path.join(projectPath, 'src/auth.test.js'));
    expect(testRefs).toHaveLength(0);

    const nodeModulesRefs = projectManager.sourceScanner!.getReferencesFromFile(
      path.join(projectPath, 'node_modules/lib.js'),
    );
    expect(nodeModulesRefs).toHaveLength(0);
  });

  it('should handle disabled source code integration', async () => {
    // Create new project without source code integration
    const disabledPath = path.join(process.cwd(), '.test-tmp', 'disabled-project');
    await fs.ensureDir(disabledPath);

    const config: Partial<SCEpterConfig> = {
      noteTypes: {
        Question: { shortcode: 'Q', folder: 'questions' },
      },

      sourceCodeIntegration: {
        enabled: false,
        folders: [],
        exclude: [],
        extensions: [],
      },
    };

    await fs.ensureDir(path.join(disabledPath, '_scepter'));
    await fs.writeFile(path.join(disabledPath, '_scepter/scepter.config.json'), JSON.stringify(config, null, 2));

    const pm = new ProjectManager(disabledPath);

    // Load config from filesystem first
    await pm.configManager.loadConfigFromFilesystem();

    await pm.initialize();

    expect(pm.sourceScanner).toBeUndefined();
  });
});
