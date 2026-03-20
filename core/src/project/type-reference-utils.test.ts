import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import {
  findAllReferencesToType,
  updateReferencesForTypeRename,
  transformResultToReferenceUpdate,
  updateNoteFileNames
} from './type-reference-utils';
import { NoteMentionService } from '../services/note-mention-service';
import type { MentionLocation, TransformResult } from '../services/note-mention-service';
import type { NoteMention } from '../parsers/note/note-parser';

// Mock the NoteMentionService
vi.mock('../services/note-mention-service');

// Mock fs-extra
vi.mock('fs-extra', () => ({
  readdir: vi.fn(),
  rename: vi.fn()
}));


describe('type-reference-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('findAllReferencesToType', () => {
    it('should find references to a specific shortcode', async () => {
      const mockMentions: MentionLocation[] = [
        {
          filePath: '/project/src/file1.ts',
          line: 10,
          column: 5,
          mention: {
            id: 'D001',
            line: 10,
            context: 'This is a reference to {D001}',
            filePath: '/project/src/file1.ts'
          } as NoteMention
        },
        {
          filePath: '/project/src/file2.ts',
          line: 25,
          mention: {
            id: 'D002',
            line: 25,
            context: 'Another reference {D002: with content}',
            filePath: '/project/src/file2.ts'
          } as NoteMention
        }
      ];

      const mockService = {
        findMentionsByShortcode: vi.fn().mockResolvedValue(mockMentions)
      };
      vi.mocked(NoteMentionService).mockImplementation(() => mockService as any);

      const result = await findAllReferencesToType('D', '/project');

      expect(mockService.findMentionsByShortcode).toHaveBeenCalledWith('D');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        filePath: '/project/src/file1.ts',
        line: 10,
        column: 5,
        text: 'This is a reference to {D001}',
        referenceText: '{D001}',
        noteId: 'D001'
      });
    });

    it('should handle mentions without context', async () => {
      const mockMentions: MentionLocation[] = [
        {
          filePath: '/project/src/file1.ts',
          line: 10,
          mention: {
            id: 'D001',
            line: 10,
            filePath: '/project/src/file1.ts'
          } as NoteMention
        }
      ];

      const mockService = {
        findMentionsByShortcode: vi.fn().mockResolvedValue(mockMentions)
      };
      vi.mocked(NoteMentionService).mockImplementation(() => mockService as any);

      const result = await findAllReferencesToType('D', '/project');

      expect(result[0].text).toBe('');
    });

    it('should find all references with custom exclude patterns', async () => {
      const mockMentions: MentionLocation[] = [
        {
          filePath: '/project/src/file1.ts',
          line: 10,
          mention: {
            id: 'Q001',
            line: 10,
            context: 'Question reference {Q001}',
            filePath: '/project/src/file1.ts'
          } as NoteMention
        }
      ];

      const mockService = {
        findMentionsByShortcode: vi.fn().mockResolvedValue(mockMentions)
      };
      
      const constructorSpy = vi.fn().mockImplementation((rootPath, excludePatterns) => {
        expect(rootPath).toBe('/project');
        expect(excludePatterns).toEqual(['dist/**', 'build/**']);
        return mockService;
      });
      
      vi.mocked(NoteMentionService).mockImplementation(constructorSpy as any);

      const result = await findAllReferencesToType('Q', '/project', ['dist/**', 'build/**']);

      expect(constructorSpy).toHaveBeenCalledWith('/project', ['dist/**', 'build/**']);
      expect(mockService.findMentionsByShortcode).toHaveBeenCalledWith('Q');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        filePath: '/project/src/file1.ts',
        line: 10,
        column: undefined,
        text: 'Question reference {Q001}',
        referenceText: '{Q001}',
        noteId: 'Q001'
      });
    });

    it('should use default exclude patterns when not provided', async () => {
      const mockService = {
        findMentionsByShortcode: vi.fn().mockResolvedValue([])
      };
      
      const constructorSpy = vi.fn().mockImplementation((rootPath, excludePatterns) => {
        expect(excludePatterns).toEqual(['node_modules/**', '**/*.{png,jpg,jpeg,gif,ico,pdf,zip}']);
        return mockService;
      });
      
      vi.mocked(NoteMentionService).mockImplementation(constructorSpy as any);

      await findAllReferencesToType('M', '/project');

      expect(constructorSpy).toHaveBeenCalled();
    });

    it('should handle complex mention formats', async () => {
      const mockMentions: MentionLocation[] = [
        {
          filePath: '/project/src/complex.ts',
          line: 15,
          column: 20,
          mention: {
            id: 'D001',
            line: 15,
            context: 'Complex mention {D001+>#tag1,tag2: with content}',
            filePath: '/project/src/complex.ts',
            inclusionModifiers: {
              content: true,
              outgoingReferences: true
            },
            tagExtensions: ['tag1', 'tag2'],
            contentExtension: 'with content'
          } as NoteMention
        }
      ];

      const mockService = {
        findMentionsByShortcode: vi.fn().mockResolvedValue(mockMentions)
      };
      vi.mocked(NoteMentionService).mockImplementation(() => mockService as any);

      const result = await findAllReferencesToType('D', '/project');

      expect(result[0]).toEqual({
        filePath: '/project/src/complex.ts',
        line: 15,
        column: 20,
        text: 'Complex mention {D001+>#tag1,tag2: with content}',
        referenceText: '{D001}',
        noteId: 'D001'
      });
    });
  });

  describe('updateReferencesForTypeRename', () => {
    it('should update references and apply transforms', async () => {
      const mockTransformResults: TransformResult[] = [
        {
          filePath: '/project/src/file1.ts',
          originalContent: 'Reference to {D001}',
          updatedContent: 'Reference to {DEC001}',
          transformCount: 1,
          mentions: []
        },
        {
          filePath: '/project/src/file2.ts',
          originalContent: 'Multiple {D002} and {D003}',
          updatedContent: 'Multiple {DEC002} and {DEC003}',
          transformCount: 2,
          mentions: []
        }
      ];

      const mockService = {
        transformShortcode: vi.fn().mockResolvedValue(mockTransformResults),
        applyTransforms: vi.fn().mockResolvedValue(undefined)
      };
      vi.mocked(NoteMentionService).mockImplementation(() => mockService as any);

      const result = await updateReferencesForTypeRename('/project', 'D', 'DEC');

      expect(mockService.transformShortcode).toHaveBeenCalledWith('D', 'DEC');
      expect(mockService.applyTransforms).toHaveBeenCalledWith(mockTransformResults, { createBackup: true });
      expect(result).toEqual(mockTransformResults);
    });

    it('should handle empty transform results', async () => {
      const mockService = {
        transformShortcode: vi.fn().mockResolvedValue([]),
        applyTransforms: vi.fn().mockResolvedValue(undefined)
      };
      vi.mocked(NoteMentionService).mockImplementation(() => mockService as any);

      const result = await updateReferencesForTypeRename('/project', 'X', 'Y');

      expect(mockService.transformShortcode).toHaveBeenCalledWith('X', 'Y');
      expect(mockService.applyTransforms).toHaveBeenCalledWith([], { createBackup: true });
      expect(result).toEqual([]);
    });

    it('should propagate errors from NoteMentionService', async () => {
      const mockError = new Error('Transform failed');
      const mockService = {
        transformShortcode: vi.fn().mockRejectedValue(mockError),
        applyTransforms: vi.fn()
      };
      vi.mocked(NoteMentionService).mockImplementation(() => mockService as any);

      await expect(updateReferencesForTypeRename('/project', 'D', 'DEC'))
        .rejects.toThrow('Transform failed');
      
      expect(mockService.applyTransforms).not.toHaveBeenCalled();
    });
  });

  describe('transformResultToReferenceUpdate', () => {
    it('should convert TransformResult to ReferenceUpdate format', () => {
      const transformResult: TransformResult = {
        filePath: '/project/src/file.ts',
        originalContent: 'Original content with {D001}',
        updatedContent: 'Original content with {DEC001}',
        transformCount: 1,
        mentions: []
      };

      const result = transformResultToReferenceUpdate(transformResult);

      expect(result).toEqual({
        filePath: '/project/src/file.ts',
        originalContent: 'Original content with {D001}',
        updatedContent: 'Original content with {DEC001}',
        updateCount: 1
      });
    });

    it('should handle zero transform count', () => {
      const transformResult: TransformResult = {
        filePath: '/project/src/file.ts',
        originalContent: 'No references here',
        updatedContent: 'No references here',
        transformCount: 0,
        mentions: []
      };

      const result = transformResultToReferenceUpdate(transformResult);

      expect(result.updateCount).toBe(0);
    });
  });

  describe('updateNoteFileNames', () => {
    it('should rename note files with matching shortcode', async () => {
      const mockFiles = ['D001 Decision One.md', 'D002 Decision Two.md', 'Q001 Question.md', 'README.md'];
      
      vi.mocked(fs.readdir).mockResolvedValue(mockFiles as any);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      const result = await updateNoteFileNames('/project/notes', 'D', 'DEC');

      expect(fs.readdir).toHaveBeenCalledWith('/project/notes');
      expect(fs.rename).toHaveBeenCalledTimes(2);
      expect(fs.rename).toHaveBeenCalledWith(
        '/project/notes/D001 Decision One.md',
        '/project/notes/DEC001 Decision One.md'
      );
      expect(fs.rename).toHaveBeenCalledWith(
        '/project/notes/D002 Decision Two.md',
        '/project/notes/DEC002 Decision Two.md'
      );
      
      expect(result).toEqual([
        {
          oldPath: '/project/notes/D001 Decision One.md',
          newPath: '/project/notes/DEC001 Decision One.md'
        },
        {
          oldPath: '/project/notes/D002 Decision Two.md',
          newPath: '/project/notes/DEC002 Decision Two.md'
        }
      ]);
    });

    it('should handle files without titles', async () => {
      const mockFiles = ['D001.md', 'D002 With Title.md'];
      
      vi.mocked(fs.readdir).mockResolvedValue(mockFiles as any);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      const result = await updateNoteFileNames('/project/notes', 'D', 'DEC');

      expect(result).toHaveLength(2);
      expect(fs.rename).toHaveBeenCalledTimes(2);
      expect(fs.rename).toHaveBeenNthCalledWith(
        1,
        '/project/notes/D001.md',
        '/project/notes/DEC001.md'
      );
      expect(fs.rename).toHaveBeenNthCalledWith(
        2,
        '/project/notes/D002 With Title.md',
        '/project/notes/DEC002 With Title.md'
      );
    });

    it('should handle different ID lengths', async () => {
      const mockFiles = ['D001 Three.md', 'D0001 Four.md', 'D00001 Five.md'];
      
      vi.mocked(fs.readdir).mockResolvedValue(mockFiles as any);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      const result = await updateNoteFileNames('/project/notes', 'D', 'DEC');

      expect(fs.rename).toHaveBeenCalledTimes(3);
      expect(result).toHaveLength(3);
    });

    it('should not rename files that do not match the pattern', async () => {
      const mockFiles = ['README.md', 'notes.txt', 'D-001 Wrong Format.md', 'XD001 Not Match.md'];
      
      vi.mocked(fs.readdir).mockResolvedValue(mockFiles as any);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      const result = await updateNoteFileNames('/project/notes', 'D', 'DEC');

      expect(fs.rename).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should handle empty directory', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const result = await updateNoteFileNames('/project/notes', 'D', 'DEC');

      expect(result).toEqual([]);
    });

    it('should propagate fs errors', async () => {
      vi.mocked(fs.readdir).mockRejectedValue(new Error('Permission denied'));

      await expect(updateNoteFileNames('/project/notes', 'D', 'DEC'))
        .rejects.toThrow('Permission denied');
    });

    it('should handle rename errors gracefully', async () => {
      const mockFiles = ['D001 File.md'];
      
      vi.mocked(fs.readdir).mockResolvedValue(mockFiles as any);
      vi.mocked(fs.rename).mockRejectedValue(new Error('File in use'));

      await expect(updateNoteFileNames('/project/notes', 'D', 'DEC'))
        .rejects.toThrow('File in use');
    });
  });

  describe('integration scenarios', () => {
    it('should handle a complete type rename workflow', async () => {
      // Setup mock data for complete workflow
      const mockMentions: MentionLocation[] = [
        {
          filePath: '/project/src/index.ts',
          line: 10,
          mention: {
            id: 'D001',
            line: 10,
            context: 'See decision {D001}',
            filePath: '/project/src/index.ts'
          } as NoteMention
        }
      ];

      const mockTransformResults: TransformResult[] = [
        {
          filePath: '/project/src/index.ts',
          originalContent: 'See decision {D001}',
          updatedContent: 'See decision {DEC001}',
          transformCount: 1,
          mentions: mockMentions
        }
      ];

      // Mock service
      const mockService = {
        findMentionsByShortcode: vi.fn().mockResolvedValue(mockMentions),
        transformShortcode: vi.fn().mockResolvedValue(mockTransformResults),
        applyTransforms: vi.fn().mockResolvedValue(undefined)
      };
      vi.mocked(NoteMentionService).mockImplementation(() => mockService as any);

      // Mock fs operations
      vi.mocked(fs.readdir).mockResolvedValue(['D001 Decision.md'] as any);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      // Execute workflow
      const references = await findAllReferencesToType('D', '/project');
      expect(references).toHaveLength(1);

      const transformResults = await updateReferencesForTypeRename('/project', 'D', 'DEC');
      expect(transformResults).toHaveLength(1);

      const renames = await updateNoteFileNames('/project/notes', 'D', 'DEC');
      expect(renames).toHaveLength(1);
    });
  });
});