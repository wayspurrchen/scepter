/**
 * Integration tests for the `meta` subcommand group: end-to-end behavioral
 * tests using a real FilesystemMetadataStorage and a real claim index.
 *
 * Each test uses `metaCommand.parseAsync` with `from: 'user'` to drive the
 * command exactly as the CLI would, against a tmp-dir project fixture.
 *
 * @validates {DD014.§3.DC.25} `meta add` happy path + multi-pair atomicity
 * @validates {DD014.§3.DC.26} KEY validation rejects whole command on bad KEY
 * @validates {DD014.§3.DC.27} Unresolved claim ID rejected with fuzzy suggestions
 * @validates {DD014.§3.DC.28} :removed claim rejection
 * @validates {DD014.§3.DC.29} `meta set` atomic replace
 * @validates {DD014.§3.DC.30} `meta unset` clears named keys, leaves others
 * @validates {DD014.§3.DC.31} `meta clear` clears all keys; no-op on empty
 * @validates {DD014.§3.DC.32} `meta get` prints fold; with key prints values
 * @validates {DD014.§3.DC.33} `meta get KEY` exits non-zero on missing key
 * @validates {DD014.§3.DC.34} `--json` output shape
 * @validates {DD014.§3.DC.35} `meta log` chronological output; `--json` array
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { metaCommand } from '../index';
import { createFilesystemProject } from '../../../../../storage/filesystem/create-filesystem-project';
import { _clearEnsureIndexCacheForTest } from '../../ensure-index';
import type { SCEpterConfig } from '../../../../../types/config';

const TEST_CONFIG: SCEpterConfig = {
  noteTypes: {
    Decision: { shortcode: 'D', folder: 'decisions' },
    Requirement: { shortcode: 'R', folder: 'requirements' },
  },
  paths: {
    notesRoot: '_scepter/notes',
    dataDir: '_scepter',
  },
};

const NOTE_CONTENT = [
  '---',
  'tags: [meta-test]',
  '---',
  '',
  '# R001 Test Requirement',
  '',
  '### §1 Core',
  '',
  '§1.AC.01 The system MUST do widget things.',
  '',
  '§1.AC.02 The system MUST validate widget input.',
  '',
  '§1.AC.03:removed [Removed]',
  '',
].join('\n');

interface TestProject {
  projectPath: string;
  cleanup(): Promise<void>;
}

async function setupProject(label: string): Promise<TestProject> {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), `scepter-meta-int-${label}-`));
  // Set up _scepter dir + config
  const dataDir = path.join(projectPath, '_scepter');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(
    path.join(dataDir, 'scepter.config.json'),
    JSON.stringify(TEST_CONFIG, null, 2),
    'utf-8',
  );
  // Set up the note (R001 with three claims, one :removed)
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

async function runMeta(projectPath: string, args: string[]): Promise<void> {
  // The `--project-dir` flag is registered on the root program, not on the
  // meta subcommands. Subcommand actions read `options.projectDir`, which
  // defaults to `process.cwd()` in BaseCommand.setup. We `chdir` into the
  // tmp project for the duration of the call. The cache in `ensureIndex`
  // is bypassed by passing `--reindex` on each first call.
  // Commander 11 retains parsed option values on the command instance across
  // parseAsync() calls — reset boolean/value flags via setOptionValue before
  // each parse so prior tests don't leak flags into this call.
  for (const sub of metaCommand.commands) {
    sub.setOptionValue('reindex', undefined);
    sub.setOptionValue('actor', undefined);
    sub.setOptionValue('note', undefined);
    sub.setOptionValue('date', undefined);
    sub.setOptionValue('json', undefined);
  }
  const cwd = process.cwd();
  try {
    process.chdir(projectPath);
    await metaCommand.parseAsync(args, { from: 'user' });
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

describe('meta CLI integration', () => {
  let project: TestProject;

  beforeEach(async () => {
    project = await setupProject(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
    // ensure-index has a module-level cache. Clear it between tests so
    // each test sees a fresh build for its own tmp project.
    _clearEnsureIndexCacheForTest();
  });

  afterEach(async () => {
    release();
    await project.cleanup();
  });

  // T-Meta-Add-1
  // @validates {DD014.§3.DC.25}
  it('add: single KEY=VALUE happy path', async () => {
    const cap = capture();
    await runMeta(project.projectPath, ['add', 'R001.§1.AC.01', 'reviewer=alice', '--reindex']);
    release();

    // Read the store directly to verify durability.
    const projectManager = await createFilesystemProject(project.projectPath);
    const events = await projectManager.metadataStorage!.query({
      claimId: 'R001.1.AC.01',
      key: 'reviewer',
    });
    // Author events use the notepath-prefixed actor; CLI events use the
    // raw actor (OS username). Filter out anything starting with "author:".
    const cliEvents = events.filter((e) => !e.actor.startsWith('author:'));
    expect(cliEvents).toHaveLength(1);
    expect(cliEvents[0].op).toBe('add');
    expect(cliEvents[0].value).toBe('alice');
    expect(cap.logs.some((l) => l.includes('Recorded 1 event(s)'))).toBe(true);
  });

  // T-Meta-Add-2
  // @validates {DD014.§3.DC.25}
  it('add: multi-pair produces N events with same actor/date/note', async () => {
    capture();
    await runMeta(project.projectPath, [
      'add',
      'R001.§1.AC.01',
      'priority=high',
      'reviewer=bob',
      'sprint=23',
      '--note',
      'multi-pair test',
      '--reindex',
    ]);
    release();

    const projectManager = await createFilesystemProject(project.projectPath);
    const events = await projectManager.metadataStorage!.query({
      claimId: 'R001.1.AC.01',
    });
    const cliEvents = events.filter((e) => !e.actor.startsWith('author:'));
    expect(cliEvents).toHaveLength(3);
    const allSameNote = cliEvents.every((e) => e.note === 'multi-pair test');
    expect(allSameNote).toBe(true);
    const allSameActor = new Set(cliEvents.map((e) => e.actor)).size === 1;
    expect(allSameActor).toBe(true);
    const allSameDate = new Set(cliEvents.map((e) => e.date)).size === 1;
    expect(allSameDate).toBe(true);
  });

  // T-Meta-Add-3
  // @validates {DD014.§3.DC.26}
  it('add: bad KEY rejects whole command, no events recorded', async () => {
    const cap = capture();
    await expect(
      runMeta(project.projectPath, ['add', 'R001.§1.AC.01', 'good=ok', '1bad=fails', '--reindex']),
    ).rejects.toThrow(/__exit_1__/);
    release();

    const projectManager = await createFilesystemProject(project.projectPath);
    const events = await projectManager.metadataStorage!.query({ claimId: 'R001.1.AC.01' });
    const cliEvents = events.filter((e) => !e.actor.startsWith('author:'));
    expect(cliEvents).toHaveLength(0);
    expect(cap.errors.some((e) => e.includes('Invalid KEY'))).toBe(true);
  });

  // T-Meta-Add-4
  // @validates {DD014.§3.DC.27}
  it('add: unresolved claim ID prints fuzzy suggestions and records nothing', async () => {
    const cap = capture();
    await runMeta(project.projectPath, ['add', 'R001.§1.AC.99', 'reviewer=alice', '--reindex']);
    release();

    const projectManager = await createFilesystemProject(project.projectPath);
    const events = await projectManager.metadataStorage!.query({ key: 'reviewer' });
    expect(events.filter((e) => e.value === 'alice')).toHaveLength(0);
    // The CLI should have printed "Claim not found" + suggestions
    expect(cap.logs.some((l) => l.includes('Claim not found'))).toBe(true);
  });

  // T-Meta-Add-5
  // @validates {DD014.§3.DC.28}
  it('add: :removed claim is rejected', async () => {
    const cap = capture();
    await runMeta(project.projectPath, ['add', 'R001.§1.AC.03', 'reviewer=alice', '--reindex']);
    release();

    const projectManager = await createFilesystemProject(project.projectPath);
    const events = await projectManager.metadataStorage!.query({ claimId: 'R001.1.AC.03' });
    const cliEvents = events.filter((e) => !e.actor.startsWith('author:'));
    expect(cliEvents).toHaveLength(0);
    expect(cap.logs.some((l) => l.toLowerCase().includes('removed'))).toBe(true);
  });

  // T-Meta-Set-1
  // @validates {DD014.§3.DC.29}
  it('set: atomic replace — fold of "add a, add b, set c" is [c]', async () => {
    capture();
    await runMeta(project.projectPath, ['add', 'R001.§1.AC.01', 'reviewer=a', '--reindex']);
    await runMeta(project.projectPath, ['add', 'R001.§1.AC.01', 'reviewer=b']);
    await runMeta(project.projectPath, ['set', 'R001.§1.AC.01', 'reviewer=c']);
    release();

    const projectManager = await createFilesystemProject(project.projectPath);
    const folded = await projectManager.metadataStorage!.fold('R001.1.AC.01');
    expect(folded.reviewer).toEqual(['c']);
  });

  // T-Meta-Unset-1
  // @validates {DD014.§3.DC.30}
  it('unset: clears named key, leaves others', async () => {
    capture();
    await runMeta(project.projectPath, ['add', 'R001.§1.AC.01', 'reviewer=alice', 'priority=high', '--reindex']);
    await runMeta(project.projectPath, ['unset', 'R001.§1.AC.01', 'reviewer']);
    release();

    const projectManager = await createFilesystemProject(project.projectPath);
    const folded = await projectManager.metadataStorage!.fold('R001.1.AC.01');
    expect(folded.reviewer).toBeUndefined();
    expect(folded.priority).toEqual(['high']);
  });

  // T-Meta-Clear-1
  // @validates {DD014.§3.DC.31}
  it('clear: removes all keys; no-op on empty', async () => {
    const cap = capture();
    // First, no metadata to clear
    await runMeta(project.projectPath, ['clear', 'R001.§1.AC.01', '--reindex']);
    expect(cap.logs.some((l) => l.includes('No metadata to clear'))).toBe(true);

    // Add three keys, clear them all
    await runMeta(project.projectPath, ['add', 'R001.§1.AC.01', 'a=1', 'b=2', 'c=3']);
    await runMeta(project.projectPath, ['clear', 'R001.§1.AC.01']);
    release();

    const projectManager = await createFilesystemProject(project.projectPath);
    const folded = await projectManager.metadataStorage!.fold('R001.1.AC.01');
    // Only the author tokens should remain (none for this AC since the note has no suffix tokens on AC.01).
    expect(folded.a).toBeUndefined();
    expect(folded.b).toBeUndefined();
    expect(folded.c).toBeUndefined();
  });

  // T-Meta-Get-1
  // @validates {DD014.§3.DC.32, §3.DC.33}
  it('get: prints all keys; with key prints values; missing key non-zero exit', async () => {
    capture();
    await runMeta(project.projectPath, ['add', 'R001.§1.AC.01', 'reviewer=alice', 'priority=high', '--reindex']);
    release();

    // Without key
    const cap1 = capture();
    await runMeta(project.projectPath, ['get', 'R001.§1.AC.01']);
    release();
    expect(cap1.logs.some((l) => l.includes('reviewer'))).toBe(true);
    expect(cap1.logs.some((l) => l.includes('priority'))).toBe(true);

    // With existing key
    const cap2 = capture();
    await runMeta(project.projectPath, ['get', 'R001.§1.AC.01', 'reviewer']);
    release();
    expect(cap2.logs.some((l) => l.includes('alice'))).toBe(true);

    // With missing key — non-zero exit
    const cap3 = capture();
    await expect(
      runMeta(project.projectPath, ['get', 'R001.§1.AC.01', 'nonexistent']),
    ).rejects.toThrow(/__exit_1__/);
    release();
    expect(cap3.exitCalls).toContain(1);
  });

  // T-Meta-Get-2
  // @validates {DD014.§3.DC.34}
  it('get --json: emits {state} for no-key, {values} for key', async () => {
    capture();
    await runMeta(project.projectPath, ['add', 'R001.§1.AC.01', 'reviewer=alice', 'priority=high', '--reindex']);
    release();

    const cap1 = capture();
    await runMeta(project.projectPath, ['get', 'R001.§1.AC.01', '--json']);
    release();
    const fullState = JSON.parse(cap1.logs[0]);
    expect(fullState).toHaveProperty('state');
    expect(fullState.state.reviewer).toEqual(['alice']);

    const cap2 = capture();
    await runMeta(project.projectPath, ['get', 'R001.§1.AC.01', 'reviewer', '--json']);
    release();
    const single = JSON.parse(cap2.logs[0]);
    expect(single).toEqual({ values: ['alice'] });
  });

  // T-Meta-Log-1
  // @validates {DD014.§3.DC.35}
  it('log: chronological events; --json emits a JSON array', async () => {
    capture();
    await runMeta(project.projectPath, ['add', 'R001.§1.AC.01', 'reviewer=alice', '--reindex']);
    await runMeta(project.projectPath, ['set', 'R001.§1.AC.01', 'reviewer=bob']);
    release();

    const cap = capture();
    await runMeta(project.projectPath, ['log', 'R001.§1.AC.01', '--json']);
    release();
    const parsed = JSON.parse(cap.logs[0]);
    expect(Array.isArray(parsed)).toBe(true);
    const cliEvents = parsed.filter((e: { actor: string }) => !e.actor.startsWith('author:'));
    expect(cliEvents).toHaveLength(2);
    expect(cliEvents[0].op).toBe('add');
    expect(cliEvents[1].op).toBe('set');
  });
});
