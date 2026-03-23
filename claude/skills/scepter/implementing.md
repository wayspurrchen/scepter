# SCEpter Implementation Guide

**Read this companion file when implementing features from SCEpter plans.** This combines workflow, implementation methodology, and source code integration guidance.

Ensure you have loaded `@scepter` (the main skill) first — it contains the non-negotiable rules, CLI reference, and core concepts.

## Pre-Implementation Workflow

### Starting Any Task (MANDATORY)

```bash
# 1. Find the task
scepter ctx show T001

# 2. CRITICAL: Gather full context
scepter ctx gather T001

# 3. Check mode prompts (if shown in output)

# 4. Get date BEFORE making edits
date "+%Y-%m-%d"

# 5. Begin work with complete context
```

### Proactive Documentation

Document AS you work, not after:
- Decision made → CREATE decision note NOW
- Requirement found → CREATE requirement note NOW
- Ambiguity found → CREATE question note NOW
- TIMING: IMMEDIATE (not "later")

### Duplicate Prevention

ALWAYS search before creating:
```bash
scepter ctx search "relevant keywords"
scepter ctx list --types [YourType] --tags relevant
# Only create if no matches
```

## Implementation Methodology

### Task Analysis

1. Review SCEpter notes and tasks for full scope
2. Create module-by-module plans with exact function signatures, I/O specs, error handling, integration points
3. Identify all dependencies and verify actual API signatures by examining code
4. Search for existing patterns, utilities, and components to reuse

### Implementation Order

1. **Foundational components first** — Build dependencies before dependents
2. **Small, testable increments** — Break into verifiable steps
3. **Core functionality over edge cases** — Happy path first
4. **Use existing utilities** — Reuse patterns from the codebase
5. **Refactor only when planned** — Don't scope-creep

### Plan Adherence and Minimalism

- Follow the plan to the letter. No extra features.
- Only implement what's explicitly required.
- Deviations only if an issue blocks correctness/safety:
  - Document the issue, proposed minimal change, rationale
  - Prefer the smallest corrective change
  - If larger changes needed, pause and request plan update

### Iterative Layering

Build in small, testable layers:
1. Build the simplest slice that proves the approach
2. Validate the slice (inputs/outputs, invariants)
3. Document key decisions
4. Decide: refine or proceed

**Typical sequence:** Core functionality → Common variations → Error handling → Performance → Conveniences

Stop when all explicit requirements are met.

### Quality Safeguards

**Before writing code:**
- Verify against plan requirements
- Understand existing patterns (use code-explorer if needed)
- Confirm dependency APIs

**While writing code:**
- Type safety — avoid `any` types
- Mental-test critical paths
- Maintain backward compatibility unless told otherwise
- Add SCEpter references (see below)

**After writing code:**
- Run tests if available
- Verify type checking
- Confirm no breakage

### Impact Analysis: Structural Property Changes (CRITICAL)

When your change causes an entity to gain, lose, or change structural elements — claims parsed from a note, exports from a module, fields on a type, routes in a router — you MUST assess downstream impact.

**The problem:** A change can be correct locally but break downstream code that branches on a structural property of the thing you changed. Unit tests on the changed code will pass. The breakage is at the consumption boundary, not the production site.

**Example:** Adding `stripInlineFormatting()` to the claim parser correctly detected `**OQ.01**` as a claim in DD001. But `buildTraceabilityMatrix()` had a binary branch: notes WITH claims show incoming references, notes WITHOUT show outgoing. DD001 suddenly gained claims, switching it from outgoing (showing ~426 referenced claims) to incoming-only (showing nothing). Parser tests passed. Trace command broke.

**After any structural change, ask:**

1. **What did I change about what this entity IS?** (Not what it does — what it IS. A note that now has claims is a different kind of entity than a note without claims.)
2. **Who reads this structural property as a dispatch signal?** Search for consumers of the property you changed — callers that branch on count, type, presence/absence.
3. **Run `scepter claims trace` on affected notes.** If your change touches the parser or anything that affects how claims are detected, verify trace output didn't regress on notes that contain the affected patterns.
4. **Run `scepter claims lint` and `gaps`.** Changes to claim detection or metadata parsing can affect lint results and gap reports.

