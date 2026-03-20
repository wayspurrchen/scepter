/**
 * Claim tree builder for SCEpter.
 *
 * Parses markdown content into a tree structure where:
 * - Section headings (numeric) become interior nodes
 * - Claim headings or claim paragraph lines (letter-prefix-dot-number) become leaf nodes
 * - Content boundaries are captured via line ranges
 *
 * Claims can appear either as markdown headings (### §1.AC.01 Description)
 * or as standalone paragraph lines (§1.AC.01 Description).
 *
 * @implements {R004.§1.AC.01} Section ID extraction from §-prefixed headings (trySectionText)
 * @implements {R004.§1.AC.02} Claim ID extraction from letter-prefix-dot-number headings (tryParseClaimText)
 * @implements {R004.§1.AC.04} Ambiguous short-form references rejected (validateClaimTree)
 * @implements {R004.§1.AC.05} Monotonically increasing claim IDs checked (checkMonotonicity)
 * @implements {R004.§1.AC.06} Forbidden form PREFIX+digits without dot rejected (checkForbiddenForm)
 * @implements {R004.§3.AC.01} Section heading extraction with § requirement
 * @implements {R004.§3.AC.02} Atomic claim extraction from headings
 * @implements {R004.§3.AC.03} Hierarchical tree construction
 * @implements {R004.§3.AC.04} No structured format beyond heading convention required
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ClaimNode {
  type: 'section' | 'claim';
  id: string;
  sectionNumber?: number;
  claimPrefix?: string;
  claimNumber?: number;
  claimSubLetter?: string;
  heading: string;
  headingLevel: number;
  line: number;
  endLine: number;
  children: ClaimNode[];
  metadata?: string[];
}

export interface ClaimTreeResult {
  roots: ClaimNode[];
  claims: Map<string, ClaimNode>;
  sections: Map<string, ClaimNode>;
  errors: ClaimTreeError[];
}

/**
 * @implements {R005.§2.AC.05} 'reference-to-removed' error type for removed claims with refs
 * @implements {R005.§2.AC.06} 'invalid-supersession-target' error type for unresolvable supersession targets
 * @implements {R005.§2.AC.07} 'multiple-lifecycle' error type for claims with multiple lifecycle tags
 */
