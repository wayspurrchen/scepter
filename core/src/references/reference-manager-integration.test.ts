import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ReferenceManager } from './reference-manager';
import { 
  addTagToAllReferences, 
  removeTagFromAllReferences,
  addTagToReference,
  removeTagFromReference 
} from './reference-tag-utils';
import type { Reference } from '../types/reference';

describe('ReferenceManager - Tag Update Integration', () => {
  let referenceManager: ReferenceManager;

  beforeEach(() => {
    referenceManager = new ReferenceManager();
  });

  describe('Integration with tag utilities', () => {
    it('should demonstrate full workflow for updating references when note is deleted', () => {
      // Add some references
      referenceManager.addReference({
        fromId: 'D001',
        toId: 'D002',
        line: 10
      });
      
      referenceManager.addReference({
        fromId: 'R001',
        toId: 'D002',
        line: 25
      });

      // Simulate file content
      const d001Content = `
# D001 - Architecture Decision

We should use microservices as described in {D002}.
Also see {D002+>} for implementation details.
And {D002#important} is critical.
`;

      const r001Content = `
# R001 - Requirement

This implements the decision {D002}.
`;

      // When D002 is deleted, update all references
      const d001Updated = addTagToAllReferences(d001Content, 'D002', 'deleted');
      const r001Updated = addTagToAllReferences(r001Content, 'D002', 'deleted');

      // Verify tags were added
      expect(d001Updated.count).toBe(3);
      expect(d001Updated.updatedContent).toContain('{D002#deleted}');
      expect(d001Updated.updatedContent).toContain('{D002+>#deleted}');
      expect(d001Updated.updatedContent).toContain('{D002#important,deleted}');

      expect(r001Updated.count).toBe(1);
      expect(r001Updated.updatedContent).toContain('{D002#deleted}');
    });

    it('should demonstrate full workflow for restoring deleted note', () => {
      // Simulate content with deleted tags
      const d001Content = `
# D001 - Architecture Decision

We should use microservices as described in {D002#deleted}.
Also see {D002+>#deleted} for implementation details.
And {D002#important,deleted} is critical.
`;

      const r001Content = `
# R001 - Requirement

This implements the decision {D002#deleted}.
`;

      // When D002 is restored, remove deleted tags
      const d001Updated = removeTagFromAllReferences(d001Content, 'D002', 'deleted');
      const r001Updated = removeTagFromAllReferences(r001Content, 'D002', 'deleted');

      // Verify tags were removed
      expect(d001Updated.count).toBe(3);
      expect(d001Updated.updatedContent).toContain('{D002}');
      expect(d001Updated.updatedContent).toContain('{D002+>}');
      expect(d001Updated.updatedContent).toContain('{D002#important}');
      expect(d001Updated.updatedContent).not.toContain('deleted');

      expect(r001Updated.count).toBe(1);
      expect(r001Updated.updatedContent).toContain('{D002}');
      expect(r001Updated.updatedContent).not.toContain('deleted');
    });

    it('should handle complex reference patterns', () => {
      const complexContent = `
# Complex References

Simple: {D002}
With modifiers: {D002+>}
With tags: {D002#tag1,tag2}
With content: {D002: Some extended content}
With everything: {D002+>#tag1,tag2: Extended content}
Nested: This is {D001} which references {D002} inside.
Multiple on line: {D002} and also {D002+>}
`;

      // Add deleted tag
      const updated = addTagToAllReferences(complexContent, 'D002', 'deleted');
      
      expect(updated.count).toBe(8); // All D002 references (including the duplicate on the last line)
      expect(updated.updatedContent).toContain('{D002#deleted}');
      expect(updated.updatedContent).toContain('{D002+>#deleted}');
      expect(updated.updatedContent).toContain('{D002#tag1,tag2,deleted}');
      expect(updated.updatedContent).toContain('{D002#deleted: Some extended content}');
      expect(updated.updatedContent).toContain('{D002+>#tag1,tag2,deleted: Extended content}');
      
      // D001 should remain unchanged
      expect(updated.updatedContent).toContain('{D001}');
    });

    it('should integrate with ReferenceManager methods', async () => {
      // Add references
      const refs: Reference[] = [
        { fromId: 'D001', toId: 'D002', line: 10, tags: [] },
        { fromId: 'D001', toId: 'D003', line: 15, tags: ['important'] },
        { fromId: 'R001', toId: 'D002', line: 5, tags: [] }
      ];
      
      refs.forEach(ref => referenceManager.addReference(ref));

      // Get result structure from updateReferencesForDeletion
      const result = await referenceManager.updateReferencesForDeletion('D002');
      
      // Should have found references from D001 and R001
      expect(result.updatedFiles.size).toBe(2);
      expect(result.totalUpdated).toBe(2);
      
      // Check that the right source files are identified
      expect(result.updatedFiles.has('D001')).toBe(true);
      expect(result.updatedFiles.has('R001')).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle references that already have the deleted tag', () => {
      const content = '{D002#deleted} and {D002#important,deleted}';
      const updated = addTagToAllReferences(content, 'D002', 'deleted');
      
      // Should not modify already tagged references
      expect(updated.count).toBe(2);
      expect(updated.updatedContent).toBe(content);
    });

    it('should handle removing tag that does not exist', () => {
      const content = '{D002} and {D002#important}';
      const updated = removeTagFromAllReferences(content, 'D002', 'deleted');
      
      // Should not modify references without the tag
      expect(updated.count).toBe(0);
      expect(updated.updatedContent).toBe(content);
    });

    it('should preserve reference formatting and whitespace', () => {
      const content = `
{D002}
  {D002+>}  
    {D002#tag: Content with
multiple lines}
`;
      
      const updated = addTagToAllReferences(content, 'D002', 'deleted');
      
      // Should preserve formatting
      expect(updated.updatedContent).toBe(`
{D002#deleted}
  {D002+>#deleted}  
    {D002#tag,deleted: Content with
multiple lines}
`);
    });
  });
});