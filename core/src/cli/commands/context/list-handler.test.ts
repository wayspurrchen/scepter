import { describe, it, expect } from 'vitest';
import { formatPaginationInfo } from './list-handler';

describe('list-handler', () => {
  describe('formatPaginationInfo', () => {
    it('should return null when no pagination needed', () => {
      const result = formatPaginationInfo({ 
        notes: [], 
        totalCount: 10, 
        hasMore: false, 
        output: '', 
        isStats: false 
      }, undefined);
      
      expect(result).toBeNull();
    });
    
    it('should format pagination info correctly', () => {
      const result = formatPaginationInfo({ 
        notes: [1, 2, 3, 4, 5] as any, 
        totalCount: 20, 
        hasMore: true, 
        output: '', 
        isStats: false 
      }, 10);
      
      expect(result).toBe('Showing 11-15 of 20 notes');
    });
    
    it('should handle first page correctly', () => {
      const result = formatPaginationInfo({ 
        notes: [1, 2, 3, 4, 5] as any, 
        totalCount: 20, 
        hasMore: true, 
        output: '', 
        isStats: false 
      }, 0);
      
      expect(result).toBe('Showing 1-5 of 20 notes');
    });
    
    it('should show additional notes for tree format', () => {
      const result = formatPaginationInfo({ 
        notes: [1, 2, 3] as any, 
        totalCount: 5, 
        hasMore: false, 
        output: '', 
        isStats: false 
      }, 0, 'tree', 12);
      
      expect(result).toBe('Showing 1-3 of 5 root notes (12 additional referenced notes displayed)');
    });
    
    it('should show tree format without additional notes', () => {
      const result = formatPaginationInfo({ 
        notes: [1, 2, 3, 4, 5] as any, 
        totalCount: 5, 
        hasMore: false, 
        output: '', 
        isStats: false 
      }, 0, 'tree', 0);
      
      expect(result).toBe('Showing 1-5 of 5 root notes');
    });
    
    it('should always show pagination for tree format even without offset', () => {
      const result = formatPaginationInfo({ 
        notes: [1, 2, 3, 4, 5] as any, 
        totalCount: 5, 
        hasMore: false, 
        output: '', 
        isStats: false 
      }, undefined, 'tree');
      
      expect(result).toBe('Showing 1-5 of 5 root notes');
    });
  });
  
  // Note: Testing the tree view formatting directly would require exporting the 
  // internal formatTreeView function or mocking the entire ProjectManager setup.
  // For now, we rely on integration tests and manual testing for tree view behavior.
});