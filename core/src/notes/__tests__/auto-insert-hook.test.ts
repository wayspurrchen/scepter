/**
 * Auto-insert hook tests for `NoteManager.createNote`. Realizes
 * TS001 §9 (auto-insert at note creation time).
 *
 * @validates {S004.§5.AC.01}
 * @validates {S004.§5.AC.02}
 * @validates {S004.§5.AC.03}
 * @validates {S004.§5.AC.04}
 * @validates {S004.§5.AC.05}
 * @validates {S004.§5.AC.06}
 * @validates {S004.§5.AC.07}
 * @validates {DD017.DC.30}
 * @validates {DD017.DC.31}
 * @validates {DD017.DC.32}
 * @validates {DD017.DC.33}
 * @validates {TS001.§9.AC.01}
 * @validates {TS001.§9.AC.02}
 * @validates {TS001.§9.AC.03}
 * @validates {TS001.§9.AC.04}
 * @validates {TS001.§9.AC.05}
 * @validates {TS001.§9.AC.06}
 * @validates {TS001.§9.AC.07}
 * @validates {TS001.§9.AC.08}
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs-extra';
import matter from 'gray-matter';
import { setupFullTestProject } from '../../test-utils/integration-test-helpers.js';
import type { TestContext } from '../../test-utils/integration-test-helpers.js';
import type { SCEpterConfig } from '../../types/config.js';

const HOOK_TEST_CONFIG_BASE: SCEpterConfig = {
  noteTypes: {
    Requirement: { shortcode: 'R', folder: 'requirements' },
  },
  paths: {
    notesRoot: '_scepter/notes',
    dataDir: '_scepter',
  },
  discoveryPaths: ['_scepter'],
};

function configWith(overrides: Partial<NonNullable<SCEpterConfig['claims']>['confidence']>): SCEpterConfig {
  return {
    ...HOOK_TEST_CONFIG_BASE,
    claims: {
      confidence: { ...overrides },
    },
  };
}

describe('S004.§5.AC.01: auto-insert default — autoInsert undefined → true', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject('auto-insert-default', HOOK_TEST_CONFIG_BASE);
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
    vi.useRealTimers();
  });

  it('createNote produces a .md file with confidence: "🤖2 <today>"', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T12:00:00Z'));
    const note = await ctx.noteManager.createNote({
      type: 'Requirement',
      title: 'Auto Test',
      content: '# Auto\n\nbody\n',
      tags: [],
    });
    expect(note.filePath).toBeDefined();
    const onDisk = await fs.readFile(note.filePath!, 'utf-8');
    const parsed = matter(onDisk);
    expect(parsed.data.confidence).toBe('🤖2 2026-05-05');
  });
});

describe('S004.§5.AC.01: idempotence on direct double-call (TS001.§9.AC.02)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject('auto-insert-idempotent', HOOK_TEST_CONFIG_BASE);
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
    vi.useRealTimers();
  });

  it('calling maybeAutoInsertConfidence twice on the same path yields one annotation, byte-identically', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T12:00:00Z'));

    // Seed a fresh note via createNote. The first call to the hook
    // happens inside createNote; we then call it directly a second time
    // to verify that idempotence holds — frontmatter idempotence per
    // S003.§4.AC.08 means the second insert byte-equals the first.
    const note = await ctx.noteManager.createNote({
      type: 'Requirement',
      title: 'Idempotent',
      content: '# X\n\nbody\n',
      tags: [],
    });
    const afterFirst = await fs.readFile(note.filePath!, 'utf-8');

    // Direct second call into the private hook. Bracket-access via
    // unknown to bypass TypeScript's private-member check; this is a
    // testing-only access pattern.
    const hook = (
      ctx.noteManager as unknown as {
        maybeAutoInsertConfidence: (notePath: string) => Promise<void>;
      }
    ).maybeAutoInsertConfidence.bind(ctx.noteManager);
    await hook(note.filePath!);
    const afterSecond = await fs.readFile(note.filePath!, 'utf-8');

    // Byte-identical content after the second call.
    expect(afterSecond).toBe(afterFirst);
    // And the on-disk content has exactly one confidence key.
    const confidenceLines = afterSecond
      .split('\n')
      .filter((l) => /^confidence:/.test(l));
    expect(confidenceLines.length).toBe(1);
  });
});

describe('S004.§5.AC.04: autoInsert: false — no-op (no confidence key, no adapter call)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject('auto-insert-false', configWith({ autoInsert: false }));
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
    vi.restoreAllMocks();
  });

  it('createNote produces a .md file WITHOUT confidence in frontmatter', async () => {
    const note = await ctx.noteManager.createNote({
      type: 'Requirement',
      title: 'No Auto',
      content: '# No\n\nbody\n',
      tags: [],
    });
    const onDisk = await fs.readFile(note.filePath!, 'utf-8');
    const parsed = matter(onDisk);
    expect(parsed.data.confidence).toBeUndefined();
  });

  it('createNote does NOT call getAdapter when autoInsert is false', async () => {
    const registryModule = await import('../../claims/confidence/registry.js');
    const spy = vi.spyOn(registryModule, 'getAdapter');
    await ctx.noteManager.createNote({
      type: 'Requirement',
      title: 'No Auto Spy',
      content: 'body',
      tags: [],
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('S004.§5.AC.03: template precedence — confidence in template content is preserved', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject('auto-insert-template', HOOK_TEST_CONFIG_BASE);
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
  });

  it('createNote with content already containing a confidence frontmatter does NOT overwrite it', async () => {
    const templateContent = '---\nconfidence: "👤4 2025-01-01"\n---\nbody\n';
    const note = await ctx.noteManager.createNote({
      type: 'Requirement',
      title: 'Template With Confidence',
      content: templateContent,
      tags: [],
    });
    const onDisk = await fs.readFile(note.filePath!, 'utf-8');
    const parsed = matter(onDisk);
    expect(parsed.data.confidence).toMatch(/^👤4 2025-01-01/);
  });
});

describe('S004.§5.AC.05: null-adapter silent no-op', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject('auto-insert-null-adapter', HOOK_TEST_CONFIG_BASE);
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
    vi.restoreAllMocks();
  });

  it('when getAdapter returns null, createNote succeeds without warning and without writing confidence', async () => {
    const registryModule = await import('../../claims/confidence/registry.js');
    vi.spyOn(registryModule, 'getAdapter').mockReturnValue(null);
    const warnings: unknown[] = [];
    ctx.noteManager.on('warning', (w: unknown) => warnings.push(w));
    const note = await ctx.noteManager.createNote({
      type: 'Requirement',
      title: 'Null Adapter',
      content: '---\ntype: Requirement\n---\nbody\n',
      tags: [],
    });
    expect(note).toBeDefined();
    const onDisk = await fs.readFile(note.filePath!, 'utf-8');
    const parsed = matter(onDisk);
    expect(parsed.data.confidence).toBeUndefined();
    // No warnings emitted.
    const autoInsertWarnings = warnings.filter(
      (w): w is { type: string } =>
        typeof w === 'object' &&
        w !== null &&
        'type' in w &&
        (w as { type: unknown }).type === 'auto_insert_failed',
    );
    expect(autoInsertWarnings).toEqual([]);
  });
});

describe('S004.§5.AC.06: failure isolation — adapter.insert throw does not block creation', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject('auto-insert-failure', HOOK_TEST_CONFIG_BASE);
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
    vi.restoreAllMocks();
  });

  it('when adapter.insert throws, createNote returns successfully and emits a warning', async () => {
    const adapterModule = await import(
      '../../claims/confidence/adapters/markdown-frontmatter.js'
    );
    vi.spyOn(adapterModule.markdownFrontmatterAdapter, 'insert').mockImplementation(() => {
      throw new Error('synthetic auto-insert failure');
    });
    const warnings: unknown[] = [];
    ctx.noteManager.on('warning', (w: unknown) => warnings.push(w));

    const note = await ctx.noteManager.createNote({
      type: 'Requirement',
      title: 'Insert Throws',
      content: '---\ntype: Requirement\n---\nbody\n',
      tags: [],
    });

    expect(note).toBeDefined();
    expect(note.id).toMatch(/^R\d+/);
    // The on-disk file should exist with the original content (no
    // confidence key inserted, since insert threw).
    const onDisk = await fs.readFile(note.filePath!, 'utf-8');
    const parsed = matter(onDisk);
    expect(parsed.data.confidence).toBeUndefined();
    // A warning event MUST be emitted.
    const autoInsertWarnings = warnings.filter(
      (w): w is { type: string; message: string; notePath: string } =>
        typeof w === 'object' &&
        w !== null &&
        'type' in w &&
        (w as { type: unknown }).type === 'auto_insert_failed',
    );
    expect(autoInsertWarnings.length).toBe(1);
    expect(autoInsertWarnings[0].message).toContain('synthetic auto-insert failure');
    expect(autoInsertWarnings[0].notePath).toBe(note.filePath);
  });
});

describe('R013.§1.AC.06: includeDate: false on auto-insert omits the date', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject(
      'auto-insert-no-date',
      configWith({ autoInsert: true, includeDate: false }),
    );
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
  });

  it('writes confidence: "🤖2" (no date, no trailing space)', async () => {
    const note = await ctx.noteManager.createNote({
      type: 'Requirement',
      title: 'No Date Auto',
      content: '# X\n\nbody\n',
      tags: [],
    });
    const onDisk = await fs.readFile(note.filePath!, 'utf-8');
    const parsed = matter(onDisk);
    expect(parsed.data.confidence).toBe('🤖2');
  });
});

describe('S004.§5.AC.07: hook scope — only createNote invokes the hook', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject('auto-insert-scope', HOOK_TEST_CONFIG_BASE);
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
    vi.restoreAllMocks();
  });

  it('updateNote does not invoke getAdapter for confidence', async () => {
    // First create a note so we can update it.
    const note = await ctx.noteManager.createNote({
      type: 'Requirement',
      title: 'For Update',
      content: 'body',
      tags: [],
    });

    const registryModule = await import('../../claims/confidence/registry.js');
    const spy = vi.spyOn(registryModule, 'getAdapter');
    spy.mockClear();

    await ctx.noteManager.updateNote(note.id, {
      title: 'For Update Renamed',
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
