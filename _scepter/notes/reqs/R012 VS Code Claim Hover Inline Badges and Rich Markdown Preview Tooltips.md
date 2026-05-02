---
created: 2026-05-02T18:15:52.606Z
tags: [vscode,hover,preview,decorations,claim-references]
---

# R012 - VS Code Claim Hover, Inline Badges, and Rich Markdown Preview Tooltips

## Overview

A SCEpter user authoring or reviewing notes in VS Code spends most of their attention inside two surfaces: the markdown editor (raw `.md`) and the markdown preview (rendered HTML). In both surfaces, claim references are dense — a typical AC line reads like prose with three or four `{R005.§1.AC.01}`-shaped citations, derivation arrows, range expansions (`{AC.01-06}`), and adjacent-section bindings (`R005 §1.AC.01`). Without contextual surfacing, the user has to navigate to each cited claim to learn what it asserts, who else cites it, and whether it has source coverage.

This requirement captures the user-facing capability surface that the recent VS Code work delivered: a unified hover and tooltip experience that exposes, at the point of reference, (a) the claim's identity and body, (b) every other note and source file that cites it, (c) whether those citations are derivations or references and where they sit in their citing line, (d) every member of a range expansion, and (e) a count badge anchored next to each claim's own definition that signals at a glance how many incoming references it has and whether any are from source code. The same information surfaces in the raw markdown editor (via `ClaimHoverProvider` and `DecorationProvider`) and in the markdown preview (via the markdown-it plugin and webview tooltip script), with deliberate cross-surface visual consistency.

