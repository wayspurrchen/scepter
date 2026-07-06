---
created: 2026-07-06T17:39:28.210Z
tags: [bug, vscode, decoration, hover, section-reference]
confidence: 🤖2 2026-07-06
status: ready_for_review
---

# T013 - Section references render gray/uncontented in VS Code editor; decoration missing color and hover truncated section content

**Status: fixed 2026-07-06, pending review.** Extension-only change; no core resolver change (respects {R004.§4.AC.04} — section refs remain non-cross-references).

## Symptom

In the VS Code extension, a section-level reference (`{R004.§2}`, `{DD018.§3}` — noteId + sectionPath, no claim prefix) renders as if unresolved/empty: not highlighted, gray-looking, "as if there's no content." Desired: render it as a resolved, highlighted reference whose hover shows all the content under that section, the same way a claim reference renders.

## Root cause (two independent defects, both extension-side)

1. **Decoration had no color.** `vscode/src/decoration-provider.ts` `sectionDecoration` set only `textDecoration: 'underline dotted rgba(78,201,176,0.4)'` — no `color:` property, unlike every other resolved decoration (claims get `color: '#4EC9B0'` + pointer + overview-ruler). So a *resolved* section reference rendered its text in the editor's default foreground with a barely-visible 40%-alpha underline — visually indistinguishable from plain/unresolved text. This was the "not highlighted / gray / no content" the user saw. The section path itself resolves correctly (the extension's `lookupSection` → derived `sections` map works; verified by direct index-build against `{R004.§2}` and `{DD018.§3}`).

2. **Hover silently truncated long sections.** `vscode/src/claim-index.ts:readSectionContent(entry, maxLines=200)` clamped the slice to `startIdx + maxLines` *even when a real `endLine` was known*, contradicting its own doc ("from line to endLine inclusive; falls back to a fixed window when endLine is missing"). A section longer than 200 lines (e.g. `DD018.§3` = 221 lines) lost its tail in the hover — so it did not "render all content underneath."

## Fix (extension-only)

- `vscode/src/decoration-provider.ts` — `sectionDecoration` now uses the resolved-reference styling (`color: '#4EC9B0'`, dotted underline, `cursor: 'pointer'`, overview-ruler mark), matching claim references so a section ref reads as resolved and clickable.
- `vscode/src/claim-index.ts` — `readSectionContent` now treats a real `endLine` as authoritative (renders the whole `[line, endLine]` slice, every nested claim + prose block); `maxLines` is only the fallback window for one-line stubs. Single caller (`hover-provider.ts:450`), so no other consumer affected. The hover already renders that slice as markdown, so full section content now shows, rendered like claim content.

## Verification

- `pnpm tsc` (core): clean. `vscode/tsconfig.json` typecheck: two errors remain (`claim-index.ts:1490`, `diagnostics-provider.ts:24`) but both are **pre-existing and unrelated** — `diagnostics-provider.ts` is untouched by this change, and the sole `claim-index.ts` edit is at line ~766, far from 1490. Confirmed via `git diff` hunk ranges.
- Visual result reasoned from code (the running extension was not launched in this session); reload the extension to confirm the teal highlight and full-section hover.

## Governing / related notes

- {R012.§2.AC.10} – {R012.§2.AC.13} govern section-hover behavior (FQID/title/heading/file:line/body-excerpt, "Contains N claims", unresolved-cause discrimination). This fix extends that surface: full-content rendering (not 200-capped) and a resolved-style decoration. Consider whether {R012.§2} warrants an explicit AC that a resolved section reference MUST carry a resolved-style decoration (the decoration color/style is currently governed by no claim, unlike the cross-project decoration which is pinned by {R011.§4.AC.05}/{DD015.§1.DC.07}).
- {R004.§4.AC.04} — section-only refs are structural navigation markers, NOT claim cross-references. This fix stays inside that invariant: it changes editor rendering only, adds nothing to the core cross-ref graph, and does not route through the core resolver.

## Open follow-up (not done here — needs a live repro)

The researcher could not reproduce a *genuinely unresolved* (gray wavy `#808080`) section ref for the two example addresses via index-build; those resolve. If, after reloading, a valid section ref still shows the gray **wavy** unresolved style (distinct from the faint style this fix replaces), that is a separate resolution bug — most likely a stale claim index or the bare/self-scoped `§N` `contextNoteId` derivation (`patterns.ts:noteIdFromPath`) — and needs an exact note+address repro.

