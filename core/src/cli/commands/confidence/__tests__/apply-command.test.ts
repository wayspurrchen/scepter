/**
 * Apply command tests. Realizes TS001 §8 (action classification, dry-run
 * accuracy, no-filters vs zero-match distinction, failure isolation,
 * filter contradiction error path).
 *
 * @validates {S004.§4.AC.01}
 * @validates {S004.§4.AC.02}
 * @validates {S004.§4.AC.03}
 * @validates {S004.§4.AC.04}
 * @validates {S004.§4.AC.05}
 * @validates {S004.§4.AC.06}
 * @validates {S004.§4.AC.07}
 * @validates {S004.§4.AC.08}
 * @validates {S004.§4.AC.09}
 * @validates {DD017.DC.20}
 * @validates {DD017.DC.21}
 * @validates {DD017.DC.22}
 * @validates {DD017.DC.23}
 * @validates {DD017.DC.24}
 * @validates {DD017.DC.25}
 * @validates {DD017.DC.26}
 * @validates {DD017.DC.27}
 * @validates {DD017.DC.28}
 * @validates {TS001.§8.AC.01}
 * @validates {TS001.§8.AC.02}
 * @validates {TS001.§8.AC.03}
 * @validates {TS001.§8.AC.04}
 * @validates {TS001.§8.AC.05}
 * @validates {TS001.§8.AC.06}
 * @validates {TS001.§8.AC.07}
 * @validates {TS001.§8.AC.09}
 * @validates {TS001.§8.AC.10}
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs-extra';
import { setupFullTestProject } from '../../../../test-utils/integration-test-helpers.js';
import type { TestContext } from '../../../../test-utils/integration-test-helpers.js';
import { executeApply } from '../apply-command.js';
import type { SCEpterConfig } from '../../../../types/config.js';

const APPLY_TEST_CONFIG: SCEpterConfig = {
  noteTypes: {
    Requirement: { shortcode: 'R', folder: 'requirements' },
    Decision: { shortcode: 'D', folder: 'decisions' },
  },
  paths: {
    notesRoot: '_scepter/notes',
    dataDir: '_scepter',
  },
  sourceCodeIntegration: {
    enabled: true,
    folders: ['core/src'],
    extensions: ['.ts', '.js'],
    exclude: [],
  },
  discoveryPaths: ['_scepter'],
};

async function seedSource(ctx: TestContext, relPath: string, body: string): Promise<string> {
  const abs = path.join(ctx.projectPath, relPath);
  await fs.ensureDir(path.dirname(abs));
  await fs.writeFile(abs, body, 'utf-8');
  return abs;
}

describe('S004.§4: apply — argument validation and filter resolution', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject('apply-validation', APPLY_TEST_CONFIG);
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
  });

  it('S004.§4.AC.02: no-filters error — exits non-zero with no-filters-supplied message', async () => {
    const result = await executeApply(ctx.projectManager!, {
      reviewerArg: 'human',
      levelArg: '4',
      filters: {},
      skipAnnotated: true,
      overwrite: false,
      dryRun: false,
      verbose: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('no-filters');
      expect(result.message).toContain('no filters supplied');
    }
  });

  it('S004.§4.AC.09: zero-matches with filters — succeeds with empty rows (no files written)', async () => {
    await ctx.noteManager.createNote({
      type: 'Requirement',
      title: 'Foo',
      content: 'body',
      tags: [],
    });
    const result = await executeApply(ctx.projectManager!, {
      reviewerArg: 'human',
      levelArg: '4',
      filters: { tags: ['nonexistent-tag-zzz'] },
      skipAnnotated: true,
      overwrite: false,
      dryRun: false,
      verbose: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toEqual([]);
      expect(result.outcome.marked).toBe(0);
      expect(result.outcome.failed).toEqual([]);
    }
  });

  it('S004.§4.AC.02: invalid reviewer fails before filter resolution', async () => {
    const result = await executeApply(ctx.projectManager!, {
      reviewerArg: 'unknown',
      levelArg: '4',
      filters: { types: ['Requirement'] },
      skipAnnotated: true,
      overwrite: false,
      dryRun: false,
      verbose: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-reviewer');
  });

  it('S004.§4.AC.02: invalid reviewer/level combo fails before filter resolution', async () => {
    const result = await executeApply(ctx.projectManager!, {
      reviewerArg: 'ai',
      levelArg: '5',
      filters: { types: ['Requirement'] },
      skipAnnotated: true,
      overwrite: false,
      dryRun: false,
      verbose: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-reviewer-level-combo');
  });

  it('S004.§1.AC.04: filter contradiction surfaces as usage error', async () => {
    await ctx.noteManager.createNote({
      type: 'Requirement',
      title: 'Foo',
      content: 'body',
      tags: [],
    });
    await seedSource(ctx, 'core/src/foo.ts', 'const x = 1;\nexport {};\n');
    const result = await executeApply(ctx.projectManager!, {
      reviewerArg: 'ai',
      levelArg: '2',
      filters: { types: ['Requirement'], glob: 'core/src/**/*.ts' },
      skipAnnotated: true,
      overwrite: false,
      dryRun: false,
      verbose: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('filter-contradiction');
      expect(result.message).toContain('--types Requirement');
    }
  });
});