**Core Principle:** **Information at the point of reference, with cross-surface consistency.** A user hovering `{R005.§1.AC.01}` in either the editor or the preview MUST see the same essential information — body, refs, badges, range members — without leaving the current document. The two surfaces use different rendering technologies (VS Code's `MarkdownString` hover vs an HTML/CSS webview tooltip), so they cannot be pixel-identical, but they MUST be informationally equivalent, visually coherent, and interactionally analogous.

## Problem Statement

Before this work, the VS Code extension had a baseline hover provider that surfaced claim metadata and a flat list of incoming references, and a markdown preview with claim references rendered as styled spans but no on-hover surfacing of any kind. A user reading a note in either surface had three concrete problems:

| Scenario | Prior Behavior | Correct Behavior |
|----------|---------------|------------------|
| Hovering a claim's own definition heading (`### AC.01 — ...`) | Hover showed the body excerpt the user is already reading, plus a flat refs list | Hover surfaces metadata + refs only — body excerpt is redundant |
| Hovering a citation `{R005.§1.AC.01}` from elsewhere | Single-pane hover with the body but a flat refs list — couldn't see refs side-by-side with the cited body | Two-column layout: refs left, body excerpt right, with independent scroll |
| Hovering a range like `{AC.01-06}` | Only the first member resolved; users had to hover each AC in the range individually | One row per range member, scannable in a single hover |
| Hovering a citation inside a refs panel inside a tooltip | No tooltip-on-tooltip — the parent dismissed | Stacked tooltips: parent stays visible, child tooltip rises above on its own DOM element |
| Reading `R005 §1.AC.01` (note id and section ref written as adjacent tokens) | Section ref unresolved — parser saw the bare `§1.AC.01` and failed to bind the note id | Bare section ref binds to the immediately-preceding bare note ref through whitespace, `'s` possessive, or a closing brace |
| Scanning a note for "where do incoming refs converge?" | No visual cue per claim — every claim looked alike regardless of how heavily cited | A `●N` badge anchored next to each claim id, color-coded for source vs note-only coverage |
| Reading claim refs inside a tooltip's body excerpt | Body rendered as plain text — claim refs appeared as bare strings, no color, no hover | Body rendered through the SCEpter plugin: claim refs styled, badges visible, deeper hovers spawn child tooltips |
| Refs panel in the editor hover showed dense URL-like file paths | Long lines wrapped awkwardly; reader couldn't tell at a glance which citing line said what | Refs panel shows the citing line as a dimmed snippet with the target FQID bolded; long lines collapse to head + windowed-around-hit |

The work that closes these gaps is split between several modules — markdown plugin, hover provider, decoration provider, claim index, pattern matcher, preview-script, claim parser. This requirement captures the user-facing capability set those modules realize, so future work has a single binding spec to backfill `@implements` annotations against.

## Design Principles

**Information at the point of reference.** A user MUST be able to learn what a citation refers to, what its body says, who else cites it, and whether it has source coverage — without leaving the current line. The hover and tooltip surfaces are the primary delivery mechanism; visual decorations (the inline badge) are the at-a-glance secondary mechanism.

**Two render modes per claim.** When the cursor sits on a claim's own definition heading or paragraph, the user already sees the body — the hover MUST surface metadata + refs only ("original-claim" mode). When the cursor sits on a citation elsewhere, the hover MUST present body and refs side-by-side so the reader can scan both without scrolling ("reference-to-claim" mode).

**Cross-surface consistency.** The editor hover and the preview tooltip share the same visual vocabulary — same FQID bolding rules, same snippet-truncation algorithm, same source/note-coverage color encoding for the `●N` badge — even though their rendering technologies differ.

**No round-trip from webview to host.** Everything the preview tooltip needs to render — refs panel, body excerpt, range members, derivation flags, snippets — MUST be pre-encoded as data attributes on the rendered span by the markdown-it plugin. The webview script is purely declarative: read attributes, build DOM, position, attach event handlers.

**Stable surface during background writes.** Background agents writing files in the workspace cause the claim index to rebuild repeatedly. The preview MUST NOT auto-refresh on every index update — re-rendering tears down hover tooltips and disrupts focus. The trade-off is acceptable: data attributes go briefly stale until the user manually refreshes; in exchange, hover stability is preserved.

## Requirements

### §1 Inline Crossref-Count Badge

Every claim definition that has at least one inbound reference MUST display a `●N` badge anchored immediately after its claim id, in both the raw markdown editor and the rendered markdown preview. The badge is the at-a-glance signal for "this claim is cited" — a reader scanning a note can identify load-bearing claims without hovering each one.

§1.AC.01 The badge MUST appear next to the claim id (e.g., `AC.01●3`) on both heading-level claim definitions (`### AC.01 — title`) and paragraph-level claim definitions (`§5.AC.01 The system MUST...`). Both shapes are first-class in real SCEpter notes; the badge MUST reach both.

§1.AC.02 The badge MUST display the total count of inbound references for that claim — the sum of source-code references (`@implements`, `@validates`, etc.) and note-to-note references (`{R012.§1.AC.01}` from another note's prose).

§1.AC.03 The badge color MUST encode source coverage: green when at least one inbound reference originates in source code; red (or otherwise distinct from green) when every inbound reference is note-to-note. The color is the at-a-glance signal for "is this implemented anywhere?"

§1.AC.04 In the raw markdown editor, the badge MUST be rendered via VS Code's `after`-decoration mechanism, anchored on the range of the claim id text in the heading line. The decoration MUST refresh when the document changes (debounced) and when the claim index refreshes.

§1.AC.05 In the markdown preview, the badge MUST be emitted as an inline `<span class="scepter-claim-badge">` element placed immediately after the rendered claim id span, so the badge sits visually adjacent to the FQID rather than at end-of-line.

§1.AC.06 The badge MUST NOT appear on citations of a claim — only on the claim's own definition. The text-render path is the preferred emission point (badge sits right after the FQID); a block-close fallback hook (`heading_close`, `paragraph_close`) MUST emit the badge when the inline path missed it (e.g., when token source-line metadata was unavailable), de-duplicating against the inline emission.

§1.AC.07 When a claim definition has zero inbound references, the badge MUST NOT appear. Absence of the badge is itself information: "no one cites this claim yet."

§1.AC.08 When the markdown preview renders a body excerpt of a claim through the SCEpter plugin (i.e., the claim's body rendered inside another claim's hover tooltip), badge emission MUST anchor on the original document's line coordinates, not the excerpt's. A line-offset env field (`_scepterLineOffset`) MUST shift the excerpt's local line numbers onto the original document's coordinate system before comparing against the claim index's line entries.

### §2 Editor Hover (Raw Markdown)

The editor hover provider MUST surface claim, note, and section information when the user hovers a reference in a `.md` file. The hover MUST distinguish between "the user is reading this claim's own definition" (original-claim mode) and "the user is hovering a citation elsewhere" (reference-to-claim mode), and MUST handle range expansions, cross-project citations, snippet truncation for long citing lines, and unknown references gracefully.

§2.AC.01 When the cursor sits on a claim's own definition heading or paragraph (same file, same line as the indexed `entry.line`), the hover MUST render in **original-claim mode**: a single-pane layout with the FQID, note type, note title, importance/lifecycle/derivation badges, and the refs panel. The body excerpt MUST be omitted — the user is already reading it.

§2.AC.02 When the cursor sits on a citation of a claim from elsewhere (different line, different file, or a citation of another claim within the same file), the hover MUST render in **reference-to-claim mode**: a two-column layout with the refs panel on the left and the cited claim's body, file:line link, and metadata badges on the right. Each column MUST scroll independently so the reader can navigate long refs lists or long body excerpts without losing the other.

§2.AC.03 When the cursor sits on a range expansion (e.g., `{R004.§1.AC.01-06}` or `{AC.01-AC.06}`), the hover MUST render one row per range member, each row showing the member's FQID, note type, note title, and a heading excerpt. Each row MUST be a clickable link that opens the member's file at its line. Cross-project ranges MUST fall back to a listing-only view (one line per member showing only the FQID) rather than performing per-member peer reads.

§2.AC.04 The refs panel MUST distinguish source-code references from note-to-note references via two named subsections ("Sources (N)" and "Notes (N)"). Each subsection MUST display its count even when empty, and MUST surface an explicit "No source references" / "No note references" line when empty (so the user knows the absence is informative, not a missing render).

§2.AC.05 Within the Notes subsection, references MUST be grouped by source note id. Each group MUST display the source note's id, type, and title as a header, and within that group each ref MUST be tagged either as a **derivation** (the citing claim's `derives=` metadata points at this claim) or as a **reference** (any other citation kind).

§2.AC.06 For each derivation ref, the hover MUST display the citing claim's local id and a heading excerpt of the citing claim. For each non-derivation ref, the hover MUST display the citing claim's local id (or `line N` when no claim id is at that line) followed by an HTML snippet of the actual citing line, with the surrounding text dimmed and the target FQID bolded.

§2.AC.07 When a citing line is too long for full display, the snippet MUST truncate while preserving the visibility of the target FQID. When the FQID falls within the head budget (default 80 characters), the snippet MUST show the start of the line through the FQID with a trailing window. When the FQID falls past the head budget, the snippet MUST show the head + an ellipsis + a window centered on the FQID (so the reader sees both the leading context and the actual hit).

§2.AC.08 When the SCEpter reference recognized at the cursor is not present in the claim index, the hover MUST surface a fallback message naming the matched id and instructing the user to refresh the index. Recognition without resolution MUST NOT silently produce a null hover.

§2.AC.09 The hover MUST log every attempted hover on a markdown file to the extension's output channel with the line, character, match kind, and surrounding text snippet. This is the primary diagnostic surface for users debugging "why didn't my hover fire?"

### §3 Markdown Preview Tooltip

The markdown preview's webview MUST display a rich hover tooltip when the user hovers a `.scepter-ref` element in the rendered preview. The tooltip MUST be informationally equivalent to the editor hover, MUST support the same render modes (original-claim, reference-to-claim, range), MUST stack when the user hovers refs inside an already-open tooltip, and MUST scroll with the page rather than floating in viewport coordinates.

§3.AC.01 The tooltip MUST appear on `mouseenter` of any `.scepter-ref` element (claim, bare-claim, note, section, cross-project) with a configurable hover delay-and-hide window (e.g., 150ms hide timer that cancels on `mouseenter` of the tooltip itself or any ancestor in the stack).

§3.AC.02 Each tooltip MUST be its own DOM element appended to `document.body` rather than a single shared tooltip element. Independent elements MUST be used so that hovering a ref *inside* an existing tooltip spawns a child tooltip on top, with the parent tooltip remaining visible underneath.

§3.AC.03 Stacked tooltips MUST manage hide timers per-level: hovering into a child tooltip MUST cancel pending hides for the child AND every ancestor up the stack. Hovering out of a tooltip MUST schedule a hide for that tooltip AND every deeper tooltip; ancestors MUST remain visible until their own hide timer fires.

§3.AC.04 Tooltip positioning MUST use `position: absolute` with document-relative coordinates (page scroll offsets included) so the tooltip moves with its anchor as the page scrolls. The tooltip MUST clamp to viewport bounds (max-width, max-height, transform-translate when near the bottom edge) so it never escapes the visible area.

§3.AC.05 The tooltip MUST handle `command:` URI navigation explicitly: clicking an `<a href="command:...">` inside the tooltip MUST dispatch the command via `window.location.href` assignment. The markdown preview's built-in click delegator only watches the `.markdown-body` area, so tooltips appended to `document.body` need their own dispatcher.

§3.AC.06 The tooltip's wheel-event handler MUST scroll the inner two-column scrollable region (when the cursor is over it) instead of the outer page, and MUST NOT propagate the wheel event to the page when the inner region is at scroll bounds.

§3.AC.07 When the markdown preview is open and the user hovers refs, the tooltip MUST NOT be torn down by claim index refresh events. The extension MUST NOT automatically dispatch `markdown.preview.refresh` on every `index.onDidRefresh` — only at activation. The trade-off is that data attributes go briefly stale until the user manually refreshes the preview; this is the accepted cost of preserving hover stability during background-agent file writes.

### §4 Refs Panel Content Layout

The refs panel — surfaced inside both the editor hover and the preview tooltip — MUST follow a consistent content structure. The panel is the primary "who cites this?" surface; its layout determines whether the user can scan citation patterns at a glance.

§4.AC.01 The refs panel MUST be split into a Sources subsection (source-code refs) and a Notes subsection (note-to-note refs). Each subsection MUST display its count in the heading.

§4.AC.02 In the Sources subsection, each ref MUST be displayed as `relative-path:line` with a clickable link that opens the file at the cited line. The path MUST be relative to the project root; markdown-special characters (underscores, asterisks) MUST be escaped so paths like `__tests__/foo.ts` don't render as bold.

§4.AC.03 In the Notes subsection, refs MUST be grouped by source note id. Each group MUST be rendered as a `<details>` collapsible (in the preview) or a flat header (in the editor hover); the group header MUST display the source note id, type, and title.

§4.AC.04 The preview's group collapsibles MUST default to open when the total group count is small (≤3 groups, ≤5 refs per group) and default to collapsed when larger. The Sources subsection MUST follow the same default-open heuristic (open when ≤5 sources, collapsed-with-summary when more).

§4.AC.05 Each ref in a Notes group MUST carry a `kind` flag distinguishing **derivation** (the citing claim's `derives=` metadata points at this claim) from **reference** (any other citation). The kind MUST be visually distinguishable in the rendered output (e.g., `— *derivation*: heading excerpt` vs `— citing-line snippet`).

§4.AC.06 For derivation refs, the panel MUST display the citing claim's local id and a heading excerpt of the citing claim. The heading excerpt MUST be truncated to a reasonable length (first sentence or 80 characters, whichever shorter).

§4.AC.07 For reference refs, the panel MUST display the citing claim's local id and an HTML snippet of the actual citing line. The snippet MUST follow the truncation algorithm specified in §2.AC.07.

§4.AC.08 The preview's snippet rendering MUST emit pre-built, server-side-escaped HTML on the data attribute (`data-claim-refs` JSON descriptor), so the webview script can drop the snippet into innerHTML without re-escaping. The webview MUST NOT round-trip back to the extension host to compute snippets.

§4.AC.09 When a claim has neither source-code refs nor note-to-note refs, the preview tooltip MUST omit the refs panel entirely (rather than showing two empty subsections). The editor hover MAY show empty subsections with explicit "No X references" lines because its hover style is more text-dense.

### §5 Range-Syntax Expansion

A range reference like `{R004.§1.AC.01-06}` or `{AC.01-AC.06}` MUST be treated as a single semantic token but rendered as N separately-resolvable claims when surfaced. The user reads the source as one expression but interacts with each member individually.

§5.AC.01 The pattern matcher MUST return a single match for a range token, with all expanded member FQIDs carried as `rangeMembers` on the match in source order. The first member MUST equal the match's `normalizedId` for backward compatibility with single-claim consumers.

§5.AC.02 Decoration providers MUST treat a range match as a single underlined span, not as N adjacent spans. The visual treatment MUST follow the same resolved/unresolved color encoding as a single-claim match.

§5.AC.03 The editor hover MUST detect range matches (via `match.rangeMembers.length > 1`) and route to the range hover renderer rather than the single-claim renderer. The range hover MUST list every member as a clickable link with FQID, note type, note title, and heading excerpt.

§5.AC.04 The markdown plugin MUST emit range-member data on the rendered span (`data-claim-range-members` JSON-encoded array of per-member descriptors). The preview tooltip MUST detect this attribute and render the same one-row-per-member layout as the editor hover.

§5.AC.05 Range expansion MUST work for both braced (`{AC.01-06}`) and braceless (`AC.01-06` in markdown context) ranges.

§5.AC.06 Cross-project range references (`{vendor-lib/R005.§1.AC.01-06}`) MUST render in a listing-only mode (one line per member, FQID only) rather than performing per-member peer-project reads. Per-member peer reads on a hover surface would round-trip too many file accesses for an interactive surface.

### §6 Adjacent-Section Binding (Parser-Level)

The claim parser MUST recognize the common authoring shape where a note id and a section reference are written as separate tokens but logically form one address: `R005 §1.AC.01`, `{R005} §1.AC.01`, `T057's §1.AC.01-02`. This is a parser-level concern but its effect surfaces in every consumer: hover, decoration, preview, diagnostics, claim index. Without it, every adjacent-section authoring shape produces an unresolved-section diagnostic and a broken navigation target.

§6.AC.01 The parser MUST bind a bare section reference (no `noteId`, has `sectionPath`) to an immediately-preceding bare note reference (note id only — no section, no claim) when the source text places them adjacent. Binding MUST mutate `address.noteId` (and `aliasPrefix` if the prev ref carried one) on the bound section ref; `address.raw` MUST stay as the literal source text so consumers that surface raw in messages echo what the author wrote.

§6.AC.02 The allowed gap between the note ref and the section ref MUST be: (a) plain whitespace, (b) `'s` possessive followed by whitespace (`T057's §1.AC.01`), or (c) a closing brace from a braced note ref followed by whitespace (`{E032} §5.2`). Any other character between the two tokens — comma, parenthesis, prose, period — MUST leave both refs untouched.

§6.AC.03 When the section reference expands to a range (`T057's §1.AC.01-02`), every range-expansion sibling MUST inherit the binding. Range members share a column with the originating ref, so once the first member binds, same-column siblings MUST receive the same `noteId`.

§6.AC.04 When the section reference is followed by another section reference (e.g., `R005 §1, §2`), only the first MUST bind. Binding stops at the first non-allowed gap character; this prevents `, §2` from being attributed to `R005`.

§6.AC.05 Downstream consumers MUST derive their normalized FQID from the address fields directly (`noteId`, `sectionPath`, `claimPrefix`, `claimNumber`) rather than re-parsing `address.raw`. Without this, the binding's effect on `address.noteId` is lost when consumers strip `§` from `address.raw` to compute the FQID.

### §7 Excerpt Rendering Pipeline

The body excerpt that appears inside a claim hover (in the right column of reference-to-claim mode) and the note excerpt that appears inside a note hover MUST be rendered through the SCEpter markdown-it plugin, not as raw text. This makes claim references inside the excerpt themselves stylable, hoverable, and badge-bearing.

§7.AC.01 The claim index MUST maintain an HTML excerpt cache (`htmlExcerptCache`) populated by rendering each claim's body and each note's excerpt through a markdown-it instance that has the SCEpter plugin attached.

§7.AC.02 When rendering a claim body excerpt through the plugin, the markdown-it env MUST carry (a) `currentDocument.fsPath` set to the parent note's absolute path (so the plugin can resolve `contextNoteId` for badge emission), and (b) `_scepterLineOffset` set to the claim's start line minus 1 (so excerpt-local line indices shift onto the original document's coordinates).

§7.AC.03 The preview tooltip's body panel MUST prefer the pre-rendered HTML excerpt (`data-claim-context`) over a raw text excerpt (`data-claim-context-raw`) when both are available. The HTML excerpt MUST be injected into the tooltip via innerHTML, and `attachListeners` MUST re-run after injection so any nested `.scepter-ref` spans pick up hover behavior.

§7.AC.04 When only the raw text excerpt is available (HTML render failed or is unavailable), the preview tooltip MUST fall back to a text excerpt with show-more-above and show-more-below buttons that expand the visible window in 12-line increments.

§7.AC.05 The note excerpt cache MUST cap excerpts at a reasonable line count (e.g., 50 lines) with a `*…content continues*` truncation marker, so a hover over a long note doesn't render the entire body.

§7.AC.06 The aggregated note-lines cache (`noteLinesCache`) MUST be populated for every indexed note so the citing-line snippet builder (used by the refs panel) can read the actual line text without re-reading from disk per snippet.

## Edge Cases

### Cursor on a Citation of the Claim Within Its Own Note

**Detection:** Same file as the claim's definition, but a different line (the user wrote `As established by {AC.01}, ...` later in the same note).
**Behavior:** Reference-to-claim mode (two-column layout). The user is not on the definition line; they're on a citation. The body excerpt is informational because the citation might appear far from the definition.

### Markdown Plugin Re-renders an Excerpt Inside Another Claim's Hover

**Detection:** The markdown-it env carries a non-zero `_scepterLineOffset`.
**Behavior:** The badge-emission line comparison MUST add the offset to the excerpt's local line number before comparing against `entry.line`. Without this, badges on claim definitions inside the excerpt either fail to emit or emit on the wrong line.

### Token Source-Line Metadata is Missing

**Detection:** The inline token has no `tok.map` or `_scepterLine`.
**Behavior:** The text-render path cannot identify the badge-emission line. The block-close fallback hook (`heading_close`, `paragraph_close`) emits the badge instead. A `_scepterBadgesEmitted` set on the env de-duplicates emissions when both paths fire for the same claim.

### Range Reference With An Out-of-Index Member

**Detection:** A range like `{AC.01-06}` resolves to six FQIDs, but `AC.04` is not in the claim index (e.g., the section was renumbered).
**Behavior:** The range hover renders one row per member, with the missing member shown as `**AC.04** — *not in index*`. The other members render normally.

### Long Citing Line With FQID Past Character 80

**Detection:** The citing line's hit position is ≥ HEAD budget (80 chars).
**Behavior:** The snippet renders `head[0..80] … window-around-hit[hit-50 .. hit+70]` so both the leading context and the bolded FQID are visible. Without this, the hit is invisible past the truncation point.

### Background Agent Writes Cause Index Rebuild While Tooltip is Open

**Detection:** `index.onDidRefresh` fires while the user has an open preview tooltip.
**Behavior:** The extension MUST NOT auto-refresh the markdown preview. The tooltip's data attributes go briefly stale; the user manually refreshes (`Cmd+Shift+P → Markdown: Refresh Preview`) when ready. Editor decorations and editor hovers refresh normally — only the preview is preserved.

## Non-Goals

- **Hover snapshot tests** — The extension currently has no automated visual-regression test suite for hovers. Verification is manual (visual inspection of the editor hover and preview tooltip in a real workspace). A future test infrastructure project may add snapshots, but this requirement does not bind that scope.
- **Per-claim configuration of badge color or visibility** — The badge color encoding (green for source coverage, red for note-only) is fixed. A user cannot per-claim opt out of badges or remap colors via configuration in this scope.
- **Hover content for non-SCEpter markdown links** — The hover and tooltip surfaces only fire for `.scepter-ref`-classed elements. Plain markdown links, code spans, and text without claim references continue to use VS Code's default markdown hover.
- **Live edit-aware tooltips** — When the user edits the markdown source while a preview tooltip is open, the tooltip is NOT live-updated against the in-memory edit. The tooltip reflects the most recent rendered preview snapshot.
- **Tooltip interactions inside the editor hover** — The editor hover is rendered via VS Code's `MarkdownString`, which does not support arbitrary nested HTML interactions. Stacked tooltips are a preview-only capability; the editor hover surfaces the same information but in a flat single-pane layout.
- **Cross-project range hover with peer-resolved bodies** — Per §5.AC.06, cross-project ranges fall back to listing-only. Per-member peer reads are out of scope for this requirement.
- **Backfilling `@implements` annotations** — This requirement defines the capability surface. The follow-up pass adds `@implements {R012.§N.AC.NN}` annotations across the implementation files; this is mechanical work scoped separately.
- **Webview-side composition of the refs panel from raw refs** — The webview MUST receive a pre-built JSON descriptor (`data-claim-refs`) and render it declaratively. This is a binding boundary: changing the descriptor shape requires coordinated edits to plugin and webview.

## Verification

Verification for this requirement is primarily manual visual inspection in a real VS Code workspace. The extension does not have an automated hover-snapshot suite. Each section's verification approach:

| Section | Verification approach |
|---------|----------------------|
| §1 Inline badge | Open a SCEpter note in the editor and the preview; visually confirm `●N` badge appears next to claim ids with N matching the index's incoming-ref count; confirm color matches source-vs-note coverage |
| §2 Editor hover | Hover the claim's definition heading (expect original-claim mode); hover a citation elsewhere (expect reference-to-claim two-column mode); hover a range (expect one row per member); hover an unknown id (expect fallback message) |
| §3 Preview tooltip | Open the markdown preview; hover refs, confirm tooltip appears with same content as editor hover; hover a ref *inside* the tooltip, confirm child tooltip stacks on top with parent visible underneath; scroll the page, confirm tooltip moves with anchor; click a `command:` link inside the tooltip, confirm navigation fires |
| §4 Refs panel | Confirm Sources / Notes subsections render with counts; confirm Notes group collapse/expand defaults; confirm derivation vs reference distinction in rendered output; confirm citing-line snippet bolds the target FQID |
| §5 Range expansion | Confirm `{AC.01-06}`-style refs render one row per member with clickable navigation; confirm cross-project ranges fall back to listing |
| §6 Adjacent-section binding | Author a note with `R005 §1.AC.01`, `{R005} §1.AC.01`, `T057's §1.AC.01-02`; run `scepter claims trace` against the citing note; confirm the section refs resolve to the bound note id |
| §7 Excerpt pipeline | Hover a citation in the preview; confirm body excerpt renders with claim refs styled as `.scepter-ref` (not bare strings) and hoverable for child tooltips; confirm `_scepterLineOffset` shifts badge anchors correctly |

A future test plan derived from this requirement may add scripted manual test cases or, if hover-snapshot infrastructure is built, automated checks. Until then, the verification surface is the rendered VS Code UI itself.

## Acceptance Criteria Summary

| Section | Count |
|---------|-------|
| §1 Inline Crossref-Count Badge | 8 |
| §2 Editor Hover (Raw Markdown) | 9 |
| §3 Markdown Preview Tooltip | 7 |
| §4 Refs Panel Content Layout | 9 |
| §5 Range-Syntax Expansion | 6 |
| §6 Adjacent-Section Binding | 5 |
| §7 Excerpt Rendering Pipeline | 6 |
| **Total** | **50** |

## References

- {DD012} — VS Code Extension Migration: CLI to Library API. The migration this work builds on; gives the extension direct access to core parsers and the claim index for plugin-time resolution and pre-rendering.
- {DD013} — VS Code Rich Views: Sidebar TreeViews, Traceability, and Search. Provides the trace and notes views that anchor the broader "rich VS Code surface" agenda; the hover and tooltip work in this requirement is the in-document complement to those side-panel views.
- {DD015} — Cross-Project Reference Resolution: Implementation Across Core, VS Code, and Agent Documentation. The cross-project decoration and hover work referenced in §2.AC.03 (cross-project range fallback) and elsewhere; this requirement leaves cross-project rendering scope to DD015 and only specifies the fallback shape where ranges intersect cross-project.
- {R004} — Claim-Level Addressability and Traceability System. The base reference grammar that range expansion (§5) and adjacent-section binding (§6) extend.
- {R005} — Claim Metadata, Verification, and Lifecycle. The metadata grammar (`importance`, `lifecycle`, `derives=`) that hover and tooltip surfaces display in the badge row.
- {R006} — Claim Derivation Tracing. The derivation-vs-reference distinction in §4.AC.05 — `derives=TARGET` metadata is what the refs panel reads to flag a citation as a derivation rather than a plain reference.
- {R011} — Cross-Project Note and Claim References via Path Aliases. Source of the `aliasPrefix` field on the parser address that §5.AC.06 (cross-project range fallback) consumes; also defines the cross-project routing in decorations and hover (handled by R011 §4 directly, not this requirement).
- Implementation files (binding scope of this requirement): `vscode/src/markdown-plugin.ts`, `vscode/src/hover-provider.ts`, `vscode/src/decoration-provider.ts`, `vscode/src/claim-index.ts`, `vscode/src/patterns.ts`, `vscode/src/extension.ts`, `vscode/media/preview-script.js`, `vscode/media/markdown-claims.css`, `core/src/parsers/claim/claim-parser.ts` (adjacent-section binding only).

## Status

- 2026-05-02: Authored. Captures the user-facing capability surface delivered by the recent VS Code work (commits `5b9bafc`..`781cf03`). The follow-up task is a backfill pass adding `@implements {R012.§N.AC.NN}` annotations across the listed implementation files; this requirement is the binding spec for that pass. Verification is manual visual inspection — no hover-snapshot test infrastructure exists yet.