**The heuristic:** You changed what X IS. Who was relying on what X WAS?

## Retrofitting Claims on Existing Code

When adding claims to a codebase that predates the claims system (no `@implements` annotations, notes in non-standard format), follow this sequence strictly. The order matters — each step depends on the previous one.

1. **Verify note claim format.** Run `scepter claims trace NOTEID`. If it says "No claims found", the note uses a format the parser can't read (checkboxes, bold-only, wrong heading levels). Reformat to heading-level or `§`-prefixed paragraphs first. This is the precondition for everything else.

2. **Run `scepter claims lint NOTEID`.** Fix structural issues before adding annotations. Forbidden forms, duplicates, and broken references must be resolved first.

3. **Add `@implements` annotations to source files.** Use fully qualified claim IDs matching exactly what appears in the trace output. Run `scepter claims trace NOTEID` after — the Source column must show your files.

4. **Add cross-note references.** If other notes discuss these claims, add `{R034.§1.AC.01}` braced references in prose, or `derives=R034.§1.AC.01` metadata on derived claims. These create the non-Source projection columns.

5. **Final verification.** Run `scepter claims trace NOTEID` and `scepter claims gaps --note NOTEID`. Every claim should show coverage where expected. If trace shows nothing despite your annotations, the claim IDs don't match — check for format differences (hyphens vs dots, missing section paths, wrong note ID prefix).

**The failure mode this prevents:** Adding `@implements {R034.AC.01}` to 20 source files while R034 has checkbox-format ACs that the parser can't read. The annotations look correct, the trace shows nothing, and no one knows until someone runs trace months later.

## Source Code References

All code implementing SCEpter notes MUST include references. These are **mandatory**, not optional.

### Reference Types

```typescript
// @implements {R001} - Code implements this requirement
// @depends-on {D005} - Code depends on this decision
// @addresses {Q003} - Code addresses this question
// @validates {R001} - Test validates this requirement
// @see {C001} - General reference
// Plain {ID} in comments - Simple mention
```

### Placement

- **Module/class level:** Architecture decisions, component specs
- **Function/method level:** Specific requirements, algorithm choices
- **Inline comments:** Decision points, non-obvious implementations

### Example

```typescript
/**
 * Authentication service
 * @implements {R001} User authentication requirement
 * @depends-on {D005} JWT decision
 * @see {T025} Implementation task
 */
class AuthService {
  /**
   * Validate credentials
   * Implementation follows {R001}
   */
  async login(username: string, password: string) {
    // Check rate limiting per {R003}
    await this.checkRateLimit(username);
    // Generate token per {D001}
    return this.generateToken(user);
  }
}
```

### Claim-Level References — MANDATORY

If your gathered context, task description, or reference documentation contains claim IDs (patterns like `§1.AC.01`, `R004.§3.AC.02`, `SEC.03`), you MUST:

1. **Read `claims.md`** from this skill directory for the full syntax, rules, and annotation patterns
2. **Carry forward every claim** from the reference material into your implementation via `@implements` annotations
3. **Use fully qualified paths** in code: `{R004.§1.AC.01}` not bare `AC.01`

Quick reference — the annotation looks like this:

```typescript
/**
 * @implements {R004.§1.AC.01} Section ID extraction from headings
 * @implements {R004.§1.AC.03} Claim resolution (fully qualified, partial, bare)
 * @validates {R001.§2.AC.03} Rate limiting enforcement
 */
```

**Do not drop claims silently.** If a claim from the reference material is out of scope for your current work, note it explicitly rather than ignoring it.

For the full claim syntax, forbidden forms, compact notation, traceability matrix integration, and annotation workflow, read `claims.md`.

## Updating Claim Threads (MANDATORY)

When the user says **"update claims"**, **"update claim threads"**, **"update threads"**, or any variation, this means: propagate the effects of your implementation back into the upstream SCEpter notes so the knowledge graph stays coherent with the code. **Progress notes alone are not sufficient.** The claims themselves — in the documents that define them — must reflect reality.

