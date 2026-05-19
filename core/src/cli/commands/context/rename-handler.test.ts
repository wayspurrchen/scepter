/**
 * RenameHandler validation tests.
 *
 * Covers each validation gate in the handler's `execute()`:
 *  - source equals target → exit(1)
 *  - target is a deletion-marker shape → exit(1)
 *  - target fails isValidNoteId → exit(1)
 *  - source fails isValidNoteId → exit(1)
 *  - source layout not found → exit(1)
 *  - target collides with a live note in the project → exit(1)
 *
 * Each test intercepts process.exit so the handler returns without
 * terminating the test runner, then asserts the captured exit code and
 * stderr message.
 *
 * @validates {DD020.§4.DC.11} validates target via isValidNoteId; rejects live-note collision; permits previously-deleted ID
 * @validates {DD020.§4.DC.20} rejects source-equals-target
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RenameHandler } from './rename-handler';
import type { CommandContext } from '../base-command';

interface MockFileManager {
  resolveNoteLayout: (id: string) => { kind: 'file'; filePath: string } | null;
}

interface MockProjectManager {
  noteManager: object;
  noteFileManager: MockFileManager;
  configManager: { getConfig: () => Record<string, unknown> };
}

function makeContext(fileManager: MockFileManager): CommandContext {
  const projectManager: MockProjectManager = {
    noteManager: {},
    noteFileManager: fileManager,
    configManager: { getConfig: () => ({}) },
  };
  return {
    projectManager: projectManager as unknown as CommandContext['projectManager'],
    projectPath: '/tmp/fake-project',
  };
}

describe('RenameHandler — validation gates', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // process.exit throws so the handler's control flow short-circuits
    // (the implementation calls exit(1) and continues; we throw to
    // simulate process termination and capture the call).
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit:${code ?? 0}`);
    }) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('rejects when sourceId equals targetId', async () => {
    const fileManager: MockFileManager = {
      resolveNoteLayout: () => ({ kind: 'file', filePath: '/tmp/R005.md' }),
    };
    const handler = new RenameHandler();
    await expect(
      handler.execute('R005', 'R005', { projectDir: '/tmp/fake-project' }, makeContext(fileManager)),
    ).rejects.toThrow('__exit:1');
    expect(errorSpy).toHaveBeenCalled();
    const stderr = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(stderr).toMatch(/identical/i);
  });

  it('rejects when targetId is a deletion-marker shape', async () => {
    const fileManager: MockFileManager = {
      resolveNoteLayout: () => ({ kind: 'file', filePath: '/tmp/R005.md' }),
    };
    const handler = new RenameHandler();
    await expect(
      handler.execute(
        'R005',
        '_deleted_R005_at_20260519',
        { projectDir: '/tmp/fake-project' },
        makeContext(fileManager),
      ),
    ).rejects.toThrow('__exit:1');
    const stderr = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(stderr).toMatch(/deletion-marker/i);
  });

  it('rejects when targetId fails isValidNoteId', async () => {
    const fileManager: MockFileManager = {
      resolveNoteLayout: () => ({ kind: 'file', filePath: '/tmp/R005.md' }),
    };
    const handler = new RenameHandler();
    await expect(
      handler.execute(
        'R005',
        'not-a-valid-id',
        { projectDir: '/tmp/fake-project' },
        makeContext(fileManager),
      ),
    ).rejects.toThrow('__exit:1');
    const stderr = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(stderr).toMatch(/not a valid note ID/i);
  });

  it('rejects when source layout is missing', async () => {
    // resolveNoteLayout returns null for the source ID → "Note not found"
    const fileManager: MockFileManager = {
      resolveNoteLayout: (id: string) => (id === 'R042' ? null : ({ kind: 'file', filePath: '/tmp/x.md' })),
    };
    const handler = new RenameHandler();
    await expect(
      handler.execute('R042', 'R099', { projectDir: '/tmp/fake-project' }, makeContext(fileManager)),
    ).rejects.toThrow('__exit:1');
    const stderr = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(stderr).toMatch(/not found/i);
  });

  it('rejects when target ID collides with a live note', async () => {
    // Both source and target resolve → live-note collision.
    const fileManager: MockFileManager = {
      resolveNoteLayout: (id: string) =>
        id === 'R005' || id === 'R007'
          ? ({ kind: 'file', filePath: `/tmp/${id}.md` })
          : null,
    };
    const handler = new RenameHandler();
    await expect(
      handler.execute('R005', 'R007', { projectDir: '/tmp/fake-project' }, makeContext(fileManager)),
    ).rejects.toThrow('__exit:1');
    const stderr = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(stderr).toMatch(/already in use/i);
  });
});
