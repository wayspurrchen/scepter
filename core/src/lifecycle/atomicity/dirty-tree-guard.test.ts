/**
 * Tests for the dirty-tree guard.
 *
 * @validates {R015.§6.AC.02} dirty tree refused unless override; not-a-git-repo proceeds
 * @validates {DD020.§3.DC.03} git status probe; clean / dirty / not-a-git-repo states
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  checkWorkingTreeClean,
  shouldBlockOnDirtyTree,
} from './dirty-tree-guard';

const execFileAsync = promisify(execFile);

let projectPath: string;

beforeEach(async () => {
  projectPath = await fs.mkdtemp(
    path.join(os.tmpdir(), 'scepter-dirty-guard-test-'),
  );
});

afterEach(async () => {
  if (projectPath) {
    await fs.remove(projectPath);
  }
});

async function gitInit(projectPath: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: projectPath });
  // Local-only identity so commits work.
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: projectPath,
  });
  await execFileAsync('git', ['config', 'user.name', 'Test'], {
    cwd: projectPath,
  });
}

describe('checkWorkingTreeClean', () => {
  it('reports clean for a fresh repo with a clean tree', async () => {
    await gitInit(projectPath);
    // Create a committed file so we have a clean baseline.
    await fs.writeFile(path.join(projectPath, 'baseline.txt'), 'hello');
    await execFileAsync('git', ['add', 'baseline.txt'], { cwd: projectPath });
    await execFileAsync(
      'git',
      ['commit', '-m', 'baseline'],
      { cwd: projectPath },
    );
    const result = await checkWorkingTreeClean(projectPath);
    expect(result.status).toBe('clean');
    expect(result.porcelain).toBe('');
  });

  it('reports dirty for uncommitted modifications', async () => {
    await gitInit(projectPath);
    const filePath = path.join(projectPath, 'modified.txt');
    await fs.writeFile(filePath, 'first');
    await execFileAsync('git', ['add', 'modified.txt'], { cwd: projectPath });
    await execFileAsync(
      'git',
      ['commit', '-m', 'first'],
      { cwd: projectPath },
    );
    // Modify after commit.
    await fs.writeFile(filePath, 'second');

    const result = await checkWorkingTreeClean(projectPath);
    expect(result.status).toBe('dirty');
    expect(result.porcelain).toContain('modified.txt');
  });

  it('reports dirty for untracked files', async () => {
    await gitInit(projectPath);
    // Commit something so the repo has a baseline.
    await fs.writeFile(path.join(projectPath, 'baseline.txt'), 'hello');
    await execFileAsync('git', ['add', 'baseline.txt'], { cwd: projectPath });
    await execFileAsync(
      'git',
      ['commit', '-m', 'baseline'],
      { cwd: projectPath },
    );
    // Add an untracked file.
    await fs.writeFile(path.join(projectPath, 'untracked.txt'), 'x');

    const result = await checkWorkingTreeClean(projectPath);
    expect(result.status).toBe('dirty');
    expect(result.porcelain).toContain('untracked.txt');
  });

  it('reports not-a-git-repo for a directory without git', async () => {
    // projectPath is just a tmpdir — no git init.
    const result = await checkWorkingTreeClean(projectPath);
    expect(result.status).toBe('not-a-git-repo');
  });
});

describe('shouldBlockOnDirtyTree', () => {
  it('does not block when clean', () => {
    expect(
      shouldBlockOnDirtyTree({ status: 'clean', porcelain: '' }, false),
    ).toBeNull();
  });

  it('does not block when not-a-git-repo', () => {
    expect(
      shouldBlockOnDirtyTree(
        { status: 'not-a-git-repo', porcelain: '' },
        false,
      ),
    ).toBeNull();
  });

  it('blocks when dirty without override', () => {
    const msg = shouldBlockOnDirtyTree(
      { status: 'dirty', porcelain: ' M file.txt' },
      false,
    );
    expect(msg).not.toBeNull();
    expect(msg).toContain('Working tree is dirty');
    expect(msg).toContain('file.txt');
  });

  it('does not block when dirty with override', () => {
    expect(
      shouldBlockOnDirtyTree(
        { status: 'dirty', porcelain: ' M file.txt' },
        true,
      ),
    ).toBeNull();
  });
});
