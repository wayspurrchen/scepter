/**
 * Filter resolver tests for `core/src/claims/confidence/filters.ts`.
 * Realizes TS001 §5 (filter resolution).
 *
 * @validates {S004.§1.AC.01-06}
 * @validates {DD017.DC.01-04}
 * @validates {TS001.§5.AC.01-07}
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs-extra';
import { setupFullTestProject } from '../../../test-utils/integration-test-helpers.js';
import type { TestContext } from '../../../test-utils/integration-test-helpers.js';
import {
  resolveFiles,
  FilterContradictionError,
  __FILTERS_FOR_TEST,
} from '../filters.js';
import type { SCEpterConfig } from '../../../types/config.js';

const FILTERS_TEST_CONFIG: SCEpterConfig = {
  noteTypes: {
    Decision: { shortcode: 'D', folder: 'decisions' },
    Requirement: {
      shortcode: 'R',
      folder: 'requirements',
      allowedTags: ['security', 'migration'],
    },
    Spec: { shortcode: 'S', folder: 'specs' },
  },
  paths: {
    notesRoot: '_scepter/notes',
    dataDir: '_scepter',
  },
  sourceCodeIntegration: {
    enabled: true,
    folders: ['core/src'],
    extensions: ['.ts', '.js'],
    exclude: ['core/dist/**', 'node_modules/**'],
  },
  discoveryPaths: ['_scepter'],
  discoveryExclude: ['_archive'],
};

async function seedNotes(ctx: TestContext): Promise<void> {
  await ctx.noteManager.createNote({
    type: 'Requirement',
    title: 'Foo',
    content: 'security note',
    tags: ['security'],
  });
  await ctx.noteManager.createNote({
    type: 'Requirement',
    title: 'Bar',
    content: 'migration note',
    tags: ['migration'],
  });
  await ctx.noteManager.createNote({
    type: 'Spec',
    title: 'Spec One',
    content: 'security spec',
    tags: ['security'],
  });
  await ctx.noteManager.createNote({
    type: 'Decision',
    title: 'Untagged Decision',
    content: 'no tags',
    tags: [],
  });
}

async function seedSourceFile(ctx: TestContext, relPath: string, body: string): Promise<void> {
  const abs = path.join(ctx.projectPath, relPath);
  await fs.ensureDir(path.dirname(abs));
  await fs.writeFile(abs, body, 'utf-8');
}

describe('S004.§1: filter resolver — categories and scope tagging', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject('filters-categories', FILTERS_TEST_CONFIG);
    await seedNotes(ctx);
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
  });

  it('S004.§1.AC.02: AND-across categories, OR-within — types narrows to Requirement', async () => {
    const result = await resolveFiles(ctx.projectManager!, { types: ['Requirement'] });
    expect(result.length).toBe(2);
    expect(result.every((f) => f.scope === 'notes')).toBe(true);
  });

  it('S004.§1.AC.02: types Requirement,Spec AND tags security narrows to security-tagged', async () => {
    const result = await resolveFiles(ctx.projectManager!, {
      types: ['Requirement', 'Spec'],
      tags: ['security'],
    });
    // Two security-tagged notes match (one Requirement, one Spec); the
    // migration-tagged Requirement must be excluded by the tags filter.
    expect(result.length).toBe(2);
    expect(result.every((f) => f.scope === 'notes')).toBe(true);
  });

  it('S004.§1.AC.02: tags security,migration unions within the category', async () => {
    const result = await resolveFiles(ctx.projectManager!, {
      tags: ['security', 'migration'],
    });
    expect(result.length).toBe(3);
    expect(result.every((f) => f.scope === 'notes')).toBe(true);
  });
});

describe('S004.§1: filter resolver — note-only categories never match source', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject('filters-note-only-no-source', FILTERS_TEST_CONFIG);
    await seedNotes(ctx);
    await seedSourceFile(ctx, 'core/src/foo.ts', '// source\nconst x = 1;\nexport {};\n');
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
  });

  it('S004.§1.AC.03: --types matches only notes, never source', async () => {
    const result = await resolveFiles(ctx.projectManager!, { types: ['Requirement'] });
    expect(result.every((f) => f.scope === 'notes')).toBe(true);
    expect(result.every((f) => f.filePath.endsWith('.md'))).toBe(true);
  });

  it('S004.§1.AC.03: --tags matches only notes, never source', async () => {
    const result = await resolveFiles(ctx.projectManager!, { tags: ['security'] });
    expect(result.every((f) => f.scope === 'notes')).toBe(true);
    expect(result.every((f) => f.filePath.endsWith('.md'))).toBe(true);
  });
});

describe('S004.§1: filter resolver — glob can reach both scopes', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject('filters-glob-both', FILTERS_TEST_CONFIG);
    await seedNotes(ctx);
    await seedSourceFile(ctx, 'core/src/foo.ts', '// source\nconst x = 1;\nexport {};\n');
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
  });

  it('S004.§1.AC.06: --glob "**/*.{md,ts}" returns both notes and source with correct scope tags', async () => {
    const result = await resolveFiles(ctx.projectManager!, {
      glob: '**/*.{md,ts}',
    });
    const sourceMatches = result.filter((f) => f.scope === 'source');
    const noteMatches = result.filter((f) => f.scope === 'notes');
    expect(sourceMatches.length).toBeGreaterThanOrEqual(1);
    expect(sourceMatches.every((f) => f.filePath.endsWith('.ts'))).toBe(true);
    expect(noteMatches.length).toBeGreaterThanOrEqual(1);
    expect(noteMatches.every((f) => f.filePath.endsWith('.md'))).toBe(true);
  });
});

