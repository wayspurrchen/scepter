/**
 * Integration tests for the metadata filters wired into trace/gaps/search.
 *
 * Each test seeds a tmp project, populates the metadata store via real
 * `meta add` calls, then invokes trace/gaps/search and asserts the filter
 * narrowed results correctly. Composability with `--importance` is also
 * exercised.
 *
 * @validates {DD014.§3.DC.55} CLI options are registered on trace/gaps/search
 * @validates {DD014.§3.DC.56} AND semantics with existing filters
 * @validates {DD014.§3.DC.57} --importance continues to work alongside --where
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { traceCommand } from '../trace-command';
import { gapsCommand } from '../gaps-command';
import { searchCommand } from '../../context/search';
import { metaCommand } from '../meta/index';
import { _clearEnsureIndexCacheForTest } from '../ensure-index';
import type { SCEpterConfig } from '../../../../types/config';

const TEST_CONFIG: SCEpterConfig = {
  noteTypes: {
    Requirement: { shortcode: 'R', folder: 'requirements' },
  },
  paths: {
    notesRoot: '_scepter/notes',
    dataDir: '_scepter',
  },
};

const NOTE_CONTENT = [
  '---',
  'tags: [filter-test]',
  '---',
  '',
  '# R001 Test Requirement',
  '',
  '### §1 Core',
  '',
  '§1.AC.01:5 The system MUST do widget things.',
  '',
  '§1.AC.02:3 The system MUST validate widget input.',
  '',
  '§1.AC.03:5 The system MUST log widget actions.',
  '',
].join('\n');

async function setupProject(label: string): Promise<{ projectPath: string; cleanup(): Promise<void> }> {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), `scepter-filter-int-${label}-`));
  const dataDir = path.join(projectPath, '_scepter');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(
    path.join(dataDir, 'scepter.config.json'),
    JSON.stringify(TEST_CONFIG, null, 2),
    'utf-8',
  );
  const reqDir = path.join(projectPath, '_scepter', 'notes', 'requirements');
  await fs.mkdir(reqDir, { recursive: true });
  await fs.writeFile(path.join(reqDir, 'R001 Test Requirement.md'), NOTE_CONTENT, 'utf-8');
  return {
    projectPath,
    async cleanup() {
      await fs.rm(projectPath, { recursive: true, force: true });
    },
  };
}

function resetMetaState() {
  for (const sub of metaCommand.commands) {
    sub.setOptionValue('reindex', undefined);
    sub.setOptionValue('actor', undefined);
    sub.setOptionValue('note', undefined);
    sub.setOptionValue('date', undefined);
    sub.setOptionValue('json', undefined);
  }
}

function resetTraceState() {
  traceCommand.setOptionValue('importance', undefined);
  traceCommand.setOptionValue('sort', undefined);
  traceCommand.setOptionValue('width', undefined);
  traceCommand.setOptionValue('full', undefined);
  traceCommand.setOptionValue('showDerived', undefined);
  traceCommand.setOptionValue('reindex', undefined);
  traceCommand.setOptionValue('json', undefined);
  traceCommand.setOptionValue('verbose', undefined);
  traceCommand.setOptionValue('where', []);
  traceCommand.setOptionValue('hasKey', []);
  traceCommand.setOptionValue('missingKey', []);
}

function resetGapsState() {
  for (const key of [
    'importance',
    'sort',
    'includeDeferred',
    'includeClosed',
    'note',
    'projection',
    'includeZero',
    'showDerived',
    'reindex',
    'json',
    'width',
    'full',
  ]) {
    gapsCommand.setOptionValue(key, undefined);
  }
  gapsCommand.setOptionValue('where', []);
  gapsCommand.setOptionValue('hasKey', []);
  gapsCommand.setOptionValue('missingKey', []);
}

function resetSearchState() {
  for (const key of [
    'mode',
    'titleOnly',
    'regex',
    'contextLines',
    'caseSensitive',
    'tags',
    'status',
    'limit',
    'format',
    'showExcerpts',
    'highlightMatches',
    'includeSource',
    'includeArchived',
    'includeDeleted',
    'types',
    'note',
    'importance',
    'lifecycle',
    'derivesFrom',
    'derivativesOf',
    'hasDerivation',
    'idOnly',
    'reindex',
  ]) {
    searchCommand.setOptionValue(key, undefined);
  }
  searchCommand.setOptionValue('where', []);
  searchCommand.setOptionValue('hasKey', []);
  searchCommand.setOptionValue('missingKey', []);
}

async function withinProject<T>(projectPath: string, fn: () => Promise<T>): Promise<T> {
  const cwd = process.cwd();
  try {
    process.chdir(projectPath);
    return await fn();
  } finally {
    process.chdir(cwd);
  }
}

let exitSpy: ReturnType<typeof vi.spyOn> | null = null;
let logSpy: ReturnType<typeof vi.spyOn> | null = null;
let errorSpy: ReturnType<typeof vi.spyOn> | null = null;

function capture() {
  const logs: string[] = [];
  const errors: string[] = [];
  const exitCalls: number[] = [];
  logSpy = vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => {
    logs.push(typeof msg === 'string' ? msg : JSON.stringify(msg));
  });
  errorSpy = vi.spyOn(console, 'error').mockImplementation((msg?: unknown) => {
    errors.push(typeof msg === 'string' ? msg : JSON.stringify(msg));
  });
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCalls.push(code ?? 0);
    throw new Error(`__exit_${code ?? 0}__`);
  }) as never);
  return {
    get logs() {
      return logs;
    },
    get errors() {
      return errors;
    },
    get exitCalls() {
      return exitCalls;
    },
  };
}

function release() {
  logSpy?.mockRestore();
  errorSpy?.mockRestore();
  exitSpy?.mockRestore();
  logSpy = errorSpy = exitSpy = null;
}

async function seedFilters(projectPath: string): Promise<void> {
  // Pre-populate metadata: AC.01 has reviewer=alice, AC.02 has reviewer=bob,
  // AC.03 has no metadata writes (only its author importance:5 token).
  await withinProject(projectPath, async () => {
    resetMetaState();
    await metaCommand.parseAsync(['add', 'R001.§1.AC.01', 'reviewer=alice', '--reindex'], { from: 'user' });
    resetMetaState();
    await metaCommand.parseAsync(['add', 'R001.§1.AC.02', 'reviewer=bob'], { from: 'user' });
  });
}

describe('Filter integration: trace + gaps + search (DD014.§3.DC.55-57)', () => {
  let project: { projectPath: string; cleanup(): Promise<void> };

  beforeEach(async () => {
    project = await setupProject(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
    _clearEnsureIndexCacheForTest();
  });

  afterEach(async () => {
    release();
    await project.cleanup();
  });

  // T-Filter-1
  // @validates {DD014.§3.DC.55, §3.DC.56}
  it('trace: --where reviewer=alice narrows the matrix to one row', async () => {
    await seedFilters(project.projectPath);
    _clearEnsureIndexCacheForTest();

    const cap = capture();
    await withinProject(project.projectPath, async () => {
      resetTraceState();
      await traceCommand.parseAsync(['R001', '--where', 'reviewer=alice', '--json', '--reindex'], { from: 'user' });
    });
    release();

    const json = JSON.parse(cap.logs[0]);
    const claimIds: string[] = json.rows.map((r: { claimId: string }) => r.claimId);
    expect(claimIds).toEqual(['R001.1.AC.01']);
  });

  // T-Filter-1
  it('trace: --has-key reviewer narrows to AC.01 + AC.02', async () => {
    await seedFilters(project.projectPath);
    _clearEnsureIndexCacheForTest();

    const cap = capture();
    await withinProject(project.projectPath, async () => {
      resetTraceState();
      await traceCommand.parseAsync(['R001', '--has-key', 'reviewer', '--json', '--reindex'], { from: 'user' });
    });
    release();

    const json = JSON.parse(cap.logs[0]);
    const claimIds: string[] = json.rows.map((r: { claimId: string }) => r.claimId).sort();
    expect(claimIds).toEqual(['R001.1.AC.01', 'R001.1.AC.02']);
  });

  // T-Filter-1
  it('trace: --missing-key reviewer narrows to AC.03 only', async () => {
    await seedFilters(project.projectPath);
    _clearEnsureIndexCacheForTest();

    const cap = capture();
    await withinProject(project.projectPath, async () => {
      resetTraceState();
      await traceCommand.parseAsync(['R001', '--missing-key', 'reviewer', '--json', '--reindex'], { from: 'user' });
    });
    release();

    const json = JSON.parse(cap.logs[0]);
    const claimIds: string[] = json.rows.map((r: { claimId: string }) => r.claimId);
    expect(claimIds).toEqual(['R001.1.AC.03']);
  });

  // T-Filter-1 + T-Filter-5
  // @validates {DD014.§3.DC.57} --importance continues to compose with metadata filters
  it('trace: --importance 5 AND --has-key reviewer narrows to AC.01 only', async () => {
    await seedFilters(project.projectPath);
    _clearEnsureIndexCacheForTest();

    const cap = capture();
    await withinProject(project.projectPath, async () => {
      resetTraceState();
      await traceCommand.parseAsync(
        ['R001', '--importance', '5', '--has-key', 'reviewer', '--json', '--reindex'],
        { from: 'user' },
      );
    });
    release();

    const json = JSON.parse(cap.logs[0]);
    const claimIds: string[] = json.rows.map((r: { claimId: string }) => r.claimId);
    // AC.01 (importance=5, reviewer=alice) ✓
    // AC.02 (importance=3, reviewer=bob) — fails importance filter
    // AC.03 (importance=5, no reviewer) — fails has-key filter
    expect(claimIds).toEqual(['R001.1.AC.01']);
  });

  // T-Filter-1 — invalid KEY at parse time
  it('trace: invalid --where KEY rejects with non-zero exit', async () => {
    await seedFilters(project.projectPath);
    _clearEnsureIndexCacheForTest();

    const cap = capture();
    await expect(
      withinProject(project.projectPath, async () => {
        resetTraceState();
        await traceCommand.parseAsync(
          ['R001', '--where', 'BadKey=foo', '--json', '--reindex'],
          { from: 'user' },
        );
      }),
    ).rejects.toThrow(/__exit_1__/);
    release();
    expect(cap.errors.some((e) => e.toLowerCase().includes('invalid'))).toBe(true);
  });

  // T-Filter-2
  // @validates {DD014.§3.DC.55, §3.DC.56} same filter shape on gaps
  it('gaps: --where reviewer=bob narrows the gap report', async () => {
    // Add a Spec note that references R001's claims so that
    // findPartialCoverageGaps actually has projection types to consider
    // (otherwise --include-zero alone won't yield rows for a single-note
    // fixture; see traceability.ts:677).
    const config: SCEpterConfig = {
      noteTypes: {
        Requirement: { shortcode: 'R', folder: 'requirements' },
        Specification: { shortcode: 'S', folder: 'specs' },
      },
      paths: { notesRoot: '_scepter/notes', dataDir: '_scepter' },
    };
    await fs.writeFile(
      path.join(project.projectPath, '_scepter', 'scepter.config.json'),
      JSON.stringify(config, null, 2),
      'utf-8',
    );
    const specDir = path.join(project.projectPath, '_scepter', 'notes', 'specs');
    await fs.mkdir(specDir, { recursive: true });
    await fs.writeFile(
      path.join(specDir, 'S001 Spec.md'),
      [
        '---',
        'tags: [filter-test-spec]',
        '---',
        '',
        '# S001 Test Spec',
        '',
        '### §1 API',
        '',
        '§1.API.01 implements {R001.§1.AC.01}.',
        '',
      ].join('\n'),
      'utf-8',
    );

    await seedFilters(project.projectPath);
    _clearEnsureIndexCacheForTest();

    // Sanity-check baseline: with --projection Specification + --include-zero,
    // AC.02 (no spec coverage) should appear as a gap.
    const baseline = capture();
    await withinProject(project.projectPath, async () => {
      resetGapsState();
      await gapsCommand.parseAsync(
        ['--note', 'R001', '--projection', 'Specification', '--include-zero', '--json', '--reindex'],
        { from: 'user' },
      );
    });
    release();
    const baselineJson = JSON.parse(baseline.logs[0]);
    const baselineIds: string[] = baselineJson.rows.map((r: { claimId: string }) => r.claimId);
    expect(baselineIds.length).toBeGreaterThan(0);
    expect(baselineIds).toContain('R001.1.AC.02');

    _clearEnsureIndexCacheForTest();
    const cap = capture();
    await withinProject(project.projectPath, async () => {
      resetGapsState();
      await gapsCommand.parseAsync(
        ['--note', 'R001', '--projection', 'Specification', '--include-zero', '--where', 'reviewer=bob', '--json', '--reindex'],
        { from: 'user' },
      );
    });
    release();

    const json = JSON.parse(cap.logs[0]);
    const claimIds: string[] = json.rows.map((r: { claimId: string }) => r.claimId);
    expect(claimIds).toEqual(['R001.1.AC.02']);
  });

  // T-Filter-3
  // @validates {DD014.§3.DC.55} same filter shape on search (claim mode)
  it('search: --mode claim with --has-key reviewer narrows results', async () => {
    await seedFilters(project.projectPath);
    _clearEnsureIndexCacheForTest();

    const cap = capture();
    await withinProject(project.projectPath, async () => {
      resetSearchState();
      // Use --note R001 so searchClaims has a filter to anchor against
      // (empty query + zero claim-level filters errors per R007.§1.AC.06).
      // --has-key reviewer narrows to AC.01 + AC.02.
      await searchCommand.parseAsync(
        ['', '--mode', 'claim', '--format', 'json', '--note', 'R001', '--has-key', 'reviewer', '--reindex'],
        { from: 'user' },
      );
    });
    release();

    // Search emits the JSON document on a single console.log call.
    const jsonLine = cap.logs.find((l) => l.trim().startsWith('{') || l.trim().startsWith('['));
    expect(jsonLine).toBeDefined();
    const parsed = JSON.parse(jsonLine!);
    // Search-claim JSON structure: { matches: [...], total: N, ... }
    const matches = parsed.matches ?? parsed;
    const claimIds = (matches as Array<{ fullyQualified: string }>).map((m) => m.fullyQualified).sort();
    expect(claimIds).toEqual(['R001.1.AC.01', 'R001.1.AC.02']);
  });
});