describe('S004.§4: apply — action classification (DC.23)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject('apply-classification', APPLY_TEST_CONFIG);
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
  });

  it('Absent annotation + skipAnnotated=true + overwrite=false → mark', async () => {
    await seedSource(ctx, 'core/src/bare.ts', 'const x = 1;\nexport {};\n');
    const result = await executeApply(ctx.projectManager!, {
      reviewerArg: 'ai',
      levelArg: '2',
      filters: { glob: '**/*.ts' },
      skipAnnotated: true,
      overwrite: false,
      dryRun: true,
      verbose: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const row = result.rows.find((r) => r.path.endsWith('bare.ts'));
      expect(row?.action).toBe('mark');
    }
  });

  it('Present annotation + skipAnnotated=true + overwrite=false → skip-annotated', async () => {
    await seedSource(
      ctx,
      'core/src/has.ts',
      '// @confidence 🤖2 2026-01-01\nconst x = 1;\nexport {};\n',
    );
    const result = await executeApply(ctx.projectManager!, {
      reviewerArg: 'ai',
      levelArg: '2',
      filters: { glob: '**/*.ts' },
      skipAnnotated: true,
      overwrite: false,
      dryRun: true,
      verbose: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const row = result.rows.find((r) => r.path.endsWith('has.ts'));
      expect(row?.action).toBe('skip-annotated');
    }
  });

  it('Present annotation + overwrite=true → replace (overwrite suppresses skip)', async () => {
    await seedSource(
      ctx,
      'core/src/has.ts',
      '// @confidence 🤖2 2026-01-01\nconst x = 1;\nexport {};\n',
    );
    const result = await executeApply(ctx.projectManager!, {
      reviewerArg: 'ai',
      levelArg: '3',
      filters: { glob: '**/*.ts' },
      skipAnnotated: true,
      overwrite: true,
      dryRun: true,
      verbose: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const row = result.rows.find((r) => r.path.endsWith('has.ts'));
      expect(row?.action).toBe('replace');
    }
  });

  it('Adapter null (.txt under glob) → skip-unmatched', async () => {
    // Force .txt into source extensions so the glob picks it up; the
    // c-family adapter still won't match it, so action is skip-unmatched.
    const config = ctx.configManager.getConfig();
    config.sourceCodeIntegration!.extensions = ['.ts', '.txt'];
    await ctx.configManager.setConfig(config);
    await seedSource(ctx, 'core/src/data.txt', 'plain text\n');
    const result = await executeApply(ctx.projectManager!, {
      reviewerArg: 'ai',
      levelArg: '2',
      filters: { glob: '**/*.txt' },
      skipAnnotated: true,
      overwrite: false,
      dryRun: true,
      verbose: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const row = result.rows.find((r) => r.path.endsWith('data.txt'));
      expect(row?.action).toBe('skip-unmatched');
    }
  });
});

describe('S004.§4: apply — dry-run does not write', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject('apply-dry-run', APPLY_TEST_CONFIG);
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
  });

  it('S004.§4.AC.05: dry-run emits plan but writes no files', async () => {
    const abs = await seedSource(ctx, 'core/src/foo.ts', 'const x = 1;\nexport {};\n');
    const before = await fs.readFile(abs, 'utf-8');
    const result = await executeApply(ctx.projectManager!, {
      reviewerArg: 'ai',
      levelArg: '2',
      filters: { glob: '**/*.ts' },
      skipAnnotated: true,
      overwrite: false,
      dryRun: true,
      verbose: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dryRun).toBe(true);
      expect(result.rows.length).toBeGreaterThan(0);
      // outcome counters are zero in dry-run.
      expect(result.outcome.marked).toBe(0);
      expect(result.outcome.replaced).toBe(0);
    }
    const after = await fs.readFile(abs, 'utf-8');
    expect(after).toBe(before);
  });
});

