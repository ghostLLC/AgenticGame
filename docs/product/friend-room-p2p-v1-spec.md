# Friend Room P2P v1 Specification

**Status:** Active implementation
**Date:** 2026-08-26
**Owner:** AgenticGame

## 1. Product decision

The near-term two-player mode is **Friend Room**, not ranked matchmaking. Two trusted friends are online at
the same time, establish a peer connection, select SavedBuild revisions, ready up, and let the host device
run one authoritative Gameplay v2 match.

The user does not choose files or perform an upload. The guest client serializes and transfers its verified
`SavedBuildV2` through the established peer channel automatically. This is still network data transfer, but
it is hidden inside the room flow instead of exposed as file handling.

The previous server-authoritative room prototype is frozen for a future ranked mode. It is not a dependency
of Friend Room.

## 2. Authority and trust boundary

- The host device is the sole match authority in v1 and starts at most one match after both players are ready.
- The host receives the guest's complete Build, including Bot source, because it must execute both Bots.
- Public room snapshots sent to either UI contain only Build name, revision, timestamp, and loadout.
- The guest receives a result projection and bundle hash, not the host's full MatchBundle or source.
- Friend Room is therefore suitable for trusted friends and practice, not prizes, rankings, or adversarial play.
- A dishonest or modified host can falsify a result. Preventing that requires the future cloud-authoritative
  ranked path or a trusted execution environment.

## 3. P2P and signaling

The match and Build data path does not require a game server. Establishing an Internet WebRTC connection may
still use either:

1. manual offer/answer exchange, which is now implemented and needs no service but has higher interaction cost; or
2. a lightweight signaling rendezvous, which only helps the two peers find each other and does not receive,
   execute, or store Builds and matches.

A short six-character room code cannot work globally without some rendezvous directory. The transport layer
is kept behind `FriendRoomPeerV1` so manual signaling, LAN discovery, or a small signaling relay can be chosen
without changing room or match logic.

STUN helps a peer learn its public-facing address; TURN relays encrypted WebRTC traffic only when a direct
path cannot be established. Neither service is the match authority. A strictly service-free profile is also
available, but is expected to work mainly on LANs or networks where peers are directly reachable.

## 4. Implemented vertical slice

- `FriendRoomHostSessionV1`: host-authoritative state machine and real `runPracticeMatchV2` execution.
- `FriendRoomGuestSessionV1`: hello, automatic Build transfer, ready control, snapshots, and bounded errors.
- `FriendDataChannelPeerV1`: structural RTCDataChannel adapter with 16 KiB default frames, Unicode-safe
  reassembly, a 1 MiB default message ceiling, and non-text/invalid-frame rejection.
- `webrtc-handshake-v1.ts`: structural RTCPeerConnection offer/answer lifecycle, URL-safe `AGFR1` invite and
  answer codes, full ICE-gathering wait, timeout, direction validation, and session binding.
- `browser-connection-v1.ts`: real browser `RTCPeerConnection` construction, validated direct/STUN/TURN ICE
  profiles, role-safe offer/answer orchestration, and observable gathering/waiting/connected/disconnected/
  failed states driven by the actual DataChannel lifecycle.
- Verified SavedBuild ingestion on both guest and host; a Build change clears that seat's readiness.
- Player-facing snapshots omit source, code hash, record fingerprints, and transport internals.
- Verified MatchBundle generation on the host with a shared result projection and bundle hash.

## 5. State machine

```text
waiting-for-peer
  -> configuring
  -> running
  -> complete
             \-> failed
```

The host owns every state transition. Guest messages are requests, never authoritative state updates.

## 6. Protocol directions

Guest to host:

- `hello(displayName)`
- `select-build(SavedBuildV2)`
- `set-ready(boolean)`

Host to guest:

- `snapshot(FriendRoomSnapshotV1)`
- `error(code, message)`

Messages use the `agentic-game-friend-room` v1 envelope. Host-only messages arriving from the guest side are
rejected and do not mutate room state.

## 7. Acceptance status

- [x] Two live peers can exchange protocol messages without a central match service.
- [x] Build selection is automatic and does not expose a file picker.
- [x] Tampered Builds are rejected before entering authoritative state.
- [x] Changing a Build clears readiness.
- [x] Both ready states start exactly one real Gameplay v2 match on the host.
- [x] Both peers converge on the same public result snapshot.
- [x] Large Unicode messages are framed and reassembled across a DataChannel-like transport.
- [x] Transport-neutral WebRTC offer/answer lifecycle and no-service manual invite codes.
- [x] Browser RTCPeerConnection wiring and validated direct/STUN/TURN configuration boundary.
- [ ] Desktop shell wiring, QR exchange, and deployment-owned production STUN/TURN credentials.
- [ ] Reconnect, host-leave handling, rematch, and room expiry.
- [ ] Player UI wired to the Ardot Friend Room flow.
- [ ] Optional signaling rendezvous for short invite codes.

## 8. Ardot design source

- File: `cocraft://localhost/file/718070578872647`.
- Page: `04 好友房间` (`3:512`).
- Entry, host/guest manual signaling, connected lobby, result, and failure states now use the P2P terminology.
- The canvas states host-device authority, trusted-friend source disclosure, sanitized guest results, and the
  explicit offer/answer exchange instead of promising a server-backed six-character code.

## 9. Ranked archive

`src/online/async-room-service-v1.ts` and `src/online/async-room-http-v1.ts` are retained as a frozen future
ranked/cloud prototype. Their tests remain active to prevent silent decay, but they must not be wired into
the Friend Room product path.
