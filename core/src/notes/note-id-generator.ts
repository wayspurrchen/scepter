import { EventEmitter } from 'events';
import type { SCEpterConfig } from '../types/config';
import { parseNoteId, formatNoteId, isValidNoteId } from '../parsers/note/shared-note-utils';

export interface IdGeneratorOptions {
  indexMode?: 'none' | 'lazy' | 'eager';
}

export interface IdGeneratorStorage {
  load(): Promise<Record<string, number>>;
  save(counters: Record<string, number>): Promise<void>;
}

export interface IdGenerationEvent {
  type: string;
  id: string;
  counter: number;
  timestamp: Date;
}

/**
 * Generates unique note IDs for each note type based on configuration
 */
export class NoteIdGenerator extends EventEmitter {
  private counters: Record<string, number> = {};
  private config: SCEpterConfig;
  private storage?: IdGeneratorStorage;
  private idExistenceChecker?: (id: string) => Promise<boolean>;
  private customPatterns: Record<string, RegExp | { format: string }> = {};
  private projectPrefix?: string;
  private patternCache: Map<string, any> = new Map();

  constructor(config: SCEpterConfig, options: IdGeneratorOptions = {}) {
    super();
    this.config = config;
    this.initializeCounters();
  }

  private initializeCounters(): void {
    // Initialize counters for all configured note types
    for (const [typeName, typeConfig] of Object.entries(this.config.noteTypes || {})) {
      this.counters[typeName] = 0;
    }
  }

  /**
   * Generate the next available ID for a note type
   */
  generateNextId(typeName: string): string {
    this.validateType(typeName);
    
    const typeConfig = this.config.noteTypes[typeName];
    if (!typeConfig) {
      throw new Error(`Unknown note type: ${typeName}`);
    }

    // Check for custom pattern
    const customPattern = this.customPatterns[typeName];
    if (customPattern && typeof customPattern === 'object' && 'format' in customPattern) {
      return this.generateFromPattern(typeName, customPattern.format);
    }

    // Increment counter
    this.counters[typeName]++;
    
    if (this.counters[typeName] > 99999) {
      throw new Error(`Note ID counter for ${typeName} exceeded maximum of 99999`);
    }

    const id = this.formatId(typeConfig.shortcode, this.counters[typeName]);
    
    // Emit event
    this.emit('idGenerated', {
      type: typeName,
      id,
      counter: this.counters[typeName],
      timestamp: new Date()
    });

    return id;
  }

  /**
   * Generate ID with async support (for concurrent generation)
   */
  async generateNextIdAsync(typeName: string): Promise<string> {
    // In a real implementation, this would use locks for concurrency
    return this.generateNextId(typeName);
  }

  /**
   * Generate unique ID (checks existence)
   */
  async generateUniqueId(typeName: string): Promise<string> {
    if (!this.idExistenceChecker) {
      return this.generateNextId(typeName);
    }

    let id: string;
    let exists: boolean;
    
    do {
      id = this.generateNextId(typeName);
      exists = await this.idExistenceChecker(id);
    } while (exists);

    return id;
  }

  /**
   * Set the current state based on existing IDs
   */
  setExistingIds(existingIds: string[]): void {
    for (const id of existingIds) {
      // Skip invalid inputs
      if (!id || typeof id !== 'string') continue;
      
      // Normalize to uppercase for parsing
      const normalizedId = id.toUpperCase();
      const parsed = parseNoteId(normalizedId);
      if (!parsed) continue;

      // Find the type by shortcode
      const typeName = this.getTypeByShortcode(parsed.shortcode);
      if (!typeName) continue;

      const num = parseInt(parsed.number, 10);
      if (num > this.counters[typeName]) {
        this.counters[typeName] = num;
      }
    }
  }

  /**
   * Get type name from shortcode
   */
  private getTypeByShortcode(shortcode: string): string | null {
    for (const [typeName, typeConfig] of Object.entries(this.config.noteTypes || {})) {
      if (typeConfig.shortcode === shortcode) {
        return typeName;
      }
    }
    return null;
  }

