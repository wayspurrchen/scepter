import { EventEmitter } from 'events';
import type { ConfigManager } from '../config/config-manager';
import type { SCEpterConfig, NoteTypeConfig } from '../types/config';
import { parseNoteId, isValidShortcodeFormat } from '../parsers/note/shared-note-utils';

export interface TypeMetadata {
  name: string;
  shortcode: string;
  folder: string;
  idPattern: RegExp;
  exampleId: string;
  description: string;
}

export interface TypeStatistics {
  totalNotes: number;
  typeDistribution: Record<string, number>;
  mostUsedType: string;
  leastUsedType: string;
}

export interface ShortcodeValidation {
  valid: string[];
  unknown: string[];
}

export interface TypeConflict {
  shortcode: string;
  existingType: string;
  conflictingType: string;
}

export interface TypeSuggestion {
  success: boolean;
  error?: string;
}

interface TypeInfo {
  name: string;
  folder: string | null;
  shortcode: string;
  virtual?: boolean;
  discovery?: string;
}

/**
 * Resolves note types from shortcodes and manages type registry
 */
export class NoteTypeResolver extends EventEmitter {
  private configManager: ConfigManager;
  private shortcodeToType: Map<string, TypeInfo> = new Map();
  private typeToInfo: Map<string, TypeInfo> = new Map();
  private shortcodeAliases: Map<string, string> = new Map();
  private tagMapping: Record<string, string> = {};
  private validationRules: Map<string, (noteId: string) => boolean> = new Map();
  private inferenceRules: Array<(content: string) => string | null> = [];
  private cacheStats = { hits: 0, misses: 0 };

  constructor(configManager: ConfigManager) {
    super();
    this.configManager = configManager;

    // Don't build mappings in constructor - wait for initialization
    // Listen for config changes - ConfigManager emits 'config:changed'
    this.configManager.on('config:changed', () => {
      this.syncWithConfig();
    });
  }

  /**
   * Initialize the resolver after config is loaded
   */
  initialize(): void {
    this.buildMappings();
  }

  private buildMappings(): void {
    // Get config synchronously
    const config = this.configManager.getConfig();

    if (!config?.noteTypes) {
      return;
    }

    this.shortcodeToType.clear();
    this.typeToInfo.clear();

    for (const [typeName, typeConfig] of Object.entries(config.noteTypes) as [string, NoteTypeConfig][]) {
      const info: TypeInfo = {
        name: typeName,
        folder: typeConfig.folder || null,
        shortcode: typeConfig.shortcode,
      };

      this.shortcodeToType.set(typeConfig.shortcode.toUpperCase(), info);
      this.typeToInfo.set(typeName, info);
    }
  }

  /**
   * Get type configuration by shortcode
   */
  getTypeByShortcode(shortcode: string): TypeInfo | null {
    if (!shortcode) return null;

    // Check aliases
    const aliasTarget = this.shortcodeAliases.get(shortcode.toUpperCase());
    if (aliasTarget) {
      shortcode = aliasTarget;
    }

    const info = this.shortcodeToType.get(shortcode.toUpperCase());
    if (info) {
      this.cacheStats.hits++;
      return { ...info };
    }

    this.cacheStats.misses++;
    return null;
  }

  /**
   * Get type name from note ID
   */
  getTypeFromNoteId(noteId: string): string | null {
    const parsed = parseNoteId(noteId);
    if (!parsed) return null;

    const typeInfo = this.getTypeByShortcode(parsed.shortcode);
    return typeInfo?.name || null;
  }

  /**
   * Check if shortcode exists in configuration
   */
  shortcodeExists(shortcode: string): boolean {
    return this.getTypeByShortcode(shortcode) !== null;
  }

  /**
   * Validate shortcode format
   */
  isValidShortcode(shortcode: string): boolean {
    return isValidShortcodeFormat(shortcode);
  }

  /**
   * Validate note ID format
   */
  isValidNoteId(noteId: string): boolean {
    const parsed = parseNoteId(noteId);
    if (!parsed) return false;

    // Check if shortcode exists
    if (!this.shortcodeExists(parsed.shortcode)) return false;

    // Check custom validation rules
    const type = this.getTypeFromNoteId(noteId);
    if (type && this.validationRules.has(type)) {
      const validator = this.validationRules.get(type)!;
      return validator(noteId);
    }

    return true;
  }

  /**
   * Validate note ID matches expected type
   */
  validateNoteId(noteId: string, expectedType: string): boolean {
    const actualType = this.getTypeFromNoteId(noteId);
    return actualType === expectedType;
  }

  /**
   * Add custom validation rule for type
   */
  addValidationRule(typeName: string, validator: (noteId: string) => boolean): void {
    this.validationRules.set(typeName, validator);
  }