### Projections: why threads cross documents

A *projection* is any artifact type where a claim manifests — a requirement note, a design document, a test spec, source code, CLI output, documentation. The same logical claim appears in multiple projections: a requirement states *what*, a design says *how*, a test spec says *how we verify*, and source code says *what actually runs*. These are all views of the same claim.

When you implement code (advancing the Source projection), the other projections that expressed those claims may now be stale. "Updating threads" means bringing those projections back into coherence with what you actually built.

### What "updating threads" requires

For each claim affected by your implementation, trace it back to every note that references it (use `scepter claims trace NOTEID`) and check whether the note needs substantive updates:

**Notes that specify design or architecture:**
- If implementation revealed a new design constraint not captured in the note, add a new claim or annotate the existing one.
- If you chose a specific implementation approach where the note was silent or ambiguous, document the choice as a claim or annotation.
- If the note's module inventory, wiring map, function signatures, or other structural descriptions are now wrong, update them.

**Notes that specify tests:**
- If you wrote tests that don't have corresponding test case entries in the spec, **add the test cases to the spec**. The spec is the specification of what should be tested; the code is the implementation. Both must agree.
- If existing test cases are now wrong or incomplete because the implementation changed the behavior, update or extend them.
- If the spec's coverage table or test level allocation is now stale, update it.

**Notes that specify requirements or acceptance criteria:**
- ACs in requirements describe *what should happen*. If an AC is wrong, flag it — don't silently change it.
- If implementation exposed a gap that means a new AC is needed, note it but don't add ACs without user approval.
- Update status tables, implementation phase tracking, or coverage matrices if the note has them.

Check `scepter config` for the note types in this project. The categories above are conceptual — map them to whatever types exist.

### What "updating threads" does NOT mean

- Just appending a progress note with a date — that's a log entry, not a thread update
- Creating new SCEpter notes (unless something genuinely new was discovered)
- Changing requirement-level ACs without user approval

### The test: coherence after update

After updating threads, a reader of any upstream note should be able to understand the current state of the feature without reading git history. If a design note says "autoWire passes relative paths to import()" but the code now uses `pathToFileURL()`, the design note is stale and the thread is not updated.

### Annotations as lightweight updates

When a full rewrite of a section is overkill, use inline annotations on the existing claim:

```markdown
§DC.03 registerSchema creates companion fields for versioned JSON fields.

> **Implementation note (2026-03-18):** The codegen pipeline's `normalizeSchema()` must preserve `versioned`, `shape`, and `companionFieldName` on serialized field definitions for this to work through the generated `register()` path. Fixed in runtime.ts — see `normalizeFieldDef()`. {ARCH017.§3.AC.03}
```

This preserves the original claim while adding the implementation-level detail that future readers need.

---

## Status Updates

### Frontmatter First Rule

All status changes MUST be in frontmatter `status` key BEFORE adding progress notes:

```yaml
---
status: in_progress  # ← UPDATE THIS FIRST
---

## Status Updates
- 2025-11-12: Changed status to in_progress
```

### Completion Rule

**NEVER mark tasks as `completed` or `done`** without explicit user verification.

Safe transitions: `pending` → `in_progress` → `blocked` → `in_progress` → `ready_for_review`

User-only transitions: → `completed`, → `done`, → `approved`

### Progress Notes

Always date with exact `date` command output:
```markdown
## Progress
- 2025-11-12: Started implementation of auth module
- 2025-11-12: Completed token generation (src/services/auth.ts)
- 2025-11-12: All unit tests passing
```

## Implementation Checklist

### Before Starting
- [ ] Gather context on all referenced tasks
- [ ] Identify all files to be modified
- [ ] Verify all dependencies exist
- [ ] Understand existing code patterns

### During Implementation
- [ ] Follow the plan step-by-step
- [ ] Add SCEpter references in code comments
- [ ] Maintain consistent code style
- [ ] Update task progress with dates

### After Implementation
- [ ] All requirements met
- [ ] Tests passing
- [ ] No existing functionality broken
- [ ] Follow-up tasks documented
- [ ] Status set to ready_for_review (not completed)
