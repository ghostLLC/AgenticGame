# Slice 5: Player-facing Agent Center

> **Goal:** let a player improve an existing Build with an in-app BYOK agent, evaluate the candidate across deterministic battles, cancel safely, and explicitly save a new revision without exposing source code or provider internals in the normal game flow.

## Product boundaries

- API keys remain in main-process memory only for the active run and are never persisted, logged, committed, exported, or returned to the renderer.
- OpenAI-compatible Chat Completions and Anthropic Messages share the provider-neutral Harness contract.
- Custom endpoints require HTTPS, except exact loopback hosts for local models; credentials, query strings, fragments, oversized responses, and unbounded requests are rejected.
- A generated candidate is session-only until the player explicitly saves it. Cancellation never changes the Build repository.
- Quick, standard, and deep evaluation use fixed 3, 5, and 10-seed matrices against the selected verified Build.
- Normal views use player language and hide source, prompts, raw transcripts, tool calls, hashes, seeds, endpoints, and stack traces.
- Ranked remains archived; Ardot remains deferred for Beta B per the current user instruction.

## Task 1: Harden providers and add Anthropic Messages

1. Write failing tests for Anthropic message/tool translation, error/key redaction, endpoint validation, cancellation, timeout, and response-size limits.
2. Add a shared safe provider HTTP boundary and bring the OpenAI-compatible provider under the same limits.
3. Verify both provider suites.

## Task 2: Agent Center session service and multi-battle evaluation

1. Write failing tests for strict run input, current Build loading, candidate extraction, 3/5/10 deterministic evaluation, aggregate player metrics, cancellation, session-only candidates, explicit save, and no-secret projections.
2. Compose the existing Harness and game tools with a candidate capture boundary, then evaluate candidate vs selected Build through the real Gameplay v2 worker sandbox.
3. Save only after explicit confirmation, producing a new immutable commander-main revision and player note.

## Task 3: Fixed IPC and in-memory run lifecycle

1. Write failing tests for fixed agent-center snapshot/run/cancel/save channels and strict inputs.
2. Keep AbortControllers and API keys inside Electron main; expose only player-facing progress/result projections.
3. Verify malformed values and unconfirmed saves are rejected before service execution.

## Task 4: Normal-game Agent Center UI

1. Write failing controller/static tests for Build selection, provider presets, one-run key notice, goal prompt, evaluation depth, running/cancel/error/result/save states, and absence of technical payloads.
2. Add Agent Center to the real app navigation and render player-facing result cards with progressive disclosure.
3. Run Playwright at 1440x900 and 1100x700; verify keyboard use, cancellation/retry/save paths, no horizontal overflow, zero console errors, and no technical leakage.

## Task 5: Slice 5 release gate and synchronization

1. Run all tests, typecheck, audit, build, desktop build, and diff checks.
2. Launch the Windows folder candidate and create the Slice 5 ZIP with size/SHA-256 evidence.
3. Commit and push main; update and read back Feishu UX, technical, development-log, and quality documents against one stable implementation key.
4. Continue directly to Slice 6 without requesting intermediate user acceptance.

## Completion evidence

- OpenAI-compatible and Anthropic Messages share strict endpoint, timeout, cancellation, response-size and redaction boundaries.
- Agent Center candidates remain session-only until explicit save; quick/standard/deep matrices run 3/5/10 deterministic battles against the selected verified Build through the real Gameplay v2 worker path.
- `npm test`: 47 test files, 227 tests passed. Typecheck, production audit (0 vulnerabilities), full build, desktop build and diff checks passed.
- Playwright at 1100x700 and 1440x900 completed standard evaluation, cancellation with partial results, and explicit save; no horizontal overflow and 0 console errors/warnings after the final form fix.
- Windows folder candidate launched with all observed Electron processes responding.
- ZIP: `release/AgenticGame-0.1.0-slice5-win-x64.zip`, 162093279 bytes, SHA-256 `C94BA5355DA12AD5BE2CA9388CD442F548EB63C5518D21D0A347F3FA7018B800`.
- Honest boundary: no real paid-provider API call and no two-real-Windows-device acceptance yet; both remain external acceptance items, not inferred from mocks.
