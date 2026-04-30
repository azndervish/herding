# Herding28 — Project Context for Claude Code

## What this is

A mobile-first React web app implementation of **Herding28**, a solo non-combat tabletop miniatures game. The player guides a herding dog to move a flock toward a pen across a 24"×24" board, working against random animal wandering each turn.

## File structure

```
App.js           — The entire app: game engine, React components, scenarios, map selector
appEngine.js     — Auto-generated shim that re-exports the engine from App.js for testing
appEngine.test.js — Unit tests for the engine (node:test, Node ≥ 18)
```

> **Important:** `appEngine.js` is generated — do not edit it directly. Regenerate it whenever the engine in `App.js` changes (see Testing section below).

## App.js internal structure

The file is divided by comment banners in this order:

1. **ENGINE (inlined)** — pure JS game logic, no React. Contains all game rules.
2. **SCENARIOS** — scenario data objects and the `SCENARIOS` registry array.
3. **BOARD SVG** — pure React SVG rendering components (no game logic).
4. **MAP SELECTOR** — `MapSelector` screen component.
5. **APP** — animation helpers (`lerp`, `snapshotPos`) and the `App()` root component.

The engine and the React layer are intentionally kept separate within the same file. The engine section has no React imports and can be extracted as plain JS for testing.

---

## Game engine

### Coordinate system

- Board is **24" × 24"** (inches), origin top-left.
- All positions are in **game-inches** (not pixels). SVG rendering converts via `toPx(inches)`.
- Most entities are circles: `{ id, type, x, y, radius }`.
- Pen is a rectangle: `{ id, type, x, y, w, h }` where (x, y) is the center.

### Entity types

| Type | Shape | Size | Notes |
|---|---|---|---|
| `dog` | circle | `TOKEN_RADIUS = 0.75` | Player-controlled |
| `herd` | circle | `HERD_RADIUS = 2.5` | 5" diameter template |
| `loose` | circle | `TOKEN_RADIUS = 0.75` | Escaped animals |
| `pen` | rectangle | defined per scenario | Goal zone |

### Game state shape

```js
{
  boardSize: 24,
  turn: number,
  phase: 'dumb_animals' | 'come_by' | 'loose_animal' | 'move_herd' | 'finished',
  dog:          { id, type, x, y, radius },
  herd:         { id, type, x, y, radius },
  looseAnimals: [{ id, type, x, y, radius }, ...],
  pen:          { id, type, x, y, w, h },
  escapedCount: number,
  events:       string[],   // log messages, newest appended last
  rng:          () => number, // injectable — Math.random in production
  terrain:      [{ id, type, x, y, w, h }, ...],  // see Terrain section
}
```

### Turn phases (in order)

1. **`dumb_animals`** — Each animal (herd + loose) moves D6" in a random direction, furthest from dog first. Herd is clamped to board edge on contact (counts as escape). Loose animals that touch the board edge are removed (escaped).
2. **`come_by`** — Player moves the dog up to 12". Dog cannot pass through herd or loose animals. Accepts `null` action (dog holds position).
3. **`loose_animal`** — If dog is within 8" of herd, roll D8. If roll ≥ distance, a loose animal spawns D6" from herd in a random direction.
4. **`move_herd`** — Each animal is pushed directly away from the dog until ≥10" gap, furthest first. Animals stop at board edges, other entities, or impassable terrain.

### `processTurn(state, action, targetPhase?)`

The main orchestrator. Runs phases sequentially until `targetPhase` is reached (without running it).

- **No `targetPhase`**: runs a full cycle, stopping just before the same phase repeats next turn.
- **`targetPhase` provided**: runs until that phase is next to execute.
- **Already at `targetPhase`**: advances past it and stops at that phase next turn.

**Primary usage pattern in the app:**

```js
// Bootstrap: run dumb_animals, stop at come_by
const ready = processTurn(initial, null, 'come_by');

// After player acts: run come_by through move_herd + next dumb_animals, stop at come_by again
const next = processTurn(gameState, { type: 'move_dog', x, y }, 'come_by');
```

**Player actions:**

```js
{ type: 'move_dog', x: number, y: number }  // must be ≤ 12" from dog
{ type: 'end_turn' }                          // dog holds position
null                                           // treated identically to end_turn
```

### Key constants

```js
HERD_RADIUS    = 2.5   // herd template radius in inches
TOKEN_RADIUS   = 0.75  // dog / loose animal token radius
DOG_MOVE_MAX   = 12    // max dog movement per turn in inches
DOG_SPOOK_RANGE = 8   // distance within which dog can spook herd
HERD_CLEARANCE = 10   // target gap between any animal and the dog after move_herd
```

---

## React app architecture

### Screens

- `screen === 'select'` → renders `<MapSelector>` (full-screen, no game state)
- `screen === 'game'`   → renders the game board layout

`startScenario(sc)` initialises state and switches to `'game'`.  
`goToSelect()` tears down game state and switches back to `'select'`.

### Animation system

After each player action, entity positions animate in two sequences of 500ms stages:

**First sequence (move_herd phase):**
1. **Dog** moves to new position
2. **Loose animals** flee (pushed by dog, or newly spooked) — skipped if none
3. **Herd** is pushed back by dog

