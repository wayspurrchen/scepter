/**
 * Integration-style tests for Phase 7: show, gather, trace command behavior on
 * alias-prefixed references.
 *
 * @validates {R011.§3.AC.01} show with peer-source header
 * @validates {R011.§3.AC.02} gather stub-only (peer not loaded)
 * @validates {R011.§3.AC.03} trace cross-project citations footer
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createFilesystemProject } from '../../../storage/filesystem/create-filesystem-project';
import { showNotes } from '../context/show-handler';
import { gatherContext } from '../context/gather-handler';
import { ClaimIndex } from '../../../claims/claim-index';

describe('Cross-project show / gather / trace (R011)', () => {
  const tmpRoot = path.join(process.cwd(), '.test-tmp', 'cross-project-cmds');
  const localPath = path.join(tmpRoot, 'local');
  const peerPath = path.join(tmpRoot, 'peer');

  beforeEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  async function makePeer(): Promise<void> {
    const configPath = path.join(peerPath, '_scepter', 'scepter.config.json');
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({
        noteTypes: { Requirement: { folder: 'reqs', shortcode: 'R' } },
      }),
    );
    const reqs = path.join(peerPath, '_scepter', 'notes', 'reqs');
    await fs.mkdir(reqs, { recursive: true });
    await fs.writeFile(
      path.join(reqs, 'R042 Peer Requirement.md'),
      '# R042 Peer Requirement\n\n## §1 Section\n\n§1.AC.01 First peer claim.\n',
    );
  }

  async function makeLocal(): Promise<void> {
    const configPath = path.join(localPath, '_scepter', 'scepter.config.json');
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({
        noteTypes: { Requirement: { folder: 'reqs', shortcode: 'R' } },
        projectAliases: { peer: peerPath },
      }),
    );
    const reqs = path.join(localPath, '_scepter', 'notes', 'reqs');
    await fs.mkdir(reqs, { recursive: true });
    await fs.writeFile(
      path.join(reqs, 'R100 Local.md'),
      '# R100 Local\n\n## §1 Section\n\n§1.AC.01 Cites {peer/R042.§1.AC.01} for context.\n',
    );
  }

  describe('show', () => {
    it('renders an alias-prefixed note with a peer-source header (R011.§3.AC.01)', async () => {
      await makePeer();
      await makeLocal();
      const pm = await createFilesystemProject(localPath);
      await pm.initialize();
      const result = await showNotes(['peer/R042'], {}, { projectManager: pm, projectPath: localPath } as any);
      expect(result.output).toContain('From peer project: peer');
      expect(result.output).toContain('R042 Peer Requirement');
      // The output should NOT classify the peer note as local (no "not found" warnings)
      expect(result.output).not.toContain('Note not found');
    });

    it('emits a clear error when the alias is not declared', async () => {
      await makeLocal();
      const pm = await createFilesystemProject(localPath);
      await pm.initialize();
      const result = await showNotes(['ghost/R042'], {}, { projectManager: pm, projectPath: localPath } as any);
      expect(result.output).toContain('ghost/R042');
      expect(result.output.toLowerCase()).toContain('not declared');
    });
  });

  describe('gather', () => {
    it('renders alias-prefixed references as stubs and does not load peer content (R011.§3.AC.02)', async () => {
      await makePeer();
      await makeLocal();
      const pm = await createFilesystemProject(localPath);
      await pm.initialize();
      const result = await gatherContext('R100', {}, { projectManager: pm, projectPath: localPath } as any);
      // crossProjectStubs reflects the alias citation
      expect(result.crossProjectStubs).toBeDefined();
      expect(result.crossProjectStubs!.length).toBeGreaterThan(0);
      const stub = result.crossProjectStubs![0];
      expect(stub.aliasName).toBe('peer');
      expect(stub.peerNoteId).toBe('R042');
      // Output footer mentions the citation
      expect(result.output).toContain('Cross-project citations');
      expect(result.output).toContain('peer/R042');
      // Aggregate counts must not include the peer
      expect(result.stats.totalNotes).toBeDefined();
      // The peer note should NOT appear in `gathered`
      expect(result.gathered.find((g) => g.note?.id === 'R042')).toBeUndefined();
    });

    it('returns no crossProjectStubs when the local note has no alias-prefixed references', async () => {
      const configPath = path.join(localPath, '_scepter', 'scepter.config.json');
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify({
          noteTypes: { Requirement: { folder: 'reqs', shortcode: 'R' } },
        }),
      );
      const reqs = path.join(localPath, '_scepter', 'notes', 'reqs');
      await fs.mkdir(reqs, { recursive: true });
      await fs.writeFile(
        path.join(reqs, 'R100 Plain.md'),
        '# R100 Plain\n\n## §1 Section\n\n§1.AC.01 No cross-project refs here.\n',
      );
      const pm = await createFilesystemProject(localPath);
      await pm.initialize();
      const result = await gatherContext('R100', {}, { projectManager: pm, projectPath: localPath } as any);
      expect(result.crossProjectStubs).toBeUndefined();
    });
  });

  describe('trace (claim-index integration)', () => {
    it('captures alias-prefixed references in crossProjectRefs separate from local crossRefs (R011.§3.AC.03/.AC.04)', async () => {
      const idx = new ClaimIndex();
      const data = idx.build([
        {
          id: 'R100',
          type: 'Requirement',
          filePath: 'R100.md',
          content: '# R100 Local\n\n### §1 Section\n\n§1.AC.01 Cites {peer/R042.§1.AC.01}.\n',
        },
      ]);

      // Cross-project references go to crossProjectRefs only.
      expect(data.crossProjectRefs).toHaveLength(1);
      expect(data.crossProjectRefs[0].aliasPrefix).toBe('peer');
      expect(data.crossProjectRefs[0].fromNoteId).toBe('R100');

      // Local crossRefs MUST NOT contain the alias-prefixed reference.
      expect(data.crossRefs.some((c) => c.toClaim.startsWith('peer'))).toBe(false);

      // No `unresolved-reference` error for the alias-prefixed citation.
      const aliasRefErrors = data.errors.filter((e) =>
        e.type === 'unresolved-reference' && (e.claimId.includes('peer/') || e.claimId.startsWith('peer.')),
      );
      expect(aliasRefErrors).toHaveLength(0);
    });
  });
});
