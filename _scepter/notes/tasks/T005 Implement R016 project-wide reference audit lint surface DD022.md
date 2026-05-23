---
created: 2026-05-23T05:36:12.754Z
tags:
  - lint
  - refs
  - audit
  - r016
  - dd022
confidence: 🤖2 2026-05-23
---

# T005 - Implement R016 — project-wide reference audit lint surface (DD022)

**Requirement:** {R016}
**Detailed Design:** {DD022}
**Foundational resolver:** {DD021}
**Adjacent surfaces:** {R015} (rewriter — DD022 is its audit complement), {R006.§5.AC.05} (`claims dependents` — distinct surface)

## Scope

Implement DD022's 27 design claims (DC.01–DC.27 across §10.1–§10.6) to deliver the new `lint --all`, `--code`, `--target`, `--codes`, `--refs-only` flags and JSON output.

Per user decision 2026-05-22: bundle the `ClaimIndexEntry.softDeleted` field prerequisite into this work surface (no separate companion DD). The field is added as Step 0 / Step 9 of the integration sequence so {DD022.§10.2.DC.07} (`reference-to-soft-deleted` synthesis) can be lifted from `:deferred` once the field exists.

## Execution

Dispatched via team protocol (`team.md`) — producer/reviewer pair with linker tag-along. Greenfield-additive surface; no refactoring plan required.

## Status

ready_for_review (Phase 2 implementation complete 2026-05-23).

## Closure (2026-05-23)

Phase 2 implementation complete. Status transitioned from `in-progress` → `ready_for_review` (user transitions `ready_for_review` → `completed`).

**Implementation surface delivered:**

- `core/src/claims/audit/run-audit.ts` (new) — orchestrator per {DD022.§10.1.DC.01-02}
- `core/src/claims/audit/incidence-collector.ts` (new) — note and source incidence synthesis per {DD022.§10.2.DC.03-10}
- `core/src/claims/audit/audit-filters.ts` (new) — five filter predicates per {DD022.§10.3.DC.11-18}
- `core/src/claims/audit/audit-formatters.ts` (new) — human and JSON formatters per {DD022.§10.4.DC.19-21}
- `core/src/cli/commands/claims/lint-command.ts` (additive) — CLI flags per {DD022.§10.5.DC.22-26}
- `core/src/claims/claim-index.ts` (additive) — `ClaimIndexEntry.softDeleted: boolean` at `:197`, populated at `:476` from `note.tags.includes('deleted')`; precondition for {DD022.§10.2.DC.07}
- `core/src/claims/index.ts` (barrel re-exports) — per {DD022.§10.6.DC.27}

**Test coverage delivered:**

- `core/src/claims/audit/__tests__/audit-filters.test.ts`
- `core/src/claims/audit/__tests__/audit-formatters.test.ts`
- `core/src/claims/audit/__tests__/incidence-collector.test.ts`

**Verification:**

- 2384 tests passing across the project; TSC clean on Phase 2 files
- All 27 DCs (DD022.§10.1.DC.01 through DD022.§10.6.DC.27) carry `@implements` annotations on non-stub code; verified via `scepter trace DD022`
- DC.07 lifecycle marker `:deferred` lifted; trace shows `DC.07:4:derives=R016.§4.AC.02` with full Source coverage (claim-index.ts, incidence-collector.ts, incidence-collector.test.ts, ensure-index.ts)
- R016 → DD022 → source chain intact for all 21 ACs; `scepter trace R016` shows DD022 derivative coverage on every AC and direct source coverage on the implementation-bound ones
- DD022 §12 (Primitive Preconditions) reflects implementation reality — `ClaimIndexEntry.softDeleted` row reads PRESENT

**Cross-projection hygiene applied 2026-05-23:**

- Coherence marker added on {DD022.§8} "Soft-deleted lifecycle field" subsection — preserves authoring history, points readers to §12 for the realized state
- Stale comment in `incidence-collector.ts:249` updated (`claim-index.ts:185` → `:197`) to match the actual realized line
