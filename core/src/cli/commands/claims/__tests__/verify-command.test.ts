/**
 * Tests for the `verify` CLI command after the DD014 rewire.
 *
 * `verify` is now a thin alias to metadata writes:
 *   verify CLAIM            -> append({op:"add", key:"verified", value:"true"})
 *   verify CLAIM --remove   -> append({op:"unset", key:"verified", value:""})
 *
 * @validates {DD014.§3.DC.60} verify maps to add/unset on `verified`
 * @validates {DD014.§3.DC.61} :removed lifecycle rejection preserved
 * @validates {DD014.§3.DC.62} note-level invocation iterates claims
 * @validates {DD014.§3.DC.64} no popLatestForKey carve-out; six-method MetadataStorage
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { verifyCommand } from '../verify-command';
import { createFilesystemProject } from '../../../../storage/filesystem/create-filesystem-project';
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
  'tags: [verify-test]',
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

async function setupProject(label: string): Promise<{ projectPath: string; cleanup(): Promise<void> }> {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), `scepter-verify-int-${label}-`));
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

async function runVerify(projectPath: string, args: string[]): Promise<void> {
  // verifyCommand doesn't carry --project-dir directly (that's a root-program
  // option). Use process.chdir so BaseCommand.setup picks up projectPath via
  // its default of process.cwd().
  // Commander 11 retains parsed option values on the command instance across
  // parseAsync() calls — flags from a previous parse leak into the next if
  // not respecified. Reset the boolean/value flags explicitly through the
  // public setOptionValue API before each parse.
  verifyCommand.setOptionValue('remove', undefined);
  verifyCommand.setOptionValue('reindex', undefined);
  verifyCommand.setOptionValue('actor', undefined);
  verifyCommand.setOptionValue('note', undefined);
  const cwd = process.cwd();
  try {
    process.chdir(projectPath);
    await verifyCommand.parseAsync(args, { from: 'user' });
  } finally {
    process.chdir(cwd);
  }
}

let exitSpy: ReturnType<typeof vi.spyOn> | null = null;
let logSpy: ReturnType<typeof vi.spyOn> | null = null;

function capture() {
  const logs: string[] = [];
  const exitCalls: number[] = [];

  logSpy = vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => {
    logs.push(typeof msg === 'string' ? msg : JSON.stringify(msg));
  });
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCalls.push(code ?? 0);
    throw new Error(`__exit_${code ?? 0}__`);
  }) as never);

  return {
    get logs() {
      return logs;
    },
    get exitCalls() {
      return exitCalls;
    },
  };
}

function release() {
  logSpy?.mockRestore();
  exitSpy?.mockRestore();
  logSpy = exitSpy = null;
}

describe('verifyCommand structure', () => {
  it('is named "verify"', () => {
    expect(verifyCommand.name()).toBe('verify');
  });

  it('has a positional <id> argument', () => {
    const args = verifyCommand.registeredArguments;
    expect(args.length).toBe(1);
    expect(args[0].name()).toBe('id');
  });

  it('has --actor, --note, --remove, --reindex options', () => {
    const longs = verifyCommand.options.map((o) => o.long);
    expect(longs).toContain('--actor');
    expect(longs).toContain('--note');
    expect(longs).toContain('--remove');
    expect(longs).toContain('--reindex');
  });

  // T-Verify-6
  // @validates {DD014.§3.DC.60} `--method` flag REMOVED
  it('does NOT have a --method option (renamed to --note)', () => {
    const longs = verifyCommand.options.map((o) => o.long);
    expect(longs).not.toContain('--method');
  });

  // T-Verify-6
  // @validates {DD014.§3.DC.60} `--all` flag REMOVED
  it('does NOT have an --all option (state-level wipe is unconditional)', () => {
    const longs = verifyCommand.options.map((o) => o.long);
    expect(longs).not.toContain('--all');
  });
});

describe('verifyCommand behavior (DD014.§3.DC.60-64)', () => {
  let project: { projectPath: string; cleanup(): Promise<void> };

  beforeEach(async () => {
    project = await setupProject(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
    _clearEnsureIndexCacheForTest();
  });

  afterEach(async () => {
    release();
    await project.cleanup();
  });

  // T-Verify-1
  // @validates {DD014.§3.DC.60} happy path: add(verified=true) with OS-username actor
  it('verify CLAIM appends one add/verified=true event', async () => {
    capture();
    await runVerify(project.projectPath, ['R001.§1.AC.01', '--reindex']);
    release();

    const projectManager = await createFilesystemProject(project.projectPath);
    const events = await projectManager.metadataStorage!.query({
      claimId: 'R001.1.AC.01',
      key: 'verified',
    });
    expect(events).toHaveLength(1);
    expect(events[0].op).toBe('add');
    expect(events[0].value).toBe('true');
    // Date should be a full ISO 8601 datetime, not just YYYY-MM-DD
    expect(events[0].date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // Actor is OS username (or fallback "cli")
    expect(events[0].actor).toBeTruthy();
  });

  // T-Verify-2
  // @validates {DD014.§3.DC.60} --actor, --note round-trip
  it('verify CLAIM --actor A --note N records actor=A and note=N', async () => {
    capture();
    await runVerify(project.projectPath, [
      'R001.§1.AC.01',
      '--actor',
      'reviewer-bot',
      '--note',
      'spec-conformance-pass',
      '--reindex',
    ]);
    release();

    const projectManager = await createFilesystemProject(project.projectPath);
    const events = await projectManager.metadataStorage!.query({
      claimId: 'R001.1.AC.01',
      key: 'verified',
    });
    expect(events).toHaveLength(1);
    expect(events[0].actor).toBe('reviewer-bot');
    expect(events[0].note).toBe('spec-conformance-pass');
  });

  // T-Verify-3
  // @validates {DD014.§3.DC.60} --remove appends an unset event (state-level wipe)
  it('verify CLAIM --remove wipes folded state but log retains both events', async () => {
    capture();
    await runVerify(project.projectPath, ['R001.§1.AC.01', '--reindex']);
    await runVerify(project.projectPath, ['R001.§1.AC.01', '--remove']);
    release();

    const projectManager = await createFilesystemProject(project.projectPath);

    // Folded state for `verified` should be empty (key absent from result).
    const folded = await projectManager.metadataStorage!.fold('R001.§1.AC.01');
    expect(folded.verified).toBeUndefined();

    // Log retains both events.
    const events = await projectManager.metadataStorage!.query({
      claimId: 'R001.1.AC.01',
      key: 'verified',
    });
    expect(events).toHaveLength(2);
    expect(events[0].op).toBe('add');
    expect(events[1].op).toBe('unset');
    expect(events[1].value).toBe('');
  });

  // T-Verify-4
  // @validates {DD014.§3.DC.61} :removed rejection preserved on add and remove paths
  it('verify on a :removed claim is rejected on both add and remove paths', async () => {
    const cap1 = capture();
    await runVerify(project.projectPath, ['R001.§1.AC.03', '--reindex']);
    release();
    expect(cap1.logs.some((l) => l.toLowerCase().includes('removed'))).toBe(true);

    const cap2 = capture();
    await runVerify(project.projectPath, ['R001.§1.AC.03', '--remove']);
    release();
    expect(cap2.logs.some((l) => l.toLowerCase().includes('removed'))).toBe(true);

    // Confirm no events were recorded.
    const projectManager = await createFilesystemProject(project.projectPath);
    const events = await projectManager.metadataStorage!.query({
      claimId: 'R001.1.AC.03',
      key: 'verified',
    });
    expect(events).toHaveLength(0);
  });

  // T-Verify-5
  // @validates {DD014.§3.DC.62} note-level: iterates claims; --remove appends unset per claim
  it('verify NOTE_ID iterates claims; --remove appends unset per claim', async () => {
    // Note-level add: should append one add(verified=true) event per non-removed claim.
    capture();
    await runVerify(project.projectPath, ['R001', '--reindex']);
    release();

    const projectManager = await createFilesystemProject(project.projectPath);

    const ac01Events = await projectManager.metadataStorage!.query({
      claimId: 'R001.1.AC.01',
      key: 'verified',
    });
    const ac02Events = await projectManager.metadataStorage!.query({
      claimId: 'R001.1.AC.02',
      key: 'verified',
    });
    const ac03Events = await projectManager.metadataStorage!.query({
      claimId: 'R001.1.AC.03',
      key: 'verified',
    });
    expect(ac01Events).toHaveLength(1);
    expect(ac01Events[0].op).toBe('add');
    expect(ac02Events).toHaveLength(1);
    expect(ac02Events[0].op).toBe('add');
    // :removed claim is skipped.
    expect(ac03Events).toHaveLength(0);

    // Note-level --remove: appends unset per non-removed claim.
    capture();
    await runVerify(project.projectPath, ['R001', '--remove']);
    release();

    const projectManager2 = await createFilesystemProject(project.projectPath);
    const folded01 = await projectManager2.metadataStorage!.fold('R001.1.AC.01');
    const folded02 = await projectManager2.metadataStorage!.fold('R001.1.AC.02');
    expect(folded01.verified).toBeUndefined();
    expect(folded02.verified).toBeUndefined();

    const ac01EventsAfter = await projectManager2.metadataStorage!.query({
      claimId: 'R001.1.AC.01',
      key: 'verified',
    });
    expect(ac01EventsAfter).toHaveLength(2); // add + unset
    expect(ac01EventsAfter[1].op).toBe('unset');
  });
});
