/**
 * Tests for validateAliasReferences — Phase 6 alias-prefixed reference
 * validation in `scepter claims lint`.
 *
 * @validates {R011.§3.AC.06} lint validates alias-prefixed references
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigManager } from '../../../../config/config-manager';
import { ClaimIndex } from '../../../../claims/claim-index';
import type { NoteWithContent } from '../../../../claims/claim-index';
import { ProjectManager } from '../../../../project/project-manager';
import { validateAliasReferences } from '../lint-command';
import { createFilesystemProject } from '../../../../storage/filesystem/create-filesystem-project';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('validateAliasReferences (R011.§3.AC.06)', () => {
  const tmpRoot = path.join(process.cwd(), '.test-tmp', 'alias-ref-validation');
  const localPath = path.join(tmpRoot, 'local');
  const peerPath = path.join(tmpRoot, 'peer');

  beforeEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  /** Build a peer project with one note R001 containing one claim §1.AC.01. */
  async function makePeer(dir: string): Promise<void> {
    const configPath = path.join(dir, '_scepter', 'scepter.config.json');
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({
        noteTypes: { Requirement: { folder: 'reqs', shortcode: 'R' } },
      }),
    );
    const reqDir = path.join(dir, '_scepter', 'notes', 'reqs');
    await fs.mkdir(reqDir, { recursive: true });
    await fs.writeFile(
      path.join(reqDir, 'R001 Peer Note.md'),
      '# R001 Peer Note\n\n### §1 Section\n\n§1.AC.01 First peer claim.\n',
    );
  }

  /** Build a local project with the given local note containing alias-prefixed references.
   * Returns the initialized ProjectManager. */
  async function makeLocal(opts: {
    aliasName: string;
    aliasTarget: string;
    localContent: string;
  }): Promise<ProjectManager> {
    const configPath = path.join(localPath, '_scepter', 'scepter.config.json');
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({
        noteTypes: { Requirement: { folder: 'reqs', shortcode: 'R' } },
        projectAliases: { [opts.aliasName]: opts.aliasTarget },
      }),
    );
    const localReqDir = path.join(localPath, '_scepter', 'notes', 'reqs');
    await fs.mkdir(localReqDir, { recursive: true });
    await fs.writeFile(path.join(localReqDir, 'R100 Local.md'), opts.localContent);
    const pm = await createFilesystemProject(localPath);
    await pm.initialize();
    return pm;
  }

  /** Build a ClaimIndex over the local note's content alone. */
  function buildIndexForLocal(content: string): ReturnType<ClaimIndex['build']> {
    const idx = new ClaimIndex();
    const note: NoteWithContent = {
      id: 'R100',
      type: 'Requirement',
      filePath: 'R100.md',
      content,
    };
    return idx.build([note]);
  }

  it('produces no errors when alias and peer note/claim resolve cleanly', async () => {
    await makePeer(peerPath);
    const localContent = '# R100 Local\n\n### §1 Section\n\n§1.AC.01 References {peer/R001.§1.AC.01} ok.\n';
    const pm = await makeLocal({ aliasName: 'peer', aliasTarget: peerPath, localContent });
    const indexData = buildIndexForLocal(localContent);

    const errors = await validateAliasReferences('R100', indexData, pm);
    expect(errors).toHaveLength(0);
  });

  it('emits alias-unknown when the alias is not in projectAliases', async () => {
    await makePeer(peerPath);
    const localContent = '# R100 Local\n\n### §1 Section\n\n§1.AC.01 References {ghost/R001.§1.AC.01}.\n';
    const pm = await makeLocal({ aliasName: 'peer', aliasTarget: peerPath, localContent });
    const indexData = buildIndexForLocal(localContent);

    const errors = await validateAliasReferences('R100', indexData, pm);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.type === 'alias-unknown')).toBe(true);
    const aliasUnknown = errors.find((e) => e.type === 'alias-unknown')!;
    expect(aliasUnknown.message).toContain('ghost');
  });

  it('emits peer-unresolved when the alias target path does not exist', async () => {
    // Configure an alias pointing at a missing path. This must NOT block
    // config load (per R011.§1.AC.06 — warnings, not errors) but the
    // reference site should produce an error.
    const localContent = '# R100 Local\n\n### §1 Section\n\n§1.AC.01 References {peer/R001.§1.AC.01}.\n';
    const pm = await makeLocal({
      aliasName: 'peer',
      aliasTarget: path.join(process.cwd(), '.test-tmp', 'definitely-not-here-zzzz'),
      localContent,
    });
    const indexData = buildIndexForLocal(localContent);

    const errors = await validateAliasReferences('R100', indexData, pm);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.type === 'peer-unresolved')).toBe(true);
  });

  it('emits peer-target-not-found when the peer note is missing', async () => {
    await makePeer(peerPath);
    // Reference R999 which doesn't exist in the peer.
    const localContent = '# R100 Local\n\n### §1 Section\n\n§1.AC.01 References {peer/R999}.\n';
    const pm = await makeLocal({ aliasName: 'peer', aliasTarget: peerPath, localContent });
    const indexData = buildIndexForLocal(localContent);

    const errors = await validateAliasReferences('R100', indexData, pm);
    expect(errors.some((e) => e.type === 'peer-target-not-found')).toBe(true);
  });

  it('emits peer-target-not-found when the peer claim is missing in an existing peer note', async () => {
    await makePeer(peerPath);
    // R001 exists in peer, but AC.99 doesn't.
    const localContent = '# R100 Local\n\n### §1 Section\n\n§1.AC.01 References {peer/R001.§1.AC.99}.\n';
    const pm = await makeLocal({ aliasName: 'peer', aliasTarget: peerPath, localContent });
    const indexData = buildIndexForLocal(localContent);

    const errors = await validateAliasReferences('R100', indexData, pm);
    expect(errors.some((e) => e.type === 'peer-target-not-found')).toBe(true);
  });

  it('returns empty when the local note has no alias-prefixed references', async () => {
    await makePeer(peerPath);
    const localContent = '# R100 Local\n\n### §1 Section\n\n§1.AC.01 No cross-project refs here.\n';
    const pm = await makeLocal({ aliasName: 'peer', aliasTarget: peerPath, localContent });
    const indexData = buildIndexForLocal(localContent);

    const errors = await validateAliasReferences('R100', indexData, pm);
    expect(errors).toHaveLength(0);
  });
});
