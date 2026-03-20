import { describe, it, expect } from 'vitest';
import {
  addTagToReference,
  removeTagFromReference,
  referenceHasTag,
  extractTagsFromReference,
  addTagToAllReferences,
  removeTagFromAllReferences
} from './reference-tag-utils';

describe('reference-tag-utils', () => {
  describe('addTagToReference', () => {
    it('should add tag to simple reference', () => {
      expect(addTagToReference('{D001}', 'deleted')).toBe('{D001#deleted}');
    });

    it('should add tag to reference with modifiers', () => {
      expect(addTagToReference('{D001+>}', 'deleted')).toBe('{D001+>#deleted}');
      expect(addTagToReference('{R042$}', 'deleted')).toBe('{R042$#deleted}');
    });

    it('should add tag to reference with existing tags', () => {
      expect(addTagToReference('{D001#important}', 'deleted')).toBe('{D001#important,deleted}');
      expect(addTagToReference('{D001#tag1,tag2}', 'deleted')).toBe('{D001#tag1,tag2,deleted}');
    });

    it('should not duplicate existing tag', () => {
      expect(addTagToReference('{D001#deleted}', 'deleted')).toBe('{D001#deleted}');
      expect(addTagToReference('{D001#important,deleted}', 'deleted')).toBe('{D001#important,deleted}');
    });

    it('should handle references with content extensions', () => {
      expect(addTagToReference('{D001}: Some content', 'deleted')).toBe('{D001#deleted}: Some content');
      expect(addTagToReference('{D001#tag1}: Content', 'deleted')).toBe('{D001#tag1,deleted}: Content');
    });

    it('should handle multi-character shortcodes', () => {
      expect(addTagToReference('{ARCH001}', 'deleted')).toBe('{ARCH001#deleted}');
      expect(addTagToReference('{US12345+>}', 'deleted')).toBe('{US12345+>#deleted}');
    });

    it('should return unchanged for invalid references', () => {
      expect(addTagToReference('Not a reference', 'deleted')).toBe('Not a reference');
      expect(addTagToReference('[D001]', 'deleted')).toBe('[D001]');
    });
  });

  describe('removeTagFromReference', () => {
    it('should remove tag from reference', () => {
      expect(removeTagFromReference('{D001#deleted}', 'deleted')).toBe('{D001}');
    });

    it('should remove tag from reference with modifiers', () => {
      expect(removeTagFromReference('{D001+>#deleted}', 'deleted')).toBe('{D001+>}');
    });

    it('should remove tag from multiple tags', () => {
      expect(removeTagFromReference('{D001#important,deleted}', 'deleted')).toBe('{D001#important}');
      expect(removeTagFromReference('{D001#deleted,important}', 'deleted')).toBe('{D001#important}');
      expect(removeTagFromReference('{D001#tag1,deleted,tag2}', 'deleted')).toBe('{D001#tag1,tag2}');
    });

    it('should return unchanged if tag not present', () => {
      expect(removeTagFromReference('{D001#other}', 'deleted')).toBe('{D001#other}');
      expect(removeTagFromReference('{D001}', 'deleted')).toBe('{D001}');
    });

    it('should handle content extensions', () => {
      expect(removeTagFromReference('{D001#deleted}: Content', 'deleted')).toBe('{D001}: Content');
      expect(removeTagFromReference('{D001#tag1,deleted}: Content', 'deleted')).toBe('{D001#tag1}: Content');
    });
  });

  describe('referenceHasTag', () => {
    it('should detect tag presence', () => {
      expect(referenceHasTag('{D001#deleted}', 'deleted')).toBe(true);
      expect(referenceHasTag('{D001#important,deleted}', 'deleted')).toBe(true);
      expect(referenceHasTag('{D001#deleted,important}', 'deleted')).toBe(true);
    });

    it('should return false when tag not present', () => {
      expect(referenceHasTag('{D001}', 'deleted')).toBe(false);
      expect(referenceHasTag('{D001#other}', 'deleted')).toBe(false);
      expect(referenceHasTag('{D001#important,active}', 'deleted')).toBe(false);
    });

    it('should handle modifiers correctly', () => {
      expect(referenceHasTag('{D001+>#deleted}', 'deleted')).toBe(true);
      expect(referenceHasTag('{D001+>}', 'deleted')).toBe(false);
    });
  });

  describe('extractTagsFromReference', () => {
    it('should extract no tags from simple reference', () => {
      expect(extractTagsFromReference('{D001}')).toEqual([]);
    });

    it('should extract single tag', () => {
      expect(extractTagsFromReference('{D001#deleted}')).toEqual(['deleted']);
    });

    it('should extract multiple tags', () => {
      expect(extractTagsFromReference('{D001#important,deleted}')).toEqual(['important', 'deleted']);
      expect(extractTagsFromReference('{D001#tag1,tag2,tag3}')).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should handle modifiers', () => {
      expect(extractTagsFromReference('{D001+>#deleted}')).toEqual(['deleted']);
      expect(extractTagsFromReference('{D001$#tag1,tag2}')).toEqual(['tag1', 'tag2']);
    });
  });

  describe('addTagToAllReferences', () => {
    it('should add tag to all references of a note', () => {
      const content = `
This references {D001} and also {D001+>}.
Another line with {D001#important}.
And {R042} should not be affected.
      `;
      
      const result = addTagToAllReferences(content, 'D001', 'deleted');
      
      expect(result.count).toBe(3);
      expect(result.updatedContent).toContain('{D001#deleted}');
      expect(result.updatedContent).toContain('{D001+>#deleted}');
      expect(result.updatedContent).toContain('{D001#important,deleted}');
      expect(result.updatedContent).toContain('{R042}'); // Unchanged
    });

    it('should not duplicate tags', () => {
      const content = 'Reference {D001#deleted} already has tag';
      const result = addTagToAllReferences(content, 'D001', 'deleted');
      
      expect(result.count).toBe(1);
      expect(result.updatedContent).toBe(content); // Unchanged
    });
  });

  describe('removeTagFromAllReferences', () => {
    it('should remove tag from all references of a note', () => {
      const content = `
This references {D001#deleted} and also {D001+>#deleted}.
Another line with {D001#important,deleted}.
And {R042#deleted} should not be affected.
      `;
      
      const result = removeTagFromAllReferences(content, 'D001', 'deleted');
      
      expect(result.count).toBe(3);
      expect(result.updatedContent).toContain('{D001}');
      expect(result.updatedContent).toContain('{D001+>}');
      expect(result.updatedContent).toContain('{D001#important}');
      expect(result.updatedContent).toContain('{R042#deleted}'); // Unchanged
    });

    it('should handle references without the tag', () => {
      const content = 'Reference {D001} and {D001#other}';
      const result = removeTagFromAllReferences(content, 'D001', 'deleted');
      
      expect(result.count).toBe(0);
      expect(result.updatedContent).toBe(content); // Unchanged
    });
  });
});