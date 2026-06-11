# Phase C: ai/ -> pi convergence plan

Status: design landed 2026-06-12. Execution is staged and ongoing; each stage
below is independently shippable and independently verifiable.

## Why this is a design, not a single commit

The original SOTA plan framed Phase C as "fold the legacy `ai/` chat stack
(~10k LOC) onto pi sessions." Mapping the actual dependency graph changes the
shape of the work in two important ways:

1. **`ai/` is not one thing.** Of its ~13.5k LOC, only a minority is the chat
   *surface*. The rest is shared infrastructure and a general agent runtime that
   pi itself and many other features depend on. A blind "delete `ai/`" would
   break settings, workflow, model-compare, source-control, git-history,
   editor autocomplete, and the agents module.
2. **There is no blind-safe path.** The chat surface only does anything useful
   with a live BYOK provider (keys + network). The e2e harness deliberately
   excludes AI providers, secrets, and network to stay deterministic, so the
   converged surface cannot be regression-tested the way the terminal/tab flows
   can until a mock-provider fixture exists (Stage 0 below).

So Phase C is a sequence of small, reversible migrations behind a stable public
surface, not one cut. This document defines the target boundary and the order.

## The real boundary: three layers inside `ai/`

Mapped from `src/modules/ai/` and its ~55 external importers.

### Layer 1 - Shared infrastructure (STAYS; pi already consumes it)

Provider keys, model discovery, transport, and security. Pi and the rest of the
app already import these; they are not "legacy" and do not move.

- `lib/keyring.ts` (`ProviderKeys`, `getKey`/`setKey`/`hasAnyKey`, custom
  endpoints) - consumed by settings, pi, model-compare.
- `lib/modelDiscovery*.ts`, `lib/modelPrefs.ts`, `config.ts` - model catalog
  and per-provider defaults.
- `lib/transport.ts`, `lib/proxyFetch.ts`, `lib/security.ts`, `lib/redact.ts`
  - the SSRF-aware fetch path and secret redaction.
- `lib/composer.tsx` (`AiComposerProvider`) - the unconditionally-mounted
  composer context. Load-bearing for App; keep mounted.

Action: none structurally. Optionally re-home this layer under a neutral name
(e.g. `modules/ai-runtime/`) once Layers 2-3 stop importing each other, so the
name stops implying "legacy." Cosmetic; do last or never.

### Layer 2 - Agent runtime (SHARED; converges underneath, not deleted)

The AI-SDK-based run loop. Used by the chat surface AND by workflow nodes and
model-compare, so it cannot be deleted with the surface.

- `store/chatStore.ts` (695 LOC) - `getOrCreateChat`, `sendMessage`, `stop`,
  `useChatStore`, agent-run status/meta. Imported by workflow, model-compare,
  source-control, agents.
- `lib/agent.ts`, `lib/transport.ts`, `tools/*` (the AI-SDK tool impls),
  `agents/*` (subagent registry/run).

Target: this is where convergence actually happens. Pi's runtime
(`pi-agent-core` + the Rust-mediated native tool boundary) is the SOTA target
runtime; the AI-SDK loop is the legacy one. The two must present one run-status
model to consumers before either the surface or the runtime can be unified. See
Stage 2.

### Layer 3 - Chat surface (the FOLD target; parallels pi's surface)

The presentation that duplicates what pi already has.

| Concern            | Legacy `ai/`                         | SOTA `pi/`                |
| ------------------ | ------------------------------------ | ------------------------- |
| Composer           | `AiInputBar`, `lib/composer.tsx`     | `PiComposer`              |
| Transcript         | `AiChat`, `AiChatMessage`            | `PiTranscript`           |
| Floating window    | `AiMiniWindow`                       | `PiFloatingWindow`       |
| Tool approval      | `AiToolApproval`                     | native approval gate      |
| Run extras         | `PlanDiffReview`, `TodoStrip`        | (to be absorbed)          |
| Stores             | `planStore`, `todoStore`, `snippetsStore` | pi session store     |

Already converged (down-payment, landed): `src/components/lazy-row.tsx` -
`PiTranscript` and `AiChat` now share one virtualization primitive
(`content-visibility`) instead of two ad-hoc render caps. This is the pattern:
extract the genuinely-shared primitive, point both surfaces at it, then retire
the legacy side once pi covers the affordance.

## Migration sequence

Each stage is shippable on its own and leaves the app working. Stop after any
stage without leaving a half-migration.

### Stage 0 - Verification scaffold (prerequisite, do first)

Without this, none of the surface stages can be regression-tested.

- Add a **mock provider** behind the existing BYOK transport: a deterministic
  fake that streams canned assistant turns and tool calls, selectable via an
  env flag the app already threads for tests. No real keys, no network.
- Add e2e specs that drive the chat surface against the mock: send a prompt ->
  assistant streams -> a tool call requests approval -> approve -> run
  completes. Mirror for pi sessions.
- This makes the surface a tested surface, which is the precondition for
  changing it.

### Stage 1 - One run-status contract (Layer 2, no surface change)

- Define a single `AgentRun` view-model (status, meta, usage, tool calls,
  cancellation) that both `chatStore` and pi sessions can produce.
- Have `chatStore` and the pi session store both expose it. Repoint the shared
  consumers (workflow, model-compare, source-control, agents) at the new
  contract. No UI changes; verified by their existing unit tests plus Stage 0.

### Stage 2 - Pi runtime backs the quick-ask composer (Layer 2/3 seam)

- Make the docked composer (`AppComposerDock` -> `AiInputBar`) able to create a
  lightweight pi session instead of an AI-SDK chat, behind a flag.
- Keep `AiInputBar`'s look; swap the runtime. Verify with Stage 0 specs on both
  paths, flip the flag default once green.

### Stage 3 - Retire duplicate surface pieces

- Replace `AiMiniWindow` usage with `PiFloatingWindow` (already exists).
- Fold `PlanDiffReview` and `TodoStrip` into the pi transcript as turn
  affordances; migrate `planStore`/`todoStore` into the pi session store.
- Replace `AiChat`/`AiChatMessage` mounts with `PiTranscript`. Delete the
  legacy components only after their last importer is repointed.

### Stage 4 - Runtime collapse and rename

- Once no surface uses the AI-SDK loop for sessions, reduce Layer 2 to the
  pieces workflow/model-compare still need (one-shot generations), and move
  Layer 1 + the residual runtime under `modules/ai-runtime/`. Drop the empty
  `ai/` surface directory.

## Verification strategy

- Layers 1-2 changes: existing unit tests + the Stage 0 mock-provider e2e.
- Layer 3 changes: Stage 0 e2e on both old and new surface during the flag
  window; visual parity is a manual check on Linux/Windows (where e2e runs).
- Never delete a legacy component in the same commit that repoints its last
  importer; land the repoint, confirm green, then delete in a follow-up so each
  step is revertible.

## What is explicitly NOT in scope

- Re-homing Layer 1 names is cosmetic and deferred to Stage 4 or skipped.
- The Rust native tool boundary is already the SOTA target and does not change.
- `PiControllerProvider` -> zustand stays dropped (see the 2026-06-11 progress
  log entry: it does not cause wide re-renders).