**Second sequence (dumb_animals phase):**
4. **Loose animals** wander randomly — skipped if none
5. **Herd** wanders randomly

Each stage is 500ms and is skipped if there's no movement. The animation uses `processTurn` twice: first to capture state after move_herd (before dumb_animals), then to get the final state (after dumb_animals).

**Key state:**

- `displayPos` — `{ dog: {x,y}, herd: {x,y}, looseAnimals: [{id,x,y,radius}] }` — what's actually rendered. Updated at 60fps by the rAF loop during animation.
- `gameState` — the authoritative engine state. Only updated when animation completes. UI chrome (phase badge, events, stats) reads from here, so it stays frozen during playback.
- `animRef` — plain mutable ref holding animation bookkeeping: `phase` (`'dog' | 'loose' | 'herd' | 'dumb_loose' | 'dumb_herd' | 'idle'`), `startMs`, `from/to` positions for both sequences (`looseFrames[]`, `looseFrames2[]`, etc.), `midState` (after move_herd), `finalState` (after dumb_animals), `raf` handle.

Board taps are blocked while `animRef.current.phase !== 'idle'`.

### Player input

- Tap within the 12" range ring → updates `preview` `{x, y}` (ghost dog shown)
- Tap again anywhere valid → moves the preview (retap is allowed without cancelling)
- **Send Dog** confirms and calls `commitMove({ type: 'move_dog', x, y })`
- **Skip** calls `commitMove({ type: 'end_turn' })`
- Out-of-range tap → 600ms red flash, no preview set

### Board rendering

The SVG uses a 480×480 coordinate space. `toPx(inches)` converts game-inches to SVG pixels: `(inches / 24) * 480`.

Rendering layer order (bottom to top): terrain → pen → spook ring → dog range ring → move preview → herd → loose animals → dog → overlays.

---

## Scenarios

Scenarios are defined as plain objects and registered in the `SCENARIOS` array:

```js
const SCENARIOS = [
  { id: 'walk_up', name: 'Walk Up', state: WALK_UP },
];
```

Each scenario `state` object follows the full game state shape (minus `rng`, which is injected as `Math.random` at runtime).

**Current scenarios:** Walk Up — dog starts bottom-left, herd near centre-left, large pen on the right.

---

## Testing

Tests use Node's built-in `node:test` runner, no dependencies.

```bash
# Run engine tests
node --experimental-vm-modules appEngine.test.js

# Run terrain tests (requires terrain code in App.jsx)
node --experimental-vm-modules terrain.test.js
```

### Regenerating `appEngine.js`

The shim is generated by extracting the `// ENGINE (inlined)` and `// SCENARIOS` blocks from `App.js`. Run this after any engine changes:

```js
// Paste into a Node --input-type=module session, or save as a script
import { readFileSync, writeFileSync } from 'fs';
const content = readFileSync('App.js', 'utf8');
const start   = content.indexOf('// ENGINE (inlined)');
const engEnd  = content.indexOf('// SCENARIO');
const scenEnd = content.indexOf('// BOARD SVG');
const engine  = content.slice(start, engEnd).split('\n')
  .filter(l => !l.trim().startsWith('// ─') && l.trim() !== '// ENGINE (inlined)')
  .join('\n');
const scenario = content.slice(engEnd, scenEnd).split('\n')
  .filter(l => !l.trim().startsWith('// ─') && l.trim() !== '// SCENARIOS')
  .join('\n');
writeFileSync('appEngine.js', `// appEngine.js — auto-generated from App.js\n\n${engine}\n\n${scenario}\n\nexport {\n  HERD_RADIUS, TOKEN_RADIUS, DOG_MOVE_MAX, DOG_SPOOK_RANGE, HERD_CLEARANCE,\n  dist, unitVector, touchesEdge, entitiesContact, circleRectContact, rollDie, angleToOffset, cloneState,\n  phaseDumbAnimals, phaseComeBy, phaseLooseAnimal, phaseMoveHerd,\n  processTurn, WALK_UP, SCENARIOS,\n};\n`);
```

### Test helpers

```js
const fixedRng = (v) => () => v;           // always returns v
function seqRng(...vals) {                  // cycles through values
  let i = 0; return () => vals[i++ % vals.length];
}
```

`fixedRng(0.5)` → D6 roll = 4 (floor(0.5×6)+1), D8 roll = 5, angle = 180°.  
`fixedRng(0.9999)` → D6 roll = 6, D8 roll = 8.  
`fixedRng(0)` → D6 roll = 1, D8 roll = 1, angle = 0°.

---

## Known design notes

- The engine has no clamping on herd position during `dumb_animals` **except** at board edges (added fix: herd that wanders to a board edge is clamped and counts as +1 escape).
- `escapedCount` and `turn` are initialised defensively with `|| 0` / `|| 1` in case state arrives without those fields.
- `cloneState` performs a shallow clone of most fields but deep-clones `looseAnimals`, `events`, and `terrain` arrays.
- The `rng` function is not cloned — it's shared by reference across cloned states, which is intentional (a single RNG stream per game).