/**
 * Formatters for claim-related CLI output.
 *
 * Provides human-readable display of traceability matrices,
 * gap reports, lint results, claim trees, index summaries,
 * and staleness reports.
 *
 * @implements {R004.§8.AC.02} High-importance claims surfaced more prominently
 * @implements {R005.§1.AC.03} importance >= 4 highlighted red/bold
 * @implements {R005.§2.AC.08} Lifecycle state visual in trace output
 * @implements {R005.§3.AC.07} Verification date in trace output
 * @implements {R005.§4.AC.01,.AC.02} Staleness report formatting
 * @implements {R006.§3.AC.02} derivationStatus display for partial coverage in gap reports
 * @implements {R006.§3.AC.03} showDerived option for derivation tree expansion in gap reports
 * @implements {R006.§4.AC.01} Derivation display in single-claim trace
 * @implements {R006.§4.AC.02} --show-derived derivative sub-rows in trace matrix
 * @implements {R006.§4.AC.03} <-SOURCE indicator on derived claims in default trace
 * @implements {R006.§5.AC.01} Derivation error type labels in lint output
 * @implements {R006.§5.AC.02} Deep chain and circular derivation error type labels
 * @implements {R006.§5.AC.03} Partial derivation coverage error type label
 * @implements {R007.§4.AC.01} List format search results
 * @implements {R007.§4.AC.02} Detailed format search results
 * @implements {R007.§4.AC.03} JSON format search results
 * @implements {R007.§4.AC.04} Result count + truncation notice
 * @implements {R007.§4.AC.05} Importance >= 4 highlighting in search results
 */

import chalk from 'chalk';
import fs from 'fs-extra';
import type { ClaimNode, ClaimTreeError } from '../../parsers/claim/index.js';
import type {
  ClaimIndexData,
  ClaimIndexEntry,
  ClaimCrossReference,
  StalenessEntry,
  ClaimSearchResult,
  MetadataEvent,
} from '../../claims/index.js';
import type { ClaimThreadNode } from '../../claims/claim-thread.js';

/**
 * Pre-projected verified-event map consumed by synchronous formatters.
 *
 * Maps fully-qualified claim ID to its chronologically-ordered list of
 * `verified` events. Callers populate via
 * `metadataStorage.query({key: "verified"})`, then group by claimId.
 *
 * @implements {DD014.§3.DC.50} Pre-folded projection for synchronous formatter contexts
 */
export type VerifiedEventsByClaim = Map<string, MetadataEvent[]>;

function getLatestVerifiedEvent(
  byClaim: VerifiedEventsByClaim | undefined,
  claimId: string,
): MetadataEvent | undefined {
  if (!byClaim) return undefined;
  const events = byClaim.get(claimId);
  if (!events || events.length === 0) return undefined;
  return events[events.length - 1];
}

/**
 * Group a flat list of `verified` events by claimId.
 *
 * Callers obtain the flat list via `metadataStorage.query({key: "verified"})`
 * and pass the result here to produce the synchronous formatter input.
 *
 * @implements {DD014.§3.DC.50}
 */
export function groupVerifiedEvents(events: MetadataEvent[]): VerifiedEventsByClaim {
  const map: VerifiedEventsByClaim = new Map();
  for (const event of events) {
    const existing = map.get(event.claimId);
    if (existing) {
      existing.push(event);
    } else {
      map.set(event.claimId, [event]);
    }
  }
  return map;
}

/**
 * Render an arbitrary `(claim, key)` projection cell from a folded state.
 *
 * Phase-1 callers: `meta get` (the sole consumer). Trace/gaps integration of
 * arbitrary keys is via filter, not display, in Phase 1; future
 * `--show-key`/`--group-by` modes will invoke this.
 *
 * @implements {DD014.§3.DC.51}
 */
export function formatMetadataKey(
  claimId: string,
  key: string,
  folded: Record<string, string[]>,
): string {
  const values = folded[key] ?? [];
  if (values.length === 0) {
    return `${chalk.cyan(claimId)} ${chalk.gray(key)}: ${chalk.gray('(empty)')}`;
  }
  if (values.length === 1) {
    return `${chalk.cyan(claimId)} ${chalk.gray(key)}: ${values[0]}`;
  }
  return `${chalk.cyan(claimId)} ${chalk.gray(key)}: [${values.join(', ')}]`;
}
import type {
  TraceabilityMatrix,
  GapReport,
} from '../../claims/index.js';

// ---------------------------------------------------------------------------
// Traceability matrix
// ---------------------------------------------------------------------------

/**
 * Options controlling how claim titles are displayed in the trace matrix.
 * @implements {R006.§4.AC.02} showDerived option for derivative sub-rows
 */
/**
 * @implements {DD005.§DC.06} gapMode for visual gap markers
 */
export interface TraceDisplayOptions {
  /** Maximum width for the title column. Titles longer than this are truncated with '...'. Default: 40. */
  titleWidth?: number;
  /** When true, show full titles without truncation. Overrides titleWidth. */
  full?: boolean;
  /** When true, expand derivative sub-rows under source claims. */
  showDerived?: boolean;
  /** Function returning derivative FQIDs for a given claim. */
  getDerivatives?: (claimId: string) => string[];
  /** Function to look up a claim entry by FQID (for sub-row display). */
  getClaimEntry?: (fqid: string) => ClaimIndexEntry | null;
  /** Function to check if a claim has Source projection coverage. */
  hasSourceCoverage?: (claimId: string) => boolean;
  /** When true, highlight empty projection cells as gaps (red marker). */
  gapMode?: boolean;
}

/**
 * Extract the descriptive portion of a claim/section heading by stripping the
 * leading ID pattern (e.g., "§1 Parser Architecture" -> "Parser Architecture",
 * "§1.AC.01 Claim Grammar" -> "Claim Grammar").
 *
 * Exported for reuse by other display surfaces (e.g., command preambles).
 */
