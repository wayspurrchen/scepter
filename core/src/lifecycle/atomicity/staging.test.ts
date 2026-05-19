/**
 * Tests for the staging area — atomic two-phase commit primitive.
 *
 * @validates {R015.§6.AC.01} atomicity: every change committed or none
 * @validates {DD020.§3.DC.01} two-phase plan/apply
 * @validates {DD020.§3.DC.02} staging directory; atomic rename; stale-staging detection
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { StagingArea, detectStaleStaging } from './staging';

let projectPath: string;

beforeEach(async () => {
  projectPath = await fs.mkdtemp(
    path.join(os.tmpdir(), 'scepter-staging-test-'),
  );
});

afterEach(async () => {
  if (projectPath) {
    await fs.remove(projectPath);
  }
});

describe('StagingArea — basic commit flow', () => {
  it('writes staged content and commits via atomic move', async () => {
    const targetPath = path.join(projectPath, 'note.md');
    await fs.writeFile(targetPath, 'original content');

    const staging = new StagingArea(projectPath, 'run-test-1');
    await staging.prepare([
      {
        kind: 'write',
        targetPath,
        content: 'rewritten content',
      },
    ]);

    // Pre-commit: original is unchanged.
    expect(await fs.readFile(targetPath, 'utf-8')).toBe('original content');
    // Staging directory exists.
    expect(await fs.pathExists(staging.stagingDir)).toBe(true);

    await staging.commit();

    // Post-commit: target has the rewritten content.
    expect(await fs.readFile(targetPath, 'utf-8')).toBe('rewritten content');
    // Staging directory is gone.
    expect(await fs.pathExists(staging.stagingDir)).toBe(false);
  });

  it('commits remove operations', async () => {
    const targetPath = path.join(projectPath, 'doomed.md');
    await fs.writeFile(targetPath, 'will be deleted');

    const staging = new StagingArea(projectPath, 'run-test-2');
    await staging.prepare([{ kind: 'remove', targetPath }]);
    expect(await fs.pathExists(targetPath)).toBe(true);

    await staging.commit();
    expect(await fs.pathExists(targetPath)).toBe(false);
  });

  it('commits rename operations', async () => {
    const fromPath = path.join(projectPath, 'old.md');
    const toPath = path.join(projectPath, 'new.md');
    await fs.writeFile(fromPath, 'content');

    const staging = new StagingArea(projectPath, 'run-test-3');
    await staging.prepare([{ kind: 'rename', from: fromPath, to: toPath }]);
    await staging.commit();

    expect(await fs.pathExists(fromPath)).toBe(false);
    expect(await fs.readFile(toPath, 'utf-8')).toBe('content');
  });

  it('commits remove-folder for folder-based notes', async () => {
    const folder = path.join(projectPath, 'note-folder');
    await fs.ensureDir(folder);
    await fs.writeFile(path.join(folder, 'main.md'), 'main');
    await fs.writeFile(path.join(folder, 'companion.md'), 'companion');

    const staging = new StagingArea(projectPath, 'run-test-4');
    await staging.prepare([{ kind: 'remove-folder', targetPath: folder }]);
    await staging.commit();

    expect(await fs.pathExists(folder)).toBe(false);
  });
});

describe('StagingArea — rollback', () => {
  it('rollback after prepare leaves originals untouched', async () => {
    const targetPath = path.join(projectPath, 'note.md');
    await fs.writeFile(targetPath, 'original content');

    const staging = new StagingArea(projectPath, 'run-test-5');
    await staging.prepare([
      { kind: 'write', targetPath, content: 'rewritten' },
    ]);
    await staging.rollback();

    expect(await fs.readFile(targetPath, 'utf-8')).toBe('original content');
    expect(await fs.pathExists(staging.stagingDir)).toBe(false);
  });

  it('rollback before prepare is a safe no-op', async () => {
    const staging = new StagingArea(projectPath, 'run-test-6');
    await staging.rollback();
    expect(await fs.pathExists(staging.stagingDir)).toBe(false);
  });

  it('rollback after commit throws', async () => {
    const targetPath = path.join(projectPath, 'note.md');
    await fs.writeFile(targetPath, 'original');
    const staging = new StagingArea(projectPath, 'run-test-7');
    await staging.prepare([
      { kind: 'write', targetPath, content: 'new' },
    ]);
    await staging.commit();
    await expect(staging.rollback()).rejects.toThrow();
  });
});

describe('StagingArea — state machine guards', () => {
  it('refuses to prepare twice', async () => {
    const staging = new StagingArea(projectPath, 'run-test-8');
    await staging.prepare([]);
    await expect(staging.prepare([])).rejects.toThrow();
  });

  it('refuses to commit without prepare', async () => {
    const staging = new StagingArea(projectPath, 'run-test-9');
    await expect(staging.commit()).rejects.toThrow();
  });

  it('refuses to prepare when staging directory already exists', async () => {
    const dir = path.join(
      projectPath,
      '_scepter',
      '_lifecycle-staging',
      'run-test-10',
    );
    await fs.ensureDir(dir);
    const staging = new StagingArea(projectPath, 'run-test-10');
    await expect(staging.prepare([])).rejects.toThrow();
  });
});

describe('detectStaleStaging', () => {
  it('returns empty array when no staging root exists', async () => {
    const stale = await detectStaleStaging(projectPath);
    expect(stale).toEqual([]);
  });

  it('returns empty array when staging root is empty', async () => {
    await fs.ensureDir(
      path.join(projectPath, '_scepter', '_lifecycle-staging'),
    );
    const stale = await detectStaleStaging(projectPath);
    expect(stale).toEqual([]);
  });

  it('returns stale staging directories', async () => {
    const staleDir = path.join(
      projectPath,
      '_scepter',
      '_lifecycle-staging',
      'run-stale-1',
    );
    await fs.ensureDir(staleDir);
    const stale = await detectStaleStaging(projectPath);
    expect(stale).toEqual([staleDir]);
  });

  it('a clean commit leaves no stale staging', async () => {
    const targetPath = path.join(projectPath, 'note.md');
    await fs.writeFile(targetPath, 'orig');
    const staging = new StagingArea(projectPath, 'run-test-11');
    await staging.prepare([
      { kind: 'write', targetPath, content: 'new' },
    ]);
    await staging.commit();
    const stale = await detectStaleStaging(projectPath);
    expect(stale).toEqual([]);
  });
});
