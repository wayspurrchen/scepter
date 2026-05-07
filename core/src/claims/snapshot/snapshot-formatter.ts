/**
 * Output formatting for the snapshot subsystem (list, show, and diff
 * surfaces).  Reads structured inputs and produces strings.  No I/O,
 * no exit-code logic — the CLI handlers own those.
 *
 * @implements {DD018.§3.DC.55} formatSnapshotList — cli-table3 rendering with Name/Captured/Claims/Size columns
 * @implements {DD018.§3.DC.56} formatSnapshotShow — metadata + summary-scale stats; never iterates per-claim
 * @implements {DD018.§3.DC.57} formatDiffHeader
 * @implements {DD018.§3.DC.58} formatDiffSections — six categories with explicit empty markers
 * @implements {DD018.§3.DC.58a} default human output is header + sections composition
 * @implements {DD018.§3.DC.59} per-finding rendering for source/note/heading-metadata sections
 * @implements {DD018.§3.DC.60} regression marker on lost-claim findings
 * @implements {DD018.§3.DC.61} formatRegressionSuggestions for two-option lifecycle suggestions
 * @implements {DD018.§3.DC.61a} two-option suggestion line for derived-from-shrinkage findings
 * @implements {DD018.§3.DC.62} formatDiffJson — JSON.stringify with summary
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import type { Snapshot, SnapshotLifecycle } from './snapshot-types.js';
import type { SnapshotListRow } from './snapshot-store.js';
import type {
  DiffReport,
  HeadingMetadataFinding,
  LostClaimFinding,
  NewClaimFinding,
  NoteRefDriftFinding,
  RegressionFinding,
  SourceRefDriftFinding,
} from './diff-types.js';

/**
 * Render the snapshot list as a borderless cli-table3 table with
 * columns Name / Captured / Claims / Size.  Caller is responsible for
 * the empty-list path — this function only renders non-empty input.
 *
 * @implements {DD018.§3.DC.55}
 */
export function formatSnapshotList(rows: SnapshotListRow[]): string {
  const table = new Table({
    head: [chalk.bold('Name'), chalk.bold('Captured'), chalk.bold('Claims'), chalk.bold('Size')],
    chars: {
      top: '',
      'top-mid': '',
      'top-left': '',
      'top-right': '',
      bottom: '',
      'bottom-mid': '',
      'bottom-left': '',
      'bottom-right': '',
      left: '',
      'left-mid': '',
      mid: '─',
      'mid-mid': '┼',
      right: '',
      'right-mid': '',
      middle: '│',
    },
    style: { 'padding-left': 1, 'padding-right': 1 },
    wordWrap: false,
  });

  for (const row of rows) {
    table.push([
      chalk.cyan(row.name),
      formatCaptured(row.capturedAt),
      String(row.claimCount),
      formatBytes(row.fileSize),
    ]);
  }

  return table.toString();
}

/**
 * Render the snapshot show output: a metadata block + summary-scale
 * stats.  Never iterates per-claim per {R014.§3.AC.05}.
 *
 * @implements {DD018.§3.DC.56}
 */
export function formatSnapshotShow(snapshot: Snapshot, fileSize: number): string {
  const lines: string[] = [];
  lines.push(chalk.bold('Snapshot:'));
  lines.push(`  Schema version: ${snapshot.metadata.schemaVersion}`);
  lines.push(`  Captured at:    ${snapshot.metadata.capturedAt}`);
  lines.push(`  Project root:   ${snapshot.metadata.projectRoot}`);
  lines.push(
    `  Git commit:     ${snapshot.metadata.gitCommit ?? chalk.gray('(unavailable)')}`,
  );
  lines.push('');
  lines.push(chalk.bold('Summary:'));
  lines.push(`  Claims:                          ${snapshot.claims.length}`);
  lines.push(`  Notes:                           ${snapshot.notes.length}`);
  lines.push(
    `  Claims with incoming source refs: ${snapshot.claims.filter((c) => c.incomingSourceRefs.length > 0).length}`,
  );
  lines.push(
    `  Claims with lifecycle tag:       ${snapshot.claims.filter((c) => c.lifecycle !== null).length}`,
  );
  lines.push(`  File size:                       ${formatBytes(fileSize)}`);
  return lines.join('\n');
}

/**
 * Reformat the verbatim ISO string from the snapshot's metadata as
 * `YYYY-MM-DD HH:MM` for the list view; raw ISO is too noisy at table
 * scale.  Falls back to the verbatim string when it doesn't parse.
 */