export function extractTitle(heading: string): string {
  // Strip leading claim ID patterns. Handles both:
  //   §1.AC.01 Title...  (section-prefixed)
  //   §AC.01 Title...    (bare prefix, no section number)
  //   AC.01 Title...     (no § prefix)
  let stripped = heading.replace(
    /^§?(?:\d+(?:\.\d+)*\.)?(?:§?[A-Z]+\.\d{2,3}[a-z]?)?\s*/,
    '',
  );
  // Strip metadata suffix that leaks from raw claim headings.
  // Format: colon-separated items like :5, :derives=TARGET, :closed, :deferred, etc.
  stripped = stripped.replace(/^(?::(?:\d|derives=[^\s]+|closed|deferred|removed|superseded=[^\s]+))+\s*/, '');
  // Strip markdown bold markers (**text**) — these leak through from raw claim headings
  stripped = stripped.replace(/\*\*/g, '');
  // Strip leading em-dash separator (common in heading-level claims: "DC.01 — title")
  stripped = stripped.replace(/^[\u2014\u2013\u2015—–-]+\s*/, '');
  // If the heading was purely an ID with no descriptive text, return the original
  return stripped.length > 0 ? stripped : heading;
}

/**
 * Truncate a string to a maximum width, appending '...' if truncated.
 *
 * Exported for reuse by other display surfaces (e.g., command preambles).
 */
export function truncateString(str: string, maxWidth: number): string {
  if (str.length <= maxWidth) return str;
  if (maxWidth <= 3) return str.slice(0, maxWidth);
  return str.slice(0, maxWidth - 3) + '...';
}

/**
 * Format a traceability matrix as a table showing claims vs projection note types.
 *
 * Claims with importance >= 4 are highlighted in red/bold.
 * Lifecycle states are displayed: dimmed for closed, markers for removed/superseded.
 *
 * @implements {R005.§1.AC.03} importance >= 4 highlighting
 * @implements {R005.§2.AC.08} Lifecycle state visual markers
 * @implements {R005.§3.AC.07} Verification date display when store provided
 */
