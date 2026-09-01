# Slice 4: Nearby Friends and Safe Room Recovery

> **Goal:** make friend rooms discoverable on a local network, safely resumable after an app restart, explicitly closable by the host, and diagnosable without leaking sensitive room material.

## Product boundaries

- No project-owned signaling server and no TURN credentials.
- LAN discovery exists only while the Nearby Friends screen is active.
- Internet play keeps the existing WebRTC invite/confirmation path and public STUN.
- Recovery is encrypted with Electron `safeStorage`; it is disabled rather than stored in plaintext when encryption is unavailable.
- Recovery never reconnects peers by itself. Both players must be online and establish a new WebRTC connection.
- Ranked code remains archived. Ardot is not used during Beta B.

## Task 1: Strict encrypted recovery capsule

**Files:**
- Create: `src/desktop/friend-room-recovery-store-v1.ts`
- Test: `tests/friend-room-recovery-store-v1.test.ts`

1. Write failing tests for strict schema validation, authenticated encryption boundary, 24-hour expiry, tampering, unavailable encryption, atomic persistence, and clearing.
2. Implement a cipher-injected store and Electron `safeStorage` adapter boundary.
3. Verify the focused tests pass.

## Task 2: Recoverable room runtime and explicit host close

**Files:**
- Modify: `src/friend-room/session-v1.ts`
- Modify: `src/desktop/friend-room-runtime-v1.ts`
- Modify: `src/desktop/friend-room-entry-controller-v1.ts`
- Test: `tests/friend-room-p2p-v1.test.ts`
- Test: `tests/desktop-friend-room-runtime-v1.test.ts`
- Test: `tests/friend-room-entry-controller-v1.test.ts`

1. Write failing tests for host close notification, recovery identity restoration, host/guest recovery capsules, revision/session checks, and guest Build re-send.
2. Add a strict room-closed protocol message and restart hydration that preserves only the necessary local state.
3. Ensure unexpected transport loss remains recoverable while explicit host leave clears recovery.
4. Verify focused tests pass.

## Task 3: Temporary LAN discovery and local signaling

**Files:**
- Create: `src/desktop/lan-discovery-v1.ts`
- Test: `tests/lan-discovery-v1.test.ts`

1. Write failing tests for strict privacy-safe advertisements, nonce/session/protocol validation, expiry, deduplication, confirmation routing, and immediate stop.
2. Implement an injected datagram boundary plus the production UDP broadcast/listener adapter.
3. Add a real localhost loopback test without relying on an external server.
4. Verify focused tests pass.

## Task 4: Safe desktop composition and diagnostics

**Files:**
- Modify: `src/desktop/main.ts`
- Modify: `src/desktop/preload.ts`
- Modify: `src/desktop/desktop-api-v1.ts`
- Modify: `src/desktop/desktop-preload-api-v1.ts`
- Create: `src/desktop/release-diagnostics-service-v1.ts`
- Test: `tests/desktop-application-ipc-v1.test.ts`
- Test: `tests/release-diagnostics-service-v1.test.ts`

1. Write failing tests for fixed-purpose APIs, validation, recovery availability, LAN lifecycle, and redacted diagnostic output.
2. Compose recovery, LAN, and diagnostics in the Electron main process after `app.whenReady`.
3. Expose no paths, keys, source, full invitations, or encrypted capsules to the renderer or diagnostic export.
4. Verify focused tests pass.

## Task 5: Normal-game Nearby Friends and Continue Room UI

**Files:**
- Modify: `src/desktop/renderer.ts`
- Modify: `src/desktop/friend-room-entry-controller-v1.ts`
- Test: `tests/desktop-app-shell-v1.test.ts`
- Test: `tests/desktop-shell-v1.test.ts`

1. Write failing static/controller tests for the Nearby Friends flow, clearer remote invite steps, Continue Friend Room card, actionable NAT/firewall diagnostics, and room-closed state.
2. Implement player-facing game cards and progressive disclosure; keep technical payloads out of normal views.
3. Run Playwright at 1440x900 and 1100x700, capture screenshots, verify keyboard path, no horizontal overflow, and zero console errors.

## Task 6: Slice 4 release gate and synchronization

**Files:**
- Modify: `README.md`
- Modify: `HANDOFF.md`
- Update: Feishu UX, technical, development-log, and quality documents

1. Run all tests, typecheck, audit, build, desktop build, and dirty-diff checks.
2. Build and launch the Windows portable candidate, stop it cleanly, and create the Slice 4 ZIP with size and SHA-256 evidence.
3. Commit and push `main`, then verify local/origin parity.
4. Update Feishu against the stable commit key and read back each document exactly once.
5. Mark this plan complete only after every gate above is green.
