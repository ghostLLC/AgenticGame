# Gameplay v2 Vertical Slice Specification

**Status:** Approved for implementation  
**Date:** 2026-08-24  
**Owner:** AgenticGame

## 1. Goal

Turn the existing v2 data contracts into a real deterministic duel that proves the first layer of richer gameplay: three meaningfully different vehicles, fog of war, terrain effects, directional armor, finite ammunition, weapon range/reload, and acceleration-based mobility. The result must run untrusted Bots through the existing worker sandbox and emit a verified self-contained `MatchBundleV2`.

## 2. Compatibility boundary

- The v1 engine, `runMatch`, Bot API, CLI, Replay v1, browser console, and viewer remain source-compatible.
- Gameplay v2 is a parallel engine and runner exposed as `GameplayEngineV2` and `runMatchV2`.
- The vertical slice supports exactly two teams with one vehicle and one weapon per team. The persisted contracts remain array-based so later multi-vehicle modes do not require a replay-envelope rewrite.
- No user-interface code changes in this phase. A UI entry point remains gated by an accepted Ardot design.

## 3. Official v2 content

### Vehicles

| Vehicle | HP | Armor F/S/R | Max speed | Accel / decel | Body / turret turn | Vision |
|---|---:|---:|---:|---:|---:|---:|
| `scout` | 80 | 15 / 8 / 4 | 1000‰ | 500 / 750‰ | 1 / 1 tick | 10 |
| `medium` | 110 | 30 / 18 / 10 | 800‰ | 400 / 600‰ | 1 / 1 tick | 8 |
| `heavy` | 150 | 55 / 32 / 18 | 600‰ | 250 / 400‰ | 2 / 2 ticks | 7 |

### Weapons

| Weapon | Damage | Penetration | Range | Reload | Projectile speed | Ammo |
|---|---:|---:|---:|---:|---:|---:|
| `light-cannon` | 24 | 18 | 9 | 3 | 2 | 18 |
| `medium-cannon` | 34 | 26 | 10 | 4 | 2 | 14 |
| `heavy-cannon` | 48 | 40 | 11 | 6 | 2 | 10 |

Each vehicle is compatible with its role weapon. Equipment remains an empty versioned slot in this slice.

## 4. Terrain and map

The `frontier-v2` map is a complete immutable cell snapshot with symmetric spawns and four terrain definitions:

- `open-ground`: movement cost 1000‰, visibility 1000‰, blocks nothing.
- `forest`: movement cost 1100‰, visibility 700‰, blocks nothing; a target in forest is harder to detect.
- `mud`: movement cost 1600‰, visibility 1000‰, blocks nothing.
- `wall`: blocks movement, vision, and projectiles.

Terrain overlap is resolved by paint order `open → forest → mud → wall`, so walls always retain blocking semantics.

## 5. Deterministic tick order

1. Decrease reload and turn cooldowns.
2. Apply body and turret turns whose cooldown is zero; successful turns reset the relevant vehicle cadence.
3. Update signed velocity from throttle using acceleration, deceleration, and the vehicle maximum.
4. Add absolute velocity to movement progress. A vehicle attempts at most one cell per tick when progress meets the destination terrain movement cost; blocked movement resets progress.
5. Advance projectiles by integer substeps. Wall/edge and range expiry remove a projectile.
6. On hit, classify the impact zone from projectile travel direction versus victim body direction, apply armor, emit the full damage explanation, and remove the projectile.
7. Fire after movement when reload is zero and ammunition is positive. Firing consumes one round and creates a projectile that moves next tick. Empty-ammo attempts emit `dry-fire`.
8. Resolve deaths, increment the tick, and at `maxTicks` compare remaining HP.

For a projectile, source direction is `(travelDirection + 4) mod 8`. Relative source directions within 45° of the body front are `front`, exactly 90° is `side`, and directions within 45° of the rear are `rear`.

Damage is:

```text
max(1, weapon.damage - max(0, armor[impactZone] - weapon.penetration))
```

## 6. Fog of war and Bot API

`BattleViewV2` exposes the full friendly tank and only currently visible enemy/projectile records. A target is visible when:

```text
chebyshevDistance * 1000 <= observerVisionRange * targetTerrain.visibilityModifierPermille
```

and no intermediate cell has `blocksVision=true`. The observer always sees itself. Projectiles use open-ground visibility (1000‰) and the same line-of-sight rule.

The init context contains schema version, team ID, field dimensions, immutable terrain cells, the selected vehicle and weapon definitions, rules, and deterministic `rng()`. The action remains `{ throttle, bodyTurn, turretTurn, fire }`, allowing simple v1 strategies to be adapted without inventing a second control vocabulary.

## 7. MatchBundleV2 evidence

`runMatchV2` must persist:

- the exact validated MatchConfigV2, map snapshot, content snapshot, and full Bot sources;
- both validated/applied actions for each processed tick, including idle fallbacks;
- every engine/violation event, filtered logs, and a full state checkpoint after each processed tick;
- the machine-readable winner/reason/tick count and all integrity hashes.

An untouched result must pass `verifyMatchBundleV2`. Same timestamp, seed, config, content, map, and Bot sources must produce deeply equal bundles.

## 8. Acceptance criteria

- Scout and heavy movement differ under identical throttle because acceleration and maximum speed are active rules.
- Mud measurably delays movement compared with open ground.
- Open targets can be seen at a range where forest targets cannot; walls break line of sight.
- Front, side, and rear hits against the same target produce the specified distinct damage.
- Reload prevents early refire, ammunition reaches zero, dry fire is observable, and projectiles expire at weapon range.
- Heavy body/turret rotation cadence is slower than scout cadence.
- A real sandboxed v2 match emits a verified deterministic MatchBundleV2 whose checkpoints include mobility, ammo, visibility-independent authoritative state, and result.
- Existing 55 tests remain green; new tests, typecheck, build, and `git diff --check` pass.

