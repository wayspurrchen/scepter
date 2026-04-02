---
created: 2026-04-02T03:23:54.518Z
tags: [cli, claims, verification]
---

# DD007 - Verification Removal - Verify Command Extension

**Architecture:** {A001}
**Related:** {R005} (verification system), {DD006} (CLI unification)

## Problem

The verification store (`_scepter/verification.json`) is append-only with no removal mechanism. Once a claim is verified — including accidentally or with wrong metadata — the only recourse is manually editing the JSON file. The `verify` command needs a `--remove` flag to pop the most recent event, and `--remove --all` to clear the full history for a claim.

## §1 Module Inventory

### MODIFY: `core/src/claims/verification-store.ts`

§DC.01 Add a `removeLatestVerification(store, claimId)` function that removes the last event from the claim's array. Returns the removed event or null if no events exist. If the array becomes empty, delete the key from the store.

§DC.02 Add a `removeAllVerifications(store, claimId)` function that deletes the claim's key from the store entirely. Returns the count of events removed.

### MODIFY: `core/src/cli/commands/claims/verify-command.ts`

§DC.03 Add `--remove` option to the verify command. When present, the command removes verification events instead of adding them.

§DC.04 When `--remove` is passed without `--all`: call `removeLatestVerification()` for each resolved claim. Print the removed event details (date, actor, method) so the user can confirm what was undone.

§DC.05 When `--remove --all` is passed: call `removeAllVerifications()` for each resolved claim. Print the count of events removed per claim.

§DC.06 When `--remove` is passed with a note ID (not a claim ID): remove the latest verification from every claim in that note. Do NOT remove all — that's too destructive for a note-level operation. Require `--remove --all` with a specific claim ID, not a note ID, to clear full history.

### MODIFY: `core/src/claims/index.ts` (barrel)

§DC.07 Re-export `removeLatestVerification` and `removeAllVerifications` from the claims barrel if needed by the verify command's import path.

## §2 Integration Sequence

1. Add `removeLatestVerification()` and `removeAllVerifications()` to `verification-store.ts`
2. Re-export from claims barrel if needed
3. Add `--remove` and `--all` options to `verify-command.ts`
4. Implement removal logic with the note-level safety constraint
5. `pnpm tsc --noEmit` and `pnpm test -- --run`

