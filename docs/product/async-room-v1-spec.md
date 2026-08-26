# Ranked Cloud Room v1 Prototype (Archived)

**Status:** Frozen on 2026-08-26; future ranked-mode reference only
**Date:** 2026-08-24  
**Owner:** AgenticGame

## 1. Product goal

> This specification is no longer the active multiplayer direction. Friend Room now uses the P2P,
> host-authoritative contract in [friend-room-p2p-v1-spec.md](friend-room-p2p-v1-spec.md). The code and
> tests described below are preserved for a future ranked mode and must not be extended as Friend Room.

Two players can enter the same room, choose one of their own immutable SavedBuild revisions, lock it,
and let the authoritative server run a deterministic Gameplay v2 match. Players never exchange Bot
files or use a file picker as part of the room flow.

The client may transmit a verified SavedBuild snapshot to the room service in the background. This is
an application-level Build sync operation, not a user-managed file upload. The room UI only exposes
Build names, revisions, vehicles, loadouts, readiness, match progress, and results.

## 2. v1 scope

- Exactly two seats: host and challenger.
- Ephemeral room code and per-seat bearer token; no account system in this slice.
- One verified SavedBuildV2 snapshot per seat. Selecting a different Build clears that seat's ready state.
- Fixed authoritative content/map snapshots on the server. The host may choose the supported mode,
  while seed and safety budgets remain server controlled.
- Both ready states atomically transition the room to `running`; only one match can start.
- The server runs both embedded Bot sources through the existing worker sandbox and produces one verified
  MatchBundleV2. Clients receive only player-facing room/result projections, never the opponent's source.
- Room state is in memory for v1. Restart recovery, accounts, matchmaking, spectators, chat, and seasons are
  explicitly deferred.

## 3. State machine

```text
waiting-for-opponent
  -> configuring
  -> running
  -> complete
             \-> failed
```

- `waiting-for-opponent`: host exists; challenger seat is empty.
- `configuring`: both seats exist; each may select a Build and toggle ready.
- `running`: both Build snapshots are frozen and the match promise owns the room transition.
- `complete`: verified bundle metadata and result projection are available to both seats.
- `failed`: a bounded public error is shown; raw worker/source details stay server side.

Terminal rooms cannot be reconfigured. Rematch creates a new room in a later slice.

## 4. Authorization and privacy

- Room codes are discovery identifiers, not authorization credentials.
- Every mutating or private read operation requires the seat token returned by create/join.
- Tokens are never returned by room snapshots, logs, replay projections, or the opponent view.
- A seat can only select its own Build and change its own ready state.
- Build validation fails closed before storage. The public projection excludes source, code hash, full
  fingerprints, entry point, and parent fingerprint.
- Request bodies, display names, room counts, and room lifetimes are bounded before public deployment.

## 5. Service contract

The domain service exposes behaviors equivalent to:

- `createRoom(displayName)` -> room code, host token, public snapshot;
- `joinRoom(roomCode, displayName)` -> challenger token and snapshot;
- `selectBuild(roomCode, token, SavedBuildV2)` -> updated snapshot;
- `setReady(roomCode, token, ready)` -> updated snapshot; the second ready starts the match;
- `getRoom(roomCode, token)` -> player-facing snapshot;
- `waitForMatch(roomCode, token)` -> completion snapshot for tests and non-streaming callers.

HTTP maps these behaviors under `/api/rooms`. The UI initially polls the room projection; SSE can replace
polling without changing the domain state machine.

## 6. Acceptance criteria

- Two different participants can create and join one room without exchanging files.
- Invalid room codes, invalid tokens, a third join, and cross-seat actions fail.
- Tampered SavedBuild records never enter a room.
- Changing a selected Build clears readiness.
- Two concurrent final-ready attempts start exactly one match.
- Match execution uses the two frozen SavedBuild sources/loadouts and returns a verified MatchBundleV2.
- Opponent source and bearer tokens are absent from every public snapshot.
- Existing single-player API, CLI, Gameplay v2, practice, and replay behavior remains compatible.

## 7. Ardot design source

- File: `cocraft://localhost/file/718070578872647`.
- Page: `04 异步竞技房间` (`3:512`).
- Create/join entry: `3:514`.
- Two-seat Build selection and readiness: `3:566`.
- Shared match result: `3:626`.
- Waiting, invalid-code, running, and failure states: `3:682`.

All four design groups passed Ardot layout inspection and screenshot review on 2026-08-24. Reported
large-empty-area warnings are intentional navigation/card breathing space; there are no clipped or
out-of-bounds controls.

## 8. Current implementation boundary

`AsyncRoomServiceV1` and the `/api/rooms` HTTP contract are implemented and covered by domain and real
HTTP integration tests. The browser-side SavedBuild store/sync, public deployment entry point, room expiry,
rate limiting, and process-level public sandbox remain required before this becomes a production Internet
feature.
