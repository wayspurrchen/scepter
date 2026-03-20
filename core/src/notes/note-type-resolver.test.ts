import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NoteTypeResolver } from './note-type-resolver';
import { ConfigManager } from '../config/config-manager';
import type { SCEpterConfig, NoteTypeConfig } from '../types/config';
import * as path from 'path';

describe('NoteTypeResolver', () => {
  let resolver: NoteTypeResolver;
  let configManager: ConfigManager;
  const testProjectPath = path.join(process.cwd(), '.test-tmp', 'test-note-type-resolver');

  beforeEach(async () => {
    // Setup test environment
    configManager = new ConfigManager(testProjectPath);

    // Set up test configuration
    const testConfig: SCEpterConfig = {
      noteTypes: {
        Requirement: { folder: 'requirements', shortcode: 'R' },
        Decision: { folder: 'decisions', shortcode: 'D' },
        Question: { folder: 'questions', shortcode: 'Q' },
        Architecture: { folder: 'architecture', shortcode: 'ARCH' }, // Multi-char
        UserStory: { folder: 'user-stories', shortcode: 'US' },
      },
    };
    const setConfig = await configManager.setConfig(testConfig);
    expect(setConfig).toBeTruthy();

    // Verify config was set
    const config = await configManager.getConfig();
    expect(config).toBeTruthy();
    expect(config?.noteTypes).toBeTruthy();

    resolver = new NoteTypeResolver(configManager);
    // Initialize the resolver after config is set
    resolver.initialize();
  });

  afterEach(async () => {
    // Cleanup
  });

  describe('Type Resolution', () => {
    it('should get type configuration by shortcode', () => {
      const typeConfig = resolver.getTypeByShortcode('R');
      expect(typeConfig).toEqual({
        name: 'Requirement',
        folder: 'requirements',
        shortcode: 'R',
      });
    });

    it('should handle case-insensitive shortcode lookup', () => {
      const typeConfig1 = resolver.getTypeByShortcode('r');
      const typeConfig2 = resolver.getTypeByShortcode('R');
      expect(typeConfig1).toEqual(typeConfig2);

      const archConfig1 = resolver.getTypeByShortcode('arch');
      const archConfig2 = resolver.getTypeByShortcode('ARCH');
      expect(archConfig1).toEqual(archConfig2);
    });

    it('should get type from note ID', () => {
      const type1 = resolver.getTypeFromNoteId('R001');
      expect(type1).toBe('Requirement');

      const type2 = resolver.getTypeFromNoteId('ARCH042');
      expect(type2).toBe('Architecture');

      const type3 = resolver.getTypeFromNoteId('US12345');
      expect(type3).toBe('UserStory');
    });

    it('should handle multi-character shortcodes', () => {
      const archConfig = resolver.getTypeByShortcode('ARCH');
      expect(archConfig).toEqual({
        name: 'Architecture',
        folder: 'architecture',
        shortcode: 'ARCH',
      });

      const usConfig = resolver.getTypeByShortcode('US');
      expect(usConfig).toEqual({
        name: 'UserStory',
        folder: 'user-stories',
        shortcode: 'US',
      });
    });

    it('should return null for unknown shortcodes', () => {
      expect(resolver.getTypeByShortcode('UNKNOWN')).toBeNull();
      expect(resolver.getTypeByShortcode('Z')).toBeNull();
      expect(resolver.getTypeByShortcode('')).toBeNull();
    });

    // From existing tests
    it('should support multi-character shortcodes like REQ, DEC, DEBT', async () => {
      const customConfig: SCEpterConfig = {
        noteTypes: {
          Requirement: { folder: 'requirements', shortcode: 'REQ' },
          Decision: { folder: 'decisions', shortcode: 'DEC' },
          TechnicalDebt: { folder: 'tech-debt', shortcode: 'DEBT' },
        },
      };

      await configManager.setConfig(customConfig);
      const customResolver = new NoteTypeResolver(configManager);
      customResolver.initialize();

      expect(customResolver.getTypeByShortcode('REQ')).toBeTruthy();
      expect(customResolver.getTypeByShortcode('DEC')).toBeTruthy();
      expect(customResolver.getTypeByShortcode('DEBT')).toBeTruthy();
    });

    it('should find files with custom shortcodes like ARCH, API', () => {
      // Already configured with ARCH in beforeEach
      expect(resolver.getTypeByShortcode('ARCH')).toBeTruthy();
      expect(resolver.getTypeFromNoteId('ARCH001')).toBe('Architecture');
    });
  });

  describe('Validation', () => {
    it('should validate shortcode format', () => {
      expect(resolver.isValidShortcode('R')).toBe(true);
      expect(resolver.isValidShortcode('ARCH')).toBe(true);
      expect(resolver.isValidShortcode('US')).toBe(true);

      // Invalid formats
      expect(resolver.isValidShortcode('')).toBe(false);
      expect(resolver.isValidShortcode('123')).toBe(false);
      expect(resolver.isValidShortcode('R-1')).toBe(false);
      expect(resolver.isValidShortcode('TOOLONG')).toBe(false); // Max 5 chars
    });

    it('should validate note ID format', () => {
      expect(resolver.isValidNoteId('R001')).toBe(true);
      expect(resolver.isValidNoteId('ARCH00042')).toBe(true);
      expect(resolver.isValidNoteId('US12345')).toBe(true);

      // Invalid formats
      expect(resolver.isValidNoteId('R1')).toBe(false); // Too few digits
      expect(resolver.isValidNoteId('001')).toBe(false); // Missing type
      expect(resolver.isValidNoteId('RR001')).toBe(false); // Unknown shortcode
      expect(resolver.isValidNoteId('R-001')).toBe(false); // Invalid chars
    });

    it('should check shortcode exists in config', () => {
      expect(resolver.shortcodeExists('R')).toBe(true);
      expect(resolver.shortcodeExists('ARCH')).toBe(true);
      expect(resolver.shortcodeExists('UNKNOWN')).toBe(false);
      expect(resolver.shortcodeExists('X')).toBe(false);
    });

    it('should validate ID matches type pattern', () => {
      expect(resolver.validateNoteId('R001', 'Requirement')).toBe(true);
      expect(resolver.validateNoteId('ARCH042', 'Architecture')).toBe(true);

      // Mismatches
      expect(resolver.validateNoteId('R001', 'Decision')).toBe(false);
      expect(resolver.validateNoteId('D001', 'Requirement')).toBe(false);
    });

    it('should support custom validation rules', () => {
      // Add rule: UserStory IDs must be >= US1000
      resolver.addValidationRule('UserStory', (noteId: string) => {
        const match = noteId.match(/^US(\d+)$/);
        if (!match) return false;
        return parseInt(match[1]) >= 1000;
      });

      expect(resolver.isValidNoteId('US1000')).toBe(true);
      expect(resolver.isValidNoteId('US999')).toBe(false);
    });
  });

  describe('Type Registry Management', () => {
    it('should detect shortcode conflicts when adding new types', () => {
      // Try to add conflicting shortcode
      const conflicts = resolver.detectConflicts({
        NewType: { folder: 'new', shortcode: 'R' }, // R already exists
      });

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toEqual({
        shortcode: 'R',
        existingType: 'Requirement',
        conflictingType: 'NewType',
      });
    });

    it('should validate unknown shortcodes against registry', () => {
      // Given a list of shortcodes found in the system
      const foundShortcodes = ['R', 'D', 'ARCH', 'UNKNOWN', 'X'];

      const validation = resolver.validateShortcodes(foundShortcodes);

      expect(validation.valid).toEqual(['R', 'D', 'ARCH']);
      expect(validation.unknown).toEqual(['UNKNOWN', 'X']);
    });

    it('should generate configuration snippet for new type', () => {
      const snippet = resolver.generateConfigSnippet({
        name: 'APISpec',
        shortcode: 'API',
        folder: 'api-specs',
      });

      expect(snippet).toBe("APISpec: { folder: 'api-specs', shortcode: 'API' }");
    });

    it('should provide type statistics from counts', () => {
      const counts = {
        Requirement: 42,
        Decision: 17,
        Question: 8,
        Architecture: 3,
        UserStory: 25,
      };

      const stats = resolver.calculateTypeStatistics(counts);

      expect(stats.totalNotes).toBe(95);
      expect(stats.typeDistribution['Requirement']).toBeCloseTo(44.2, 1);
      expect(stats.mostUsedType).toBe('Requirement');
      expect(stats.leastUsedType).toBe('Architecture');
    });
  });

  describe('Configuration Sync', () => {
    it('should update when configuration changes', async () => {
      const originalType = resolver.getTypeByShortcode('R');
      expect(originalType?.folder).toBe('requirements');

      // Update config
      const updatedConfig = await configManager.mergeConfig({
        noteTypes: {
          Requirement: { folder: 'reqs', shortcode: 'R' }, // Changed folder
        },
      });

      // Resolver should auto-update
      await resolver.syncWithConfig();
      const updatedType = resolver.getTypeByShortcode('R');
      expect(updatedType?.folder).toBe('reqs');
    });

    it('should handle type additions at runtime', async () => {
      expect(resolver.getTypeByShortcode('EPIC')).toBeNull();

      await configManager.mergeConfig({
        noteTypes: {
          Epic: { folder: 'epics', shortcode: 'EPIC' },
        },
      });

      await resolver.syncWithConfig();
      const epicType = resolver.getTypeByShortcode('EPIC');
      expect(epicType).toBeTruthy();
      expect(epicType?.name).toBe('Epic');
    });

    it('should handle type removals gracefully', async () => {
      expect(resolver.getTypeByShortcode('Q')).toBeTruthy();

      // Remove Question type
      const config = await configManager.getConfig();
      delete config.noteTypes.Question;
      await configManager.setConfig(config);

      await resolver.syncWithConfig();
      expect(resolver.getTypeByShortcode('Q')).toBeNull();
    });

    it('should validate configuration on load', () => {
      const invalidConfig = {
        noteTypes: {
          Invalid1: { folder: 'test', shortcode: '' }, // Empty shortcode
          Invalid2: { folder: '', shortcode: 'I2' }, // Empty folder is OK (folder is optional)
          Valid: { folder: 'valid', shortcode: 'V' },
        },
      };

      const errors = resolver.validateConfiguration(invalidConfig.noteTypes);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Invalid1');
    });

    it('should emit events on type changes', async () => {
      const events: any[] = [];
      resolver.on('typeAdded', (e) => events.push({ type: 'added', ...e }));
      resolver.on('typeRemoved', (e) => events.push({ type: 'removed', ...e }));
      resolver.on('typeUpdated', (e) => events.push({ type: 'updated', ...e }));

      // Add new type
      await configManager.mergeConfig({
        noteTypes: {
          Feature: { folder: 'features', shortcode: 'F' },
        },
      });
      await resolver.syncWithConfig();

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('added');
      expect(events[0].noteType).toBe('Feature');
    });
  });

  describe('Type Listing', () => {
    it('should list all available note types', () => {
      const types = resolver.getAllTypes();

      expect(types).toHaveLength(5); // 5 configured types
      expect(types.map((t) => t.name)).toContain('Requirement');
      expect(types.map((t) => t.name)).toContain('Decision');
      expect(types.map((t) => t.name)).toContain('Architecture');
    });

    it('should provide type metadata', () => {
      const metadata = resolver.getTypeMetadata('Requirement');

      expect(metadata).toEqual({
        name: 'Requirement',
        shortcode: 'R',
        folder: 'requirements',
        idPattern: /^R\d{3,3}$/,
        exampleId: 'R001',
        description: expect.any(String),
      });
    });

    it('should sort types by various criteria', () => {
      const byName = resolver.getAllTypes({ sortBy: 'name' });
      expect(byName[0].name).toBe('Architecture');
      expect(byName[byName.length - 1].name).toBe('UserStory');

      const byShortcode = resolver.getAllTypes({ sortBy: 'shortcode' });
      expect(byShortcode[0].shortcode).toBe('ARCH');

      const byFolder = resolver.getAllTypes({ sortBy: 'folder' });
      // Filter to only types with folders (in case any have null folder)
      const folderedTypes = byFolder.filter((t) => t.folder !== null);
      expect(folderedTypes[0].folder).toBe('architecture');
    });

    it('should filter types by properties', () => {
      const singleChar = resolver.getAllTypes({
        filter: (type) => type.shortcode.length === 1,
      });
      expect(singleChar).toHaveLength(3); // R, D, Q

      const multiChar = resolver.getAllTypes({
        filter: (type) => type.shortcode.length > 1,
      });
      expect(multiChar).toHaveLength(2); // ARCH, US
    });

    it('should group types by tag', () => {
      // Add tags to types
      resolver.setTagMapping({
        Requirement: 'planning',
        UserStory: 'planning',
        Decision: 'design',
        Architecture: 'design',
        Question: 'communication',
      });

      const grouped = resolver.getTypesGroupedByTag();

      expect(grouped.planning).toHaveLength(2);
      expect(grouped.design).toHaveLength(2);
      expect(grouped.communication).toHaveLength(1);
      expect(grouped.planning.map((t) => t.name)).toContain('Requirement');
      expect(grouped.planning.map((t) => t.name)).toContain('UserStory');
    });
  });

  describe('Shortcode Management', () => {
    it('should ensure shortcode uniqueness', () => {
      const shortcodes = resolver.getAllShortcodes();
      const uniqueShortcodes = new Set(shortcodes);
      expect(shortcodes.length).toBe(uniqueShortcodes.size);
    });

    it('should validate shortcode length limits', () => {
      expect(resolver.isValidShortcodeLength('R')).toBe(true);
      expect(resolver.isValidShortcodeLength('ARCH')).toBe(true);
      expect(resolver.isValidShortcodeLength('ABCDE')).toBe(true); // 5 chars max
      expect(resolver.isValidShortcodeLength('TOOLONG')).toBe(false);
      expect(resolver.isValidShortcodeLength('')).toBe(false);
    });

    it('should handle shortcode conflicts', () => {
      const result = resolver.tryAddType({
        name: 'Review',
        shortcode: 'R', // Already taken
        folder: 'reviews',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already in use');
    });

    it('should support shortcode aliases', () => {
      // Add aliases
      resolver.addShortcodeAlias('REQ', 'R'); // REQ -> Requirement
      resolver.addShortcodeAlias('DEC', 'D'); // DEC -> Decision

      expect(resolver.getTypeByShortcode('REQ')).toEqual(resolver.getTypeByShortcode('R'));
      expect(resolver.getTypeByShortcode('DEC')).toEqual(resolver.getTypeByShortcode('D'));

      // Aliases should work in ID validation too
      expect(resolver.isValidNoteId('REQ001')).toBe(true);
      expect(resolver.getTypeFromNoteId('DEC042')).toBe('Decision');
    });
  });

  describe('Integration with ConfigManager', () => {
    it('should react to config manager events', async () => {
      let eventFired = false;
      resolver.on('configUpdated', () => {
        eventFired = true;
      });

      // Trigger config change
      await configManager.mergeConfig({
        noteTypes: {
          NewType: { folder: 'new', shortcode: 'N' },
        },
      });

      // Wait for event propagation
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(eventFired).toBe(true);
      expect(resolver.getTypeByShortcode('N')).toBeTruthy();
    });

    it('should invalidate cache on config change', async () => {
      // Warm up cache
      resolver.getTypeByShortcode('R');
      const cacheHitsBefore = resolver.getCacheStats().hits;

      // Change config
      await configManager.mergeConfig({
        noteTypes: {
          Requirement: { folder: 'reqs-updated', shortcode: 'R' },
        },
      });
      await resolver.syncWithConfig();

      // Cache should be cleared
      const cacheHitsAfter = resolver.getCacheStats().hits;
      expect(cacheHitsAfter).toBe(0);

      // Should get updated value
      const type = resolver.getTypeByShortcode('R');
      expect(type?.folder).toBe('reqs-updated');
    });

    it('should handle config manager errors', async () => {
      // Mock config manager to throw error
      const errorConfig = new ConfigManager('/invalid/path');

      // Mock the config property getter to throw
      Object.defineProperty(errorConfig, 'config', {
        get: () => {
          throw new Error('Config load failed');
        },
      });

      expect(() => {
        const resolver = new NoteTypeResolver(errorConfig);
        resolver.initialize();
      }).toThrow('Config load failed');
    });

    it('should support multiple config sources', async () => {
      // First source
      await configManager.setConfig({
        noteTypes: {
          Type1: { folder: 'type1', shortcode: 'T1' },
        },
      });

      // Additional types from another source
      const additionalTypes = {
        Type2: { folder: 'type2', shortcode: 'T2' },
        Type3: { folder: 'type3', shortcode: 'T3' },
      };

      resolver.mergeTypesFromSource(additionalTypes);

      expect(resolver.getAllTypes()).toHaveLength(3); // Type1, Type2, Type3
      expect(resolver.getTypeByShortcode('T1')).toBeTruthy();
      expect(resolver.getTypeByShortcode('T2')).toBeTruthy();
      expect(resolver.getTypeByShortcode('T3')).toBeTruthy();
    });

    it('should validate config on initialization', async () => {
      // Create config with invalid types
      const invalidConfig = new ConfigManager(testProjectPath);

      // This should throw when trying to set the invalid config
      await expect(
        invalidConfig.setConfig({
          noteTypes: {
            Invalid: { folder: '', shortcode: 'I' }, // Empty folder
          },
        }),
      ).rejects.toThrow();
    });
  });
});