export function formatTraceabilityMatrix(
  matrix: TraceabilityMatrix,
  displayOptions?: TraceDisplayOptions,
  verifiedEvents?: VerifiedEventsByClaim,
): string {
  const lines: string[] = [];

  // @implements {DD005.§DC.05} Gap mode uses a different header
  if (displayOptions?.gapMode) {
    if (matrix.sourceNoteId === '(all)') {
      lines.push(chalk.bold('Coverage Gaps'));
    } else {
      lines.push(chalk.bold(`Coverage Gaps for ${chalk.cyan(matrix.sourceNoteId)} (${matrix.sourceNoteType})`));
    }
  } else {
    lines.push(chalk.bold(`Traceability Matrix for ${chalk.cyan(matrix.sourceNoteId)} (${matrix.sourceNoteType})`));
  }
  lines.push('');

  if (matrix.rows.length === 0) {
    if (displayOptions?.gapMode) {
      lines.push(chalk.green('No coverage gaps found.'));
    } else {
      lines.push(chalk.yellow('No claims found or referenced by this note.'));
    }
    return lines.join('\n');
  }

  if (matrix.projectionTypes.length === 0) {
    lines.push(chalk.yellow('No cross-references found to claims in this note.'));
    lines.push('');
    lines.push(chalk.gray('Claims in this note:'));
    for (const row of matrix.rows) {
      lines.push(`  ${chalk.cyan(row.claimId)} ${row.heading}`);
    }
    return lines.join('\n');
  }

  // Resolve title display width
  const titleMaxWidth = displayOptions?.full
    ? Infinity
    : (displayOptions?.titleWidth ?? 70);

  // Split rows into own claims and referenced (outgoing) claims
  const ownRows: typeof matrix.rows = [];
  const referencedRows: typeof matrix.rows = [];
  for (const row of matrix.rows) {
    if (row.isOutgoing) {
      referencedRows.push(row);
    } else {
      ownRows.push(row);
    }
  }

  // Compute active projection types per section (only types with data)
  function getActiveProjections(rows: typeof matrix.rows): string[] {
    const active = new Set<string>();
    for (const row of rows) {
      for (const pType of matrix.projectionTypes) {
        const presences = row.projections.get(pType);
        if (presences && presences.length > 0) {
          active.add(pType);
        }
      }
    }
    // Preserve original ordering
    return matrix.projectionTypes.filter(t => active.has(t));
  }

  // Check if any row in a section has verification data
  // @implements {DD014.§3.DC.50} verification rendering routed through fold projection
  const hasVerification = verifiedEvents && matrix.rows.some(row => {
    const v = getLatestVerifiedEvent(verifiedEvents, row.claimId);
    return v !== undefined;
  });

  const typeColWidth = 14;
  const verifiedColWidth = 12;

  // Render a section of rows with its own header
  function renderSection(
    rows: typeof matrix.rows,
    sectionLabel: string | null,
    projectionTypes: string[],
  ): void {
    if (rows.length === 0) return;

    // Compute titles
    const titles = rows.map((r) => {
      const raw = extractTitle(r.heading);
      return displayOptions?.full ? raw : truncateString(raw, titleMaxWidth);
    });

    // Column widths for this section
    const claimColWidth = Math.max(
      10,
      ...rows.map((r) => {
        let len = r.claimId.length;
        if (r.derivedFrom && r.derivedFrom.length > 0) {
          len += ` \u2190${r.derivedFrom[0]}`.length;
          if (r.derivedFrom.length > 1) {
            len += `+${r.derivedFrom.length - 1}`.length;
          }
        }
        return len;
      }),
    );
    const titleColWidth = Math.max(
      5,
      ...titles.map((t) => t.length),
    );

    // Section separator
    if (sectionLabel) {
      lines.push('');
      lines.push(chalk.bold.gray(`${sectionLabel}:`));
    }

    // Header
    const headerParts = [
      padRight('Claim', claimColWidth),
      padRight('Title', titleColWidth),
    ];
    for (const pType of projectionTypes) {
      headerParts.push(padRight(pType, typeColWidth));
    }
    if (hasVerification) {
      headerParts.push(padRight('Verified', verifiedColWidth));
    }

    lines.push(chalk.bold(headerParts.join(' | ')));
    lines.push(chalk.gray('-'.repeat(headerParts.join(' | ').length)));

    // Rows
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const title = titles[i];

      // Unresolved rows get a [BROKEN] marker
      if (row.unresolved) {
        const claimIdText = padRight(row.claimId, claimColWidth);
        const claimLabel = chalk.red(claimIdText);
        const brokenMsg = padRight('[BROKEN] target claim not found in index', titleColWidth);
        const cells = [claimLabel, chalk.red(brokenMsg)];
        for (const _pType of projectionTypes) {
          cells.push(chalk.red(padRight('?', typeColWidth)));
        }
        if (hasVerification) {
          cells.push(padRight('', verifiedColWidth));
        }
        lines.push(cells.join(' | '));
        continue;
      }

      // @implements {R005.§1.AC.03} importance >= 4 gets red/bold highlighting
      const isHighImportance = row.importance !== undefined && row.importance >= 4;

      // @implements {R005.§2.AC.08} Lifecycle state visual markers
      let lifecycleMarker = '';
      let isDimmed = false;
      if (row.lifecycle) {
        switch (row.lifecycle.type) {
          case 'closed':
            isDimmed = true;
            break;
          case 'removed':
            lifecycleMarker = ' [removed]';
            break;
          case 'superseded':
            lifecycleMarker = ` [superseded\u2192${row.lifecycle.target ?? '?'}]`;
            break;
          case 'deferred':
            lifecycleMarker = ' [deferred]';
            break;
        }
      }

      // @implements {R006.§4.AC.03} Append <-SOURCE indicator for derived claims
      let derivedIndicator = '';
      if (row.derivedFrom && row.derivedFrom.length > 0) {
        derivedIndicator = ` \u2190${row.derivedFrom[0]}`;
        if (row.derivedFrom.length > 1) {
          derivedIndicator += `+${row.derivedFrom.length - 1}`;
        }
      }

      const claimIdText = padRight(row.claimId + derivedIndicator, claimColWidth);
      const claimLabel = isDimmed
        ? chalk.dim(claimIdText)
        : isHighImportance
          ? chalk.red.bold(claimIdText)
          : chalk.cyan(claimIdText);

      const titleText = padRight(title + lifecycleMarker, titleColWidth);
      const titleLabel = isDimmed ? chalk.dim(titleText) : chalk.white(titleText);

      const cells = [claimLabel, titleLabel];

      for (const pType of projectionTypes) {
        const presences = row.projections.get(pType);
        if (presences && presences.length > 0) {
          const countByNote = new Map<string, number>();
          for (const p of presences) {
            countByNote.set(p.noteId, (countByNote.get(p.noteId) || 0) + 1);
          }
          const noteLabels = [...countByNote.entries()].map(([id, count]) => {
            const displayId = id.startsWith('source:') ? id.slice(7) : id;
            return count > 1 ? `${displayId}(x${count})` : displayId;
          });
          const cellText = padRight(noteLabels.join(','), typeColWidth);
          cells.push(isDimmed ? chalk.dim(cellText) : chalk.green(cellText));
        } else {
          // @implements {DD005.§DC.06} Gap mode: red marker for missing coverage
          const isRelevantGap = displayOptions?.gapMode
            && row.noteType !== pType
            && (!row.relevantProjections || row.relevantProjections.has(pType));
          if (isRelevantGap) {
            cells.push(chalk.red(padRight('[gap]', typeColWidth)));
          } else {
            cells.push(chalk.gray(padRight('-', typeColWidth)));
          }
        }
      }

      // @implements {R005.§3.AC.07} Show verification date when store provided
      // @implements {DD014.§3.DC.50}
      if (hasVerification && verifiedEvents) {
        const latestVerif = getLatestVerifiedEvent(verifiedEvents, row.claimId);
        if (latestVerif) {
          cells.push(chalk.green(padRight(latestVerif.date, verifiedColWidth)));
        } else {
          cells.push(padRight('', verifiedColWidth));
        }
      }

      // @implements {R006.§4.AC.02} --show-derived: add derivation status marker
      if (displayOptions?.showDerived && displayOptions.getDerivatives) {
        const derivatives = displayOptions.getDerivatives(row.claimId);
        if (derivatives.length > 0) {
          let covered = 0;
          for (const dFqid of derivatives) {
            if (displayOptions.hasSourceCoverage?.(dFqid)) {
              covered++;
            }
          }
          const marker = covered === derivatives.length
            ? chalk.green(' [derived:OK]')
            : chalk.yellow(` [derived:partial ${covered}/${derivatives.length}]`);
          cells.push(marker);
        }
      }

      lines.push(cells.join(' | '));

      // @implements {R006.§4.AC.02} --show-derived: insert derivative sub-rows
      if (displayOptions?.showDerived && displayOptions.getDerivatives) {
        const derivatives = displayOptions.getDerivatives(row.claimId);
        for (const derivFqid of derivatives) {
          const derivEntry = displayOptions.getClaimEntry?.(derivFqid);
          const derivTitle = derivEntry ? extractTitle(derivEntry.heading) : '';
          const truncTitle = displayOptions?.full ? derivTitle : truncateString(derivTitle, titleMaxWidth);

          const hasSrc = displayOptions.hasSourceCoverage?.(derivFqid) ?? false;
          const srcMarker = hasSrc ? chalk.green('\u2713') : chalk.red('\u2717');

          const subCells = [
            chalk.gray(padRight(`  \u2514\u2500 ${derivFqid}`, claimColWidth + 5)),
            chalk.gray(padRight(truncTitle, titleColWidth)),
          ];
          for (const _pType of projectionTypes) {
            subCells.push(chalk.gray(padRight('', typeColWidth)));
          }
          subCells.push(srcMarker);
          lines.push(subCells.join(' | '));
        }
      }
    }
  }

  // Render own claims section (no label for the first section)
  const ownProjections = getActiveProjections(ownRows);
  renderSection(ownRows, null, ownProjections);

  // Hint about verified claims
  if (hasVerification) {
    lines.push('');
    lines.push(chalk.gray('This note has verified claims. View verification history with `scepter trace <claimId>`.'));
  }

  // Render referenced claims section with separate header
  if (referencedRows.length > 0) {
    const refProjections = getActiveProjections(referencedRows);
    renderSection(referencedRows, 'Referenced claims', refProjections);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Single-claim trace
// ---------------------------------------------------------------------------

/**
 * @implements {R006.§4.AC.01} derivation display in single-claim trace
 * @implements {R006.§4.AC.02} --show-derived option
 */
export interface ClaimTraceOptions {
  /** Show line excerpts for each reference. Default: true. */
  excerpts?: boolean;
  /** Max width for excerpt lines. Default: 100. */
  excerptWidth?: number;
  /** When true, show derivative claims under the traced claim. */
  showDerived?: boolean;
  /** Function returning derivative FQIDs for a given claim. */
  getDerivatives?: (claimId: string) => string[];
  /** Function to look up a claim entry by FQID. */
  getClaimEntry?: (fqid: string) => ClaimIndexEntry | null;
}

/**
 * Read lines around a target line from a file, with ±context.
 * Returns array of { lineNum, text, isTarget } or null if file unreadable.
 * Caches file contents per path to avoid redundant reads.
 */
const fileCache = new Map<string, string[] | null>();

interface ExcerptLine {
  lineNum: number;
  text: string;
  isTarget: boolean;
}

async function readExcerpt(filePath: string, lineNumber: number, context: number = 1): Promise<ExcerptLine[] | null> {
  if (!fileCache.has(filePath)) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      fileCache.set(filePath, content.split('\n'));
    } catch {
      fileCache.set(filePath, null);
    }
  }
  const fileLines = fileCache.get(filePath);
  if (!fileLines || lineNumber < 1 || lineNumber > fileLines.length) return null;

  const result: ExcerptLine[] = [];
  const start = Math.max(1, lineNumber - context);
  const end = Math.min(fileLines.length, lineNumber + context);

  for (let i = start; i <= end; i++) {
    const text = fileLines[i - 1].trim();
    if (text.length > 0) {
      result.push({ lineNum: i, text, isTarget: i === lineNumber });
    }
  }

  return result.length > 0 ? result : null;
}