describe('S004.§1: filter resolver — contradiction detection', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject('filters-contradiction', FILTERS_TEST_CONFIG);
    await seedNotes(ctx);
    await seedSourceFile(ctx, 'core/src/foo.ts', '// source\nconst x = 1;\nexport {};\n');
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
  });

  it('S004.§1.AC.04: note-only filter + source-only glob throws FilterContradictionError', async () => {
    await expect(
      resolveFiles(ctx.projectManager!, {
        types: ['Requirement'],
        glob: 'core/src/**/*.ts',
      }),
    ).rejects.toThrow(FilterContradictionError);
  });

  it('S004.§1.AC.04: contradiction error message names both contributing filters', async () => {
    let captured: Error | null = null;
    try {
      await resolveFiles(ctx.projectManager!, {
        types: ['Requirement'],
        glob: 'core/src/**/*.ts',
      });
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeInstanceOf(FilterContradictionError);
    expect(captured!.message).toContain('--types Requirement');
    expect(captured!.message).toContain('core/src/**/*.ts');
  });
});

describe('S004.§1: filter resolver — exclusions honored', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject('filters-exclusions', FILTERS_TEST_CONFIG);
    await seedNotes(ctx);
    await seedSourceFile(ctx, 'core/src/foo.ts', '// source\nconst x = 1;\nexport {};\n');
    await seedSourceFile(
      ctx,
      'core/dist/built.ts',
      '// built; should be excluded\nconst y = 2;\nexport {};\n',
    );
    await seedSourceFile(
      ctx,
      '_scepter/_archive/R999 archived.md',
      '---\ntype: Requirement\n---\nbody\n',
    );
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
  });

  it('S004.§1.AC.05: --glob honors sourceCodeIntegration.exclude (core/dist filtered out)', async () => {
    const result = await resolveFiles(ctx.projectManager!, { glob: '**/*.ts' });
    expect(result.some((f) => f.filePath.includes('core/dist/'))).toBe(false);
  });

  it('S004.§1.AC.05: --glob honors discoveryExclude (_archive filtered out)', async () => {
    const result = await resolveFiles(ctx.projectManager!, { glob: '**/*.md' });
    expect(result.some((f) => f.filePath.includes('_archive'))).toBe(false);
  });
});

describe('S004.§1: filter resolver — scope classification helpers', () => {
  it('S004.§1.AC.06: classifyScope tags discoveryPaths as notes, sourceFolders as source', () => {
    const { classifyScope } = __FILTERS_FOR_TEST;
    expect(classifyScope('_scepter/notes/reqs/R001.md', ['_scepter'], ['core/src'], ['.ts'])).toBe(
      'notes',
    );
    expect(classifyScope('core/src/foo.ts', ['_scepter'], ['core/src'], ['.ts'])).toBe('source');
  });

  it('S004.§1.AC.06: scope-tagging precedence — notes win the overlap', () => {
    const { classifyScope } = __FILTERS_FOR_TEST;
    // Same root for both (a project that uses "." for discovery and a
    // sub-folder for source where the discovery root is a parent of the
    // source root). Notes wins by classifier ordering (notes check first).
    expect(classifyScope('core/src/foo.ts', ['.', '_scepter'], ['core/src'], ['.ts'])).toBe('notes');
  });

  it('S004.§1.AC.06: classifyScope returns null for files matching neither root', () => {
    const { classifyScope } = __FILTERS_FOR_TEST;
    expect(classifyScope('docs/random.md', ['_scepter'], ['core/src'], ['.ts'])).toBe(null);
  });

  it('S004.§1.AC.06: classifyScope rejects source files with non-matching extensions', () => {
    const { classifyScope } = __FILTERS_FOR_TEST;
    expect(classifyScope('core/src/foo.txt', ['_scepter'], ['core/src'], ['.ts'])).toBe(null);
  });
});

describe('S004.§1: filter resolver — glob from project root', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject('filters-glob-root', FILTERS_TEST_CONFIG);
    await seedNotes(ctx);
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
  });

  it('S004.§1.AC.05: --glob is evaluated relative to the project root', async () => {
    // Run with a different process.cwd() to confirm the glob honors
    // projectPath rather than cwd. Save and restore cwd so we don't
    // leak this state to other tests.
    const originalCwd = process.cwd();
    try {
      process.chdir(path.dirname(ctx.projectPath));
      const result = await resolveFiles(ctx.projectManager!, { glob: '**/*.md' });
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((f) => f.filePath.startsWith(ctx.projectPath))).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