describe('S004.§4: apply — wet run, mark and replace', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject('apply-wet-run', APPLY_TEST_CONFIG);
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
  });

  it('S004.§4.AC.03: wet run marks unannotated files via the C-family adapter', async () => {
    const abs = await seedSource(ctx, 'core/src/foo.ts', 'const x = 1;\nexport {};\n');
    const result = await executeApply(ctx.projectManager!, {
      reviewerArg: 'ai',
      levelArg: '2',
      filters: { glob: 'core/src/**/*.ts' },
      skipAnnotated: true,
      overwrite: false,
      dryRun: false,
      verbose: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome.marked).toBe(1);
      expect(result.outcome.failed).toEqual([]);
    }
    const after = await fs.readFile(abs, 'utf-8');
    expect(after).toContain('@confidence 🤖2');
  });

  it('S004.§4.AC.06: --overwrite replaces existing annotation', async () => {
    const abs = await seedSource(
      ctx,
      'core/src/foo.ts',
      '// @confidence 🤖1 2026-01-01\nconst x = 1;\nexport {};\n',
    );
    const result = await executeApply(ctx.projectManager!, {
      reviewerArg: 'ai',
      levelArg: '3',
      filters: { glob: 'core/src/**/*.ts' },
      skipAnnotated: true,
      overwrite: true,
      dryRun: false,
      verbose: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome.replaced).toBe(1);
    }
    const after = await fs.readFile(abs, 'utf-8');
    expect(after).toContain('🤖3');
    expect(after).not.toContain('🤖1');
  });
});

describe('S004.§4.AC.05: apply — dry-run accuracy across mixed fixture (TS001.§8.AC.02)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    // autoInsert disabled so fixture-state remains exactly as seeded —
    // the test verifies dry-run predicts wet-run; the createNote-time
    // hook would otherwise mutate fixture annotation state mid-setup.
    ctx = await setupFullTestProject('apply-dry-accuracy', {
      ...APPLY_TEST_CONFIG,
      claims: { confidence: { autoInsert: false } },
    });
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
  });

  it('the dry-run plan predicts the wet-run outcome row-for-row across 20 files', async () => {
    // Build a 20-file fixture: 10 source + 10 notes; half of each
    // pre-annotated, half bare. This exercises mark, skip-annotated,
    // and replace branches predictably.
    for (let i = 0; i < 5; i++) {
      await seedSource(
        ctx,
        `core/src/annotated-${i}.ts`,
        `// @confidence 🤖2 2026-01-${String(i + 1).padStart(2, '0')}\nconst x = ${i};\nexport {};\n`,
      );
    }
    for (let i = 0; i < 5; i++) {
      await seedSource(ctx, `core/src/bare-${i}.ts`, `const x = ${i};\nexport {};\n`);
    }
    for (let i = 0; i < 5; i++) {
      // Pre-annotated note: write the file directly with confidence
      // already in the frontmatter (createNote can't do this without
      // the autoInsert hook, which is disabled here).
      const notePath = path.join(
        ctx.projectPath,
        `_scepter/notes/requirements/R${String(100 + i).padStart(3, '0')} pre.md`,
      );
      await fs.ensureDir(path.dirname(notePath));
      await fs.writeFile(
        notePath,
        `---\ntype: Requirement\nconfidence: "👤4 2026-02-${String(i + 1).padStart(2, '0')}"\n---\nbody ${i}\n`,
        'utf-8',
      );
    }
    for (let i = 0; i < 5; i++) {
      await ctx.noteManager.createNote({
        type: 'Decision',
        title: `Bare D ${i}`,
        content: `body ${i}`,
        tags: [],
      });
    }

    // Snapshot every file's pre-state for restoration after the wet run.
    const dryArgs = {
      reviewerArg: 'human' as const,
      levelArg: '5',
      filters: { glob: '**/*.{ts,md}' },
      skipAnnotated: true,
      overwrite: false,
      dryRun: true,
      verbose: false,
    };
    const wetArgs = { ...dryArgs, dryRun: false };

    const dryResult = await executeApply(ctx.projectManager!, dryArgs);
    expect(dryResult.ok).toBe(true);

    const wetResult = await executeApply(ctx.projectManager!, wetArgs);
    expect(wetResult.ok).toBe(true);

    if (dryResult.ok && wetResult.ok) {
      // Same row count.
      expect(dryResult.rows.length).toBe(wetResult.rows.length);
      expect(dryResult.rows.length).toBe(20);

      // Build path → action maps; assert byte-identical action prediction.
      const dryByPath = new Map(dryResult.rows.map((r) => [r.path, r.action]));
      const wetByPath = new Map(wetResult.rows.map((r) => [r.path, r.action]));
      for (const [path, dryAction] of dryByPath.entries()) {
        const wetAction = wetByPath.get(path);
        expect(wetAction).toBe(dryAction);
      }

      // Sanity-check the breakdown: 5 annotated source + 5 annotated
      // notes → skip-annotated; 5 bare source + 5 bare notes → mark.
      const dryActionCounts = dryResult.rows.reduce(
        (acc: Record<string, number>, row) => {
          acc[row.action] = (acc[row.action] ?? 0) + 1;
          return acc;
        },
        {},
      );
      expect(dryActionCounts['mark']).toBe(10);
      expect(dryActionCounts['skip-annotated']).toBe(10);
    }
  });
});

