/**
 * Mark command tests. Realizes TS001 §7 (mark refactor through
 * getAdapter, includeDate honoring, null-adapter error path,
 * validation-before-adapter ordering, command-owns-I/O contract).
 *
 * @validates {S004.§3.AC.01-06}
 * @validates {DD017.DC.15-19}
 * @validates {TS001.§7.AC.01}
 * @validates {TS001.§7.AC.02}
 * @validates {TS001.§7.AC.03}
 * @validates {TS001.§7.AC.04}
 * @validates {TS001.§7.AC.05}
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs-extra';
import { setupFullTestProject } from '../../../../test-utils/integration-test-helpers.js';
import type { TestContext } from '../../../../test-utils/integration-test-helpers.js';
import { executeMark } from '../mark-command.js';
import type { SCEpterConfig } from '../../../../types/config.js';

const MARK_TEST_CONFIG: SCEpterConfig = {
  noteTypes: {
    Requirement: { shortcode: 'R', folder: 'requirements' },
  },
  paths: {
    notesRoot: '_scepter/notes',
    dataDir: '_scepter',
  },
  sourceCodeIntegration: {
    enabled: true,
    folders: ['core/src'],
    extensions: ['.ts'],
    exclude: [],
  },
  discoveryPaths: ['_scepter'],
};

function configWithIncludeDate(value: boolean): SCEpterConfig {
  return {
    ...MARK_TEST_CONFIG,
    claims: {
      confidence: {
        includeDate: value,
      },
    },
  };
}

async function seed(ctx: TestContext, relPath: string, body: string): Promise<string> {
  const abs = path.join(ctx.projectPath, relPath);
  await fs.ensureDir(path.dirname(abs));
  await fs.writeFile(abs, body, 'utf-8');
  return abs;
}

describe('S004.§3: mark — adapter routing and validation order', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject('mark-routing', MARK_TEST_CONFIG);
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
  });

  it('S004.§3.AC.01: source-file (.ts) mark routes through C-family adapter and writes annotation', async () => {
    await seed(ctx, 'core/src/foo.ts', 'const x = 1;\nexport {};\n');
    const outcome = await executeMark(ctx.projectManager!, {
      file: 'core/src/foo.ts',
      reviewerArg: 'ai',
      levelArg: '2',
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.adapterId).toBe('c-family-comments');
      const updated = await fs.readFile(path.join(ctx.projectPath, 'core/src/foo.ts'), 'utf-8');
      expect(updated).toContain('@confidence 🤖2');
    }
  });

  it('S004.§3.AC.04: notes (.md) mark routes through markdown-frontmatter adapter', async () => {
    await seed(
      ctx,
      '_scepter/notes/reqs/R001 Test.md',
      '---\ntype: Requirement\n---\nbody\n',
    );
    const outcome = await executeMark(ctx.projectManager!, {
      file: '_scepter/notes/reqs/R001 Test.md',
      reviewerArg: 'human',
      levelArg: '4',
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.adapterId).toBe('markdown-frontmatter');
      const updated = await fs.readFile(
        path.join(ctx.projectPath, '_scepter/notes/reqs/R001 Test.md'),
        'utf-8',
      );
      // gray-matter may emit the emoji as a YAML \U escape rather than
      // the literal character; assert via parse-back rather than via
      // raw byte regex.
      const matter = (await import('gray-matter')).default;
      const parsed = matter(updated);
      expect(parsed.data.confidence).toMatch(/^👤4/);
      expect(parsed.data.type).toBe('Requirement');
    }
  });

  it('S004.§3.AC.01: null-adapter error path — .txt file errors out without writing', async () => {
    const abs = await seed(ctx, 'core/src/note.txt', 'hello world\n');
    const before = await fs.readFile(abs, 'utf-8');
    const outcome = await executeMark(ctx.projectManager!, {
      file: 'core/src/note.txt',
      reviewerArg: 'ai',
      levelArg: '2',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('no-adapter');
      expect(outcome.message).toContain('core/src/note.txt');
      expect(outcome.message).toContain('.txt');
      expect(outcome.message).toContain('c-family-comments');
      expect(outcome.message).toContain('markdown-frontmatter');
    }
    const after = await fs.readFile(abs, 'utf-8');
    expect(after).toBe(before);
  });

  it('S004.§3.AC.02: validation-before-adapter — invalid AI level (5) errors before adapter call', async () => {
    const abs = await seed(ctx, 'core/src/foo.ts', 'const x = 1;\nexport {};\n');
    const before = await fs.readFile(abs, 'utf-8');
    const outcome = await executeMark(ctx.projectManager!, {
      file: 'core/src/foo.ts',
      reviewerArg: 'ai',
      levelArg: '5',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('invalid-reviewer-level-combo');
    }
    const after = await fs.readFile(abs, 'utf-8');
    expect(after).toBe(before);
  });

  it('S004.§3.AC.02: validation-before-adapter — invalid human level (1) errors before adapter call', async () => {
    await seed(ctx, 'core/src/foo.ts', 'const x = 1;\nexport {};\n');
    const outcome = await executeMark(ctx.projectManager!, {
      file: 'core/src/foo.ts',
      reviewerArg: 'human',
      levelArg: '1',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('invalid-reviewer-level-combo');
    }
  });
});

describe('S004.§3: mark — includeDate config honored (DC.17)', () => {
  let ctx: TestContext;

  afterEach(async () => {
    if (ctx) await fs.remove(ctx.projectPath);
  });

  it('R013.§1.AC.06: includeDate: false omits the trailing date', async () => {
    ctx = await setupFullTestProject('mark-no-date', configWithIncludeDate(false));
    await seed(ctx, 'core/src/foo.ts', 'const x = 1;\nexport {};\n');
    const outcome = await executeMark(ctx.projectManager!, {
      file: 'core/src/foo.ts',
      reviewerArg: 'ai',
      levelArg: '2',
    });
    expect(outcome.ok).toBe(true);
    const updated = await fs.readFile(path.join(ctx.projectPath, 'core/src/foo.ts'), 'utf-8');
    // Confidence annotation has no trailing date.
    expect(updated).toMatch(/@confidence 🤖2(\n|$)/);
    expect(updated).not.toMatch(/@confidence 🤖2 \d{4}-\d{2}-\d{2}/);
  });

  it('R013.§1.AC.06: includeDate: true (default) includes today as YYYY-MM-DD', async () => {
    ctx = await setupFullTestProject('mark-with-date', configWithIncludeDate(true));
    await seed(ctx, 'core/src/foo.ts', 'const x = 1;\nexport {};\n');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T12:00:00Z'));
    try {
      const outcome = await executeMark(ctx.projectManager!, {
        file: 'core/src/foo.ts',
        reviewerArg: 'ai',
        levelArg: '2',
      });
      expect(outcome.ok).toBe(true);
      const updated = await fs.readFile(
        path.join(ctx.projectPath, 'core/src/foo.ts'),
        'utf-8',
      );
      expect(updated).toContain('@confidence 🤖2 2026-05-05');
    } finally {
      vi.useRealTimers();
    }
  });

  it('R013.§1.AC.06: includeDate undefined defaults to true', async () => {
    ctx = await setupFullTestProject('mark-default-date', MARK_TEST_CONFIG);
    await seed(ctx, 'core/src/foo.ts', 'const x = 1;\nexport {};\n');
    const outcome = await executeMark(ctx.projectManager!, {
      file: 'core/src/foo.ts',
      reviewerArg: 'ai',
      levelArg: '2',
    });
    expect(outcome.ok).toBe(true);
    const updated = await fs.readFile(path.join(ctx.projectPath, 'core/src/foo.ts'), 'utf-8');
    expect(updated).toMatch(/@confidence 🤖2 \d{4}-\d{2}-\d{2}/);
  });
});

describe('S004.§3.AC.06: mark — command-owns-I/O contract (DC.18)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject('mark-owns-io', MARK_TEST_CONFIG);
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
    vi.restoreAllMocks();
  });

  it('adapter.insert receives (content: string, payload: object) — never an fs handle', async () => {
    const filePath = await seed(ctx, 'core/src/foo.ts', 'const x = 1;\nexport {};\n');

    const adapterModule = await import('../../../../claims/confidence/adapters/c-family.js');
    const insertSpy = vi.spyOn(adapterModule.cFamilyAdapter, 'insert');

    const outcome = await executeMark(ctx.projectManager!, {
      file: 'core/src/foo.ts',
      reviewerArg: 'ai',
      levelArg: '2',
    });
    expect(outcome.ok).toBe(true);

    // adapter.insert was called exactly once. Verifies the I/O contract
    // (DC.18): the adapter is invoked with (content, payload) — content
    // is a string, payload is a plain object — never a path, FileHandle,
    // or Buffer. The mark command alone owns the read+write.
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const [contentArg, payloadArg] = insertSpy.mock.calls[0];
    expect(typeof contentArg).toBe('string');
    expect(contentArg).toContain('const x = 1;');
    expect(typeof payloadArg).toBe('object');
    expect(payloadArg).not.toBeNull();
    expect(Buffer.isBuffer(payloadArg)).toBe(false);
    // payload shape per ConfidencePayload.
    expect(payloadArg).toMatchObject({ reviewer: '🤖', level: 2 });

    // And the on-disk file IS updated (exactly one write happened —
    // verified by the file content reflecting the insert outcome).
    const updated = await fs.readFile(filePath, 'utf-8');
    expect(updated).toContain('@confidence 🤖2');
  });
});

describe('S004.§3: mark — file-not-found path', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupFullTestProject('mark-missing', MARK_TEST_CONFIG);
  });

  afterEach(async () => {
    await fs.remove(ctx.projectPath);
  });

  it('errors when file does not exist', async () => {
    const outcome = await executeMark(ctx.projectManager!, {
      file: 'core/src/missing.ts',
      reviewerArg: 'ai',
      levelArg: '2',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('file-not-found');
  });
});
