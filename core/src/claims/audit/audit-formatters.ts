/**
 * Audit output formatters — human-readable (grouped) and JSON (flat).
 *
 * The human formatter groups records by error code → target note ID → citing
 * site per {DD022.§10.4.DC.19} and renders a scanned-counts footer per DC.21.
 * The JSON formatter emits a `{ scanned, incidences[] }` document with the
 * `IncidenceRecord` shape as the canonical contract per DC.20, using an
 * explicit `toCanonicalIncidence` helper to lock the field order independent
 * of call-site construction discipline (Section 5 Finding #2).
 *
 * @see {DD022.§10.4} Audit Formatters module
 */

import chalk from 'chalk';
import { promises as fs } from 'fs';
import type { IncidenceRecord, IncidenceCode, IncidenceSite } from './incidence-collector.js';
import { REFERENCE_FAMILY_CODES } from './incidence-collector.js';
import type { AuditScanned } from './run-audit.js';
import { formatErrorType } from '../../cli/formatters/claim-formatter.js';

// ---------------------------------------------------------------------------
// JSON formatter
// ---------------------------------------------------------------------------

/**
 * Canonical serialization of an `IncidenceRecord` for JSON output. The field
 * order matches the TypeScript interface declaration order at
 * `incidence-collector.ts` and is locked by explicit construction here so
 * that JSON output diff-stability does not depend on call-site construction
 * discipline.
 *
 * @implements {DD022.§10.2.DC.04} canonical JSON contract — declaration-order field emission
 */
function toCanonicalIncidence(rec: IncidenceRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {
    code: rec.code,
    targetRaw: rec.targetRaw,
  };
  if (rec.targetNoteId !== undefined) out.targetNoteId = rec.targetNoteId;
  if (rec.resolverDetail !== undefined) out.resolverDetail = rec.resolverDetail;
  out.site = toCanonicalSite(rec.site);
  if (rec.lifecycleFlag !== undefined) out.lifecycleFlag = rec.lifecycleFlag;
  return out;
}

/**
 * Canonical serialization of an `IncidenceSite`. Variants render with their
 * fields in declaration order — `note-site` first, then `source-site`.
 */
function toCanonicalSite(site: IncidenceSite): Record<string, unknown> {
  if (site.kind === 'note-site') {
    const out: Record<string, unknown> = {
      kind: site.kind,
      noteId: site.noteId,
    };
    if (site.claimId !== undefined) out.claimId = site.claimId;
    if (site.section !== undefined) out.section = site.section;
    out.line = site.line;
    out.sourceSnippet = site.sourceSnippet;
    out.filePath = site.filePath;
    return out;
  }
  // source-site
  return {
    kind: site.kind,
    filePath: site.filePath,
    relativePath: site.relativePath,
    line: site.line,
    annotationType: site.annotationType,
    sourceSnippet: site.sourceSnippet,
  };
}

/**
 * Format the audit findings as a JSON document. Pretty-printed via
 * `JSON.stringify(x, null, 2)`. Synchronous — snippets are NOT loaded from
 * disk for JSON consumers; the `filePath:line` location is sufficient.
 *
 * @implements {DD022.§10.4.DC.20} formatAuditJson document shape
 * @implements {R016.§5.AC.02} JSON `--all --json` output
 * @implements {R016.§5.AC.03} JSON shape stability
 */
export function formatAuditJson(
  records: IncidenceRecord[],
  scanned: AuditScanned,
): string {
  const document = {
    scanned,
    incidences: records.map(toCanonicalIncidence),
  };
  return JSON.stringify(document, null, 2);
}

// ---------------------------------------------------------------------------
// Human formatter — grouping, sorting, snippet extraction
// ---------------------------------------------------------------------------

/**
 * Format the audit findings as a human-readable text block, grouped by code →
 * target → site. Followed by a scanned-counts footer.
 *
 * Source snippets are extracted lazily — file content is read once per
 * distinct filePath in the records (batched), then snippets are sliced
 * per-record from the cached content.
 *
 * @implements {DD022.§10.4.DC.19} formatAuditHuman grouping order
 * @implements {DD022.§10.4.DC.21} scanned counts footer
 * @implements {R016.§5.AC.01} human output groups by target
 * @implements {R016.§5.AC.04} human output surfaces scanned counts
 */
