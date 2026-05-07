/**
 * Audit tests for `core/src/claims/confidence/audit.ts`. Realizes
 * TS001 §6 (library-side audit behavior).
 *
 * @validates {S004.§2.AC.01-09}
 * @validates {DD017.DC.05-10}
 * @validates {TS001.§6.AC.01}
 * @validates {TS001.§6.AC.02}
 * @validates {TS001.§6.AC.03}
 * @validates {TS001.§6.AC.07}
 * @validates {TS001.§6.AC.08}
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs-extra';
import { setupFullTestProject } from '../../../test-utils/integration-test-helpers.js';
import type { TestContext } from '../../../test-utils/integration-test-helpers.js';
import { auditConfidence } from '../audit.js';
import type { SCEpterConfig } from '../../../types/config.js';

const AUDIT_TEST_CONFIG: SCEpterConfig = {
  noteTypes: {
    Decision: { shortcode: 'D', folder: 'decisions' },
    Requirement: { shortcode: 'R', folder: 'requirements' },
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
};

async function seedSourceFile(ctx: TestContext, relPath: string, body: string): Promise<void> {
  const abs = path.join(ctx.projectPath, relPath);
  await fs.ensureDir(path.dirname(abs));
  await fs.writeFile(abs, body, 'utf-8');
}

describe('S004.§2: auditConfidence — multi-scope', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject('audit-multi-scope', AUDIT_TEST_CONFIG);
    // Seed: one annotated source file, one unannotated source file,
    // one annotated note, one unannotated note.
    await seedSourceFile(
      ctx,
      'core/src/annotated.ts',
      '// @confidence 🤖2 2026-05-05\nconst x = 1;\nexport {};\n',
    );
    await seedSourceFile(
      ctx,
      'core/src/bare.ts',
      'const x = 1;\nexport {};\n',
    );
    await ctx.noteManager.createNote({
      type: 'Requirement',
      title: 'Annotated Note',
      content: 'body',
      tags: [],
      additionalFrontmatter: { confidence: '👤4 2026-05-05' },
    } as Parameters<typeof ctx.noteManager.createNote>[0]);
    await ctx.noteManager.createNote({
      type: 'Requirement',
      title: 'Bare Note',
      content: 'body',
      tags: [],
    });
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
  });

  it('S004.§2.AC.05: result carries bySource and byNotes substructures with all six fields', async () => {
    const result = await auditConfidence(ctx.projectManager!);
    expect(result.bySource).toBeDefined();
    expect(result.byNotes).toBeDefined();
    for (const sub of [result.bySource, result.byNotes]) {
      expect(sub.total).toBeTypeOf('number');
      expect(sub.annotated).toBeTypeOf('number');
      expect(sub.unannotated).toBeTypeOf('number');
      expect(sub.byLevel).toEqual(expect.objectContaining({ 1: expect.any(Number) }));
      expect(Array.isArray(sub.files)).toBe(true);
      expect(Array.isArray(sub.unannotatedFiles)).toBe(true);
    }
  });

  it('S004.§2.AC.05: unrun scope is zero-valued, never undefined (--source-only)', async () => {
    const result = await auditConfidence(ctx.projectManager!, { scope: 'source' });
    expect(result.byNotes.total).toBe(0);
    expect(result.byNotes.annotated).toBe(0);
    expect(result.byNotes.unannotated).toBe(0);
    expect(result.byNotes.byLevel).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    expect(result.byNotes.files).toEqual([]);
    expect(result.byNotes.unannotatedFiles).toEqual([]);
  });

  it('S004.§2.AC.05: unrun scope is zero-valued (--notes-only)', async () => {
    const result = await auditConfidence(ctx.projectManager!, { scope: 'notes' });
    expect(result.bySource.total).toBe(0);
    expect(result.bySource.files).toEqual([]);
    expect(result.bySource.unannotatedFiles).toEqual([]);
  });

  it('S004.§2.AC.09: top-level fields equal the union of bySource and byNotes', async () => {
    const result = await auditConfidence(ctx.projectManager!);
    expect(result.total).toBe(result.bySource.total + result.byNotes.total);
    expect(result.annotated).toBe(result.bySource.annotated + result.byNotes.annotated);
    expect(result.unannotated).toBe(result.bySource.unannotated + result.byNotes.unannotated);
    for (const level of [1, 2, 3, 4, 5] as const) {
      expect(result.byLevel[level]).toBe(
        result.bySource.byLevel[level] + result.byNotes.byLevel[level],
      );
    }
    expect(result.files.length).toBe(result.bySource.files.length + result.byNotes.files.length);
    expect(result.unannotatedFiles.length).toBe(
      result.bySource.unannotatedFiles.length + result.byNotes.unannotatedFiles.length,
    );
  });

  it('S004.§2.AC.02: --source-only does not walk discoveryPaths (no notes in result)', async () => {
    const result = await auditConfidence(ctx.projectManager!, { scope: 'source' });
    expect(result.byNotes.total).toBe(0);
    // Source totals should reflect only source files.
    expect(result.bySource.total).toBeGreaterThanOrEqual(2);
  });

  it('S004.§2.AC.02: --notes-only does not call discoverSourceFiles (no source in result)', async () => {
    const result = await auditConfidence(ctx.projectManager!, { scope: 'notes' });
    expect(result.bySource.total).toBe(0);
    // Note totals should reflect only note files.
    expect(result.byNotes.total).toBeGreaterThanOrEqual(2);
  });
});

describe('S004.§2: auditConfidence — getAdapter null-skip and legacy compat', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject('audit-null-adapter', AUDIT_TEST_CONFIG);
    // .ts file (has adapter) + .txt file in core/src (no adapter for .txt)
    // Note: .txt isn't in extensions for sourceCodeIntegration, so it
    // wouldn't even be discovered. Use .json which IS in folders but
    // has no extension match... actually use a file that .ts adapter
    // won't claim. Per registry, c-family adapter handles .ts/.js/.cjs/
    // .mjs/.tsx/.jsx/.c/.h/.cpp/.hpp/.cc/.cs. A .json file under
    // core/src with extensions filter set to [.ts, .js] won't be
    // discovered, so the null-skip needs a different setup.
    //
    // Use a forced extensions config: include .json in extensions but
    // .json has no adapter, so getAdapter returns null and the file is
    // skipped.
    await seedSourceFile(ctx, 'core/src/data.json', '{}');
    await seedSourceFile(
      ctx,
      'core/src/foo.ts',
      'const x = 1;\nexport {};\n',
    );
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
  });

  it('S004.§2.AC.04: files with no matching adapter are silently omitted', async () => {
    // Force .json into the extensions list so it IS discovered, then
    // verify it doesn't appear in the result (getAdapter returns null
    // for .json).
    const config = ctx.configManager.getConfig();
    config.sourceCodeIntegration!.extensions = ['.ts', '.json'];
    await ctx.configManager.setConfig(config);

    const result = await auditConfidence(ctx.projectManager!, { scope: 'source' });
    // Only .ts file should be counted. .json has no adapter → silent skip.
    expect(result.bySource.total).toBe(1);
    expect(
      result.bySource.unannotatedFiles.some((f) => f.endsWith('foo.ts')),
    ).toBe(true);
    expect(
      result.bySource.unannotatedFiles.some((f) => f.endsWith('data.json')),
    ).toBe(false);
  });

  it('S004.§2.AC.09: legacy consumer reading only top-level fields still works', async () => {
    const result = await auditConfidence(ctx.projectManager!);
    // Pretend to be a pre-{R013} consumer that only knows about the
    // legacy single-scope shape. It reads total, annotated, unannotated,
    // byLevel, files, unannotatedFiles — the same fields the legacy
    // signature returned.
    function legacyConsumer(r: typeof result): {
      total: number;
      annotated: number;
      byLevel1: number;
      filesCount: number;
    } {
      return {
        total: r.total,
        annotated: r.annotated,
        byLevel1: r.byLevel[1],
        filesCount: r.files.length,
      };
    }
    const summary = legacyConsumer(result);
    expect(summary.total).toBeTypeOf('number');
    expect(summary.annotated).toBeTypeOf('number');
    expect(summary.byLevel1).toBeTypeOf('number');
    expect(summary.filesCount).toBeTypeOf('number');
  });
});