export interface ClaimTreeError {
  type: 'duplicate' | 'non-monotonic' | 'ambiguous' | 'unresolved-reference' | 'forbidden-form' | 'multiple-lifecycle' | 'invalid-supersession-target' | 'reference-to-removed' | 'unresolvable-derivation-target';
  claimId: string;
  line: number;
  message: string;
  conflictingLines?: number[];
  noteId?: string;
  noteFilePath?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Matches a markdown heading: captures level (# count) and text */
const HEADING_RE = /^(#{1,6})\s+(.+)$/;

/** Matches a markdown table row: | cell | cell | ... | */
const TABLE_ROW_RE = /^\|(.+)\|\s*$/;

/** Matches a table separator row: |---|---|---| */
const TABLE_SEPARATOR_RE = /^\|[\s:]*-+[\s:|-]*\|\s*$/;

/** HTML comment to opt out of table claim parsing */
const TABLE_CLAIMS_OFF_RE = /<!--\s*no-table-claims\s*-->/;

/**
 * Matches a section identifier at the start of text.
 * Captures optional section symbol prefix + number. Can be nested (§3.1).
 */
const SECTION_ID_RE = /^§(\d+(?:\.\d+)*)\b/;

/**
 * Matches a claim identifier at the start of text.
 * Format: optional-section-path + claim prefix + dot + number
 * Examples: §1.AC.01, AC.01, §3.AC.04, §1.2.SEC.03
 */
const CLAIM_ID_RE = /^§?(?:(\d+(?:\.\d+)*)\.)?§?([A-Z]+)\.(\d{2,3})([a-z])?\b/;

/**
 * Matches a claim pattern at the start of a non-heading line.
 * This handles the R004 convention where claims are paragraph-level text like:
 *   §1.AC.01 The parser MUST extract section IDs...
 *   §2.AC.04:superseded=R005.§2.AC.04 Colon-suffix metadata...
 *
 * @implements {R005.§2.AC.04a} Accept colon after claim number for metadata
 */
const LINE_CLAIM_RE = /^§?(?:(\d+(?:\.\d+)*)\.)?§?([A-Z]+)\.(\d{2,3})([a-z])?[\s:]/;

/**
 * Strip leading and trailing markdown inline formatting from a claim ID.
 * Handles: **AC.01**, *AC.01*, __AC.01__, _AC.01_
 * Also strips a trailing ** or * that wraps just the ID portion.
 *
 * Returns the cleaned text suitable for regex matching.
 */
function stripInlineFormatting(text: string): string {
  // Strip leading bold/italic markers: **, *, __, _
  let result = text.replace(/^(?:\*{1,2}|_{1,2})/, '');
  // Strip the closing markers after the claim ID portion
  // Match: claim-like text followed by formatting close then space
  result = result.replace(/^(§?(?:\d+(?:\.\d+)*\.)?§?[A-Z]+\.\d{2,3}[a-z]?)(?:\*{1,2}|_{1,2})([\s:])/, '$1$2');
  return result;
}

/**
 * Detect forbidden form within text.
 * Matches uppercase letters immediately followed by 2-3 digits with no dot separator.
 * Must be preceded by section symbol, whitespace, or start of string, and NOT followed by a dot.
 */
const FORBIDDEN_IN_TEXT_RE = /(?:^|§|\s)([A-Z]+)(\d{2,3}[a-z]?)(?!\.\d)(?![A-Za-z])/;

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Parse markdown content into a claim tree.
 *
 * Section headings (numeric) become interior nodes. Claim headings
 * (letter-prefix-dot-number) become leaves. Claims can also appear as
 * paragraph-level text (e.g., §1.AC.01 Description...) — these are treated
 * as pseudo-headings one level deeper than their containing section.
 *
 * Content between headings/claims is captured via line ranges (line to endLine).
 */
export function buildClaimTree(content: string): ClaimTreeResult {
  const lines = content.split('\n');
  const roots: ClaimNode[] = [];
  const claims = new Map<string, ClaimNode>();
  const sections = new Map<string, ClaimNode>();
  const errors: ClaimTreeError[] = [];

  // Check for table-claims opt-out directive
  const tableClaimsEnabled = !TABLE_CLAIMS_OFF_RE.test(content);

  // First pass: extract all structural nodes (headings + standalone claim lines)
  const structuralNodes: Array<{
    node: ClaimNode;
    headingLevel: number;
    lineNum: number;
  }> = [];

  // Track the current heading level for standalone claim lines
  let currentHeadingLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1; // 1-based

    // Check if this is a markdown heading
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      currentHeadingLevel = level;

      // Check for forbidden forms in the heading
      checkForbiddenForm(text, lineNum, errors);

      // Try to match as a claim heading first (more specific)
      const claimNode = tryParseClaimText(text, level, lineNum);
      if (claimNode) {
        structuralNodes.push({ node: claimNode, headingLevel: level, lineNum });
        continue;
      }

      // Try to match as a section heading
      const sectionNode = trySectionText(text, level, lineNum);
      if (sectionNode) {
        structuralNodes.push({ node: sectionNode, headingLevel: level, lineNum });
      }
      // Plain headings without numeric or claim patterns are skipped
      continue;
    }

    // Check for table row claims: first cell checked for claim ID,
    // full row used as heading. Enabled by default, opt-out with <!-- no-table-claims -->
    const trimmedLine = line.trimStart();
    if (tableClaimsEnabled && TABLE_ROW_RE.test(trimmedLine) && !TABLE_SEPARATOR_RE.test(trimmedLine)) {
      const tableMatch = trimmedLine.match(TABLE_ROW_RE)!;
      const cells = tableMatch[1].split('|').map((c) => c.trim());
      const firstCell = cells[0] ?? '';
      const strippedCell = stripInlineFormatting(firstCell);
      if (strippedCell.length > 0 && CLAIM_ID_RE.test(strippedCell)) {
        checkForbiddenForm(strippedCell, lineNum, errors);
        const claimNode = tryParseClaimText(strippedCell, currentHeadingLevel + 1, lineNum);
        if (claimNode) {
          // Use the full row content (all cells joined) as the heading
          claimNode.heading = cells.join(' | ');
          structuralNodes.push({
            node: claimNode,
            headingLevel: currentHeadingLevel + 1,
            lineNum,
          });
        }
      }
      continue;
    }

    // Not a heading or table — check if this line starts with a claim pattern
    // (paragraph-level claims like "§1.AC.01 The parser MUST..."
    //  or bold-wrapped claims like "**AC.01** The parser MUST...")
    const strippedLine = stripInlineFormatting(trimmedLine);
    if (strippedLine.length > 0 && LINE_CLAIM_RE.test(strippedLine)) {
      // Check for forbidden forms first
      checkForbiddenForm(strippedLine, lineNum, errors);

      const claimNode = tryParseClaimText(strippedLine, currentHeadingLevel + 1, lineNum);
      if (claimNode) {
        // Use the original trimmed line as the heading for display
        claimNode.heading = trimmedLine;
        structuralNodes.push({
          node: claimNode,
          headingLevel: currentHeadingLevel + 1,
          lineNum,
        });
      }
    }
  }

  if (structuralNodes.length === 0) {
    return { roots, claims, sections, errors };
  }

  // Second pass: compute endLine for each node
  for (let i = 0; i < structuralNodes.length; i++) {
    const current = structuralNodes[i];
    let endLine = lines.length;

    // For claim nodes that are paragraph-level (not headings), endLine extends to
    // the next structural node or the next blank line (whichever comes first),
    // unless the next structural element is at a deeper level.
    if (i + 1 < structuralNodes.length) {
      const next = structuralNodes[i + 1];
      if (next.headingLevel <= current.headingLevel) {
        endLine = next.lineNum - 1;
      } else {
        // Next node is deeper — find the next node at same or shallower level
        for (let j = i + 1; j < structuralNodes.length; j++) {
          if (structuralNodes[j].headingLevel <= current.headingLevel) {
            endLine = structuralNodes[j].lineNum - 1;
            break;
          }
        }
      }
    }

    current.node.endLine = endLine;
  }

  // Third pass: build parent-child relationships based on heading level
  const stack: Array<{ node: ClaimNode; level: number }> = [];

  for (const { node, headingLevel } of structuralNodes) {
    // Pop stack entries at the same or deeper level
    while (stack.length > 0 && stack[stack.length - 1].level >= headingLevel) {
      stack.pop();
    }

    if (stack.length > 0) {
      stack[stack.length - 1].node.children.push(node);
    } else {
      roots.push(node);
    }

    // Qualify bare claim IDs with ancestor section path.
    // A bare claim like "AC.01" inside §2 becomes "2.AC.01".
    // Claims that already have an inline section prefix (e.g., "§1.AC.01" → id "1.AC.01")
    // are left unchanged.
    if (node.type === 'claim' && !/^\d/.test(node.id)) {
      const sectionPath: number[] = [];
      for (const entry of stack) {
        if (entry.node.type === 'section' && entry.node.sectionNumber != null) {
          sectionPath.push(entry.node.sectionNumber);
        }
      }
      if (sectionPath.length > 0) {
        node.id = `${sectionPath.join('.')}.${node.id}`;
        node.sectionNumber = sectionPath[sectionPath.length - 1];
      }
    }

    stack.push({ node, level: headingLevel });

    // Register in the appropriate map
    if (node.type === 'claim') {
      if (claims.has(node.id)) {
        const existing = claims.get(node.id)!;
        errors.push({
          type: 'duplicate',
          claimId: node.id,
          line: node.line,
          message: `Duplicate claim ID "${node.id}" found at line ${node.line} (first defined at line ${existing.line}).`,
          conflictingLines: [existing.line, node.line],
        });
      } else {
        claims.set(node.id, node);
      }
    } else {
      if (sections.has(node.id)) {
        const existing = sections.get(node.id)!;
        errors.push({
          type: 'duplicate',
          claimId: node.id,
          line: node.line,
          message: `Duplicate section ID "${node.id}" found at line ${node.line} (first defined at line ${existing.line}).`,
          conflictingLines: [existing.line, node.line],
        });
      } else {
        sections.set(node.id, node);
      }
    }
  }

  return { roots, claims, sections, errors };
}

/**
 * Validate a claim tree for structural issues.
 *
 * Checks:
 * - Duplicate claim/section IDs (already detected during build, but re-checked)
 * - Non-monotonic claim numbering within sections
 * - Forbidden forms (AC01 without dot)
 * - Ambiguous claim IDs across sections
 */
export function validateClaimTree(tree: ClaimTreeResult): ClaimTreeError[] {
  const errors: ClaimTreeError[] = [...tree.errors];

  // Check for non-monotonic numbering within each section
  checkMonotonicity(tree.roots, errors);

  // Check for ambiguous claim IDs across sections
  const claimsByBareId = new Map<string, ClaimNode[]>();
  for (const [, node] of tree.claims) {
    const bareId = buildBareClaimId(node);
    if (!claimsByBareId.has(bareId)) {
      claimsByBareId.set(bareId, []);
    }
    claimsByBareId.get(bareId)!.push(node);
  }

  for (const [bareId, nodes] of claimsByBareId) {
    if (nodes.length > 1) {
      const uniqueIds = new Set(nodes.map((n) => n.id));
      if (uniqueIds.size > 1) {
        errors.push({
          type: 'ambiguous',
          claimId: bareId,
          line: nodes[0].line,
          message: `Ambiguous bare claim ID "${bareId}" — found in multiple sections: ${nodes.map((n) => `"${n.id}" (line ${n.line})`).join(', ')}.`,
          conflictingLines: nodes.map((n) => n.line),
        });
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Try to parse text as a claim identifier.
 * Returns a ClaimNode if the text starts with a claim pattern, null otherwise.
 */
function tryParseClaimText(text: string, level: number, lineNum: number): ClaimNode | null {
  const claimMatch = text.match(CLAIM_ID_RE);
  if (!claimMatch) return null;

  const sectionPart = claimMatch[1]; // e.g., "1" from "§1.AC.01"
  const prefix = claimMatch[2];       // e.g., "AC"
  const number = parseInt(claimMatch[3], 10);
  const subLetter = claimMatch[4] || undefined;

  const sectionNumbers = sectionPart
    ? sectionPart.split('.').map((s) => parseInt(s, 10))
    : [];

  const sectionPrefix = sectionNumbers.length > 0
    ? sectionNumbers.join('.') + '.'
    : '';
  const claimId = `${sectionPrefix}${prefix}.${claimMatch[3]}${subLetter || ''}`;

  // Parse metadata from the text if present
  // @implements {R005.§2.AC.04a} Colon-separated metadata items (supersedes comma separator)
  // @implements {R005.§2.AC.04b} Relaxed regex accepts =, dot, §, underscore, hyphen for key-value metadata
  // Check immediately after claim ID first (e.g., §AC.01:5 description),
  // then fall back to end-of-text (e.g., §AC.01 description:5)
  const afterClaimId = text.substring(claimMatch[0].length);
  let metadataMatch = afterClaimId.match(/^:([A-Za-z0-9=_.§-]+(?::[A-Za-z0-9=_.§-]+)*)/);
  if (!metadataMatch) {
    metadataMatch = text.match(/:([A-Za-z0-9=_.§-]+(?::[A-Za-z0-9=_.§-]+)*)$/);
  }
  const metadata = metadataMatch
    ? metadataMatch[1].split(':').filter((s) => s.length > 0)
    : undefined;

  return {
    type: 'claim',
    id: claimId,
    claimPrefix: prefix,
    claimNumber: number,
    ...(subLetter ? { claimSubLetter: subLetter } : {}),
    heading: text,
    headingLevel: level,
    line: lineNum,
    endLine: lineNum,
    children: [],
    ...(sectionNumbers.length > 0 ? { sectionNumber: sectionNumbers[sectionNumbers.length - 1] } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

/**
 * Try to parse text as a section identifier.
 * Returns a ClaimNode if the text starts with a section pattern, null otherwise.
 */
function trySectionText(text: string, level: number, lineNum: number): ClaimNode | null {
  const sectionMatch = text.match(SECTION_ID_RE);
  if (!sectionMatch) return null;

  const sectionNumbers = sectionMatch[1].split('.').map((s) => parseInt(s, 10));
  const sectionId = sectionNumbers.join('.');

  return {
    type: 'section',
    id: sectionId,
    sectionNumber: sectionNumbers[sectionNumbers.length - 1],
    heading: text,
    headingLevel: level,
    line: lineNum,
    endLine: lineNum,
    children: [],
  };
}

/**
 * Check for forbidden forms in text and add errors if found.
 */
function checkForbiddenForm(text: string, lineNum: number, errors: ClaimTreeError[]): void {
  const forbiddenMatch = text.match(FORBIDDEN_IN_TEXT_RE);
  if (!forbiddenMatch) return;

  const prefix = forbiddenMatch[1];
  const num = forbiddenMatch[2];
  const candidate = `${prefix}${num}`;

  // Make sure this isn't a valid note ID (e.g., REQ004)
  if (/^[A-Z]{1,5}\d{3,5}$/.test(candidate)) return;

  // Check that the text doesn't also contain the valid form PREFIX.NN
  // which would mean the forbidden match is a false positive
  const validClaimInText = text.match(new RegExp(`${prefix}\\.\\d{2,3}`));
  if (validClaimInText) return;

  errors.push({
    type: 'forbidden-form',
    claimId: candidate,
    line: lineNum,
    message: `Forbidden form "${candidate}" (missing dot between prefix and number). Use "${prefix}.${num}" instead.`,
  });
}

/**
 * Build a bare claim ID (PREFIX.NN without section prefix) for ambiguity checking.
 */
function buildBareClaimId(node: ClaimNode): string {
  const numStr = String(node.claimNumber).padStart(2, '0');
  const subLetter = node.id.match(/[a-z]$/)?.[0] || '';
  return `${node.claimPrefix}.${numStr}${subLetter}`;
}

/**
 * Compare two claim nodes by their composite (claimNumber, claimSubLetter) identity.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 *
 * Ordering: PREFIX.03 < PREFIX.03a < PREFIX.03b < PREFIX.04
 * A claim with no sub-letter sorts before any sub-lettered claim with the same number.
 */
function compareClaimOrder(a: ClaimNode, b: ClaimNode): number {
  const numDiff = a.claimNumber! - b.claimNumber!;
  if (numDiff !== 0) return numDiff;
  // Same number — compare sub-letters. No letter < 'a' < 'b' < ...
  const aLetter = a.claimSubLetter ?? '';
  const bLetter = b.claimSubLetter ?? '';
  if (aLetter === bLetter) return 0;
  if (aLetter === '') return -1;
  if (bLetter === '') return 1;
  return aLetter < bLetter ? -1 : 1;
}

/**
 * Check that claim numbers within each section are monotonically increasing.
 * Sub-lettered claims (e.g. DIFF.03a, DIFF.03b) are valid refinements that
 * sort between their base claim and the next integer claim.
 */
function checkMonotonicity(nodes: ClaimNode[], errors: ClaimTreeError[]): void {
  const claimsByPrefix = new Map<string, ClaimNode[]>();

  for (const node of nodes) {
    if (node.type === 'claim' && node.claimPrefix && node.claimNumber !== undefined) {
      const prefix = node.claimPrefix;
      if (!claimsByPrefix.has(prefix)) {
        claimsByPrefix.set(prefix, []);
      }
      claimsByPrefix.get(prefix)!.push(node);
    }

    if (node.children.length > 0) {
      checkMonotonicity(node.children, errors);
    }
  }

  for (const [prefix, claimNodes] of claimsByPrefix) {
    for (let i = 1; i < claimNodes.length; i++) {
      const prev = claimNodes[i - 1];
      const curr = claimNodes[i];
      if (compareClaimOrder(curr, prev) <= 0) {
        const prevBare = `${prefix}.${String(prev.claimNumber).padStart(2, '0')}${prev.claimSubLetter ?? ''}`;
        const currBare = `${prefix}.${String(curr.claimNumber).padStart(2, '0')}${curr.claimSubLetter ?? ''}`;
        errors.push({
          type: 'non-monotonic',
          claimId: curr.id,
          line: curr.line,
          message: `Non-monotonic claim numbering: "${curr.id}" (${currBare}) at line ${curr.line} does not follow "${prev.id}" (${prevBare}) at line ${prev.line}.`,
          conflictingLines: [prev.line, curr.line],
        });
      }
    }
  }
}