/** Clear the file cache (useful between invocations in tests). */
export function clearFileCache(): void {
  fileCache.clear();
}

/**
 * Format a trace for a single claim: show the claim details and every
 * document/source that references it, with line excerpts.
 *
 * @implements {R005.§3.AC.07} Show verification date when store provided
 */
export async function formatClaimTrace(
  entry: ClaimIndexEntry,
  incoming: ClaimCrossReference[],
  noteTypes: Map<string, string>,
  options?: ClaimTraceOptions,
  verifiedEvents?: VerifiedEventsByClaim,
): Promise<string> {
  const showExcerpts = options?.excerpts !== false;
  const excerptWidth = options?.excerptWidth ?? 100;
  const lines: string[] = [];

  lines.push(chalk.bold(`Trace for ${chalk.cyan(entry.fullyQualified)} (${entry.noteType})`));
  lines.push(`  ${entry.heading}`);
  lines.push(`  ${chalk.gray(`Defined in ${entry.noteId} at L${entry.line}-${entry.endLine}`)}`);

  // Show importance and lifecycle if present
  if (entry.importance !== undefined) {
    lines.push(`  ${chalk.gray('Importance:')} ${entry.importance >= 4 ? chalk.red.bold(String(entry.importance)) : String(entry.importance)}`);
  }
  if (entry.lifecycle) {
    const lcDisplay = entry.lifecycle.target
      ? `${entry.lifecycle.type}\u2192${entry.lifecycle.target}`
      : entry.lifecycle.type;
    lines.push(`  ${chalk.gray('Lifecycle:')} ${entry.lifecycle.type === 'closed' ? chalk.dim(lcDisplay) : lcDisplay}`);
  }

  // @implements {R006.§4.AC.01} Show derivation source
  if (entry.derivedFrom && entry.derivedFrom.length > 0) {
    lines.push(`  ${chalk.gray('Derived from:')} ${entry.derivedFrom.join(', ')}`);
  }

  // @implements {R005.§3.AC.07} Show full verification history in single-claim trace
  // @implements {DD014.§3.DC.50} verification history routed through fold projection
  if (verifiedEvents) {
    const events = verifiedEvents.get(entry.fullyQualified);
    if (events && events.length > 0) {
      lines.push(`  ${chalk.gray('Verification history:')}`);
      // Show most recent first
      for (const event of [...events].reverse()) {
        const parts = [event.date];
        if (event.actor) parts.push(`by ${event.actor}`);
        if (event.note) parts.push(`(${event.note})`);
        lines.push(`    ${chalk.green(parts.join(' '))}`);
      }
    }
  }

  // Show definition excerpt with context
  if (showExcerpts && entry.noteFilePath) {
    const excerpt = await readExcerpt(entry.noteFilePath, entry.line, 1);
    if (excerpt) {
      for (const el of excerpt) {
        const prefix = el.isTarget ? '▸' : '│';
        lines.push(`  ${chalk.gray(prefix)} ${chalk.gray(truncateString(el.text, excerptWidth))}`);
      }
    }
  }

  lines.push('');

  if (incoming.length === 0) {
    lines.push(chalk.yellow('No references to this claim found.'));

    // @implements {R006.§4.AC.02} Still show derivatives even with no incoming refs
    if (options?.showDerived && options.getDerivatives) {
      const derivatives = options.getDerivatives(entry.fullyQualified);
      if (derivatives.length > 0) {
        lines.push('');
        lines.push(chalk.bold('Derivatives:'));
        for (const derivFqid of derivatives) {
          const derivEntry = options.getClaimEntry?.(derivFqid);
          if (derivEntry) {
            const title = extractTitle(derivEntry.heading);
            lines.push(`  ${chalk.cyan(derivFqid)} ${chalk.gray(title)}`);
          } else {
            lines.push(`  ${chalk.cyan(derivFqid)}`);
          }
        }
      }
    }

    clearFileCache();
    return lines.join('\n');
  }

  // Group incoming refs by source note, preserving per-line info
  const byNote = new Map<string, { type: string; refs: { line: number; filePath: string }[] }>();
  for (const ref of incoming) {
    const existing = byNote.get(ref.fromNoteId);
    if (existing) {
      existing.refs.push({ line: ref.line, filePath: ref.filePath });
    } else {
      const type = noteTypes.get(ref.fromNoteId) ?? 'Unknown';
      byNote.set(ref.fromNoteId, { type, refs: [{ line: ref.line, filePath: ref.filePath }] });
    }
  }

  lines.push(chalk.bold('Referenced by:'));

  // Sort by note ID
  const sorted = [...byNote.entries()].sort(([a], [b]) => a.localeCompare(b));

  for (const [noteId, { type, refs }] of sorted) {
    const displayId = noteId.startsWith('source:') ? noteId.slice(7) : noteId;
    // Deduplicate lines
    const uniqueRefs = [...new Map(refs.map((r) => [r.line, r])).values()]
      .sort((a, b) => a.line - b.line);
    const lineLabels = uniqueRefs.map((r) => `L${r.line}`).join(', ');

    lines.push(
      `  ${chalk.cyan(displayId)}  ${chalk.gray(lineLabels)}  (${type})`,
    );

    // Show excerpts with ±1 context for each unique line
    if (showExcerpts) {
      for (const ref of uniqueRefs) {
        const excerpt = await readExcerpt(ref.filePath, ref.line, 1);
        if (excerpt) {
          for (const el of excerpt) {
            const prefix = el.isTarget ? '▸' : '│';
            lines.push(`    ${chalk.gray(prefix)} ${chalk.gray(truncateString(el.text, excerptWidth))}`);
          }
          // Blank separator between excerpts from the same note
          lines.push('');
        }
      }
    }
  }

  // @implements {R006.§4.AC.02} Show derivatives section when --show-derived is active
  if (options?.showDerived && options.getDerivatives) {
    const derivatives = options.getDerivatives(entry.fullyQualified);
    if (derivatives.length > 0) {
      lines.push('');
      lines.push(chalk.bold('Derivatives:'));
      for (const derivFqid of derivatives) {
        const derivEntry = options.getClaimEntry?.(derivFqid);
        if (derivEntry) {
          const title = extractTitle(derivEntry.heading);
          lines.push(`  ${chalk.cyan(derivFqid)} ${chalk.gray(title)}`);
        } else {
          lines.push(`  ${chalk.cyan(derivFqid)}`);
        }
      }
    }
  }

  clearFileCache();
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Gap report
// ---------------------------------------------------------------------------

/**
 * Format a gap report showing claims that are missing coverage in some note types.
 *
 * @implements {R005.§1.AC.03} importance >= 4 highlighting
 * @implements {R006.§3.AC.02} derivationStatus display for partial coverage
 * @implements {R006.§3.AC.03} showDerived option for derivation tree expansion
 */
export function formatGapReport(
  gaps: GapReport[],
  options?: { minImportance?: number; showDerived?: boolean },
): string {
  const lines: string[] = [];

  lines.push(chalk.bold('Claim Coverage Gaps'));
  lines.push('');

  let filtered = gaps;
  if (options?.minImportance !== undefined) {
    filtered = gaps.filter((g) =>
      g.importance !== undefined && g.importance >= options.minImportance!,
    );
  }

  if (filtered.length === 0) {
    lines.push(chalk.green('No coverage gaps found.'));
    return lines.join('\n');
  }

  lines.push(`Found ${chalk.yellow(String(filtered.length))} claim(s) with incomplete coverage:`);
  lines.push('');

  for (const gap of filtered) {
    // @implements {R005.§1.AC.03} importance >= 4 gets red/bold
    const isHighImportance = gap.importance !== undefined && gap.importance >= 4;

    const claimLabel = isHighImportance
      ? chalk.red.bold(gap.claimId)
      : chalk.cyan(gap.claimId);

    lines.push(`${claimLabel}`);

    if (gap.importance !== undefined) {
      lines.push(`  ${chalk.gray('Importance:')} ${gap.importance}`);
    }

    if (gap.lifecycle) {
      const lcDisplay = gap.lifecycle.target
        ? `${gap.lifecycle.type}\u2192${gap.lifecycle.target}`
        : gap.lifecycle.type;
      lines.push(`  ${chalk.gray('Lifecycle:')} ${lcDisplay}`);
    }

    if (gap.metadata.length > 0) {
      lines.push(`  ${chalk.gray('Metadata:')} ${gap.metadata.join(', ')}`);
    }

    lines.push(`  ${chalk.green('Present in:')} ${gap.presentIn.join(', ')}`);
    lines.push(`  ${chalk.yellow('Missing from:')} ${gap.missingFrom.join(', ')}`);

    // @implements {R006.§3.AC.02} Show derivation coverage status
    // @implements {R006.§3.AC.03} Expand derivation tree when showDerived is active
    if (gap.derivationStatus) {
      const ds = gap.derivationStatus;
      lines.push(`  ${chalk.gray('Derivation coverage:')} ${ds.coveredDerivatives}/${ds.totalDerivatives} derivatives covered`);
      if (options?.showDerived && ds.uncoveredDerivatives.length > 0) {
        lines.push(`  ${chalk.yellow('Uncovered derivatives:')}`);
        for (const uncov of ds.uncoveredDerivatives) {
          lines.push(`    ${chalk.cyan(uncov)}`);
        }
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Lint results
// ---------------------------------------------------------------------------

/**
 * Format validation errors from claim tree validation.
 */
export function formatLintResults(errors: ClaimTreeError[]): string {
  const lines: string[] = [];

  if (errors.length === 0) {
    lines.push(chalk.green('No issues found.'));
    return lines.join('\n');
  }

  lines.push(chalk.bold(`Found ${chalk.yellow(String(errors.length))} issue(s):`));
  lines.push('');

  for (const error of errors) {
    const typeLabel = formatErrorType(error.type);
    const lineLabel = chalk.gray(`L${error.line}`);

    lines.push(`  ${typeLabel} ${lineLabel} ${error.message}`);

    if (error.conflictingLines && error.conflictingLines.length > 1) {
      lines.push(`    ${chalk.gray('Conflicting lines:')} ${error.conflictingLines.join(', ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Color-code error types for display.
 *
 * @implements {R005.§2.AC.05} reference-to-removed displayed as warning
 * @implements {R005.§2.AC.06} invalid-supersession-target displayed as error
 * @implements {R005.§2.AC.07} multiple-lifecycle displayed as error
 * @implements {R006.§5.AC.01} invalid-derivation-target displayed as error
 * @implements {R006.§5.AC.02} deep-derivation-chain and circular-derivation displayed
 * @implements {R006.§5.AC.03} partial-derivation-coverage displayed as warning
 */
function formatErrorType(type: string): string {
  switch (type) {
    case 'duplicate':
      return chalk.red('[DUPLICATE]');
    case 'non-monotonic':
      return chalk.yellow('[NON-MONOTONIC]');
    case 'ambiguous':
      return chalk.magenta('[AMBIGUOUS]');
    case 'unresolved-reference':
      return chalk.red('[UNRESOLVED]');
    case 'forbidden-form':
      return chalk.red('[FORBIDDEN-FORM]');
    case 'multiple-lifecycle':
      return chalk.red('[MULTIPLE-LIFECYCLE]');
    case 'invalid-supersession-target':
      return chalk.red('[INVALID-SUPERSESSION]');
    case 'reference-to-removed':
      return chalk.yellow('[REF-TO-REMOVED]');
    // Derivation error types
    case 'invalid-derivation-target':
      return chalk.red('[INVALID-DERIVATION]');
    case 'deep-derivation-chain':
      return chalk.yellow('[DEEP-CHAIN]');
    case 'partial-derivation-coverage':
      return chalk.yellow('[PARTIAL-DERIVATION]');
    case 'circular-derivation':
      return chalk.red('[CIRCULAR-DERIVATION]');
    case 'self-derivation':
      return chalk.red('[SELF-DERIVATION]');
    case 'derives-superseded-conflict':
      return chalk.red('[DERIVES-SUPERSEDED]');
    case 'derivation-from-removed':
      return chalk.yellow('[DERIVES-FROM-REMOVED]');
    case 'derivation-from-superseded':
      return chalk.yellow('[DERIVES-FROM-SUPERSEDED]');
    default:
      return chalk.gray(`[${type.toUpperCase()}]`);
  }
}

// ---------------------------------------------------------------------------
// Claim tree
// ---------------------------------------------------------------------------

/**
 * Format a claim tree as an indented view of sections and claims.
 */
export function formatClaimTree(nodes: ClaimNode[], depth: number = 0): string {
  const lines: string[] = [];

  for (const node of nodes) {
    const indent = '  '.repeat(depth);
    const icon = node.type === 'section' ? chalk.yellow('S') : chalk.cyan('C');
    const id = node.type === 'section'
      ? chalk.yellow(node.id)
      : chalk.cyan(node.id);

    const metaStr = node.metadata && node.metadata.length > 0
      ? chalk.gray(` :${node.metadata.join(',')}`)
      : '';

    const lineRange = chalk.gray(` [L${node.line}-${node.endLine}]`);

    lines.push(`${indent}[${icon}] ${id} ${node.heading}${metaStr}${lineRange}`);

    if (node.children.length > 0) {
      lines.push(formatClaimTree(node.children, depth + 1));
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Index summary
// ---------------------------------------------------------------------------

/**
 * Format a summary of the claim index build results.
 *
 * @implements {R005.§5.AC.01} Summary includes importance, lifecycle, and verification counts
 */
export function formatIndexSummary(data: ClaimIndexData, verifiedEvents?: VerifiedEventsByClaim): string {
  const lines: string[] = [];

  lines.push(chalk.bold('Claim Index Summary'));
  lines.push('');

  // Note count
  const noteCount = data.trees.size;
  lines.push(`Notes scanned:      ${chalk.cyan(String(noteCount))}`);

  // Total claims
  const claimCount = data.entries.size;
  lines.push(`Total claims:       ${chalk.cyan(String(claimCount))}`);

  // Cross-references
  const xrefCount = data.crossRefs.length;
  lines.push(`Cross-references:   ${chalk.cyan(String(xrefCount))}`);

  // Errors
  const errorCount = data.errors.length;
  if (errorCount > 0) {
    lines.push(`Errors:             ${chalk.red(String(errorCount))}`);
  } else {
    lines.push(`Errors:             ${chalk.green('0')}`);
  }

  // @implements {R005.§5.AC.01} Importance breakdown
  const importanceCounts = new Map<number, number>();
  for (const entry of data.entries.values()) {
    if (entry.importance !== undefined) {
      importanceCounts.set(entry.importance, (importanceCounts.get(entry.importance) || 0) + 1);
    }
  }
  if (importanceCounts.size > 0) {
    lines.push('');
    lines.push(chalk.bold('By importance:'));
    for (let level = 5; level >= 1; level--) {
      const count = importanceCounts.get(level) || 0;
      if (count > 0) {
        const label = level >= 4 ? chalk.red.bold(String(count)) : chalk.cyan(String(count));
        lines.push(`  Level ${level}: ${label}`);
      }
    }
  }

  // @implements {R005.§5.AC.01} Lifecycle state breakdown
  const lifecycleCounts = new Map<string, number>();
  for (const entry of data.entries.values()) {
    if (entry.lifecycle) {
      const key = entry.lifecycle.type;
      lifecycleCounts.set(key, (lifecycleCounts.get(key) || 0) + 1);
    }
  }
  if (lifecycleCounts.size > 0) {
    lines.push('');
    lines.push(chalk.bold('By lifecycle:'));
    const sortedLifecycle = [...lifecycleCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [state, count] of sortedLifecycle) {
      lines.push(`  ${state}: ${chalk.cyan(String(count))}`);
    }
  }

  // @implements {R005.§5.AC.01} Verification counts
  // @implements {DD014.§3.DC.50}
  if (verifiedEvents) {
    let verified = 0;
    let unverified = 0;
    for (const fullyQualified of data.entries.keys()) {
      const events = verifiedEvents.get(fullyQualified);
      if (events && events.length > 0) {
        verified++;
      } else {
        unverified++;
      }
    }
    lines.push('');
    lines.push(chalk.bold('Verification:'));
    lines.push(`  Verified:   ${chalk.green(String(verified))}`);
    lines.push(`  Unverified: ${unverified > 0 ? chalk.yellow(String(unverified)) : chalk.green('0')}`);
  }

  // Claims per note breakdown
  if (noteCount > 0) {
    lines.push('');
    lines.push(chalk.bold('Claims per note:'));

    const claimsByNote = new Map<string, number>();
    for (const entry of data.entries.values()) {
      claimsByNote.set(entry.noteId, (claimsByNote.get(entry.noteId) || 0) + 1);
    }

    // Sort by note ID
    const sorted = [...claimsByNote.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [noteId, count] of sorted) {
      lines.push(`  ${chalk.cyan(noteId)}: ${count} claim(s)`);
    }
  }

  // Show errors if any, grouped by source note
  if (errorCount > 0) {
    lines.push('');
    lines.push(chalk.bold('Errors:'));

    // Group errors by noteId (or 'unknown' if not annotated)
    const errorsByNote = new Map<string, typeof data.errors>();
    for (const error of data.errors) {
      const key = error.noteId ?? 'unknown';
      const group = errorsByNote.get(key) ?? [];
      group.push(error);
      errorsByNote.set(key, group);
    }

    // Sort note groups alphabetically
    const sortedNotes = [...errorsByNote.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [noteId, errors] of sortedNotes) {
      const filePath = errors[0].noteFilePath;
      const noteLabel = filePath ? `${noteId} (${filePath})` : noteId;
      lines.push('');
      lines.push(`  ${chalk.bold.underline(noteLabel)}`);
      for (const error of errors) {
        const typeLabel = formatErrorType(error.type);
        lines.push(`    ${typeLabel} ${chalk.gray(`L${error.line}`)} ${error.message}`);
      }
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Staleness report
// ---------------------------------------------------------------------------

/**
 * Format a staleness report showing stale, unverified, and current claims
 * with their implementing file paths and verification dates.
 *
 * @implements {R005.§4.AC.01} Staleness report formatting
 * @implements {R005.§4.AC.02} Separate stale vs unverified display
 */
export function formatStalenessReport(entries: StalenessEntry[]): string {
  const lines: string[] = [];

  lines.push(chalk.bold('Claim Staleness Report'));
  lines.push('');

  if (entries.length === 0) {
    lines.push(chalk.green('No claims with source references found.'));
    return lines.join('\n');
  }

  const stale = entries.filter((e) => e.status === 'stale');
  const unverified = entries.filter((e) => e.status === 'unverified');
  const current = entries.filter((e) => e.status === 'current');

  lines.push(`Stale:      ${stale.length > 0 ? chalk.red.bold(String(stale.length)) : chalk.green('0')}`);
  lines.push(`Unverified: ${unverified.length > 0 ? chalk.yellow(String(unverified.length)) : chalk.green('0')}`);
  lines.push(`Current:    ${chalk.green(String(current.length))}`);
  lines.push('');

  if (stale.length > 0) {
    lines.push(chalk.red.bold('Stale claims (source modified after verification):'));
    for (const entry of stale) {
      const impLabel = entry.importance !== undefined ? ` [imp:${entry.importance}]` : '';
      lines.push(`  ${chalk.red(entry.claimId)}${chalk.gray(impLabel)}`);
      if (entry.lastVerified) {
        lines.push(`    ${chalk.gray('Last verified:')} ${entry.lastVerified.slice(0, 10)}`);
      }
      if (entry.lastModified) {
        lines.push(`    ${chalk.gray('Last modified:')} ${entry.lastModified.slice(0, 10)}`);
      }
      for (const file of entry.implementingFiles) {
        lines.push(`    ${chalk.gray('File:')} ${file}`);
      }
    }
    lines.push('');
  }

  if (unverified.length > 0) {
    lines.push(chalk.yellow('Unverified claims (never verified):'));
    for (const entry of unverified) {
      const impLabel = entry.importance !== undefined ? ` [imp:${entry.importance}]` : '';
      lines.push(`  ${chalk.yellow(entry.claimId)}${chalk.gray(impLabel)}`);
      for (const file of entry.implementingFiles) {
        lines.push(`    ${chalk.gray('File:')} ${file}`);
      }
    }
    lines.push('');
  }

  if (current.length > 0) {
    lines.push(chalk.green('Current claims (verified and up-to-date):'));
    for (const entry of current) {
      const impLabel = entry.importance !== undefined ? ` [imp:${entry.importance}]` : '';
      lines.push(`  ${chalk.green(entry.claimId)}${chalk.gray(impLabel)}`);
      if (entry.lastVerified) {
        lines.push(`    ${chalk.gray('Last verified:')} ${entry.lastVerified.slice(0, 10)}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Search results
// ---------------------------------------------------------------------------

/**
 * Format search results in list format: one line per claim with FQID, type, truncated heading.
 *
 * @implements {R007.§4.AC.01} List format: FQID, note type, 60-char truncated heading
 * @implements {R007.§4.AC.04} Result count + truncation notice
 * @implements {R007.§4.AC.05} Importance >= 4 highlighting (red/bold)
 */
export function formatClaimSearchList(result: ClaimSearchResult): string {
  const lines: string[] = [];

  if (result.matches.length === 0) {
    lines.push(formatSearchResultCount(result));
    return lines.join('\n');
  }

  for (const entry of result.matches) {
    const isHighImportance = entry.importance !== undefined && entry.importance >= 4;
    const fqid = isHighImportance
      ? chalk.red.bold(entry.fullyQualified)
      : chalk.cyan(entry.fullyQualified);
    const type = chalk.gray(`(${entry.noteType})`);
    const title = truncateString(extractTitle(entry.heading), 60);

    lines.push(`${fqid} ${type} ${title}`);
  }

  lines.push('');
  lines.push(formatSearchResultCount(result));

  return lines.join('\n');
}

/**
 * Format search results in detailed format: full claim details per match.
 *
 * @implements {R007.§4.AC.02} Detailed format: FQID, type, full heading, importance, lifecycle, derivation, file path
 * @implements {R007.§4.AC.04} Result count + truncation notice
 * @implements {R007.§4.AC.05} Importance >= 4 highlighting (red/bold)
 */
export function formatClaimSearchDetailed(result: ClaimSearchResult): string {
  const lines: string[] = [];

  if (result.matches.length === 0) {
    lines.push(formatSearchResultCount(result));
    return lines.join('\n');
  }

  for (const entry of result.matches) {
    const isHighImportance = entry.importance !== undefined && entry.importance >= 4;
    const fqid = isHighImportance
      ? chalk.red.bold(entry.fullyQualified)
      : chalk.cyan(entry.fullyQualified);

    lines.push(fqid);
    lines.push(`  ${chalk.gray('Type:')} ${entry.noteType}`);
    lines.push(`  ${chalk.gray('Heading:')} ${entry.heading}`);

    if (entry.importance !== undefined) {
      const impDisplay = isHighImportance
        ? chalk.red.bold(String(entry.importance))
        : String(entry.importance);
      lines.push(`  ${chalk.gray('Importance:')} ${impDisplay}`);
    }

    if (entry.lifecycle) {
      const lcDisplay = entry.lifecycle.target
        ? `${entry.lifecycle.type}\u2192${entry.lifecycle.target}`
        : entry.lifecycle.type;
      lines.push(`  ${chalk.gray('Lifecycle:')} ${lcDisplay}`);
    }

    if (entry.derivedFrom.length > 0) {
      lines.push(`  ${chalk.gray('Derived from:')} ${entry.derivedFrom.join(', ')}`);
    }

    lines.push(`  ${chalk.gray('File:')} ${entry.noteFilePath}`);
    lines.push('');
  }

  lines.push(formatSearchResultCount(result));

  return lines.join('\n');
}

/**
 * Format search results as JSON array.
 *
 * @implements {R007.§4.AC.03} JSON format with specified fields
 * @implements {R007.§4.AC.04} Result count + truncation in metadata
 */
export function formatClaimSearchJson(result: ClaimSearchResult): string {
  const output = {
    total: result.total,
    truncated: result.truncated,
    matches: result.matches.map(entry => ({
      fullyQualified: entry.fullyQualified,
      noteId: entry.noteId,
      noteType: entry.noteType,
      claimId: entry.claimId,
      heading: entry.heading,
      sectionPath: entry.sectionPath,
      importance: entry.importance ?? null,
      lifecycle: entry.lifecycle?.type ?? null,
      derivedFrom: entry.derivedFrom,
      noteFilePath: entry.noteFilePath,
    })),
  };
  return JSON.stringify(output, null, 2);
}

/**
 * Format result count line with optional truncation notice.
 * @implements {R007.§4.AC.04}
 */
function formatSearchResultCount(result: ClaimSearchResult): string {
  if (result.total === 0) {
    return 'No claims match the specified criteria.';
  }
  if (result.truncated) {
    return `${result.total} claims found (showing first ${result.matches.length}).`;
  }
  return `${result.total} claims found.`;
}

/**
 * Dispatch to the correct search result formatter based on format option.
 */
export function formatSearchResults(result: ClaimSearchResult, format: 'list' | 'detailed' | 'json' = 'list'): string {
  switch (format) {
    case 'detailed':
      return formatClaimSearchDetailed(result);
    case 'json':
      return formatClaimSearchJson(result);
    default:
      return formatClaimSearchList(result);
  }
}

// ---------------------------------------------------------------------------
// Claim thread view
// ---------------------------------------------------------------------------

/**
 * Format a claim thread tree as a human-readable tree with box-drawing characters.
 *
 * @implements {DD005.§DC.23} Tree output format with indentation and box-drawing
 */
export function formatClaimThread(nodes: ClaimThreadNode[]): string {
  const lines: string[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    // Root node: show claim ID and title
    const title = node.title ? ` ${chalk.white('"' + extractTitle(node.title) + '"')}` : '';
    lines.push(`${chalk.cyan(node.claim)}:${title}`);

    // Render children with tree connectors
    renderThreadChildren(node.children, lines, '  ', '');

    // Blank line between root-level threads (when showing multiple claims)
    if (i < nodes.length - 1) {
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Format a claim thread tree as JSON.
 *
 * @implements {DD005.§DC.24} JSON tree with claim, relationship, file, line, children
 */
export function formatClaimThreadJson(nodes: ClaimThreadNode[]): string {
  return JSON.stringify(nodes, null, 2);
}

/**
 * Render child nodes of a thread tree with box-drawing connectors.
 */
function renderThreadChildren(
  children: ClaimThreadNode[],
  lines: string[],
  indent: string,
  parentPrefix: string,
): void {
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const isLast = i === children.length - 1;
    const connector = isLast ? '\u2514\u2500' : '\u251C\u2500';
    const childPrefix = isLast ? '   ' : '\u2502  ';

    const label = formatThreadNodeLabel(child);
    lines.push(`${indent}${parentPrefix}${connector} ${label}`);

    // Recursively render grandchildren
    if (child.children.length > 0) {
      renderThreadChildren(child.children, lines, indent, parentPrefix + childPrefix);
    }
  }
}

/**
 * Format the label for a single thread node based on its relationship type.
 */
function formatThreadNodeLabel(node: ClaimThreadNode): string {
  switch (node.relationship) {
    case 'derives-from': {
      const title = node.title ? ` ${chalk.white('"' + extractTitle(node.title) + '"')}` : '';
      return `${chalk.gray('derives-from:')} ${chalk.cyan(node.claim)}${title}`;
    }
    case 'derives-into': {
      const title = node.title ? ` ${chalk.white('"' + extractTitle(node.title) + '"')}` : '';
      return `${chalk.gray('derives-into:')} ${chalk.cyan(node.claim)}${title}`;
    }
    case '@implements': {
      const location = formatFileLocation(node.file, node.line);
      return `${chalk.green('@implements:')} ${location}`;
    }
    case '@validates': {
      const location = formatFileLocation(node.file, node.line);
      return `${chalk.yellow('@validates:')} ${location}`;
    }
    case 'referenced-by': {
      const noteLabel = node.noteId ?? 'unknown';
      const lineInfo = node.line ? ` (L${node.line})` : '';
      return `${chalk.gray('referenced-by:')} ${chalk.cyan(noteLabel)}${chalk.gray(lineInfo)}`;
    }
    case 'verified': {
      const date = node.date ? node.date : 'unknown';
      const parts = [date];
      if (node.actor) parts.push(node.actor);
      if (node.method) parts.push(node.method);
      return `${chalk.gray('verified:')} ${chalk.green(parts.join(', '))}`;
    }
    default:
      return node.claim;
  }
}

/**
 * Format a file path with optional line number for display.
 * Strips common prefixes to keep output compact.
 */
function formatFileLocation(file?: string, line?: number): string {
  if (!file) return 'unknown';
  const lineStr = line ? `:${line}` : '';
  return chalk.white(`${file}${lineStr}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function padRight(str: string, width: number): string {
  if (str.length >= width) return str;
  return str + ' '.repeat(width - str.length);
}
