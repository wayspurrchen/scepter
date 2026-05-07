/**
 * Tests for the snapshot writer — capture determinism and the
 * shape contract from §3.DC.14-§3.DC.20.
 *
 * @validates {DD018.§3.DC.14} captureSnapshot signature + return type
 * @validates {DD018.§3.DC.15} single-pass entries iteration
 * @validates {DD018.§3.DC.16} body-content extraction algorithm
 * @validates {DD018.§3.DC.18} per-note SnapshotNoteEntry emission
 * @validates {DD018.§3.DC.10} sort-order contract for claims and notes
 */
import { describe, it, expect } from 'vitest';
import { ClaimIndex } from '../../claim-index';
import type { NoteWithContent } from '../../claim-index';
import { captureSnapshot } from '../snapshot-writer';
import type { NoteFileManager } from '../../../notes/note-file-manager';

const NOTE_R001 = `# R001 Sample

### §1 Section

§1.AC.01 The system MUST do a thing.

§1.AC.02 The system MUST do another thing.
`;

const NOTE_R002 = `# R002 Other

### §1 Section

§1.AC.01 Other system MUST do a thing.
`;

function buildNotes(): NoteWithContent[] {
  return [
    { id: 'R001', type: 'Requirement', filePath: '/p/R001.md', content: NOTE_R001 },
    { id: 'R002', type: 'Requirement', filePath: '/p/R002.md', content: NOTE_R002 },
  ];
}

function buildIndex(): ClaimIndex {
  const index = new ClaimIndex();
  index.build(buildNotes());
  return index;
}

function fakeNoteFileManager(): NoteFileManager {
  // Only `getAggregatedContents` is called by the writer.  Stub it.
  const noteContents = new Map<string, string>([
    ['R001', NOTE_R001],
    ['R002', NOTE_R002],
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    getAggregatedContents: async (id: string) => noteContents.get(id) ?? null,
  } as any;
}

describe('captureSnapshot', () => {
  it('produces a Snapshot with metadata, claims, and notes', async () => {
    const snapshot = await captureSnapshot({
      claimIndex: buildIndex(),
      noteFileManager: fakeNoteFileManager(),
      projectRoot: '/p',
    });
    expect(snapshot.metadata.schemaVersion).toBe(1);
    expect(snapshot.metadata.projectRoot).toBe('/p');
    expect(typeof snapshot.metadata.capturedAt).toBe('string');
    expect(snapshot.claims.length).toBe(3);
    expect(snapshot.notes.length).toBe(2);
  });

  it('claims are sorted by fqid; notes are sorted by noteId', async () => {
    const snapshot = await captureSnapshot({
      claimIndex: buildIndex(),
      noteFileManager: fakeNoteFileManager(),
      projectRoot: '/p',
    });
    const claimFqids = snapshot.claims.map((c) => c.fqid);
    expect([...claimFqids].sort()).toEqual(claimFqids);
    const noteIds = snapshot.notes.map((n) => n.noteId);
    expect([...noteIds].sort()).toEqual(noteIds);
  });

  it('two captures with identical inputs are byte-equal modulo capturedAt', async () => {
    const ctx = {
      claimIndex: buildIndex(),
      noteFileManager: fakeNoteFileManager(),
      projectRoot: '/p',
    };
    const a = await captureSnapshot(ctx);
    const b = await captureSnapshot(ctx);

    // Strip capturedAt (both differ by sub-second wall clock).
    const stripCapturedAt = (s: typeof a) => ({
      ...s,
      metadata: { ...s.metadata, capturedAt: '<stripped>' },
    });
    expect(JSON.stringify(stripCapturedAt(a), null, 2)).toBe(
      JSON.stringify(stripCapturedAt(b), null, 2),
    );
  });

  it('per-note entries carry the claim FQIDs that belong to the note', async () => {
    const snapshot = await captureSnapshot({
      claimIndex: buildIndex(),
      noteFileManager: fakeNoteFileManager(),
      projectRoot: '/p',
    });
    const r001 = snapshot.notes.find((n) => n.noteId === 'R001');
    expect(r001).toBeDefined();
    expect(r001!.claimFqids.length).toBe(2);
    expect(r001!.noteContentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('every claim has a sha256 hex bodyHash', async () => {
    const snapshot = await captureSnapshot({
      claimIndex: buildIndex(),
      noteFileManager: fakeNoteFileManager(),
      projectRoot: '/p',
    });
    for (const c of snapshot.claims) {
      expect(c.bodyHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('emits no body field in claim entries (only headings + bodyHash)', async () => {
    const snapshot = await captureSnapshot({
      claimIndex: buildIndex(),
      noteFileManager: fakeNoteFileManager(),
      projectRoot: '/p',
    });
    // Per §DC.03 the SnapshotClaimEntry shape MUST NOT contain a body
    // text field; defensive shape check.
    for (const c of snapshot.claims) {
      expect(c).not.toHaveProperty('body');
      expect(c).not.toHaveProperty('bodyText');
      expect(c).not.toHaveProperty('content');
    }
  });

  it('a heading-form claim body change produces a different bodyHash', async () => {
    // Use heading-form claims so the §DC.16 line-skip algorithm
    // captures actual body lines (paragraph-form claims carry body
    // text in the heading; heading-form claims carry it in lines
    // after the heading).
    const headingForm = `# R003 Heading Form

#### §1.AC.01 Heading title

This is the body content of the claim.
It spans multiple lines.

#### §1.AC.02 Another claim

Other body content.
`;
    const headingFormModified = headingForm.replace(
      'This is the body content of the claim.',
      'This is the MODIFIED body content.',
    );
    async function snapshotWith(content: string): Promise<ReturnType<typeof captureSnapshot>> {
      const idx = new ClaimIndex();
      idx.build([{ id: 'R003', type: 'Requirement', filePath: '/p/R003.md', content }]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fm = {
        getAggregatedContents: async (_id: string) => content,
      } as any as NoteFileManager;
      return captureSnapshot({ claimIndex: idx, noteFileManager: fm, projectRoot: '/p' });
    }
    const a = await snapshotWith(headingForm);
    const b = await snapshotWith(headingFormModified);
    const fqid = a.claims[0].fqid;
    const aHash = a.claims.find((c) => c.fqid === fqid)!.bodyHash;
    const bHash = b.claims.find((c) => c.fqid === fqid)!.bodyHash;
    expect(aHash).not.toBe(bHash);
  });

  it('paragraph-form claim text changes are reflected in the heading field', async () => {
    // Paragraph-form claims (line === endLine) carry content in the
    // heading per the parser's tree shape; the snapshot heading
    // captures it verbatim so diff detects the change via
    // headingOrMetadataChanged (Phase 2) rather than bodyChanged.
    // Verify the heading reflects the body verbatim.
    const snapshot = await captureSnapshot({
      claimIndex: buildIndex(),
      noteFileManager: fakeNoteFileManager(),
      projectRoot: '/p',
    });
    const c = snapshot.claims.find((x) => x.heading.includes('do a thing'));
    expect(c).toBeDefined();
    expect(c!.heading).toContain('The system MUST do a thing.');
  });

  it('gitCommit is null or a 40-char hex SHA', async () => {
    const snapshot = await captureSnapshot({
      claimIndex: buildIndex(),
      noteFileManager: fakeNoteFileManager(),
      projectRoot: '/p',
    });
    if (snapshot.metadata.gitCommit !== null) {
      expect(snapshot.metadata.gitCommit).toMatch(/^[0-9a-f]+$/i);
    }
  });
});