export async function formatAuditHuman(
  records: IncidenceRecord[],
  scanned: AuditScanned,
): Promise<string> {
  const lines: string[] = [];
  const snippetCache = await loadSnippetCache(records);

  if (records.length === 0) {
    lines.push(chalk.green('No findings.'));
  } else {
    lines.push(
      chalk.bold(
        `Found ${chalk.yellow(String(records.length))} incidence(s):`,
      ),
    );
    lines.push('');

    const byCode = groupByCode(records);
    for (const code of sortedCodes(Array.from(byCode.keys()))) {
      const codeRecords = byCode.get(code)!;
      lines.push(formatCodeHeading(code, codeRecords.length));

      const byTarget = groupByTarget(codeRecords);
      const targetKeys = Array.from(byTarget.keys()).sort();
      for (const target of targetKeys) {
        const targetRecords = byTarget.get(target)!;
        const siteWord = targetRecords.length === 1 ? 'site' : 'sites';
        lines.push(
          `  ${chalk.cyan(target)} ${chalk.gray(`(${targetRecords.length} ${siteWord})`)}`,
        );

        const sortedSiteRecords = sortSites(targetRecords);
        for (const rec of sortedSiteRecords) {
          lines.push(formatSiteLine(rec, snippetCache));
        }
        lines.push('');
      }
    }
  }

  // Footer per DC.21
  lines.push(chalk.gray('--'));
  const noteWord = scanned.notes === 1 ? 'note' : 'notes';
  const fileWord = scanned.sourceFiles === 1 ? 'source file' : 'source files';
  const refWord = scanned.references === 1 ? 'reference' : 'references';
  lines.push(
    chalk.gray(
      `Scanned: ${scanned.notes} ${noteWord}, ${scanned.sourceFiles} ${fileWord}, ${scanned.references} ${refWord}.`,
    ),
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Grouping + sorting helpers
// ---------------------------------------------------------------------------

function groupByCode(records: IncidenceRecord[]): Map<IncidenceCode, IncidenceRecord[]> {
  const out = new Map<IncidenceCode, IncidenceRecord[]>();
  for (const r of records) {
    const existing = out.get(r.code);
    if (existing) {
      existing.push(r);
    } else {
      out.set(r.code, [r]);
    }
  }
  return out;
}

function groupByTarget(records: IncidenceRecord[]): Map<string, IncidenceRecord[]> {
  const out = new Map<string, IncidenceRecord[]>();
  for (const r of records) {
    const key = r.targetNoteId ?? '<no-target>';
    const existing = out.get(key);
    if (existing) {
      existing.push(r);
    } else {
      out.set(key, [r]);
    }
  }
  return out;
}

/**
 * Sort codes: reference-family codes first (alphabetical among themselves),
 * then structural codes (alphabetical). Per Section 6 Finding #4 reading of
 * DC.19 "alphabetical within REFERENCE_FAMILY_CODES" — family first, then
 * structural; alphabetical within each group.
 */
function sortedCodes(codes: IncidenceCode[]): IncidenceCode[] {
  return [...codes].sort((a, b) => {
    const aFamily = REFERENCE_FAMILY_CODES.has(a);
    const bFamily = REFERENCE_FAMILY_CODES.has(b);
    if (aFamily && !bFamily) return -1;
    if (!aFamily && bFamily) return 1;
    return a.localeCompare(b);
  });
}

function sortSites(records: IncidenceRecord[]): IncidenceRecord[] {
  return [...records].sort((a, b) => {
    const aPath = a.site.kind === 'note-site' ? a.site.filePath : a.site.relativePath;
    const bPath = b.site.kind === 'note-site' ? b.site.filePath : b.site.relativePath;
    const pathCmp = aPath.localeCompare(bPath);
    if (pathCmp !== 0) return pathCmp;
    return a.site.line - b.site.line;
  });
}

function formatCodeHeading(code: IncidenceCode, count: number): string {
  const word = count === 1 ? 'incidence' : 'incidences';
  return `${formatErrorType(code)} ${chalk.gray(`(${count} ${word})`)}`;
}

function formatSiteLine(
  rec: IncidenceRecord,
  snippetCache: Map<string, string[]>,
): string {
  const snippet =
    rec.site.sourceSnippet || getSnippet(rec.site.filePath, rec.site.line, snippetCache);
  const trimmed = snippet.trim().slice(0, 100);
  const snippetSuffix = trimmed ? chalk.gray(`  | ${trimmed}`) : '';

  if (rec.site.kind === 'note-site') {
    const claimSuffix = rec.site.claimId ? chalk.gray(` (in ${rec.site.claimId})`) : '';
    return `    ${rec.site.filePath}:${rec.site.line}${claimSuffix}${snippetSuffix}`;
  }
  const annotation = chalk.gray(` (@${rec.site.annotationType})`);
  return `    ${rec.site.relativePath}:${rec.site.line}${annotation}${snippetSuffix}`;
}

// ---------------------------------------------------------------------------
// Snippet caching — batched file reads
// ---------------------------------------------------------------------------

/**
 * Read each distinct filePath once and cache the line array. Source-site
 * records already carry `sourceSnippet` from the scanner; note-site records
 * have empty snippets and are filled here.
 *
 * Missing files (e.g., due to recent deletion) are tolerated — `getSnippet`
 * returns empty string for any uncached path.
 */
async function loadSnippetCache(
  records: IncidenceRecord[],
): Promise<Map<string, string[]>> {
  const cache = new Map<string, string[]>();
  const paths = new Set<string>();
  for (const r of records) {
    // Only note-site needs disk reads; source-site already has snippets.
    if (r.site.kind === 'note-site' && r.site.filePath) {
      paths.add(r.site.filePath);
    }
  }
  for (const p of paths) {
    try {
      const content = await fs.readFile(p, 'utf8');
      cache.set(p, content.split('\n'));
    } catch {
      // File unreadable — leave out of cache; snippet will be empty.
    }
  }
  return cache;
}

function getSnippet(
  filePath: string,
  line: number,
  cache: Map<string, string[]>,
): string {
  const fileLines = cache.get(filePath);
  if (!fileLines || line < 1 || line > fileLines.length) return '';
  return fileLines[line - 1] ?? '';
}