describe('S004.§4.AC.05: apply — includeDate: false honored (TS001.§8.AC.09)', () => {
  let ctx: TestContext;

  afterEach(async () => {
    if (ctx) await fs.remove(ctx.projectPath);
  });

  it('writes annotations without a date when claims.confidence.includeDate is false', async () => {
    ctx = await setupFullTestProject('apply-no-date', {
      ...APPLY_TEST_CONFIG,
      claims: { confidence: { autoInsert: false, includeDate: false } },
    });
    const abs = await seedSource(ctx, 'core/src/foo.ts', 'const x = 1;\nexport {};\n');
    const result = await executeApply(ctx.projectManager!, {
      reviewerArg: 'ai',
      levelArg: '2',
      filters: { glob: 'core/src/**/*.ts' },
      skipAnnotated: true,
      overwrite: false,
      dryRun: false,
      verbose: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.outcome.marked).toBe(1);
    const updated = await fs.readFile(abs, 'utf-8');
    expect(updated).toMatch(/@confidence 🤖2(\n|$)/);
    expect(updated).not.toMatch(/@confidence 🤖2 \d{4}-\d{2}-\d{2}/);
  });
});

describe('S004.§4.AC.07: apply — per-file failure isolation', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    // autoInsert disabled so createNote files don't already carry a
    // confidence annotation — the failure-isolation test wants apply to
    // see them as unannotated (action=mark) so the per-file try/catch
    // around adapter.insert is what determines mark vs failed.
    ctx = await setupFullTestProject('apply-failure-isolation', {
      ...APPLY_TEST_CONFIG,
      claims: { confidence: { autoInsert: false } },
    });
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
    vi.restoreAllMocks();
  });

  it('continues across valid files when adapter.insert throws on one of them', async () => {
    // Three valid notes via createNote.
    await ctx.noteManager.createNote({
      type: 'Requirement',
      title: 'A',
      content: 'a',
      tags: [],
    });
    await ctx.noteManager.createNote({
      type: 'Requirement',
      title: 'B',
      content: 'b',
      tags: [],
    });
    await ctx.noteManager.createNote({
      type: 'Requirement',
      title: 'C',
      content: 'c',
      tags: [],
    });
    // A fourth file. We force adapter.insert to throw when called
    // against this file's path — verifying the apply loop's per-file
    // try/catch isolation contract directly. Real malformed YAML can't
    // reliably trigger this through gray-matter's per-input rejection
    // cache (parse() consumes the throw slot before insert() is called).
    const targetPath = path.join(
      ctx.projectPath,
      '_scepter/notes/decisions/D999 mocked-throw.md',
    );
    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, '---\ntype: Decision\n---\nbody\n', 'utf-8');

    const adapterModule = await import('../../../../claims/confidence/adapters/markdown-frontmatter.js');
    const realInsert = adapterModule.markdownFrontmatterAdapter.insert;
    const insertSpy = vi
      .spyOn(adapterModule.markdownFrontmatterAdapter, 'insert')
      .mockImplementation((content, payload) => {
        // Throw only for this test's target file. The parse-time call
        // already returned null for this file's content, so the action
        // classification is 'mark' and we reach insert.
        // Identify the file by its known sentinel content.
        if (content.includes('---\ntype: Decision\n---\nbody')) {
          throw new Error('synthetic insert failure for failure-isolation test');
        }
        return realInsert(content, payload);
      });

    try {
      const result = await executeApply(ctx.projectManager!, {
        reviewerArg: 'human',
        levelArg: '4',
        filters: { glob: '_scepter/**/*.md' },
        skipAnnotated: true,
        overwrite: false,
        dryRun: false,
        verbose: false,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.outcome.marked).toBe(3);
        expect(result.outcome.failed.length).toBe(1);
        expect(result.outcome.failed[0].path).toContain('D999');
        expect(result.outcome.failed[0].error).toContain('synthetic insert failure');
      }
    } finally {
      insertSpy.mockRestore();
    }
  });
});
