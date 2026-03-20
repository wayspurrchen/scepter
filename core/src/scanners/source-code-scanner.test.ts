import { beforeEach, describe, it, expect, vi } from 'vitest';
import fs from 'fs-extra';
import * as path from 'path';
import { SourceCodeScanner } from './source-code-scanner.js';
import { ConfigManager } from '../config/config-manager.js';
import type { SourceCodeIntegrationConfig } from '../types/config.js';

// Mock modules
vi.mock('fs-extra', () => ({
  default: {
    stat: vi.fn(),
    readFile: vi.fn(),
    pathExists: vi.fn(),
    readdir: vi.fn(),
    ensureDir: vi.fn(),
    access: vi.fn(),
  },
  stat: vi.fn(),
  readFile: vi.fn(),
  pathExists: vi.fn(),
  readdir: vi.fn(),
  ensureDir: vi.fn(),
  access: vi.fn(),
}));
vi.mock('chokidar');
vi.mock('glob', () => ({
  glob: vi.fn().mockResolvedValue([]),
}));

describe('SourceCodeScanner', () => {
  const projectPath = '/test/project';
  let scanner: SourceCodeScanner;
  let configManager: ConfigManager;
  let mockConfig: { sourceCodeIntegration: SourceCodeIntegrationConfig };

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      sourceCodeIntegration: {
        enabled: true,
        folders: ['src', 'lib'],
        exclude: ['node_modules', '*.test.ts'],
        extensions: ['.js', '.ts', '.py'],
      },
    };

    configManager = new ConfigManager(projectPath);
    vi.spyOn(configManager, 'getConfig').mockReturnValue(mockConfig as any);

    scanner = new SourceCodeScanner(projectPath, configManager);
  });

  describe('initialization', () => {
    it('should initialize when source code integration is enabled', async () => {
      // Mock file discovery
      const { glob } = await import('glob');
      (glob as any).mockResolvedValue([]);
      (fs as any).stat.mockResolvedValue({ mtime: new Date() } as any);
      (fs as any).readFile.mockResolvedValue('// Some code');

      await scanner.initialize();

      expect(scanner.isReady()).toBe(true);
    });

    it('should throw when source code integration is disabled', async () => {
      mockConfig.sourceCodeIntegration.enabled = false;

      await expect(scanner.initialize()).rejects.toThrow('Source code integration is not enabled');
    });
  });

  describe('file scanning', () => {
    beforeEach(async () => {
      await scanner.initialize();
    });

    it('should extract note references from JavaScript files', async () => {
      // Initialize scanner first
      const { glob } = await import('glob');
      (glob as any).mockResolvedValue([]);
      await scanner.initialize();

      const filePath = '/test/project/src/example.js';
      const fileContent = `
        // This implements {Q001}
        function doSomething() {
          // See {D002} for details
          return 42;
        }
      `;

      (fs as any).stat.mockResolvedValue({
        mtime: new Date(),
        isFile: () => true,
      } as any);
      (fs as any).readFile.mockResolvedValue(fileContent);

      const references = await scanner.scanFile(filePath);

      expect(references).toHaveLength(2);
      // Debug what we got
      console.log('First reference:', references[0]);

      expect(references[0]).toMatchObject({
        toId: 'Q001',
        filePath,
        language: 'javascript',
        referenceType: 'implements',
        line: 2,
      });
      expect(references[1]).toMatchObject({
        toId: 'D002',
        filePath,
        language: 'javascript',
        referenceType: 'see',
        line: 4,
      });
    });

    it('should extract note references from Python files', async () => {
      // Initialize scanner first
      const { glob } = await import('glob');
      (glob as any).mockResolvedValue([]);
      await scanner.initialize();

      const filePath = '/test/project/lib/example.py';
      const fileContent = `
# This module addresses {T001}
def process_data():
    """
    Process data according to {S002}
    """
    pass
      `;

      (fs as any).stat.mockResolvedValue({
        mtime: new Date(),
        isFile: () => true,
      } as any);
      (fs as any).readFile.mockResolvedValue(fileContent);

      const references = await scanner.scanFile(filePath);

      expect(references).toHaveLength(2);
      expect(references[0]).toMatchObject({
        toId: 'T001',
        filePath,
        language: 'python',
        referenceType: 'addresses',
        line: 2,
      });
      expect(references[1]).toMatchObject({
        toId: 'S002',
        filePath,
        language: 'python',
        referenceType: 'mentions',
        line: 5,
      });
    });

    it('should cache scan results based on file modification time', async () => {
      // Initialize scanner first
      const { glob } = await import('glob');
      (glob as any).mockResolvedValue([]);
      await scanner.initialize();

      const filePath = '/test/project/src/cached.js';
      const mtime = new Date();

      (fs as any).stat.mockResolvedValue({
        mtime,
        isFile: () => true,
      } as any);
      (fs as any).readFile.mockResolvedValue('// {Q001}');

      // First scan
      await scanner.scanFile(filePath);

      // Second scan with same mtime - should use cache
      await scanner.scanFile(filePath);

      // readFile should only be called once
      expect((fs as any).readFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('reference queries', () => {
    beforeEach(async () => {
      const { glob } = await import('glob');
      (glob as any).mockResolvedValue([]);
      await scanner.initialize();

      // Mock some references - put each on separate lines for better parsing
      const files = {
        '/test/project/src/a.js': '// {Q001}\n// {D002}',
        '/test/project/src/b.js': '// {Q001}\n// {T003}',
        '/test/project/lib/c.py': '# {D002}',
      };

      for (const [filePath, content] of Object.entries(files)) {
        (fs as any).stat.mockResolvedValue({
          mtime: new Date(),
          isFile: () => true,
        } as any);
        (fs as any).readFile.mockResolvedValue(content);
        await scanner.scanFile(filePath);
      }
    });

    it('should find all references to a note', () => {
      const refs = scanner.getReferencesToNote('Q001');

      expect(refs).toHaveLength(2);
      expect(refs.map((r) => r.filePath)).toContain('/test/project/src/a.js');
      expect(refs.map((r) => r.filePath)).toContain('/test/project/src/b.js');
    });

    it('should find all references from a file', () => {
      const refs = scanner.getReferencesFromFile('/test/project/src/a.js');

      expect(refs).toHaveLength(2);
      expect(refs.map((r) => r.toId)).toContain('Q001');
      expect(refs.map((r) => r.toId)).toContain('D002');
    });

    it('should handle relative file paths', () => {
      const refs = scanner.getReferencesFromFile('src/a.js');

      expect(refs).toHaveLength(2);
    });
  });

  describe('statistics', () => {
    it('should track scanning statistics', async () => {
      const { glob } = await import('glob');
      (glob as any).mockResolvedValue([]);
      await scanner.initialize();

      const files = ['/test/project/src/a.js', '/test/project/src/b.js', '/test/project/lib/c.py'];

      for (const filePath of files) {
        (fs as any).stat.mockResolvedValue({
          mtime: new Date(),
          isFile: () => true,
        } as any);
        (fs as any).readFile.mockResolvedValue(`// {Q00${files.indexOf(filePath) + 1}}`);
        await scanner.scanFile(filePath);
      }

      const stats = scanner.getStats();

      expect(stats.totalFiles).toBe(3);
      expect(stats.totalNotes).toBe(3);
      expect(stats.totalReferences).toBe(3);
    });
  });

  describe('event handling', () => {
    it('should emit events for reference discovery', async () => {
      const { glob } = await import('glob');
      (glob as any).mockResolvedValue([]);
      await scanner.initialize();

      const referenceFoundHandler = vi.fn();
      scanner.on('reference:found', referenceFoundHandler);

      (fs as any).stat.mockResolvedValue({
        mtime: new Date(),
        isFile: () => true,
      } as any);
      (fs as any).readFile.mockResolvedValue('// {Q001}');

      await scanner.scanFile('/test/project/src/test.js');

      expect(referenceFoundHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          toId: 'Q001',
          filePath: '/test/project/src/test.js',
        }),
      );
    });

    it('should emit scan complete event', async () => {
      const { glob } = await import('glob');
      (glob as any).mockResolvedValue([]);
      await scanner.initialize();

      const scanCompleteHandler = vi.fn();
      scanner.on('scan:complete', scanCompleteHandler);

      // Mock glob to return test files for scanAllFiles
      (glob as any).mockResolvedValue(['src/test.js']);
      (fs as any).stat.mockResolvedValue({
        mtime: new Date(),
        isFile: () => true,
      } as any);
      (fs as any).readFile.mockResolvedValue('// {Q001}');

      const result = await scanner.scanAllFiles();

      expect(scanCompleteHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          filesScanned: expect.any(Number),
          referencesFound: expect.any(Number),
        }),
        expect.any(Array), // errors array
      );
    });
  });
});
