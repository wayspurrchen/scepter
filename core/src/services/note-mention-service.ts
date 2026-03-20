import * as fs from 'fs-extra';
import * as path from 'path';
import { glob } from 'glob';
import { parseNoteMentions, type NoteMention } from '../parsers/note/note-parser';
import { parseNoteId } from '../parsers/note/shared-note-utils';

export interface MentionLocation {
  filePath: string;
  line: number;
  column?: number;
  mention: NoteMention;
}

export interface MentionTransform {
  oldId: string;
  newId: string;
}

export interface TransformResult {
  filePath: string;
  originalContent: string;
  updatedContent: string;
  transformCount: number;
  mentions: MentionLocation[];
}

/**
 * Service for finding and transforming note mentions across a codebase
 */
export class NoteMentionService {
  constructor(
    private rootPath: string,
    private excludePatterns: string[] = [
      'node_modules/**',
      '**/*.{png,jpg,jpeg,gif,ico,pdf,zip,gz,tar}',
      '**/.git/**',
      '**/dist/**',
      '**/build/**'
    ]
  ) {}

  /**
   * Find all mentions of notes with a specific shortcode
   */
  async findMentionsByShortcode(shortcode: string): Promise<MentionLocation[]> {
    const mentions: MentionLocation[] = [];
    
    // Find all text files
    const files = await glob('**/*', {
      cwd: this.rootPath,
      ignore: this.excludePatterns,
      nodir: true,
      absolute: true
    });
    
    // Search each file
    for (const filePath of files) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const fileMentions = parseNoteMentions(content, { 
          filePath,
          includeContext: true 
        });
        
        // Filter mentions by shortcode
        for (const mention of fileMentions) {
          const parsed = parseNoteId(mention.id);
          if (parsed && parsed.shortcode === shortcode) {
            mentions.push({
              filePath,
              line: mention.line,
              mention
            });
          }
        }
      } catch (error) {
        // Skip files that can't be read
        continue;
      }
    }
    
    return mentions;
  }

  /**
   * Find mentions in a specific file
   */
  async findMentionsInFile(filePath: string): Promise<MentionLocation[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const mentions = parseNoteMentions(content, { 
        filePath,
        includeContext: true 
      });
      
      return mentions.map(mention => ({
        filePath,
        line: mention.line,
        mention
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Transform mentions in a file according to the provided transforms
   */
  async transformMentionsInFile(
    filePath: string,
    transforms: MentionTransform[]
  ): Promise<TransformResult> {
    const originalContent = await fs.readFile(filePath, 'utf-8');
    const mentions = await this.findMentionsInFile(filePath);
    
    // Create a map for quick lookup
    const transformMap = new Map(transforms.map(t => [t.oldId, t.newId]));
    
    // Sort mentions by position (reverse order to transform from end to start)
    const sortedMentions = mentions
      .filter(m => transformMap.has(m.mention.id))
      .sort((a, b) => {
        // Sort by line, then by approximate position
        if (a.line !== b.line) return b.line - a.line;
        return 0;
      });
    
    let updatedContent = originalContent;
    let transformCount = 0;
    
    // Transform each mention
    for (const location of sortedMentions) {
      const oldId = location.mention.id;
      const newId = transformMap.get(oldId);
      
      if (!newId) continue;
      
      // Build the pattern to match this specific mention
      // We need to be careful to preserve modifiers, tags, and content
      const escapedOldId = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // Create patterns for different mention formats
      const patterns = [
        // Complex format with everything: {D001+>#tag: content}
        new RegExp(
          `\\{${escapedOldId}([$+><*]*)(#[^}:]+)?(:[^}]*)\\}`,
          'g'
        ),
        // With modifiers and tags: {D001+>#tag}
        new RegExp(
          `\\{${escapedOldId}([$+><*]*)(#[^}:]+)?\\}`,
          'g'
        ),
        // With content: {D001: content}
        new RegExp(
          `\\{${escapedOldId}(:[^}]*)\\}`,
          'g'
        ),
        // Simple: {D001}
        new RegExp(
          `\\{${escapedOldId}\\}`,
          'g'
        )
      ];
      
      // Try patterns from most specific to least specific
      let replaced = false;
      for (const pattern of patterns) {
        const newContent = updatedContent.replace(pattern, (match, ...groups) => {
          replaced = true;
          transformCount++;
          
          // Reconstruct the mention with the new ID
          if (groups.length === 3 && groups[0] && groups[1] && groups[2]) {
            // Complex format
            return `{${newId}${groups[0]}${groups[1]}${groups[2]}}`;
          } else if (groups.length === 2 && groups[0] && groups[1]) {
            // With modifiers and tags
            return `{${newId}${groups[0]}${groups[1]}}`;
          } else if (groups.length === 1 && groups[0]) {
            // With content or just modifiers
            return `{${newId}${groups[0]}}`;
          } else {
            // Simple format
            return `{${newId}}`;
          }
        });
        
        if (replaced) {
          updatedContent = newContent;
          break;
        }
      }
    }
    
    return {
      filePath,
      originalContent,
      updatedContent,
      transformCount,
      mentions: sortedMentions
    };
  }

  /**
   * Transform all mentions of a specific shortcode to a new shortcode
   */
  async transformShortcode(
    oldShortcode: string,
    newShortcode: string
  ): Promise<TransformResult[]> {
    const results: TransformResult[] = [];
    
    // Find all mentions with the old shortcode
    const mentions = await this.findMentionsByShortcode(oldShortcode);
    
    // Group mentions by file
    const mentionsByFile = new Map<string, MentionLocation[]>();
    for (const mention of mentions) {
      const fileMentions = mentionsByFile.get(mention.filePath) || [];
      fileMentions.push(mention);
      mentionsByFile.set(mention.filePath, fileMentions);
    }
    
    // Transform each file
    for (const [filePath, fileMentions] of mentionsByFile) {
      // Create transforms for all unique IDs in this file
      const uniqueIds = new Set(fileMentions.map(m => m.mention.id));
      const transforms: MentionTransform[] = Array.from(uniqueIds).map(oldId => ({
        oldId,
        newId: oldId.replace(new RegExp(`^${oldShortcode}`), newShortcode)
      }));
      
      const result = await this.transformMentionsInFile(filePath, transforms);
      results.push(result);
    }
    
    return results;
  }

  /**
   * Apply transform results to files (write the changes)
   */
  async applyTransforms(
    results: TransformResult[],
    options: { createBackup?: boolean } = {}
  ): Promise<void> {
    for (const result of results) {
      if (result.transformCount > 0) {
        // Create backup if requested
        if (options.createBackup) {
          await fs.copyFile(result.filePath, `${result.filePath}.backup`);
        }
        
        // Write the updated content
        await fs.writeFile(result.filePath, result.updatedContent);
      }
    }
  }

  /**
   * Get a preview of what would be changed
   */
  getTransformPreview(results: TransformResult[]): string {
    const lines: string[] = [];
    
    for (const result of results) {
      if (result.transformCount > 0) {
        lines.push(`\nFile: ${path.relative(this.rootPath, result.filePath)}`);
        lines.push(`  Changes: ${result.transformCount}`);
        
        // Show a few examples
        const examples = result.mentions.slice(0, 3);
        for (const location of examples) {
          const oldId = location.mention.id;
          lines.push(`  Line ${location.line}: ${oldId} → ${oldId.replace(/^[A-Z]+/, 'NEW')}`);
        }
        
        if (result.mentions.length > 3) {
          lines.push(`  ... and ${result.mentions.length - 3} more`);
        }
      }
    }
    
    return lines.join('\n');
  }
}