function formatCaptured(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear().toString().padStart(4, '0');
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  const hh = d.getHours().toString().padStart(2, '0');
  const min = d.getMinutes().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Render the one-line summary header followed by a blank line.
 *
 * When `regressionsActive` is true (the `--regressions` flag was
 * passed), the `Regressions: T` segment is rendered with chalk
 * emphasis (red when T > 0, green when T === 0) so the gate result
 * is visible before the user scrolls.  When false, the segment
 * still appears but with plain rendering.
 *
 * @implements {DD018.§3.DC.57}
 */
export function formatDiffHeader(report: DiffReport, regressionsActive: boolean): string {
  const s = report.summary;
  const regressionSegment = renderRegressionSegment(s.regressions, regressionsActive);
  const line =
    `Lost: ${s.lost}, ` +
    `New: ${s.new}, ` +
    `Body changed: ${s.bodyChanged}, ` +
    `Heading/metadata changed: ${s.headingOrMetadataChanged}, ` +
    `Source ref drift: ${s.sourceRefDrift}, ` +
    `Incoming note-ref drift: ${s.incomingNoteRefDrift}, ` +
    regressionSegment;
  return `${line}\n`;
}

function renderRegressionSegment(count: number, regressionsActive: boolean): string {
  const text = `Regressions: ${count}`;
  if (!regressionsActive) return text;
  if (count > 0) return chalk.red(text);
  return chalk.green(text);
}

/**
 * Render the six-category report.  Each category appears even when
 * empty per {R014.§5.AC.07}; empty sections render an explicit
 * `(no findings)` indicator rather than being silently omitted.
 *
 * @implements {DD018.§3.DC.58}
 */
export function formatDiffSections(report: DiffReport, _regressionsActive: boolean): string {
  const blocks: string[] = [];
  blocks.push(renderLostSection(report.lostClaims));
  blocks.push(renderNewSection(report.newClaims));
  blocks.push(renderBodyChangedSection(report.bodyChanged));
  blocks.push(renderHeadingOrMetadataSection(report.headingOrMetadataChanged));
  blocks.push(renderSourceRefDriftSection(report.sourceRefDrift));
  blocks.push(renderNoteRefDriftSection(report.incomingNoteRefDrift));
  return blocks.join('\n');
}

function sectionHeader(label: string): string {
  return chalk.bold(label);
}

function renderLostSection(findings: LostClaimFinding[]): string {
  const lines: string[] = [sectionHeader('Lost claims')];
  if (findings.length === 0) {
    lines.push('  (no findings)');
  } else {
    for (const f of findings) {
      const marker = f.isRegression ? ` ${chalk.red('[REGRESSION]')}` : '';
      const lifecycle = f.baselineLifecycle ? ` ${chalk.dim(`(was: ${formatLifecycleInline(f.baselineLifecycle)})`)}` : '';
      lines.push(`  ${chalk.cyan(f.fqid)}${marker}${lifecycle}`);
      if (f.baselineHeading) {
        lines.push(`    ${chalk.dim(truncate(f.baselineHeading, 100))}`);
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}

function renderNewSection(findings: NewClaimFinding[]): string {
  const lines: string[] = [sectionHeader('New claims')];
  if (findings.length === 0) {
    lines.push('  (no findings)');
  } else {
    for (const f of findings) {
      const lifecycle = f.candidateLifecycle ? ` ${chalk.dim(`(${formatLifecycleInline(f.candidateLifecycle)})`)}` : '';
      lines.push(`  ${chalk.cyan(f.fqid)}${lifecycle}`);
      if (f.candidateHeading) {
        lines.push(`    ${chalk.dim(truncate(f.candidateHeading, 100))}`);
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}

function renderBodyChangedSection(findings: { fqid: string }[]): string {
  const lines: string[] = [sectionHeader('Body changed')];
  if (findings.length === 0) {
    lines.push('  (no findings)');
  } else {
    for (const f of findings) {
      lines.push(`  ${chalk.cyan(f.fqid)}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function renderHeadingOrMetadataSection(findings: HeadingMetadataFinding[]): string {
  const lines: string[] = [sectionHeader('Heading or metadata changed')];
  if (findings.length === 0) {
    lines.push('  (no findings)');
  } else {
    for (const f of findings) {
      lines.push(`  ${chalk.cyan(f.fqid)}`);
      for (const change of f.changes) {
        const baseline = formatFieldValue(change.field, change.baseline);
        const candidate = formatFieldValue(change.field, change.candidate);
        lines.push(`    - ${change.field}: ${baseline} ${chalk.dim('→')} ${candidate}`);
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}

function renderSourceRefDriftSection(findings: SourceRefDriftFinding[]): string {
  const lines: string[] = [sectionHeader('Source ref drift')];
  if (findings.length === 0) {
    lines.push('  (no findings)');
  } else {
    for (const f of findings) {
      lines.push(`  ${chalk.cyan(f.fqid)}`);
      for (const r of f.lost) {
        lines.push(`    - lost: ${r.filePath}:${r.line} ${chalk.dim(`[${r.refKind}]`)}`);
      }
      for (const r of f.gained) {
        lines.push(`    - gained: ${r.filePath}:${r.line} ${chalk.dim(`[${r.refKind}]`)}`);
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}

function renderNoteRefDriftSection(findings: NoteRefDriftFinding[]): string {
  const lines: string[] = [sectionHeader('Incoming note-ref drift')];
  if (findings.length === 0) {
    lines.push('  (no findings)');
  } else {
    for (const f of findings) {
      lines.push(`  ${chalk.cyan(f.fqid)}`);
      for (const r of f.lost) {
        lines.push(`    - lost: ${r}`);
      }
      for (const r of f.gained) {
        lines.push(`    - gained: ${r}`);
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Render the suggestion lines for the regression-gate output.  Each
 * regression produces one suggestion line; for `derived-from-shrinkage`
 * findings with multiple lost-derivation targets, ONE line per
 * lost target is emitted so each line is directly copy-pasteable.
 *
 * For `dangling-source-coverage` and `untombstoned-loss`, the line
 * shape surfaces both lifecycle alternatives (`removed` and
 * `superseded=TARGET`) inline in the trailing comment per §DC.61.
 *
 * For `derived-from-shrinkage`, the line shape surfaces both the
 * restoration path (`derives=<lost-target>`) and the tombstone path
 * (`lifecycle=removed` or `=superseded=TARGET`) per §DC.61a — neither
 * is the "default"; the user picks based on intent.
 *
 * Returns the empty string when there are no regressions.
 *
 * @implements {DD018.§3.DC.61}
 * @implements {DD018.§3.DC.61a}
 */
export function formatRegressionSuggestions(report: DiffReport): string {
  if (report.regressions.length === 0) return '';
  const lines: string[] = [sectionHeader('Suggestions')];
  for (const r of report.regressions) {
    if (r.kind === 'derived-from-shrinkage') {
      const targets = r.lostDerivationTargets ?? [];
      // §DC.61a — emit ONE line per lost target.
      for (const target of targets) {
        lines.push(formatDerivedFromShrinkageSuggestion(r, target));
      }
    } else {
      lines.push(formatLifecycleSuggestion(r));
    }
  }
  lines.push('');
  return lines.join('\n');
}

function formatLifecycleSuggestion(r: RegressionFinding): string {
  const head = `Suggest: scepter meta add ${r.fqid} lifecycle=removed`;
  const ctxBits = [
    `was: ${r.kind}`,
    `baseline source refs: ${r.baselineSourceRefCount}`,
  ];
  if (r.locationHint) {
    ctxBits.push(`defined at ${r.locationHint.filePath}:${r.locationHint.line}`);
  }
  ctxBits.push(`substitute lifecycle=superseded=TARGET if this regression is a planned replacement`);
  return `  ${head}   ${chalk.dim(`# ${ctxBits.join('; ')}`)}`;
}

function formatDerivedFromShrinkageSuggestion(r: RegressionFinding, lostTarget: string): string {
  const head = `Suggest: scepter meta add ${r.fqid} derives=${lostTarget}`;
  const ctxBits = [
    `restore derivation chain`,
    `OR lifecycle=removed (or lifecycle=superseded=TARGET) to acknowledge intentional drop`,
  ];
  if (r.locationHint) {
    ctxBits.push(`defined at ${r.locationHint.filePath}:${r.locationHint.line}`);
  }
  return `  ${head}   ${chalk.dim(`# ${ctxBits.join('; ')}`)}`;
}

/**
 * Render the diff report as machine-readable JSON.  No human header,
 * no chalk; the `summary` field carries the per-category counts so
 * machine consumers don't need to re-count.
 *
 * @implements {DD018.§3.DC.62}
 */
export function formatDiffJson(report: DiffReport, regressionsActive: boolean): string {
  const payload = {
    summary: report.summary,
    regressionsActive,
    lostClaims: report.lostClaims,
    newClaims: report.newClaims,
    bodyChanged: report.bodyChanged,
    headingOrMetadataChanged: report.headingOrMetadataChanged,
    sourceRefDrift: report.sourceRefDrift,
    incomingNoteRefDrift: report.incomingNoteRefDrift,
    regressions: report.regressions,
  };
  return JSON.stringify(payload, null, 2);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function formatLifecycleInline(lc: SnapshotLifecycle): string {
  if (lc.type === 'superseded' && lc.supersedes) {
    return `superseded=${lc.supersedes}`;
  }
  return lc.type;
}

function formatFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return chalk.dim('null');
  if (field === 'lifecycle' && typeof value === 'object') {
    return formatLifecycleInline(value as SnapshotLifecycle);
  }
  if (Array.isArray(value)) {
    return `[${value.join(', ')}]`;
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  return String(value);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