  /**
   * Get all configured types
   */
  getAllTypes(options?: {
    sortBy?: 'name' | 'shortcode' | 'folder';
    filter?: (type: TypeInfo) => boolean;
  }): TypeInfo[] {
    let types = Array.from(this.typeToInfo.values());

    if (options?.filter) {
      types = types.filter(options.filter);
    }

    if (options?.sortBy) {
      types.sort((a, b) => {
        const aVal = a[options.sortBy!] || '';
        const bVal = b[options.sortBy!] || '';
        return aVal.toString().localeCompare(bVal.toString());
      });
    }

    return types.map((t) => ({ ...t }));
  }

  /**
   * Get all types
   */
  getTypes(): Record<string, TypeInfo> {
    const result: Record<string, TypeInfo> = {};

    // Add configured types
    for (const [name, info] of this.typeToInfo.entries()) {
      result[name] = { ...info };
    }

    return result;
  }

  /**
   * Get type by name
   */
  getType(typeName: string): TypeInfo | null {
    return this.typeToInfo.get(typeName) || null;
  }

  /**
   * Resolve type identifier (case-insensitive name or shortcode)
   */
  resolveTypeIdentifier(identifier: string): string | null {
    if (!identifier) return null;

    const upperIdentifier = identifier.toUpperCase();

    // Try as shortcode (case-insensitive)
    const byShortcode = this.getTypeByShortcode(identifier);
    if (byShortcode) {
      return byShortcode.name;
    }

    // Try exact type name match
    if (this.typeToInfo.has(identifier)) {
      return identifier;
    }

    // Try case-insensitive type name match
    for (const [typeName] of this.typeToInfo.entries()) {
      if (typeName.toUpperCase() === upperIdentifier) {
        return typeName;
      }
    }

    return null;
  }

  /**
   * Resolve type from shortcode
   */
  resolveFromShortcode(shortcode: string): string | null {
    const typeInfo = this.getTypeByShortcode(shortcode);
    return typeInfo?.name || null;
  }

  /**
   * Check if type is virtual
   */
  isVirtual(typeName: string): boolean {
    return false;
  }

  /**
   * Get all shortcodes
   */
  getAllShortcodes(): string[] {
    return Array.from(this.shortcodeToType.keys());
  }

  /**
   * Get type metadata
   */
  getTypeMetadata(typeName: string): TypeMetadata | null {
    const info = this.typeToInfo.get(typeName);
    if (!info) return null;

    const digitCount = info.shortcode.length > 1 ? 5 : 3;
    const idPattern = new RegExp(`^${info.shortcode}\\d{${digitCount},${digitCount}}$`);

    // Get description from config if available
    const config = this.configManager.getConfig();
    const typeConfig = config.noteTypes[typeName];
    const description = typeConfig?.description || (info.folder ? `${info.name} notes stored in ${info.folder} folder` : `${info.name} notes`);

    return {
      name: info.name,
      shortcode: info.shortcode,
      folder: info.folder || '',
      idPattern,
      exampleId: `${info.shortcode}${'0'.repeat(digitCount - 1)}1`,
      description,
    };
  }

  /**
   * Check if shortcode length is valid
   */
  isValidShortcodeLength(shortcode: string): boolean {
    return shortcode.length >= 1 && shortcode.length <= 5;
  }

  /**
   * Try to add a new type
   */
  tryAddType(typeInfo: { name: string; shortcode: string; folder: string }): TypeSuggestion {
    if (this.shortcodeExists(typeInfo.shortcode)) {
      const existing = this.getTypeByShortcode(typeInfo.shortcode)!;
      return {
        success: false,
        error: `Shortcode ${typeInfo.shortcode} already in use by ${existing.name}`,
      };
    }

    return { success: true };
  }

  /**
   * Add shortcode alias
   */
  addShortcodeAlias(alias: string, targetShortcode: string): void {
    this.shortcodeAliases.set(alias.toUpperCase(), targetShortcode.toUpperCase());
  }

  /**
   * Detect type conflicts in proposed configuration
   */
  detectConflicts(proposedTypes: Record<string, NoteTypeConfig>): TypeConflict[] {
    const conflicts: TypeConflict[] = [];

    for (const [typeName, typeConfig] of Object.entries(proposedTypes)) {
      const existing = this.getTypeByShortcode(typeConfig.shortcode);
      if (existing && existing.name !== typeName) {
        conflicts.push({
          shortcode: typeConfig.shortcode,
          existingType: existing.name,
          conflictingType: typeName,
        });
      }
    }

    return conflicts;
  }

