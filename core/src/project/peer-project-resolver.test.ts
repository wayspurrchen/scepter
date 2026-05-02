/**
 * @validates {R011.§2.AC.05} alias-unknown / peer-unresolved / peer-load-failed / note-not-found / claim-not-found
 * @validates {R011.§2.AC.06} per-invocation peer cache
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigManager } from '../config/config-manager';
import { PeerProjectResolver } from './peer-project-resolver';
import type { PeerProjectFactory } from './peer-project-resolver';
import { createFilesystemProject } from '../storage/filesystem/create-filesystem-project';
import { parseClaimAddress } from '../parsers/claim/claim-parser';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('PeerProjectResolver (R011)', () => {
  const tmpRoot = path.join(process.cwd(), '.test-tmp', 'peer-resolver');
  const localPath = path.join(tmpRoot, 'local');
  const peerPath = path.join(tmpRoot, 'peer');

  beforeEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.mkdir(localPath, { recursive: true });
    await fs.mkdir(peerPath, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  /** Build a minimal SCEpter project rooted at `dir` with one note R001. */
  async function makePeer(dir: string, noteContent = '# R001 - Peer Note\n\nSome peer body.\n\n§1.AC.01 First peer acceptance criterion.\n'): Promise<void> {
    const configPath = path.join(dir, '_scepter', 'scepter.config.json');
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({
        noteTypes: { Requirement: { folder: 'reqs', shortcode: 'R' } },
      }),
    );
    const notesDir = path.join(dir, '_scepter', 'notes', 'reqs');
    await fs.mkdir(notesDir, { recursive: true });
    await fs.writeFile(path.join(notesDir, 'R001 Peer Note.md'), noteContent);
  }

  /** Build a local config that declares a `peer` alias pointing at `peerPath`. */
  async function makeLocalWithAlias(): Promise<ConfigManager> {
    const configPath = path.join(localPath, '_scepter', 'scepter.config.json');
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({
        noteTypes: { Requirement: { folder: 'reqs', shortcode: 'R' } },
        projectAliases: { peer: peerPath },
      }),
    );
    const cm = new ConfigManager(localPath);
    await cm.loadConfigFromFilesystem();
    return cm;
  }

  describe('resolve', () => {
    it('returns alias-unknown when the alias is not declared', async () => {
      const cm = await makeLocalWithAlias();
      const factory: PeerProjectFactory = vi.fn(async () => {
        throw new Error('factory should not be called');
      });
      const resolver = new PeerProjectResolver(cm, factory);
      const result = await resolver.resolve('not-declared');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('alias-unknown');
        expect(result.aliasName).toBe('not-declared');
      }
      expect(factory).not.toHaveBeenCalled();
    });

    it('returns peer-unresolved when the alias target is invalid', async () => {
      // Don't make a peer project at peerPath; loadConfig will mark `peer` unresolved.
      const cm = await makeLocalWithAlias();
      const factory: PeerProjectFactory = vi.fn(async () => {
        throw new Error('factory should not be called for unresolved alias');
      });
      const resolver = new PeerProjectResolver(cm, factory);
      const result = await resolver.resolve('peer');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('peer-unresolved');
      }
      expect(factory).not.toHaveBeenCalled();
    });

    it('returns peer-load-failed when the factory throws', async () => {
      await makePeer(peerPath);
      const cm = await makeLocalWithAlias();
      const factory: PeerProjectFactory = vi.fn(async () => {
        throw new Error('boom');
      });
      const resolver = new PeerProjectResolver(cm, factory);
      const result = await resolver.resolve('peer');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('peer-load-failed');
        expect(result.message).toContain('boom');
      }
    });

    it('returns a successful PeerProjectHandle when the alias is valid', async () => {
      await makePeer(peerPath);
      const cm = await makeLocalWithAlias();
      const resolver = new PeerProjectResolver(cm, createFilesystemProject);
      const result = await resolver.resolve('peer');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.aliasName).toBe('peer');
        expect(path.resolve(result.resolvedPath)).toBe(path.resolve(peerPath));
        expect(result.projectManager).toBeDefined();
      }
    });

    it('caches resolution results — second call returns the same handle without calling factory again', async () => {
      await makePeer(peerPath);
      const cm = await makeLocalWithAlias();
      const factory: PeerProjectFactory = vi.fn(createFilesystemProject);
      const resolver = new PeerProjectResolver(cm, factory);
      const first = await resolver.resolve('peer');
      const second = await resolver.resolve('peer');
      expect(first).toBe(second);
      expect(factory).toHaveBeenCalledTimes(1);
    });
  });

  describe('lookupNote', () => {
    it('returns the peer note when the ID exists', async () => {
      await makePeer(peerPath);
      const cm = await makeLocalWithAlias();
      const resolver = new PeerProjectResolver(cm, createFilesystemProject);
      const result = await resolver.lookupNote('peer', 'R001');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.note.id).toBe('R001');
        expect(result.peer.aliasName).toBe('peer');
      }
    });

    it('returns note-not-found when the note ID does not exist in the peer', async () => {
      await makePeer(peerPath);
      const cm = await makeLocalWithAlias();
      const resolver = new PeerProjectResolver(cm, createFilesystemProject);
      const result = await resolver.lookupNote('peer', 'R999');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('note-not-found');
      }
    });

    it('propagates alias-unknown when the alias is not declared', async () => {
      await makePeer(peerPath);
      const cm = await makeLocalWithAlias();
      const resolver = new PeerProjectResolver(cm, createFilesystemProject);
      const result = await resolver.lookupNote('not-declared', 'R001');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('alias-unknown');
    });
  });

  describe('lookupClaim', () => {
    it('returns the peer claim entry when the address resolves', async () => {
      await makePeer(peerPath);
      const cm = await makeLocalWithAlias();
      const resolver = new PeerProjectResolver(cm, createFilesystemProject);
      const addr = parseClaimAddress('peer/R001.§1.AC.01');
      expect(addr).not.toBeNull();
      const result = await resolver.lookupClaim(addr!);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.peer.aliasName).toBe('peer');
        // The entry's fully qualified ID should match what we asked for.
        // Format: R001.1.AC.01 in the index canonical form.
        expect(result.entry).toBeDefined();
      }
    });

    it('returns claim-not-found when the claim does not exist in the peer', async () => {
      await makePeer(peerPath);
      const cm = await makeLocalWithAlias();
      const resolver = new PeerProjectResolver(cm, createFilesystemProject);
      const addr = parseClaimAddress('peer/R001.§1.AC.99');
      expect(addr).not.toBeNull();
      const result = await resolver.lookupClaim(addr!);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('claim-not-found');
    });

    it('rejects local addresses (no aliasPrefix) — programmer error', async () => {
      const cm = await makeLocalWithAlias();
      const resolver = new PeerProjectResolver(cm, createFilesystemProject);
      const addr = parseClaimAddress('R001.§1.AC.01');
      expect(addr).not.toBeNull();
      const result = await resolver.lookupClaim(addr!);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('alias-unknown');
        expect(result.message).toMatch(/local address/);
      }
    });
  });

  /**
   * @validates {R011.§4.AC.12} peer-cache invalidation on projectAliases reload
   * @validates {R011.§2.AC.06} unchanged aliases preserved across reload
   */
  describe('invalidate / invalidateChanged (R011.§4.AC.12)', () => {
    /** Build a peer project at the given dir with one R001 note. */
    async function makePeerAt(dir: string): Promise<void> {
      const configPath = path.join(dir, '_scepter', 'scepter.config.json');
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify({ noteTypes: { Requirement: { folder: 'reqs', shortcode: 'R' } } }),
      );
      const notesDir = path.join(dir, '_scepter', 'notes', 'reqs');
      await fs.mkdir(notesDir, { recursive: true });
      await fs.writeFile(
        path.join(notesDir, 'R001 Peer Note.md'),
        '# R001 - Peer\n\n§1.AC.01 First peer claim.\n',
      );
    }

    /** Write the local config with a given projectAliases map. */
    async function writeLocalConfig(aliases: Record<string, string>): Promise<void> {
      const configPath = path.join(localPath, '_scepter', 'scepter.config.json');
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify({
          noteTypes: { Requirement: { folder: 'reqs', shortcode: 'R' } },
          projectAliases: aliases,
        }),
      );
    }

    it('invalidate(name) drops the cache entry; next resolve re-loads via factory', async () => {
      await makePeerAt(peerPath);
      const cm = await makeLocalWithAlias();
      const factory: PeerProjectFactory = vi.fn(createFilesystemProject);
      const resolver = new PeerProjectResolver(cm, factory);

      const first = await resolver.resolve('peer');
      expect(first.ok).toBe(true);
      expect(factory).toHaveBeenCalledTimes(1);
      expect(resolver.cacheSize).toBe(1);

      resolver.invalidate('peer');
      expect(resolver.cacheSize).toBe(0);

      const second = await resolver.resolve('peer');
      expect(second.ok).toBe(true);
      expect(factory).toHaveBeenCalledTimes(2);
    });

    it('invalidate(name) is idempotent for unknown aliases', async () => {
      const cm = await makeLocalWithAlias();
      const factory: PeerProjectFactory = vi.fn(createFilesystemProject);
      const resolver = new PeerProjectResolver(cm, factory);
      // Calling invalidate on an alias that was never cached is a no-op.
      expect(() => resolver.invalidate('never-cached')).not.toThrow();
      expect(resolver.cacheSize).toBe(0);
    });

    it('repoint: alias path changes → cache entry invalidated, next resolve hits new path', async () => {
      // Two distinct peer projects on disk.
      const peer1 = path.join(tmpRoot, 'peer1');
      const peer2 = path.join(tmpRoot, 'peer2');
      await makePeerAt(peer1);
      await makePeerAt(peer2);

      // Local config initially points `vendor` → peer1.
      await writeLocalConfig({ vendor: peer1 });
      const cm = new ConfigManager(localPath);
      await cm.loadConfigFromFilesystem();

      const factory: PeerProjectFactory = vi.fn(createFilesystemProject);
      const resolver = new PeerProjectResolver(cm, factory);

      // Subscribe to the aliases:changed event so the resolver can act on
      // reloads — mirrors the ProjectManager wiring.
      cm.on('aliases:changed', (payload: { prev: Map<string, any>; next: Map<string, any> }) => {
        resolver.invalidateChanged(payload.prev, payload.next);
      });

      const firstResolve = await resolver.resolve('vendor');
      expect(firstResolve.ok).toBe(true);
      if (firstResolve.ok) {
        expect(path.resolve(firstResolve.resolvedPath)).toBe(path.resolve(peer1));
      }
      expect(factory).toHaveBeenCalledTimes(1);

      // Repoint the alias and reload.
      await writeLocalConfig({ vendor: peer2 });
      await cm.reloadConfig();

      const secondResolve = await resolver.resolve('vendor');
      expect(secondResolve.ok).toBe(true);
      if (secondResolve.ok) {
        expect(path.resolve(secondResolve.resolvedPath)).toBe(path.resolve(peer2));
      }
      expect(factory).toHaveBeenCalledTimes(2);
    });

    it('remove: alias removed → cache entry invalidated, next resolve returns alias-unknown', async () => {
      await makePeerAt(peerPath);
      await writeLocalConfig({ vendor: peerPath });
      const cm = new ConfigManager(localPath);
      await cm.loadConfigFromFilesystem();

      const factory: PeerProjectFactory = vi.fn(createFilesystemProject);
      const resolver = new PeerProjectResolver(cm, factory);
      cm.on('aliases:changed', (payload: { prev: Map<string, any>; next: Map<string, any> }) => {
        resolver.invalidateChanged(payload.prev, payload.next);
      });

      const first = await resolver.resolve('vendor');
      expect(first.ok).toBe(true);

      // Remove the alias entirely and reload.
      await writeLocalConfig({});
      await cm.reloadConfig();

      const second = await resolver.resolve('vendor');
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.reason).toBe('alias-unknown');
      }
    });

    it('unchanged-preserved: alias path unchanged across reload → factory NOT called again', async () => {
      // §2.AC.06 caching invariant — must hold across config reloads when
      // the alias's path is unchanged.
      await makePeerAt(peerPath);
      await writeLocalConfig({ vendor: peerPath });
      const cm = new ConfigManager(localPath);
      await cm.loadConfigFromFilesystem();

      const factory: PeerProjectFactory = vi.fn(createFilesystemProject);
      const resolver = new PeerProjectResolver(cm, factory);
      cm.on('aliases:changed', (payload: { prev: Map<string, any>; next: Map<string, any> }) => {
        resolver.invalidateChanged(payload.prev, payload.next);
      });

      await resolver.resolve('vendor');
      expect(factory).toHaveBeenCalledTimes(1);

      // Reload with EXACT same config.
      await cm.reloadConfig();

      // Subsequent resolve must hit cache. Factory must not be called again.
      await resolver.resolve('vendor');
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('mixed: multiple aliases, only changed/removed entries invalidated', async () => {
      const peerA1 = path.join(tmpRoot, 'peer-a-v1');
      const peerA2 = path.join(tmpRoot, 'peer-a-v2');
      const peerB = path.join(tmpRoot, 'peer-b');
      const peerC = path.join(tmpRoot, 'peer-c');
      await makePeerAt(peerA1);
      await makePeerAt(peerA2);
      await makePeerAt(peerB);
      await makePeerAt(peerC);

      // Initial: a→A1, b→B, c→C.
      await writeLocalConfig({ a: peerA1, b: peerB, c: peerC });
      const cm = new ConfigManager(localPath);
      await cm.loadConfigFromFilesystem();

      const factory: PeerProjectFactory = vi.fn(createFilesystemProject);
      const resolver = new PeerProjectResolver(cm, factory);
      cm.on('aliases:changed', (payload: { prev: Map<string, any>; next: Map<string, any> }) => {
        resolver.invalidateChanged(payload.prev, payload.next);
      });

      // Resolve all three.
      await resolver.resolve('a');
      await resolver.resolve('b');
      await resolver.resolve('c');
      expect(factory).toHaveBeenCalledTimes(3);
      expect(resolver.cacheSize).toBe(3);

      // Reload: a unchanged, b repointed (B→A2-shaped: simulate by repointing
      // b to peerA2), c removed.
      await writeLocalConfig({ a: peerA1, b: peerA2 });
      await cm.reloadConfig();

      // a should still hit cache; b and c should be invalidated.
      await resolver.resolve('a');
      expect(factory).toHaveBeenCalledTimes(3); // a hit cache, no new call

      const bResolve = await resolver.resolve('b');
      expect(factory).toHaveBeenCalledTimes(4); // b re-loaded
      if (bResolve.ok) {
        expect(path.resolve(bResolve.resolvedPath)).toBe(path.resolve(peerA2));
      }

      const cResolve = await resolver.resolve('c');
      expect(cResolve.ok).toBe(false);
      if (!cResolve.ok) {
        expect(cResolve.reason).toBe('alias-unknown');
      }
    });
  });
});