  /**
   * Format ID based on project prefix and shortcode
   */
  private formatId(shortcode: string, number: number): string {
    // Always use 5 digits for consistency (tests expect this)
    const baseId = formatNoteId(shortcode, number, 5);
    return this.projectPrefix ? `${this.projectPrefix}-${baseId}` : baseId;
  }

  /**
   * Generate ID from custom pattern
   */
  private generateFromPattern(typeName: string, pattern: string): string {
    const typeConfig = this.config.noteTypes[typeName];
    const variables: Record<string, string> = {
      shortcode: typeConfig.shortcode,
      year: new Date().getFullYear().toString(),
      month: (new Date().getMonth() + 1).toString().padStart(2, '0'),
      quarter: `Q${Math.ceil((new Date().getMonth() + 1) / 3)}`,
      date: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    };

    let result = pattern;
    
    // Handle counter variable
    const counterMatch = pattern.match(/\${counter:(\d+)}/);
    if (counterMatch) {
      this.counters[typeName]++;
      const digits = parseInt(counterMatch[1]);
      const counter = this.counters[typeName].toString().padStart(digits, '0');
      result = result.replace(counterMatch[0], counter);
    }

    // Replace other variables
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\$\\{${key}(:.*?)?\\}`, 'g'), (match, format) => {
        if (format && key === 'date') {
          // Handle date formatting
          return this.formatDate(format.slice(1));
        }
        return value;
      });
    }

    return result;
  }

  private formatDate(format: string): string {
    const date = new Date();
    const replacements: Record<string, string> = {
      'YYYY': date.getFullYear().toString(),
      'MM': (date.getMonth() + 1).toString().padStart(2, '0'),
      'DD': date.getDate().toString().padStart(2, '0'),
      'YYYYMMDD': date.toISOString().slice(0, 10).replace(/-/g, '')
    };

    return replacements[format] || format;
  }

  /**
   * Validate type exists in config
   */
  private validateType(typeName: string): void {
    if (!typeName) {
      throw new Error('Note type is required');
    }
    
    if (!this.config.noteTypes) {
      throw new Error('Configuration missing noteTypes');
    }
    
    if (!this.config.noteTypes[typeName]) {
      throw new Error(`Unknown note type: ${typeName}`);
    }
  }

  /**
   * Check if type is valid
   */
  isValidType(typeName: string): boolean {
    return !!(this.config.noteTypes && this.config.noteTypes[typeName]);
  }

  /**
   * Get next number for type
   */
  getNextNumber(typeName: string): number {
    this.validateType(typeName);
    return this.counters[typeName] + 1;
  }

  /**
   * Get current count for type
   */
  getCurrentCount(typeName: string): number {
    this.validateType(typeName);
    return this.counters[typeName];
  }

  /**
   * Get all current counts
   */
  getAllCounts(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const typeName of Object.keys(this.config.noteTypes || {})) {
      result[typeName] = this.counters[typeName];
    }
    return result;
  }

  /**
   * Reset counters
   */
  reset(typeName?: string): void {
    if (typeName) {
      this.validateType(typeName);
      this.counters[typeName] = 0;
    } else {
      for (const type of Object.keys(this.counters)) {
        this.counters[type] = 0;
      }
    }
  }

  /**
   * Set storage adapter
   */
  setStorage(storage: IdGeneratorStorage): void {
    this.storage = storage;
  }

  /**
   * Load counters from storage
   */
  async loadCounters(): Promise<void> {
    if (!this.storage) return;

    try {
      const savedCounters = await this.storage.load();
      
      for (const [typeName, count] of Object.entries(savedCounters)) {
        if (this.isValidType(typeName) && typeof count === 'number' && count >= 0) {
          this.counters[typeName] = count;
        }
      }
    } catch (error) {
      // Reset to 0 on error
      this.initializeCounters();
    }
  }

  /**
   * Save counters to storage
   */
  async saveCounters(): Promise<void> {
    if (!this.storage) return;
    await this.storage.save(this.getAllCounts());
  }

  /**
   * Set ID existence checker
   */
  setIdExistenceChecker(checker: (id: string) => Promise<boolean>): void {
    this.idExistenceChecker = checker;
  }


  /**
   * Register event handler for ID generation
   */
  onIdGenerated(handler: (event: IdGenerationEvent) => void): void {
    this.on('idGenerated', handler);
  }
}