  /**
   * Validate shortcodes against registry
   */
  validateShortcodes(shortcodes: string[]): ShortcodeValidation {
    const valid: string[] = [];
    const unknown: string[] = [];

    for (const shortcode of shortcodes) {
      if (this.shortcodeExists(shortcode)) {
        valid.push(shortcode);
      } else {
        unknown.push(shortcode);
      }
    }

    return { valid, unknown };
  }

  /**
   * Generate configuration snippet
   */
  generateConfigSnippet(typeInfo: { name: string; shortcode: string; folder?: string | null }): string {
    if (typeInfo.folder) {
      return `${typeInfo.name}: { folder: '${typeInfo.folder}', shortcode: '${typeInfo.shortcode}' }`;
    }
    return `${typeInfo.name}: { shortcode: '${typeInfo.shortcode}' }`;
  }

  /**
   * Calculate type statistics
   */
  calculateTypeStatistics(counts: Record<string, number>): TypeStatistics {
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    const distribution: Record<string, number> = {};

    for (const [type, count] of Object.entries(counts)) {
      distribution[type] = (count / total) * 100;
    }

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const mostUsed = sorted[0]?.[0] || '';
    const leastUsed = sorted[sorted.length - 1]?.[0] || '';

    return {
      totalNotes: total,
      typeDistribution: distribution,
      mostUsedType: mostUsed,
      leastUsedType: leastUsed,
    };
  }

  /**
   * Sync with configuration changes
   */
  async syncWithConfig(): Promise<void> {
    // Get the old types before rebuilding
    const oldTypes = new Set(this.typeToInfo.keys());
    const oldTypeMap = new Map(this.typeToInfo);

    this.buildMappings();
    this.cacheStats = { hits: 0, misses: 0 };

    // Check for changes and emit appropriate events
    const newTypes = new Set(this.typeToInfo.keys());

    // Check for added types
    for (const typeName of newTypes) {
      if (!oldTypes.has(typeName)) {
        this.emit('typeAdded', { noteType: typeName });
      }
    }

    // Check for removed types
    for (const typeName of oldTypes) {
      if (!newTypes.has(typeName)) {
        this.emit('typeRemoved', { noteType: typeName });
      }
    }

    // Check for updated types
    for (const typeName of newTypes) {
      if (oldTypes.has(typeName)) {
        const oldInfo = oldTypeMap.get(typeName);
        const newInfo = this.typeToInfo.get(typeName);
        if (oldInfo && newInfo && (oldInfo.folder !== newInfo.folder || oldInfo.shortcode !== newInfo.shortcode)) {
          this.emit('typeUpdated', { noteType: typeName });
        }
      }
    }

    this.emit('configUpdated');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { hits: number; misses: number } {
    return { ...this.cacheStats };
  }

  /**
   * Set tag mapping for types
   */
  setTagMapping(mapping: Record<string, string>): void {
    this.tagMapping = mapping;
  }

  /**
   * Get types grouped by tag
   */
  getTypesGroupedByTag(): Record<string, TypeInfo[]> {
    const groups: Record<string, TypeInfo[]> = {};

    for (const [typeName, tag] of Object.entries(this.tagMapping)) {
      const info = this.typeToInfo.get(typeName);
      if (!info) continue;

      if (!groups[tag]) {
        groups[tag] = [];
      }
      groups[tag].push({ ...info });
    }

    return groups;
  }

  /**
   * Merge types from additional source
   */
  mergeTypesFromSource(additionalTypes: Record<string, NoteTypeConfig>): void {
    // Update mappings directly
    for (const [typeName, typeConfig] of Object.entries(additionalTypes)) {
      const info: TypeInfo = {
        name: typeName,
        folder: typeConfig.folder || null,
        shortcode: typeConfig.shortcode,
      };

      this.shortcodeToType.set(typeConfig.shortcode.toUpperCase(), info);
      this.typeToInfo.set(typeName, info);
    }
  }

  /**
   * Validate configuration
   */
  validateConfiguration(noteTypes: Record<string, NoteTypeConfig>): string[] {
    const errors: string[] = [];

    for (const [typeName, config] of Object.entries(noteTypes)) {
      if (!config.shortcode) {
        errors.push(`${typeName}: missing shortcode`);
      }
    }

    return errors;
  }

  /**
   * Add inference rule for content type detection
   */
  addInferenceRule(rule: (content: string) => string | null): void {
    this.inferenceRules.push(rule);
  }

  /**
   * Infer type from content (for custom rules)
   */
  inferTypeFromContent(content: string): string | null {
    // Try custom rules first
    for (const rule of this.inferenceRules) {
      const result = rule(content);
      if (result) return result;
    }

    return null;
  }
}
