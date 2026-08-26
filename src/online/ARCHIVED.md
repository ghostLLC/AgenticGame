# Ranked cloud room prototype — frozen

This directory contains the server-authoritative room prototype completed before the product moved its
near-term multiplayer path to trusted-friend P2P rooms.

- It is retained, tested, and buildable so the work can be resumed when ranked infrastructure is viable.
- It has no CLI, player UI, deployment entry point, or dependency from `src/friend-room`.
- Do not extend it for friend-room features.
- Resume only with an explicit ranked-mode decision covering accounts, matchmaking, durable storage,
  abuse controls, public sandbox isolation, observability, and operating cost.

The current multiplayer implementation lives in `src/friend-room`.
