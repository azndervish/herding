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
- Pen is a rectangle with walls: `{ id, type, x, y, w, h, openSide }` where (x, y) is the center and `openSide` specifies which side is open ('left', 'right', 'top', or 'bottom').

### Entity types

| Type | Shape | Size | Notes |
|---|---|---|---|
| `dog` | circle | `TOKEN_RADIUS = 0.75` | Player-controlled |
| `herd` | circle | `HERD_RADIUS = 2.5` | 5" diameter template |
| `loose` | circle | `TOKEN_RADIUS = 0.75` | Escaped animals |
| `pen` | rectangle with 3 walls | defined per scenario | Goal zone with solid walls on 3 sides; victory when herd center is inside |

### Game state shape

```js
{
  boardSize: 24,
  turn: number,
  phase: 'dumb_animals' | 'come_by' | 'loose_animal' | 'move_herd' | 'finished',
  dog:          { id, type, x, y, radius },
  herd:         { id, type, x, y, radius },
  looseAnimals: [{ id, type, x, y, radius }, ...],
  pen:          { id, type, x, y, w, h, openSide },
  escapedCount: number,
  events:       string[],   // log messages, newest appended last
  rng:          () => number, // injectable — Math.random in production
  terrain:      [{ id, type, x, y, w, h }, ...],  // see Terrain section (types: 'impassable', 'labouring', 'antithetical')
}
```

### Turn phases (in order)

1. **`dumb_animals`** — Each animal (herd + loose) moves D6" in a random direction, furthest from dog first. All entities stop at pen walls, impassable terrain, and when contacting the dog or other loose animals. Loose animals CAN move into contact with the herd (for rejoining). Herd is clamped to board edge on contact (counts as escape). Loose animals that touch the board edge are removed (escaped).
2. **`come_by`** — Player moves the dog up to 12". Dog cannot pass through herd, loose animals, pen walls, or impassable terrain. Accepts `null` action (dog holds position).
3. **`loose_animal`** — If dog is within 8" of herd, roll D8. If roll ≥ distance, a loose animal spawns D6" from herd in a random direction.
4. **`move_herd`** — Each animal is pushed directly away from the dog until ≥10" gap, furthest first. Animals stop at board edges, pen walls, impassable terrain, or when contacting other entities. **Victory condition:** Game transitions to `finished` phase if the herd's center point (x, y) is inside the pen rectangle.

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

### Collision resolution

`resolveMovement(animal, targetX, targetY, state, escapedIds, checkEntityCollisions)` is a shared helper that handles all collision detection and resolution:

- Checks pen wall collisions using ray-casting with `raySegmentIntersect`
- Checks impassable terrain collisions using ray-casting
- Optionally checks entity-to-entity collisions (when `checkEntityCollisions=true`)
- For loose animals: allows movement into contact with herd (for rejoining), but blocks contact with dog and other loose animals
- For herd: blocks contact with all entities (dog and loose animals)
- Returns `{ x, y, blocked, obstacle }` with final position and collision information

Used by both `phaseDumbAnimals` and `phaseMoveHerd` to ensure consistent collision behavior.

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
2. **Loose animals** flee (pushed by dog, newly spooked, or rejoining) — skipped if none
   - Animals that rejoined during move_herd animate moving to herd center with green tint, then disappear
3. **Herd** is pushed back by dog

**Second sequence (dumb_animals phase):**
4. **Loose animals** wander randomly (or rejoin) — skipped if none
   - Animals that rejoined during dumb_animals animate moving to herd center with green tint, then disappear
5. **Herd** wanders randomly

Each stage is 500ms and is skipped if there's no movement. The animation uses `processTurn` twice: first to capture state after move_herd (before dumb_animals), then to get the final state (after dumb_animals).

**Rejoining animation:** When a loose animal rejoins the herd, it:
- Appears in the animation with a green stroke/fill (vs. normal yellow)
- Animates smoothly from its last position to the herd center
- Disappears after reaching the herd (filtered out when animation stage completes)
- Detection: checks game state events for "{animal.id}" + "rejoined" messages

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

**Current scenarios:**
- **Walk Up** — dog starts bottom-left, herd near centre-left, pen (8"×6") on the right with solid walls on top/right/bottom and open on the left side for entry.
- **Rotten Bridge** — pen in top right corner (opens bottom), two impassable river sections create an 8" gap in the middle for crossing.
- **Dead Mount** — pen in top right corner (opens bottom), entire right half of the board is labouring terrain. Herd starts 10" from left edge, 2" from bottom.
- **Bog's Edge** — pen near bottom center (opens right), 8" wide murky water (antithetical terrain) runs along right side from x=16 to x=24. Herd starts 10" from left, 8" from top.

### Terrain

Terrain rectangles modify gameplay based on their type:

**Impassable terrain** (`type: 'impassable'`):
- Blocks all entity movement (dog, herd, loose animals)
- Ray-casting collision detection using `raySegmentIntersect`
- Entities stop ~0.01" before contact
- Rendered as blue water with ripples

**Labouring terrain** (`type: 'labouring'`):
- If an entity's center point is in labouring terrain during `dumb_animals` or `move_herd` phases, its movement distance is halved (rounded up)
- Example: D6 roll of 5 → moves ceil(5/2) = 3"
- Example: Push distance of 7" → moves ceil(7/2) = 4"
- Does not block movement, only slows it
- Rendered as brownish mud with diagonal texture lines
- Checked via `isInLabouringTerrain(x, y, terrain)`

**Antithetical terrain** (`type: 'antithetical'`):
- If an entity's center point is in antithetical terrain during `move_herd` phase AND is within 10" of the dog, it is pulled TOWARD the dog instead of pushed away
- Pull distance = 10" - current distance from dog
- Example: Herd at 8" from dog → normally pushed 2" away, but antithetical pulls 2" toward dog instead
- Entity stops if it would contact the dog (uses `resolveMovement` for collision detection)
- Only applies during `move_herd` phase (not `dumb_animals`)
- Only applies if within 10" clearance range
- Rendered as dark green/teal murky water with swirling circles
- Checked via `isInAntitheticalTerrain(x, y, terrain)`

### Pen Wall Collision

Pen walls are impassable barriers that block all entity movement:
- Walls are defined by the `openSide` property ('left', 'right', 'top', 'bottom')
- Three sides have solid walls; one side is open for entry
- `raySegmentIntersect` uses fine-grained sampling (10 samples per inch) with binary search refinement for <0.01" precision
- Entities stop with ~0.01" buffer before touching walls
- Visual circles have 2px stroke width, adding ~0.05" visual overhang beyond collision radius

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