/**
 * Tests for audit output formatters.
 *
 * @validates {DD022.§10.2.DC.04} IncidenceRecord canonical JSON contract
 * @validates {DD022.§10.4.DC.19} formatAuditHuman grouping order
 * @validates {DD022.§10.4.DC.20} formatAuditJson document shape
 * @validates {DD022.§10.4.DC.21} scanned counts footer
 * @validates {R016.§5.AC.01–04} output format ACs
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { formatAuditHuman, formatAuditJson } from '../audit-formatters.js';
import type { IncidenceRecord, IncidenceCode } from '../incidence-collector.js';
import type { AuditScanned } from '../run-audit.js';

// ---------------------------------------------------------------------------
// Helpers — strip ANSI color codes from chalk output so we can assert on text
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

function mkRecord(opts: {
  code: IncidenceCode;
  targetRaw: string;
  targetNoteId?: string;
  site?: Partial<{
    kind: 'note-site' | 'source-site';
    filePath: string;
    relativePath: string;
    line: number;
    claimId: string;
  }>;
  lifecycleFlag?: 'archived' | 'soft-deleted';
  resolverDetail?: string;
}): IncidenceRecord {
  const siteOpts = opts.site ?? {};
  if (siteOpts.kind === 'source-site') {
    return {
      code: opts.code,
      targetRaw: opts.targetRaw,
      ...(opts.targetNoteId !== undefined ? { targetNoteId: opts.targetNoteId } : {}),
      ...(opts.resolverDetail !== undefined ? { resolverDetail: opts.resolverDetail } : {}),
      site: {
        kind: 'source-site',
        filePath: siteOpts.filePath ?? '/abs/core/src/foo.ts',
        relativePath: siteOpts.relativePath ?? 'core/src/foo.ts',
        line: siteOpts.line ?? 1,
        annotationType: 'implements',
        sourceSnippet: '',
      },
      ...(opts.lifecycleFlag !== undefined ? { lifecycleFlag: opts.lifecycleFlag } : {}),
    };
  }
  return {
    code: opts.code,
    targetRaw: opts.targetRaw,
    ...(opts.targetNoteId !== undefined ? { targetNoteId: opts.targetNoteId } : {}),
    ...(opts.resolverDetail !== undefined ? { resolverDetail: opts.resolverDetail } : {}),
    site: {
      kind: 'note-site',
      noteId: 'S099',
      ...(siteOpts.claimId !== undefined ? { claimId: siteOpts.claimId } : {}),
      line: siteOpts.line ?? 1,
      sourceSnippet: '',
      filePath: siteOpts.filePath ?? '/abs/notes/S099.md',
    },
    ...(opts.lifecycleFlag !== undefined ? { lifecycleFlag: opts.lifecycleFlag } : {}),
  };
}

const SCANNED: AuditScanned = {
  notes: 5,
  sourceFiles: 0,
  references: 12,
};

// ---------------------------------------------------------------------------
// JSON formatter
// ---------------------------------------------------------------------------

describe('formatAuditJson', () => {
  describe('Test 1: shape and field order', () => {
    it('emits { scanned, incidences[] } with canonical field order', () => {
      const records = [
        mkRecord({
          code: 'reference-to-unknown-note',
          targetRaw: 'R042.1.AC.03',
          targetNoteId: 'R042',
          site: { line: 42, claimId: 'S099.1.AC.01' },
        }),
      ];
      const json = formatAuditJson(records, SCANNED);
      const parsed = JSON.parse(json);
      expect(Object.keys(parsed)).toEqual(['scanned', 'incidences']);
      expect(parsed.scanned).toEqual(SCANNED);
      expect(parsed.incidences).toHaveLength(1);

      const inc = parsed.incidences[0];
      // Canonical declaration order: code, targetRaw, targetNoteId,
      // resolverDetail (omitted here), site, lifecycleFlag (omitted).
      expect(Object.keys(inc)).toEqual(['code', 'targetRaw', 'targetNoteId', 'site']);

      // Site canonical order for note-site: kind, noteId, claimId, line, sourceSnippet, filePath.
      expect(Object.keys(inc.site)).toEqual([
        'kind',
        'noteId',
        'claimId',
        'line',
        'sourceSnippet',
        'filePath',
      ]);
    });
  });

  describe('Test 2: deterministic byte output', () => {
    it('two invocations with same input produce byte-identical output', () => {
      const records = [
        mkRecord({ code: 'reference-to-archived', targetRaw: 'R057', targetNoteId: 'R057', lifecycleFlag: 'archived' }),
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042', targetNoteId: 'R042' }),
      ];
      const a = formatAuditJson(records, SCANNED);
      const b = formatAuditJson(records, SCANNED);
      expect(a).toBe(b);
    });
  });

  describe('Test 3: empty records → empty incidences, populated scanned', () => {
    it('emits valid JSON with empty incidences array', () => {
      const json = formatAuditJson([], SCANNED);
      const parsed = JSON.parse(json);
      expect(parsed.incidences).toEqual([]);
      expect(parsed.scanned).toEqual(SCANNED);
    });
  });

  describe('Test 3b: source-site canonical order', () => {
    it('source-site site emits kind, filePath, relativePath, line, annotationType, sourceSnippet', () => {
      const records = [
        mkRecord({
          code: 'reference-to-unknown-note',
          targetRaw: 'R042',
          targetNoteId: 'R042',
          site: { kind: 'source-site' },
        }),
      ];
      const parsed = JSON.parse(formatAuditJson(records, SCANNED));
      expect(Object.keys(parsed.incidences[0].site)).toEqual([
        'kind',
        'filePath',
        'relativePath',
        'line',
        'annotationType',
        'sourceSnippet',
      ]);
    });
  });
});

// ---------------------------------------------------------------------------
// Human formatter
// ---------------------------------------------------------------------------

describe('formatAuditHuman', () => {
  describe('Test 4: zero-finding case', () => {
    it('emits "No findings." plus scanned footer', async () => {
      const out = stripAnsi(await formatAuditHuman([], SCANNED));
      expect(out).toContain('No findings.');
      expect(out).toContain('Scanned: 5 notes, 0 source files, 12 references.');
    });
  });

  describe('Test 5: groups by code → target → sites', () => {
    it('emits code section, then target subheadings, then site lines', async () => {
      const records = [
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042', targetNoteId: 'R042', site: { line: 1, filePath: '/abs/a.md' } }),
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042', targetNoteId: 'R042', site: { line: 2, filePath: '/abs/a.md' } }),
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R057', targetNoteId: 'R057', site: { line: 3, filePath: '/abs/b.md' } }),
      ];
      const out = stripAnsi(await formatAuditHuman(records, SCANNED));
      // Header
      expect(out).toContain('Found 3 incidence(s):');
      // Code heading
      expect(out).toMatch(/\[UNKNOWN-NOTE\].*\(3 incidences\)/);
      // Target subheadings (alphabetical: R042 before R057)
      const r042Idx = out.indexOf('R042 ');
      const r057Idx = out.indexOf('R057 ');
      expect(r042Idx).toBeGreaterThan(0);
      expect(r057Idx).toBeGreaterThan(r042Idx);
      // Site counts: R042 has 2 sites, R057 has 1
      expect(out).toMatch(/R042.*\(2 sites\)/);
      expect(out).toMatch(/R057.*\(1 site\)/);
    });
  });

  describe('Test 6: sorts codes — reference-family first, then alphabetical', () => {
    it('reference-to-archived appears before non-monotonic', async () => {
      const records = [
        mkRecord({ code: 'non-monotonic', targetRaw: 'R042.1.AC.05', targetNoteId: 'R042' }),
        mkRecord({ code: 'reference-to-archived', targetRaw: 'R057', targetNoteId: 'R057', lifecycleFlag: 'archived' }),
      ];
      const out = stripAnsi(await formatAuditHuman(records, SCANNED));
      const archivedIdx = out.indexOf('[ARCHIVED-REF]');
      const monoIdx = out.indexOf('[NON-MONOTONIC]');
      expect(archivedIdx).toBeGreaterThan(0);
      expect(monoIdx).toBeGreaterThan(archivedIdx);
    });
  });

  describe('Test 7: sorts targets alphabetically within each code', () => {
    it('R001 before R042 in same code block', async () => {
      const records = [
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042', targetNoteId: 'R042' }),
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R001', targetNoteId: 'R001' }),
      ];
      const out = stripAnsi(await formatAuditHuman(records, SCANNED));
      const r001Idx = out.indexOf('R001 ');
      const r042Idx = out.indexOf('R042 ');
      expect(r001Idx).toBeLessThan(r042Idx);
    });
  });

  describe('Test 8: sorts sites by filePath then line within each target', () => {
    it('a.md:1 before a.md:5 before b.md:1', async () => {
      const records = [
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042', targetNoteId: 'R042', site: { filePath: '/abs/b.md', line: 1 } }),
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042', targetNoteId: 'R042', site: { filePath: '/abs/a.md', line: 5 } }),
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042', targetNoteId: 'R042', site: { filePath: '/abs/a.md', line: 1 } }),
      ];
      const out = stripAnsi(await formatAuditHuman(records, SCANNED));
      const aLine1 = out.indexOf('/abs/a.md:1');
      const aLine5 = out.indexOf('/abs/a.md:5');
      const bLine1 = out.indexOf('/abs/b.md:1');
      expect(aLine1).toBeGreaterThan(0);
      expect(aLine1).toBeLessThan(aLine5);
      expect(aLine5).toBeLessThan(bLine1);
    });
  });

  describe('Test 9: snippet extraction from real file', () => {
    let tmpDir: string;
    let tmpFile: string;

    beforeAll(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-formatter-'));
      tmpFile = path.join(tmpDir, 'sample.md');
      await fs.writeFile(tmpFile, 'line one\nline two with target reference\nline three\n');
    });

    afterAll(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('reads the cited line from disk and includes it in output', async () => {
      const records = [
        mkRecord({
          code: 'reference-to-unknown-note',
          targetRaw: 'R042',
          targetNoteId: 'R042',
          site: { line: 2, filePath: tmpFile },
        }),
      ];
      const out = stripAnsi(await formatAuditHuman(records, SCANNED));
      expect(out).toContain('line two with target reference');
    });
  });

  describe('Test 10: missing-file → empty snippet, no error', () => {
    it('does not throw on records citing a non-existent file', async () => {
      const records = [
        mkRecord({
          code: 'reference-to-unknown-note',
          targetRaw: 'R042',
          targetNoteId: 'R042',
          site: { line: 1, filePath: '/does/not/exist.md' },
        }),
      ];
      const out = stripAnsi(await formatAuditHuman(records, SCANNED));
      // Output should still contain the record line; no snippet text appended.
      expect(out).toContain('/does/not/exist.md:1');
    });
  });

  describe('Test 11: footer always present', () => {
    it('zero records → footer with scanned counts', async () => {
      const out = stripAnsi(await formatAuditHuman([], SCANNED));
      expect(out).toMatch(/Scanned: 5 notes, 0 source files, 12 references\./);
    });

    it('records present → footer also present', async () => {
      const records = [
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042', targetNoteId: 'R042' }),
      ];
      const out = stripAnsi(await formatAuditHuman(records, SCANNED));
      expect(out).toMatch(/Scanned: 5 notes/);
    });
  });

  describe('Test 12: plural/singular grammar', () => {
    it('1 vs 2 notes / source files / references / sites / incidences', async () => {
      const singularScanned: AuditScanned = { notes: 1, sourceFiles: 1, references: 1 };
      const records = [
        mkRecord({ code: 'reference-to-unknown-note', targetRaw: 'R042', targetNoteId: 'R042' }),
      ];
      const out = stripAnsi(await formatAuditHuman(records, singularScanned));
      expect(out).toContain('Found 1 incidence(s):');
      // singular forms in footer
      expect(out).toContain('1 note, 1 source file, 1 reference.');
      // singular site count under target
      expect(out).toMatch(/R042.*\(1 site\)/);
    });
  });
});
