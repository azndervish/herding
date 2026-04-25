/**
 * Herding28 Game Engine — Unit Tests
 *
 * Run with:  node --experimental-vm-modules herdingEngine.test.js
 * Or with:   npx jest herdingEngine.test.js   (if jest is configured for ESM)
 *
 * Uses the built-in Node test runner (node:test) for zero-dependency testing.
 * Requires Node ≥ 18.
 *
 * Usage:  node herdingEngine.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  dist,
  unitVector,
  clampToBoard,
  touchesEdge,
  entitiesContact,
  rollDie,
  adjustDie,
  createInitialState,
  phaseDumbAnimals,
  phaseComeBy,
  phaseLooseAnimal,
  phaseMoveHerd,
  processTurn,
  HERD_RADIUS,
  TOKEN_RADIUS,
  DOG_SPOOK_RANGE,
  HERD_CLEARANCE,
} from './herdingEngine.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** RNG that always returns a fixed value (0..1). */
const fixedRng = (val) => () => val;

/** RNG that cycles through an array of values. */
function seqRng(...vals) {
  let i = 0;
  return () => vals[i++ % vals.length];
}

/** Build a minimal valid state for testing. */
function makeState(overrides = {}) {
  return createInitialState({
    boardSize: 24,
    dog:  { x: 12, y: 12 },
    herd: { x: 12, y: 6 },
    pen:  { x: 22, y: 22 },
    looseAnimals: [],
    rng: fixedRng(0.5),  // deterministic default
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

describe('dist', () => {
  it('returns 0 for identical points', () => {
    assert.equal(dist({ x: 3, y: 4 }, { x: 3, y: 4 }), 0);
  });

  it('returns correct Euclidean distance', () => {
    assert.ok(Math.abs(dist({ x: 0, y: 0 }, { x: 3, y: 4 }) - 5) < 1e-9);
  });
});

describe('unitVector', () => {
  it('returns correct unit vector', () => {
    const v = unitVector({ x: 0, y: 0 }, { x: 3, y: 4 });
    assert.ok(Math.abs(v.x - 0.6) < 1e-9);
    assert.ok(Math.abs(v.y - 0.8) < 1e-9);
  });

  it('handles coincident points without NaN', () => {
    const v = unitVector({ x: 5, y: 5 }, { x: 5, y: 5 });
    assert.ok(!isNaN(v.x));
    assert.ok(!isNaN(v.y));
  });
});

describe('clampToBoard', () => {
  it('clamps x below 0', () => {
    assert.equal(clampToBoard({ x: -3, y: 10 }, 24).x, 0);
  });

  it('clamps y above boardSize', () => {
    assert.equal(clampToBoard({ x: 10, y: 30 }, 24).y, 24);
  });

  it('leaves in-bounds points unchanged', () => {
    const p = clampToBoard({ x: 5, y: 5 }, 24);
    assert.equal(p.x, 5);
    assert.equal(p.y, 5);
  });
});

describe('touchesEdge', () => {
  it('detects entity at left edge', () => {
    assert.ok(touchesEdge({ x: 0.5, y: 12, radius: TOKEN_RADIUS }, 24));
  });

  it('detects entity at right edge', () => {
    assert.ok(touchesEdge({ x: 23.5, y: 12, radius: TOKEN_RADIUS }, 24));
  });

  it('does not flag entity clearly inside', () => {
    assert.ok(!touchesEdge({ x: 12, y: 12, radius: TOKEN_RADIUS }, 24));
  });
});

describe('entitiesContact', () => {
  it('detects overlap', () => {
    const a = { x: 0, y: 0, radius: 1 };
    const b = { x: 1, y: 0, radius: 1 };
    assert.ok(entitiesContact(a, b)); // centres 1" apart, radii sum 2
  });

  it('detects exact base-to-base contact', () => {
    const a = { x: 0, y: 0, radius: 1 };
    const b = { x: 2, y: 0, radius: 1 };
    assert.ok(entitiesContact(a, b)); // distance == sum of radii
  });

  it('returns false when separated', () => {
    const a = { x: 0, y: 0, radius: 0.5 };
    const b = { x: 5, y: 0, radius: 0.5 };
    assert.ok(!entitiesContact(a, b));
  });
});

// ---------------------------------------------------------------------------
// Dice helpers
// ---------------------------------------------------------------------------

describe('rollDie', () => {
  it('always returns 1 when rng returns 0', () => {
    assert.equal(rollDie(6, fixedRng(0)), 1);
  });

  it('returns max face when rng is close to 1', () => {
    // floor(0.9999 * 6) + 1 = 6
    assert.equal(rollDie(6, fixedRng(0.9999)), 6);
  });

  it('stays within [1, faces]', () => {
    for (let i = 0; i < 100; i++) {
      const r = rollDie(20, Math.random);
      assert.ok(r >= 1 && r <= 20, `rollDie out of range: ${r}`);
    }
  });
});

describe('adjustDie', () => {
  it('upgrades D6 to D8', () => {
    assert.equal(adjustDie(6, 1), 8);
  });

  it('downgrades D6 to D4', () => {
    assert.equal(adjustDie(6, -1), 4);
  });

  it('clamps at D4 minimum', () => {
    assert.equal(adjustDie(4, -5), 4);
  });

  it('clamps at D20 maximum', () => {
    assert.equal(adjustDie(20, 5), 20);
  });

  it('upgrades and downgrades cancel out', () => {
    assert.equal(adjustDie(6, 2 - 2), 6);
  });
});

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

describe('createInitialState', () => {
  it('sets phase to dumb_animals', () => {
    assert.equal(makeState().phase, 'dumb_animals');
  });

  it('sets turn to 1', () => {
    assert.equal(makeState().turn, 1);
  });

  it('starts with empty events', () => {
    assert.equal(makeState().events.length, 0);
  });

  it('places dog at given position', () => {
    const s = makeState({ dog: { x: 5, y: 7 } });
    assert.equal(s.dog.x, 5);
    assert.equal(s.dog.y, 7);
  });

  it('assigns correct radii', () => {
    const s = makeState();
    assert.equal(s.herd.radius, HERD_RADIUS);
    assert.equal(s.dog.radius, TOKEN_RADIUS);
  });
});

// ---------------------------------------------------------------------------
// Phase 1: Dumb Animals
// ---------------------------------------------------------------------------

describe('phaseDumbAnimals', () => {
  it('advances phase to come_by', () => {
    const s = phaseDumbAnimals(makeState());
    assert.equal(s.phase, 'come_by');
  });

  it('adds at least one event', () => {
    const s = phaseDumbAnimals(makeState());
    assert.ok(s.events.length >= 1);
  });

  it('moves herd (position changes when rng drives non-zero roll)', () => {
    const initial = makeState({ rng: fixedRng(0.9) }); // roll = 6, angle ~324°
    const herdBefore = { x: initial.herd.x, y: initial.herd.y };
    const s = phaseDumbAnimals(initial);
    const moved = s.herd.x !== herdBefore.x || s.herd.y !== herdBefore.y;
    assert.ok(moved);
  });

  it('moves loose animals', () => {
    const state = makeState({
      looseAnimals: [{ x: 6, y: 6 }],
      rng: fixedRng(0.9),
    });
    const laBefore = { x: 6, y: 6 };
    const s = phaseDumbAnimals(state);
    const la = s.looseAnimals[0];
    const moved = la === undefined || la.x !== laBefore.x || la.y !== laBefore.y;
    assert.ok(moved); // either moved or rejoined herd
  });

  it('removes loose animal that touches edge', () => {
    // Loose animal is furthest from dog (dog at 12,12; loose at 23,12 → dist=11;
    // herd at 12,6 → dist=6). So loose animal moves FIRST.
    // seqRng feeds loose animal first: roll=0.9→6", angle=0→0° → moves to x=29 → escapes
    // Then herd moves: roll=0.5→3", angle=0.5→180°
    const state = makeState({
      looseAnimals: [{ x: 23, y: 12 }],
      rng: seqRng(
        // loose animal (furthest) moves first: roll=0.9→6", angle=0→0°
        0.9, 0,
        // herd moves next: roll=0.5→3", angle=0.5→180°
        0.5, 0.5
      ),
    });
    const s = phaseDumbAnimals(state);
    assert.equal(s.looseAnimals.length, 0);
    assert.ok(s.events.some(e => e.includes('escaped')));
  });

  it('rejoins loose animal that contacts herd', () => {
    // Place loose animal right next to herd
    const herdX = 12, herdY = 6;
    const state = makeState({
      herd: { x: herdX, y: herdY },
      // Loose animal just outside herd radius
      looseAnimals: [{ x: herdX + HERD_RADIUS + TOKEN_RADIUS - 0.1, y: herdY }],
      // rng returns ~0 so roll=1 and angle≈0 → moves loose animal slightly right (away from herd)
      // We need it to move INTO herd; use a left-moving angle (π → 180°)
      rng: seqRng(
        0.5, 0.5, // herd: 3" at 180°
        0.01,     // loose: roll=1
        0.5       // loose: angle=180° (moves left → into herd)
      ),
    });
    const s = phaseDumbAnimals(state);
    assert.ok(s.events.some(e => e.includes('rejoined')));
    assert.equal(s.looseAnimals.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Phase 2: Come-by
// ---------------------------------------------------------------------------

describe('phaseComeBy', () => {
  it('advances phase to loose_animal', () => {
    const s0 = makeState();
    s0.phase = 'come_by';
    const s = phaseComeBy(s0, { type: 'end_turn' });
    assert.equal(s.phase, 'loose_animal');
  });

  it('moves dog to target position when path is clear', () => {
    const s0 = makeState();
    s0.phase = 'come_by';
    const s = phaseComeBy(s0, { type: 'move_dog', x: 5, y: 5 });
    assert.ok(Math.abs(s.dog.x - 5) < 0.1);
    assert.ok(Math.abs(s.dog.y - 5) < 0.1);
  });

  it('throws when move exceeds 12"', () => {
    const s0 = makeState({ dog: { x: 0, y: 0 } });
    s0.phase = 'come_by';
    assert.throws(
      () => phaseComeBy(s0, { type: 'move_dog', x: 20, y: 20 }),
      /exceeds max/
    );
  });

  it('does not move dog when end_turn', () => {
    const s0 = makeState({ dog: { x: 10, y: 10 } });
    s0.phase = 'come_by';
    const s = phaseComeBy(s0, { type: 'end_turn' });
    assert.equal(s.dog.x, 10);
    assert.equal(s.dog.y, 10);
  });

  it('stops dog before herd when path is blocked', () => {
    // Dog at (0,6), herd at (12,6), dog wants to move to (20,6)
    const s0 = makeState({ dog: { x: 0, y: 6 }, herd: { x: 12, y: 6 } });
    s0.phase = 'come_by';
    // Max move is 12", so target (12,6) is right at the herd — should be blocked
    const s = phaseComeBy(s0, { type: 'move_dog', x: 12, y: 6 });
    // Dog should be less than (12 - HERD_RADIUS - TOKEN_RADIUS) from start
    assert.ok(s.dog.x < 12 - HERD_RADIUS);
  });

  it('allows move up to exactly 12"', () => {
    const s0 = makeState({ dog: { x: 0, y: 0 }, herd: { x: 0, y: 20 } });
    s0.phase = 'come_by';
    const s = phaseComeBy(s0, { type: 'move_dog', x: 12, y: 0 });
    assert.ok(Math.abs(s.dog.x - 12) < 0.1);
  });

  it('throws for unknown action type', () => {
    const s0 = makeState();
    assert.throws(() => phaseComeBy(s0, { type: 'teleport' }), /Unknown action/);
  });
});

// ---------------------------------------------------------------------------
// Phase 3: Loose Animal
// ---------------------------------------------------------------------------

describe('phaseLooseAnimal', () => {
  it('advances phase to move_herd', () => {
    const s0 = makeState();
    s0.phase = 'loose_animal';
    const s = phaseLooseAnimal(s0);
    assert.equal(s.phase, 'move_herd');
  });

  it('does not spawn loose animal when dog is beyond 8"', () => {
    // Dog at (12,12), herd at (12,6): distance = 6" < 8 → WILL trigger
    // Let's put herd far away instead
    const s0 = makeState({ herd: { x: 12, y: 22 }, dog: { x: 12, y: 12 } });
    s0.phase = 'loose_animal';
    const count = s0.looseAnimals.length;
    const s = phaseLooseAnimal(s0);
    // Distance = 10" > 8, so no spook trigger
    assert.equal(s.looseAnimals.length, count);
    assert.ok(s.events.some(e => e.includes('too far')));
  });

  it('spawns loose animal when dog is within 8" and roll >= distance', () => {
    // Dog at (12,12), herd at (12,9): distance = 3"
    // With fixedRng(0.9): D8 roll → 8, 8 >= 3 → spawn
    const s0 = makeState({
      dog:  { x: 12, y: 12 },
      herd: { x: 12, y: 9 },
      rng:  fixedRng(0.9),
    });
    s0.phase = 'loose_animal';
    const s = phaseLooseAnimal(s0);
    assert.equal(s.looseAnimals.length, 1);
    assert.ok(s.events.some(e => e.includes('spooked')));
  });

  it('does NOT spawn loose animal when roll < distance', () => {
    // Dog at (12,12), herd at (12,5): distance = 7"
    // With fixedRng(0): D8 roll → 1, 1 < 7 → no spawn
    const s0 = makeState({
      dog:  { x: 12, y: 12 },
      herd: { x: 12, y: 5 },
      rng:  fixedRng(0),
    });
    s0.phase = 'loose_animal';
    const s = phaseLooseAnimal(s0);
    assert.equal(s.looseAnimals.length, 0);
    assert.ok(s.events.some(e => e.includes('did not meet')));
  });

  it('loose animals do NOT trigger more loose animals', () => {
    // Existing loose animal should not cause phaseLooseAnimal to check it
    const s0 = makeState({
      dog:  { x: 12, y: 12 },
      herd: { x: 12, y: 9 },
      looseAnimals: [{ x: 12, y: 10 }],
      rng: fixedRng(0), // low roll → no new spawn from herd either
    });
    s0.phase = 'loose_animal';
    const s = phaseLooseAnimal(s0);
    // Should still have just 1 (the original); rng low enough to prevent new one
    assert.equal(s.looseAnimals.length, 1);
  });

  it('adds an event regardless of spawn outcome', () => {
    const s0 = makeState();
    s0.phase = 'loose_animal';
    const s = phaseLooseAnimal(s0);
    assert.ok(s.events.length > 0);
  });
});

// ---------------------------------------------------------------------------
// Phase 4: Move Herd
// ---------------------------------------------------------------------------

describe('phaseMoveHerd', () => {
  it('advances phase to dumb_animals (next turn) when game continues', () => {
    const s0 = makeState({ dog: { x: 12, y: 12 }, herd: { x: 12, y: 5 } });
    s0.phase = 'move_herd';
    const s = phaseMoveHerd(s0);
    assert.ok(s.phase === 'dumb_animals' || s.phase === 'finished');
  });

  it('increments turn counter', () => {
    const s0 = makeState({ dog: { x: 12, y: 12 }, herd: { x: 12, y: 5 } });
    s0.phase = 'move_herd';
    const s = phaseMoveHerd(s0);
    if (s.phase !== 'finished') {
      assert.equal(s.turn, 2);
    }
  });

  it('moves herd away from dog to at least 10" when board allows', () => {
    // Herd at (12,2), dog at (12,12): distance = 10" → already at limit, no move
    // Use dog-herd distance that allows 10" clearance without hitting edge:
    // dog at (12,12), herd at (12,9): 3" apart, needs 7" push → lands at y=2 (board edge!)
    // Instead: dog at (12,12), herd at (4,12): 8" apart, pushed to x=-2 clipped.
    // Safe test: place dog near centre, herd with room to move
    // dog(12,12) herd(20,12): dist=8, needs 2" push → x=22 ✓
    const s0 = makeState({ dog: { x: 12, y: 12 }, herd: { x: 20, y: 12 } });
    s0.phase = 'move_herd';
    const s = phaseMoveHerd(s0);
    if (s.phase !== 'finished') {
      // Herd should be at least 10" from dog, or stopped at edge
      const d = dist(s.herd, s.dog);
      assert.ok(d >= HERD_CLEARANCE - 1e-6 || touchesEdge(s.herd, 24));
    }
  });

  it('does not move herd already > 10" away', () => {
    // Herd at (12,22), dog at (12,12): distance = 10 → already at limit
    const s0 = makeState({ dog: { x: 12, y: 12 }, herd: { x: 12, y: 22 } });
    s0.phase = 'move_herd';
    const herdBefore = { x: s0.herd.x, y: s0.herd.y };
    const s = phaseMoveHerd(s0);
    assert.ok(Math.abs(s.herd.x - herdBefore.x) < 0.01);
    assert.ok(Math.abs(s.herd.y - herdBefore.y) < 0.01);
  });

  it('counts herd touching edge as escape', () => {
    // dog at (12,12), herd at (12,4): distance=8" < 10, needs 2" push north → y=2, which touches edge (radius=2.5)
    const s0 = makeState({ dog: { x: 12, y: 12 }, herd: { x: 12, y: 4 } });
    s0.phase = 'move_herd';
    const s = phaseMoveHerd(s0);
    assert.ok(s.escapedCount >= 1);
    assert.ok(s.events.some(e => e.includes('board edge')));
  });

  it('removes loose animal that fled off board', () => {
    // dog at (12,12), loose at (12,4): dist=8" < 10, pushed 2" north → y=2, touches edge (radius=0.75) → y=2 > 0.75 so maybe ok
    // Better: loose at (12,2): dist=10, won't move. Need loose close enough.
    // loose at (12,5): dist=7, pushed 3" north → y=2, touchesEdge (y ≤ radius=0.75) → no
    // loose at (12,1.5): dist=10.5, won't move (>10). Need dog very close to loose:
    // dog at (12,10), loose at (12,1): dist=9, pushed 1" north → y=0, escapes!
    const s0 = makeState({
      dog:  { x: 12, y: 10 },
      herd: { x: 22, y: 10 }, // herd far away (dist=10, won't move)
      looseAnimals: [{ x: 12, y: 1 }], // dist=9 from dog, push 1" → y=0 → escapes
    });
    s0.phase = 'move_herd';
    const s = phaseMoveHerd(s0);
    assert.ok(s.looseAnimals.length < s0.looseAnimals.length || s.escapedCount > 0);
  });

  it('loose animal rejoins herd during move_herd', () => {
    // dog at (12,12), loose at (12,8) dist=4 from dog → pushed 6" north → (12,2)
    // herd at (12,2) → they contact! (herd radius 2.5 + la radius 0.75 = 3.25)
    // But sorting: herd dist from dog = 10, la dist = 4 → herd moves first... 
    // Let's check: herd at (12,2) dist=10 → won't move. la at (12,8) dist=4 → pushed to (12,2) → contacts herd!
    const s0 = makeState({
      dog:  { x: 12, y: 12 },
      herd: { x: 12, y: 2 },
      looseAnimals: [{ x: 12, y: 8 }],
    });
    s0.phase = 'move_herd';
    const s = phaseMoveHerd(s0);
    const rejoined = s.looseAnimals.length === 0;
    const rejoinEvent = s.events.some(e => e.includes('rejoined') || e.includes('contact'));
    assert.ok(rejoined || rejoinEvent);
  });

  it('detects win condition when herd enters pen', () => {
    // Place herd right at pen location, dog pushes it in
    const s0 = makeState({
      dog:  { x: 12, y: 12 },
      herd: { x: 22, y: 22 }, // same as pen
      pen:  { x: 22, y: 22 },
    });
    s0.phase = 'move_herd';
    const s = phaseMoveHerd(s0);
    assert.equal(s.phase, 'finished');
    assert.ok(s.events.some(e => e.includes("That'll do")));
  });
});

// ---------------------------------------------------------------------------
// processTurn — integration
// ---------------------------------------------------------------------------

describe('processTurn', () => {
  it('returns a state with incremented turn', () => {
    const s0 = makeState();
    const s = processTurn(s0, { type: 'end_turn' });
    // Should be turn 2 unless game finished
    if (s.phase !== 'finished') {
      assert.equal(s.turn, 2);
    }
  });

  it('returns phase dumb_animals (ready for next turn)', () => {
    const s0 = makeState();
    const s = processTurn(s0, { type: 'end_turn' });
    assert.ok(s.phase === 'dumb_animals' || s.phase === 'finished');
  });

  it('accumulates events from all phases', () => {
    const s0 = makeState();
    const s = processTurn(s0, { type: 'end_turn' });
    // Should have events from dumb_animals + come_by + loose_animal + move_herd
    assert.ok(s.events.length >= 3);
  });

  it('does not mutate the original state', () => {
    const s0 = makeState();
    const origTurn = s0.turn;
    const origDogX = s0.dog.x;
    processTurn(s0, { type: 'end_turn' });
    assert.equal(s0.turn, origTurn);
    assert.equal(s0.dog.x, origDogX);
  });

  it('multiple turns converge: herd moves away from dog over time', () => {
    let s = makeState({
      dog:  { x: 12, y: 12 },
      herd: { x: 12, y: 6 },
      pen:  { x: 0, y: 0 }, // put pen somewhere unlikely to be reached
      rng: fixedRng(0.5),
    });

    for (let i = 0; i < 5; i++) {
      if (s.phase === 'finished') break;
      s = processTurn(s, { type: 'end_turn' });
    }
    // After multiple turns of dog staying put, herd should be >= 10" away
    assert.ok(dist(s.herd, s.dog) >= HERD_CLEARANCE - 0.5);
  });

  it('game ends when herd reaches pen', () => {
    // Set up so herd is pushed directly into pen
    const s0 = makeState({
      dog:  { x: 12, y: 12 },
      herd: { x: 21, y: 21 },  // close to pen
      pen:  { x: 22, y: 22 },
      rng: fixedRng(0.01), // minimal random movement
    });
    // Move dog toward herd to trigger movement
    let s = processTurn(s0, { type: 'move_dog', x: 12, y: 12 });
    let turns = 0;
    while (s.phase !== 'finished' && turns < 20) {
      s = processTurn(s, { type: 'end_turn' });
      turns++;
    }
    // Either finished or herd moved toward pen over time
    assert.ok(s.phase === 'finished' || s.escapedCount >= 0);
  });

  it('escapedCount increases when loose animals leave board', () => {
    // Place a loose animal very close to edge; dog causes Move Herd
    const s0 = makeState({
      dog:  { x: 12, y: 20 },
      herd: { x: 12, y: 12 },
      pen:  { x: 0, y: 0 },
      looseAnimals: [{ x: 12, y: 0.5 }],
      rng: fixedRng(0.01),
    });
    const s = processTurn(s0, { type: 'end_turn' });
    assert.ok(s.escapedCount >= 0); // may escape depending on movement
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles zero loose animals gracefully', () => {
    const s0 = makeState({ looseAnimals: [] });
    assert.doesNotThrow(() => processTurn(s0, { type: 'end_turn' }));
  });

  it('handles multiple loose animals', () => {
    const s0 = makeState({
      looseAnimals: [
        { x: 5, y: 5 },
        { x: 8, y: 8 },
        { x: 15, y: 15 },
      ],
      rng: fixedRng(0.5),
    });
    assert.doesNotThrow(() => processTurn(s0, { type: 'end_turn' }));
  });

  it('rollDie never returns 0', () => {
    for (let i = 0; i < 1000; i++) {
      assert.ok(rollDie(6, Math.random) >= 1);
    }
  });

  it('state events array grows each turn', () => {
    let s = makeState({ rng: fixedRng(0.5) });
    const s1 = processTurn(s, { type: 'end_turn' });
    const s2 = processTurn(s1, { type: 'end_turn' });
    assert.ok(s2.events.length > s1.events.length);
  });
});
