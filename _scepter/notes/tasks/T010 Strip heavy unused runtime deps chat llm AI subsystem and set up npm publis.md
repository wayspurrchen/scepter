---
created: 2026-06-23T20:33:09.426Z
status: ready_for_review
tags: [packaging, npm, dependencies]
confidence: 🤖2 2026-06-23
---

# T010 - Strip heavy/unused runtime deps (chat+llm AI subsystem) and set up npm publishing under @wayspurrchen scope

**Status:** ready_for_review · 2026-06-23

## Work completed (2026-06-23)

**Deleted** (all verified zero `@implements`/external importers first):
- `core/src/chat/` (entire subsystem)
- `core/src/llm/openai.ts`, `core/src/llm/claude-code.ts`, `core/src/llm/claude-interactive-yield.ts`
- `core/src/tasks/task-dispatcher.integration.test.ts` (live-OpenAI-API test of removed feature)
- `core/src/llm/types.ts` retained (live `SimpleLLMFunction`/`OpenAIModel` seam).

**Edited:**
- `core/src/types/task.ts` — replaced `import { type SDKMessage } from '@anthropic-ai/claude-code'`
  with a local `export type SDKMessage = Record<string, unknown>`.
- `tsconfig.json` — removed dead `./ui` project reference (the removed UI piece).
- `package.json` — see dispositions above; scope rename, publishing config, dep cleanup.
- `package-lock.json` — synced (npm canonical lock; pnpm-lock.yaml is gitignored).

**Dependency removals (from `dependencies`):** `@anthropic-ai/claude-code`, `@anthropic-ai/sdk`,
`openai`, `handlebars` → 11 packages pruned from the tree.
**Moved to `devDependencies`:** `prettier`, `vitest`.

**Verification (all green):**
- `pnpm tsc` — clean.
- `pnpm run build` — clean (cli + index, cjs + esm + dts).
- `node core/dist/cli.js --help` / `config` — runs standalone, no missing-module errors.
- Full suite: 2420 passed, 11 skipped, 126 files.
- `npm pack --dry-run` — 11 files, 1.3 MB packed / 6.6 MB unpacked (maps excluded via explicit
  `files` globs; down from 4.2 MB / 19.4 MB).

## Publishing runbook (for the user)

1. `npm login` (already authenticated as `wayspurrchen`).
2. Bump version if desired (currently `0.1.0`).
3. `npm publish` — `prepublishOnly` builds first; `publishConfig.access: "public"` + the
   `@wayspurrchen` user scope means no org and no paid plan required.
4. Verify: `npm view @wayspurrchen/scepter`; smoke `npx @wayspurrchen/scepter --help`.

## Goal

Make the package publishable as `@wayspurrchen/scepter` on npm, and remove heavy runtime
dependencies backing the now-unused interactive chat / LLM subsystem.

## Findings (verified by import-graph trace, not assumption)

- **`chat/` subsystem** — fully self-contained; zero importers outside `chat/`; no CLI
  command references it. Dead from the published CLI's perspective.
- **`llm/claude-code.ts`, `llm/claude-interactive-yield.ts`** — zero importers anywhere. Dead.
- **`llm/openai.ts`** — imported only by `tasks/task-dispatcher.integration.test.ts`
  (a live-OpenAI-API integration test of the removed feature).
- **`llm/types.ts`** — LIVE. `SimpleLLMFunction` / `OpenAIModel` consumed by
  `task-dispatcher.ts`, `project-manager.ts`, `create-filesystem-project.ts` via an optional
  injected `llmFunction` seam that nothing in the CLI path ever populates. KEPT.
- **`types/task.ts`** — type-only `SDKMessage` import from `@anthropic-ai/claude-code`
  (`TaskResult.messages`). `TaskResult` is part of the public barrel, so replace the type
  locally rather than break the shape.
- **`index.ts`** library barrel already excludes `cli/`, `llm/`, `chat/` by design
  (`@implements {DD011.§DC.03}`, `{DD011.§DC.05}`, `{DD011.§DC.06}`). Removing chat/llm impls
  does not touch public API.
- No deletion target carries any `@implements`/`@see`/etc. annotation → zero claim-graph impact.
- vscode package does not import core `chat`/`llm`.

## Dependency disposition

- **Remove from `dependencies`:** `@anthropic-ai/claude-code`, `@anthropic-ai/sdk` (0 uses),
  `openai` (test-only after deletion), `handlebars` (0 uses).
- **Move to `devDependencies`:** `prettier` (0 programmatic imports; dev formatter),
  `vitest` (test runner only).

## Publishing config (root package.json)

- `name` → `@wayspurrchen/scepter`; drop `private: true`.
- `bin.scepter` → `./core/dist/cli.js` (compiled, shebanged, executable). Local `./scepter`
  tsx wrapper retained for dev.
- Add `files` allowlist (`.gitignore` excludes `core/dist`, and npm falls back to
  `.gitignore` absent an `.npmignore` → without this the tarball ships no build output).
- Add `publishConfig.access: "public"` (scoped pkgs default to restricted).
- Add `prepublishOnly: "pnpm run build"`, `repository`, `license`, `description`, `engines`.
- Scope `@wayspurrchen` is the personal user scope — no npm org required.

## Related Notes

- {DD011} — Library API Surface (barrel exports + build config). This task confirms the barrel-exclusion
  claims still hold after the chat/llm deletion. The `@implements {DD011.§DC.05}` and `{DD011.§DC.06}`
  annotations on `core/src/index.ts` remain valid (the barrel still imports nothing from the now-deleted
  paths), but the *claim text* of {DD011.§DC.05}, {DD011.§DC.06}, and {DD011.§DC.11} still names
  `core/src/chat/` (deleted) and characterizes `core/src/llm/` as carrying "external service
  dependencies (Claude SDK, OpenAI)" — which is no longer true after this task (`llm/` now contains
  only the dependency-free `types.ts` seam). Flagged for human review; not rewritten here.
- {A003} — Library API Surface architecture (upstream of {DD011}). {A003.§7.AC.02} lists `handlebars`
  among the library's transitive runtime dependencies; this task removed `handlebars` from
  `dependencies`, so that enumeration is now stale. {A003.§9} scope-excludes "LLM and chat subsystem
  exposure" — the chat subsystem no longer exists to exclude. Flagged for human review.
- {A002} — Storage Protocol Extraction. Its §Scope-exclusion bullet references `ChatSessionStore` in
  `core/src/chat/types.ts` as an out-of-scope sixth storage concern; that file was deleted by this task,
  making the reference dangling. Flagged for human review.

