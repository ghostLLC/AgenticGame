# Public Beta Slice 6 implementation plan

## Goal

Finish the player-facing release surface and produce reproducible Windows Beta B artifacts without adding a project-owned server or reopening ranked mode.

## Work order

1. Add a strict, atomic `AppSettingsV1` repository for volume, motion, nearby-friend preference, default friend mode, and non-sensitive recent provider metadata. Corrupt settings are quarantined and reset only through an explicit safe fallback.
2. Add a fixed settings service/API/IPC surface for settings, the seven release checks, a content-previewed redacted diagnostic export, a system directory-picker-driven legacy import, and the GitHub Releases link.
3. Import bounded legacy `my-bots/*.js` files as new immutable commander revisions and convert validated Replay v1 files into privacy-safe public replay records. Skip invalid or oversized files and return only player-safe counts.
4. Add the normal-game settings page and programmatic Web Audio baseline for button, ready, battle start, hit, destruction, victory, defeat, and disconnect cues. Respect master/effects volume and reduced motion.
5. Add unsigned per-user NSIS packaging that preserves player data on uninstall, release notes, a two-real-device acceptance script/checklist, and automated package-policy checks.
6. Run tests, typecheck, production audit, build, Playwright at 1100x700 and 1440x900, folder EXE smoke, NSIS/ZIP artifact verification, and Git/Feishu read-back against one stable implementation key.

## Honest completion boundary

The code and artifacts can be completed on this workstation. A second real Windows device and a real remote NAT path are external acceptance environments; the final report must mark those steps pending until the user runs the supplied script/checklist, and must not infer them from browser tabs or loopback tests.

## Completion evidence

- Settings, diagnostics, legacy import, audio feedback, fixed IPC and player UI are implemented with contract/controller/integration coverage.
- 244 automated tests, typecheck, production audit, general build and desktop build pass.
- Playwright covered save, seven diagnostics, redacted export, legacy import and friend-mode preference at 1440×900 and 1100×700 with no horizontal overflow and 0 console warnings/errors.
- Folder EXE stayed responsive; unsigned per-user NSIS and portable ZIP were generated and hashed.
- Stable implementation key `ba189c1` was pushed to `origin/main`, then written once to each UX, technical, development-log and quality-gate Feishu document and verified by read-back.
- Real two-device LAN/remote/recovery and a clean-user NSIS installation remain explicit final acceptance steps.
