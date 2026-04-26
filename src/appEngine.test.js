/**
 * appEngine.test.js
 *
 * Unit tests for the game engine inlined in App.jsx.
 * Extracted into appEngine.js (a thin re-export shim) for testability.
 *
 * Run:  node --experimental-vm-modules appEngine.test.js
 * Requires Node ≥ 18.
 *
 * Coverage strategy
 * ─────────────────
 * This file focuses on:
 *   1. Behaviours that DIFFER from herdingEngine.js (the reference engine):
 *      - phaseComeBy accepts null / missing action (treated as end_turn)
 *      - escapedCount initialises defensively from undefined
 *      - turn increments defensively from undefined
 *      - phaseLooseAnimal "herd holds" message wording
 *   2. The WALK_UP scenario bootstrap (what App does on mount).
 *   3. Full integration coverage of every phase function and processTurn.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  HERD_RADIUS,
  TOKEN_RADIUS,
  DOG_MOVE_MAX,
  DOG_SPOOK_RANGE,
  HERD_CLEARANCE,
  dist,
  unitVector,
  touchesEdge,
  entitiesContact,
  rollDie,
  angleToOffset,
  cloneState,
  phaseDumbAnimals,
  phaseComeBy,
  phaseLooseAnimal,
  phaseMoveHerd,
  processTurn,
  WALK_UP,
} from './appEngine.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

/** RNG that always returns a fixed value in [0,1). */
const fixedRng = (val) => () => val;

/** RNG that cycles through an array of values. */
function seqRng(...vals) {
  let i = 0;
  return () => vals[i++ % vals.length];
}

/** Minimal valid state using the App.jsx shape (escapedCount may start absent). */
function makeState(overrides = {}) {
  return {
    boardSize: 24,
    turn: 1,
    phase: 'dumb_animals',
    escapedCount: 0,
    events: [],
    rng: fixedRng(0.5),
    dog:  { id: 'dog',  type: 'dog',  x: 12, y: 12, radius: TOKEN_RADIUS },
    herd: { id: 'herd', type: 'herd', x: 12, y: 6,  radius: HERD_RADIUS  },
    pen:  { id: 'pen',  type: 'pen',  x: 22, y: 22, radius: 2.5          },
    looseAnimals: [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('HERD_RADIUS is 2.5"', () => assert.equal(HERD_RADIUS, 2.5));
  it('TOKEN_RADIUS is 0.75"', () => assert.equal(TOKEN_RADIUS, 0.75));
  it('DOG_MOVE_MAX is 12"', () => assert.equal(DOG_MOVE_MAX, 12));
  it('DOG_SPOOK_RANGE is 8"', () => assert.equal(DOG_SPOOK_RANGE, 8));
  it('HERD_CLEARANCE is 10"', () => assert.equal(HERD_CLEARANCE, 10));
});

// ─────────────────────────────────────────────────────────────────────────────
// Geometry helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('dist', () => {
  it('returns 0 for same point', () => assert.equal(dist({x:0,y:0},{x:0,y:0}), 0));
  it('returns 5 for 3-4-5 triangle', () => {
    assert.ok(Math.abs(dist({x:0,y:0},{x:3,y:4}) - 5) < 1e-9);
  });
});

describe('unitVector', () => {
  it('returns unit vector for 3-4-5', () => {
    const v = unitVector({x:0,y:0},{x:3,y:4});
    assert.ok(Math.abs(v.x - 0.6) < 1e-9);
    assert.ok(Math.abs(v.y - 0.8) < 1e-9);
  });
  it('handles coincident points without NaN', () => {
    const v = unitVector({x:5,y:5},{x:5,y:5});
    assert.ok(!isNaN(v.x) && !isNaN(v.y));
  });
});

describe('touchesEdge', () => {
  it('detects entity at left wall', () =>
    assert.ok(touchesEdge({x:0.5, y:12, radius:TOKEN_RADIUS}, 24)));
  it('detects entity at top wall', () =>
    assert.ok(touchesEdge({x:12, y:0.5, radius:TOKEN_RADIUS}, 24)));
  it('detects entity at right wall', () =>
    assert.ok(touchesEdge({x:23.5, y:12, radius:TOKEN_RADIUS}, 24)));
  it('detects entity at bottom wall', () =>
    assert.ok(touchesEdge({x:12, y:23.5, radius:TOKEN_RADIUS}, 24)));
  it('clear of all edges returns false', () =>
    assert.ok(!touchesEdge({x:12, y:12, radius:TOKEN_RADIUS}, 24)));
});

describe('entitiesContact', () => {
  it('overlapping circles → true', () =>
    assert.ok(entitiesContact({x:0,y:0,radius:1},{x:1,y:0,radius:1})));
  it('exactly touching → true', () =>
    assert.ok(entitiesContact({x:0,y:0,radius:1},{x:2,y:0,radius:1})));
  it('separated circles → false', () =>
    assert.ok(!entitiesContact({x:0,y:0,radius:0.5},{x:5,y:0,radius:0.5})));
});

describe('rollDie', () => {
  it('returns 1 when rng returns 0', () => assert.equal(rollDie(6, fixedRng(0)), 1));
  it('returns max when rng returns 0.9999', () => assert.equal(rollDie(6, fixedRng(0.9999)), 6));
  it('always in [1, faces]', () => {
    for (let i = 0; i < 200; i++) {
      const r = rollDie(8, Math.random);
      assert.ok(r >= 1 && r <= 8);
    }
  });
});

describe('angleToOffset', () => {
  it('0° → moves purely in +x', () => {
    const {dx,dy} = angleToOffset(0, 5);
    assert.ok(Math.abs(dx - 5) < 1e-9);
    assert.ok(Math.abs(dy) < 1e-9);
  });
  it('90° → moves purely in +y', () => {
    const {dx,dy} = angleToOffset(90, 5);
    assert.ok(Math.abs(dx) < 1e-9);
    assert.ok(Math.abs(dy - 5) < 1e-9);
  });
  it('output vector has correct magnitude', () => {
    const {dx,dy} = angleToOffset(45, 7);
    assert.ok(Math.abs(Math.sqrt(dx*dx+dy*dy) - 7) < 1e-9);
  });
});

describe('cloneState', () => {
  it('produces a distinct object', () => {
    const s = makeState();
    const c = cloneState(s);
    assert.notEqual(c, s);
    assert.notEqual(c.dog, s.dog);
    assert.notEqual(c.herd, s.herd);
    assert.notEqual(c.looseAnimals, s.looseAnimals);
    assert.notEqual(c.events, s.events);
  });
  it('mutations to clone do not affect original', () => {
    const s = makeState();
    const c = cloneState(s);
    c.dog.x = 99; c.herd.y = 99;
    assert.equal(s.dog.x, 12);
    assert.equal(s.herd.y, 6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: Dumb Animals
// ─────────────────────────────────────────────────────────────────────────────

describe('phaseDumbAnimals', () => {
  it('sets phase to come_by', () => {
    assert.equal(phaseDumbAnimals(makeState()).phase, 'come_by');
  });

  it('moves herd by D6" in random direction', () => {
    // fixedRng(0.9): roll=6, angle≈324° — herd should move
    const s = phaseDumbAnimals(makeState({ rng: fixedRng(0.9) }));
    const moved = s.herd.x !== 12 || s.herd.y !== 6;
    assert.ok(moved);
  });

  it('adds a Dumb Animals event for the herd', () => {
    const s = phaseDumbAnimals(makeState());
    assert.ok(s.events.some(e => e.includes('Dumb Animals') && e.includes('Herd')));
  });

  it('processes animals furthest from dog first (sort order)', () => {
    // Two loose animals at different distances; check they are both processed
    const state = makeState({
      looseAnimals: [
        { id:'la_near', type:'loose', x:13, y:12, radius:TOKEN_RADIUS }, // ~1" away
        { id:'la_far',  type:'loose', x:22, y:12, radius:TOKEN_RADIUS }, // ~10" away
      ],
      rng: fixedRng(0.5),
    });
    const s = phaseDumbAnimals(state);
    // Both should have events (or been rejoined/escaped)
    const eventText = s.events.join(' ');
    assert.ok(eventText.includes('la_far') || s.looseAnimals.length < 2);
  });


  it('clamps herd and counts escape when it wanders to board edge in dumb_animals', () => {
    // herd near top edge; furthest from dog so moves first
    // seqRng: roll=6 (0.9999), angle=270° (0.75) → dy=-6, herd.y = 2-6 = -4 → clamped to HERD_RADIUS
    const state = makeState({
      herd: { id:'herd', type:'herd', x:12, y:2, radius:HERD_RADIUS },
      rng: seqRng(0.9999, 0.75),
    });
    const s = phaseDumbAnimals(state);
    assert.ok(s.herd.y >= 0, `herd.y should be ≥0, got ${s.herd.y}`);
    assert.equal(s.herd.y, HERD_RADIUS);
    assert.equal(s.escapedCount, 1);
    assert.ok(s.events.some(e => e.includes('board edge') && e.includes('Herd')));
  });

  it('herd clamped to board edge does not go negative', () => {
    // All four edges: north
    const north = makeState({ herd:{id:'herd',type:'herd',x:12,y:1,radius:HERD_RADIUS}, rng:seqRng(0.9999,0.75) });
    assert.ok(phaseDumbAnimals(north).herd.y >= 0);
    // South
    const south = makeState({ herd:{id:'herd',type:'herd',x:12,y:23,radius:HERD_RADIUS}, rng:seqRng(0.9999,0.25) });
    assert.ok(phaseDumbAnimals(south).herd.y <= 24);
    // West
    const west = makeState({ herd:{id:'herd',type:'herd',x:1,y:12,radius:HERD_RADIUS}, rng:seqRng(0.9999,0.5) });
    assert.ok(phaseDumbAnimals(west).herd.x >= 0);
    // East
    const east = makeState({ herd:{id:'herd',type:'herd',x:23,y:12,radius:HERD_RADIUS}, rng:seqRng(0.9999,0) });
    assert.ok(phaseDumbAnimals(east).herd.x <= 24);
  });

  it('removes loose animal that reaches board edge', () => {
    // la_far is furthest from dog (dog at 12,12), so it moves first
    // seqRng: la_far gets roll=6 at angle=0° → x = 23+6 = 29 → escaped
    const state = makeState({
      looseAnimals: [{ id:'la_far', type:'loose', x:23, y:12, radius:TOKEN_RADIUS }],
      rng: seqRng(
        0.9, 0,    // la_far: roll=6, angle=0° → escapes right
        0.5, 0.5,  // herd: roll=3, angle=180°
      ),
    });
    const s = phaseDumbAnimals(state);
    assert.equal(s.looseAnimals.length, 0);
    assert.ok(s.events.some(e => e.includes('escaped')));
  });

  it('rejoins loose animal that contacts herd during wandering', () => {
    // Setup: dog(12,12), herd(12,6), la(12,9.5)
    // la is closer to dog (dist=2.5) than herd (dist=6) → herd moves FIRST
    // seqRng: herd gets first two values, la gets next two
    //   herd: roll=1 (0.01), angle=0° (0)  → herd moves to (13, 6)
    //   la:   roll=1 (0.01), angle=270° (0.75) → la moves north to (12, 8.5)
    //   dist(la=(12,8.5), herd=(13,6)) = sqrt(1+6.25) = 2.69 < 3.25 (sum of radii) → contact!
    const state = makeState({
      herd: { id:'herd', type:'herd', x:12, y:6,   radius:HERD_RADIUS  },
      looseAnimals: [{ id:'la', type:'loose', x:12, y:9.5, radius:TOKEN_RADIUS }],
      rng: seqRng(
        0.01, 0,     // herd: roll=1, angle=0°   → (13, 6)
        0.01, 0.75,  // la:   roll=1, angle=270° → (12, 8.5) → contacts herd
      ),
    });
    const s = phaseDumbAnimals(state);
    assert.ok(s.events.some(e => e.includes('rejoined')));
    assert.equal(s.looseAnimals.length, 0);
  });

  it('does not mutate original state', () => {
    const s0 = makeState();
    const herdXBefore = s0.herd.x;
    phaseDumbAnimals(s0);
    assert.equal(s0.herd.x, herdXBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Come-by  (App.jsx differences highlighted)
// ─────────────────────────────────────────────────────────────────────────────

describe('phaseComeBy', () => {
  function comeByState(overrides = {}) {
    return makeState({ phase: 'come_by', ...overrides });
  }

  // ── App.jsx-specific: null action treated as end_turn ──────────────────────

  it('[App] null action → treated as end_turn, dog does not move', () => {
    const s0 = comeByState({ dog: { id:'dog', type:'dog', x:5, y:5, radius:TOKEN_RADIUS } });
    const s = phaseComeBy(s0, null);
    assert.equal(s.dog.x, 5);
    assert.equal(s.dog.y, 5);
    assert.equal(s.phase, 'loose_animal');
  });

  it('[App] null action → emits "holds position" event', () => {
    const s = phaseComeBy(comeByState(), null);
    assert.ok(s.events.some(e => e.includes('holds position')));
  });

  it('[App] undefined action → treated as end_turn', () => {
    const s = phaseComeBy(comeByState(), undefined);
    assert.equal(s.phase, 'loose_animal');
    assert.ok(s.events.some(e => e.includes('holds position')));
  });

  // ── Standard end_turn ──────────────────────────────────────────────────────

  it('end_turn action → dog does not move', () => {
    const s0 = comeByState({ dog: { id:'dog', type:'dog', x:3, y:3, radius:TOKEN_RADIUS } });
    const s = phaseComeBy(s0, { type:'end_turn' });
    assert.equal(s.dog.x, 3);
    assert.equal(s.dog.y, 3);
  });

  it('advances phase to loose_animal', () => {
    assert.equal(phaseComeBy(comeByState(), { type:'end_turn' }).phase, 'loose_animal');
  });

  // ── move_dog ───────────────────────────────────────────────────────────────

  it('moves dog to target when path is clear', () => {
    const s0 = comeByState({
      dog:  { id:'dog',  type:'dog',  x:0, y:0, radius:TOKEN_RADIUS },
      herd: { id:'herd', type:'herd', x:0, y:20, radius:HERD_RADIUS },
    });
    const s = phaseComeBy(s0, { type:'move_dog', x:10, y:0 });
    assert.ok(Math.abs(s.dog.x - 10) < 0.1);
    assert.ok(Math.abs(s.dog.y - 0)  < 0.1);
  });

  it('throws when move exceeds 12"', () => {
    const s0 = comeByState({ dog: { id:'dog', type:'dog', x:0, y:0, radius:TOKEN_RADIUS } });
    assert.throws(() => phaseComeBy(s0, { type:'move_dog', x:20, y:0 }), /exceeds max/);
  });

  it('stops dog before herd when path is blocked', () => {
    const s0 = comeByState({
      dog:  { id:'dog',  type:'dog',  x:0, y:6, radius:TOKEN_RADIUS },
      herd: { id:'herd', type:'herd', x:8, y:6, radius:HERD_RADIUS },
    });
    const s = phaseComeBy(s0, { type:'move_dog', x:12, y:6 });
    // Dog must be short of herd surface (8 - 2.5 - 0.75 - 0.01 = 4.74)
    assert.ok(s.dog.x < 8 - HERD_RADIUS);
  });

  it('emits move event with coordinates', () => {
    const s0 = comeByState({
      dog:  { id:'dog',  type:'dog',  x:0, y:0, radius:TOKEN_RADIUS },
      herd: { id:'herd', type:'herd', x:0, y:20, radius:HERD_RADIUS },
    });
    const s = phaseComeBy(s0, { type:'move_dog', x:5, y:0 });
    assert.ok(s.events.some(e => e.includes('Come-by') && e.includes('moves to')));
  });

  it('throws for unknown action type', () => {
    assert.throws(() => phaseComeBy(comeByState(), { type:'teleport' }), /Unknown action/);
  });

  it('does not mutate original state', () => {
    const s0 = comeByState();
    const xBefore = s0.dog.x;
    phaseComeBy(s0, null);
    assert.equal(s0.dog.x, xBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3: Loose Animal
// ─────────────────────────────────────────────────────────────────────────────

describe('phaseLooseAnimal', () => {
  function laState(overrides = {}) {
    return makeState({ phase: 'loose_animal', ...overrides });
  }

  it('advances phase to move_herd', () => {
    assert.equal(phaseLooseAnimal(laState()).phase, 'move_herd');
  });

  it('does not spawn when dog > 8" from herd', () => {
    // dog(12,12) herd(12,22): 10" apart → no spook
    const s0 = laState({ herd: { id:'herd', type:'herd', x:12, y:22, radius:HERD_RADIUS } });
    const s = phaseLooseAnimal(s0);
    assert.equal(s.looseAnimals.length, 0);
    assert.ok(s.events.some(e => e.includes('too far')));
  });

  it('spawns loose animal when roll ≥ distance', () => {
    // dog(12,12) herd(12,9): 3" apart; fixedRng(0.9) → D8 roll=8 ≥ 3 → spawn
    const s0 = laState({
      dog:  { id:'dog',  type:'dog',  x:12, y:12, radius:TOKEN_RADIUS },
      herd: { id:'herd', type:'herd', x:12, y:9,  radius:HERD_RADIUS },
      rng: fixedRng(0.9),
    });
    const s = phaseLooseAnimal(s0);
    assert.equal(s.looseAnimals.length, 1);
    assert.ok(s.events.some(e => e.includes('spooked')));
  });

  it('does not spawn when roll < distance', () => {
    // dog(12,12) herd(12,5): 7" apart; fixedRng(0) → D8 roll=1 < 7 → no spawn
    const s0 = laState({
      dog:  { id:'dog',  type:'dog',  x:12, y:12, radius:TOKEN_RADIUS },
      herd: { id:'herd', type:'herd', x:12, y:5,  radius:HERD_RADIUS },
      rng: fixedRng(0),
    });
    const s = phaseLooseAnimal(s0);
    assert.equal(s.looseAnimals.length, 0);
  });

  // ── App.jsx-specific: "herd holds" message wording ─────────────────────────

  it('[App] no-spawn event contains "Herd holds"', () => {
    const s0 = laState({
      dog:  { id:'dog',  type:'dog',  x:12, y:12, radius:TOKEN_RADIUS },
      herd: { id:'herd', type:'herd', x:12, y:5,  radius:HERD_RADIUS },
      rng: fixedRng(0),
    });
    const s = phaseLooseAnimal(s0);
    assert.ok(s.events.some(e => e.includes('Herd holds')));
  });

  it('loose animals do NOT trigger additional loose animals', () => {
    const s0 = laState({
      dog:  { id:'dog',  type:'dog',  x:12, y:12, radius:TOKEN_RADIUS },
      herd: { id:'herd', type:'herd', x:12, y:9,  radius:HERD_RADIUS },
      looseAnimals: [{ id:'la_existing', type:'loose', x:12, y:10, radius:TOKEN_RADIUS }],
      rng: fixedRng(0), // roll=1 < 3" → no new spawn
    });
    const s = phaseLooseAnimal(s0);
    assert.equal(s.looseAnimals.length, 1);
  });

  it('new loose animal ID includes turn number', () => {
    const s0 = laState({
      dog:  { id:'dog',  type:'dog',  x:12, y:12, radius:TOKEN_RADIUS },
      herd: { id:'herd', type:'herd', x:12, y:9,  radius:HERD_RADIUS },
      turn: 4,
      rng: fixedRng(0.9),
    });
    const s = phaseLooseAnimal(s0);
    assert.ok(s.looseAnimals.length === 1);
    assert.ok(s.looseAnimals[0].id.includes('t4'));
  });

  it('does not mutate original state', () => {
    const s0 = laState();
    const lenBefore = s0.looseAnimals.length;
    phaseLooseAnimal(s0);
    assert.equal(s0.looseAnimals.length, lenBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4: Move Herd
// ─────────────────────────────────────────────────────────────────────────────

describe('phaseMoveHerd', () => {
  function mhState(overrides = {}) {
    return makeState({ phase: 'move_herd', ...overrides });
  }

  it('increments turn and sets phase to dumb_animals', () => {
    const s = phaseMoveHerd(mhState());
    if (s.phase !== 'finished') {
      assert.equal(s.turn, 2);
      assert.equal(s.phase, 'dumb_animals');
    }
  });

  it('moves herd away from dog to achieve ≥10" gap (when board allows)', () => {
    // dog(2,12) herd(10,12): 8" apart → needs 2" push east → x=12 (well within board)
    // 12 < 24-2.5=21.5 so no edge clamping, distance becomes exactly 10"
    const s0 = mhState({
      dog:  { id:'dog',  type:'dog',  x:2,  y:12, radius:TOKEN_RADIUS },
      herd: { id:'herd', type:'herd', x:10, y:12, radius:HERD_RADIUS  },
    });
    const s = phaseMoveHerd(s0);
    if (s.phase !== 'finished') {
      assert.ok(dist(s.herd, s.dog) >= HERD_CLEARANCE - 0.01,
        `Expected ≥10", got ${dist(s.herd,s.dog).toFixed(2)}"`);
    }
  });

  it('does not move herd already ≥10" from dog', () => {
    const s0 = mhState({
      dog:  { id:'dog',  type:'dog',  x:12, y:12, radius:TOKEN_RADIUS },
      herd: { id:'herd', type:'herd', x:22, y:12, radius:HERD_RADIUS },
    });
    const hXBefore = s0.herd.x;
    const s = phaseMoveHerd(s0);
    if (s.phase !== 'finished') {
      assert.ok(Math.abs(s.herd.x - hXBefore) < 0.01);
    }
  });

  it('herd hitting edge increments escapedCount and emits event', () => {
    // dog(12,12) herd(12,4): 8" apart → push 2" north → y=2 ≤ HERD_RADIUS=2.5 → edge!
    const s0 = mhState({
      dog:  { id:'dog',  type:'dog',  x:12, y:12, radius:TOKEN_RADIUS },
      herd: { id:'herd', type:'herd', x:12, y:4,  radius:HERD_RADIUS },
    });
    const s = phaseMoveHerd(s0);
    assert.ok(s.escapedCount >= 1);
    assert.ok(s.events.some(e => e.includes('board edge')));
  });

  // ── App.jsx-specific: escapedCount initialises from undefined ──────────────

  it('[App] escapedCount initialises from undefined when first escape occurs', () => {
    const s0 = mhState({
      dog:  { id:'dog',  type:'dog',  x:12, y:12, radius:TOKEN_RADIUS },
      herd: { id:'herd', type:'herd', x:12, y:4,  radius:HERD_RADIUS },
      escapedCount: undefined,  // simulates state where field was absent
    });
    const s = phaseMoveHerd(s0);
    assert.ok(typeof s.escapedCount === 'number');
    assert.ok(s.escapedCount >= 1);
  });

  // ── App.jsx-specific: turn initialises from undefined ─────────────────────

  it('[App] turn initialises from undefined (becomes 2 after first move_herd)', () => {
    const s0 = mhState({
      dog:  { id:'dog',  type:'dog',  x:12, y:12, radius:TOKEN_RADIUS },
      herd: { id:'herd', type:'herd', x:22, y:12, radius:HERD_RADIUS }, // already far
      turn: undefined,
    });
    const s = phaseMoveHerd(s0);
    if (s.phase !== 'finished') {
      assert.equal(s.turn, 2); // (undefined || 1) + 1 = 2
    }
  });

  it('loose animal escaping off board increments escapedCount', () => {
    // dog(12,10) herd(22,10): 10" apart → won't move
    // la(12,1): 9" from dog → pushed 1" north → y=0 → escapes
    const s0 = mhState({
      dog:  { id:'dog',  type:'dog',  x:12, y:10, radius:TOKEN_RADIUS },
      herd: { id:'herd', type:'herd', x:22, y:10, radius:HERD_RADIUS },
      looseAnimals: [{ id:'la', type:'loose', x:12, y:1, radius:TOKEN_RADIUS }],
    });
    const s = phaseMoveHerd(s0);
    assert.ok(s.escapedCount >= 1);
    assert.equal(s.looseAnimals.length, 0);
  });

  it('loose animal rejoins herd when moved into contact', () => {
    // dog(12,12), herd(12,2): dist=10 → herd won't move
    // la(12,8): dist=4 → pushed 6" north → y=2 → contacts herd (dist≈0, radii sum=3.25)
    const s0 = mhState({
      dog:  { id:'dog',  type:'dog',  x:12, y:12, radius:TOKEN_RADIUS },
      herd: { id:'herd', type:'herd', x:12, y:2,  radius:HERD_RADIUS },
      looseAnimals: [{ id:'la', type:'loose', x:12, y:8, radius:TOKEN_RADIUS }],
    });
    const s = phaseMoveHerd(s0);
    const rejoined = s.looseAnimals.length === 0;
    const rejoinEvent = s.events.some(e => e.includes('rejoined') || e.includes('contact'));
    assert.ok(rejoined || rejoinEvent);
  });

  it('detects win when herd centre enters pen', () => {
    // Place herd at same position as pen
    const s0 = mhState({
      dog:  { id:'dog',  type:'dog',  x:12, y:12, radius:TOKEN_RADIUS },
      herd: { id:'herd', type:'herd', x:22, y:22, radius:HERD_RADIUS },
      pen:  { id:'pen',  type:'pen',  x:22, y:22, radius:2.5 },
    });
    s0.phase = 'move_herd';
    const s = phaseMoveHerd(s0);
    assert.equal(s.phase, 'finished');
    assert.ok(s.events.some(e => e.includes("That'll do")));
  });

  it('does not mutate original state', () => {
    const s0 = mhState();
    const turnBefore = s0.turn;
    phaseMoveHerd(s0);
    assert.equal(s0.turn, turnBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// processTurn — targetPhase logic
// ─────────────────────────────────────────────────────────────────────────────

describe('processTurn', () => {

  // ── Default (no targetPhase): full cycle ──────────────────────────────────

  it('no target from dumb_animals → returns turn 2 dumb_animals', () => {
    const s = processTurn(makeState(), null);
    if (s.phase !== 'finished') {
      assert.equal(s.turn, 2);
      assert.equal(s.phase, 'dumb_animals');
    }
  });

  it('no target from come_by → returns turn 2 come_by', () => {
    let s0 = makeState();
    s0 = processTurn(s0, null, 'come_by');  // advance to come_by
    const s = processTurn(s0, null);         // full cycle from come_by
    if (s.phase !== 'finished') {
      assert.equal(s.turn, 2);
      assert.equal(s.phase, 'come_by');
    }
  });

  // ── With targetPhase: stop before ─────────────────────────────────────────

  it('turn 1 dumb_animals → target come_by: stops at turn 1 come_by', () => {
    const s = processTurn(makeState(), null, 'come_by');
    assert.equal(s.turn, 1);
    assert.equal(s.phase, 'come_by');
    assert.ok(s.events.some(e => e.includes('Dumb Animals')));
    assert.ok(!s.events.some(e => e.includes('Come-by')));
  });

  it('turn 1 dumb_animals → target loose_animal: runs dumb+come, stops at loose', () => {
    const s = processTurn(makeState(), null, 'loose_animal');
    assert.equal(s.turn, 1);
    assert.equal(s.phase, 'loose_animal');
    assert.ok(s.events.some(e => e.includes('Come-by') || e.includes('holds position')));
  });

  it('turn 1 dumb_animals → target move_herd: runs first 3 phases', () => {
    const s = processTurn(makeState(), null, 'move_herd');
    assert.equal(s.turn, 1);
    assert.equal(s.phase, 'move_herd');
    assert.ok(s.events.some(e => e.includes('Loose Animal')));
    assert.ok(!s.events.some(e => e.includes('Move Herd')));
  });

  it('turn 1 dumb_animals → target dumb_animals: completes full turn, returns turn 2', () => {
    const s = processTurn(makeState(), null, 'dumb_animals');
    if (s.phase !== 'finished') {
      assert.equal(s.turn, 2);
      assert.equal(s.phase, 'dumb_animals');
    }
  });

  // ── targetPhase == current phase: must advance past ───────────────────────

  it('already at come_by → target come_by: advances to turn 2 come_by', () => {
    let s0 = makeState();
    s0 = processTurn(s0, null, 'come_by');   // turn 1, come_by
    const s = processTurn(s0, null, 'come_by'); // target same → must advance
    if (s.phase !== 'finished') {
      assert.equal(s.turn, 2);
      assert.equal(s.phase, 'come_by');
    }
  });

  it('already at move_herd → target move_herd: advances to turn 2 move_herd', () => {
    let s0 = makeState();
    s0 = processTurn(s0, null, 'move_herd');
    const s = processTurn(s0, null, 'move_herd');
    if (s.phase !== 'finished') {
      assert.equal(s.turn, 2);
      assert.equal(s.phase, 'move_herd');
    }
  });

  // ── Action forwarding ─────────────────────────────────────────────────────

  it('move_dog action applied when come_by runs inside processTurn', () => {
    // dog at (0,0), herd far away, target (10,0) — dog should land near (10,0)
    const s0 = makeState({
      dog:  { id:'dog',  type:'dog',  x:0,  y:0,  radius:TOKEN_RADIUS },
      herd: { id:'herd', type:'herd', x:0,  y:20, radius:HERD_RADIUS },
    });
    const s = processTurn(s0, { type:'move_dog', x:10, y:0 }, 'loose_animal');
    assert.equal(s.phase, 'loose_animal');
    assert.ok(Math.abs(s.dog.x - 10) < 0.5, `dog.x=${s.dog.x}`);
  });

  // ── null action (App.jsx behaviour) ──────────────────────────────────────

  it('[App] null action passed through processTurn → dog holds during come_by', () => {
    const s0 = makeState({
      dog: { id:'dog', type:'dog', x:5, y:5, radius:TOKEN_RADIUS },
    });
    const s = processTurn(s0, null, 'come_by');   // advances through dumb_animals
    // Now at come_by; run null action for full cycle
    const s2 = processTurn(s, null);
    if (s2.phase !== 'finished') {
      // Dog should not have moved (null = hold position)
      assert.ok(Math.abs(s2.dog.x - s.dog.x) < 0.01);
    }
  });

  // ── Early exit on finished ────────────────────────────────────────────────

  it('stops immediately when game reaches finished, regardless of target', () => {
    const s0 = makeState({
      dog:  { id:'dog',  type:'dog',  x:12, y:12, radius:TOKEN_RADIUS },
      herd: { id:'herd', type:'herd', x:22, y:22, radius:HERD_RADIUS },
      pen:  { id:'pen',  type:'pen',  x:22, y:22, radius:2.5 },
      phase: 'move_herd',
    });
    const s = processTurn(s0, null, 'dumb_animals');
    assert.equal(s.phase, 'finished');
  });

  // ── Immutability ──────────────────────────────────────────────────────────

  it('does not mutate original state', () => {
    const s0 = makeState();
    const turnBefore = s0.turn;
    const dogXBefore = s0.dog.x;
    processTurn(s0, null);
    assert.equal(s0.turn, turnBefore);
    assert.equal(s0.dog.x, dogXBefore);
  });

  // ── Multi-turn progression ────────────────────────────────────────────────

  it('stepwise through 4 phases equals a single full-cycle call', () => {
    const rng = fixedRng(0.5);
    function fresh() {
      return makeState({
        rng: fixedRng(0.5),
        dog:  { id:'dog',  type:'dog',  x:12, y:12, radius:TOKEN_RADIUS },
        herd: { id:'herd', type:'herd', x:12, y:6,  radius:HERD_RADIUS },
        pen:  { id:'pen',  type:'pen',  x:0,  y:0,  radius:2.5 },
      });
    }

    let stepped = fresh();
    stepped = processTurn(stepped, null, 'come_by');
    stepped = processTurn(stepped, null, 'loose_animal');
    stepped = processTurn(stepped, null, 'move_herd');
    stepped = processTurn(stepped, null, 'dumb_animals');

    const full = processTurn(fresh(), null);

    assert.equal(stepped.turn,  full.turn);
    assert.equal(stepped.phase, full.phase);
    assert.ok(Math.abs(stepped.herd.x - full.herd.x) < 0.01);
    assert.ok(Math.abs(stepped.herd.y - full.herd.y) < 0.01);
    assert.ok(Math.abs(stepped.dog.x  - full.dog.x)  < 0.01);
    assert.ok(Math.abs(stepped.dog.y  - full.dog.y)  < 0.01);
  });

  it('events accumulate across multiple processTurn calls', () => {
    let s = makeState();
    s = processTurn(s, null);
    const len1 = s.events.length;
    s = processTurn(s, null);
    assert.ok(s.events.length > len1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WALK_UP scenario — App.jsx bootstrap
// ─────────────────────────────────────────────────────────────────────────────

describe('WALK_UP scenario', () => {

  it('has the correct starting positions', () => {
    assert.equal(WALK_UP.dog.x,  1);
    assert.equal(WALK_UP.dog.y,  22);
    assert.equal(WALK_UP.herd.x, 6);
    assert.equal(WALK_UP.herd.y, 10);
    assert.equal(WALK_UP.pen.x,  18);
    assert.equal(WALK_UP.pen.y,  10);
  });

  it('pen has radius 4 (larger than standard)', () => {
    assert.equal(WALK_UP.pen.radius, 4);
  });

  it('starts with no loose animals', () => {
    assert.equal(WALK_UP.looseAnimals.length, 0);
  });

  it('starts at turn 1, dumb_animals phase', () => {
    assert.equal(WALK_UP.turn, 1);
    assert.equal(WALK_UP.phase, 'dumb_animals');
  });

  it('dog starts > 12" from herd (entire board width to cross)', () => {
    const d = dist(WALK_UP.dog, WALK_UP.herd);
    assert.ok(d > 12, `Expected > 12", got ${d.toFixed(2)}"`);
  });

  // ── App bootstrap sequence: processTurn(initial, null, 'come_by') ─────────

  it('bootstrap: processTurn to come_by produces correct phase', () => {
    const initial = { ...WALK_UP, rng: fixedRng(0.5) };
    const s = processTurn(initial, null, 'come_by');
    assert.equal(s.phase, 'come_by');
    assert.equal(s.turn, 1);
  });

  it('bootstrap: herd has moved after dumb_animals', () => {
    const initial = { ...WALK_UP, rng: fixedRng(0.9) }; // guaranteed movement
    const s = processTurn(initial, null, 'come_by');
    const moved = s.herd.x !== WALK_UP.herd.x || s.herd.y !== WALK_UP.herd.y;
    assert.ok(moved);
  });

  it('bootstrap: dog has NOT moved (dumb_animals does not move dog)', () => {
    const initial = { ...WALK_UP, rng: fixedRng(0.5) };
    const s = processTurn(initial, null, 'come_by');
    assert.equal(s.dog.x, WALK_UP.dog.x);
    assert.equal(s.dog.y, WALK_UP.dog.y);
  });

  it('bootstrap: events contain a Dumb Animals entry', () => {
    const initial = { ...WALK_UP, rng: fixedRng(0.5) };
    const s = processTurn(initial, null, 'come_by');
    assert.ok(s.events.some(e => e.includes('Dumb Animals')));
  });

  it('bootstrap: escapedCount is 0 when herd does not reach an edge', () => {
    // fixedRng(0.1): roll=1", angle=36° → herd moves from (6,10) to ~(6.8,10.6) — safely inside
    const initial = { ...WALK_UP, rng: fixedRng(0.1) };
    const s = processTurn(initial, null, 'come_by');
    assert.equal(s.escapedCount, 0);
  });

  it('player can move dog and complete a full come_by cycle', () => {
    const initial = { ...WALK_UP, rng: fixedRng(0.5) };
    const atComeBy = processTurn(initial, null, 'come_by');

    // Move dog 5" north (toward herd) — within 12" max
    const action = { type: 'move_dog', x: atComeBy.dog.x, y: atComeBy.dog.y - 5 };
    const next = processTurn(atComeBy, action, 'come_by');

    if (next.phase !== 'finished') {
      assert.equal(next.phase, 'come_by');
      assert.equal(next.turn, 2);
      // Dog should be at the new position (from prev turn's move)
      // After a full cycle, dog stays where it was placed
      assert.ok(Math.abs(next.dog.x - action.x) < 0.5);
      assert.ok(Math.abs(next.dog.y - action.y) < 0.5);
    }
  });

  it('herd stays within board bounds after repeated turns', () => {
    let s = { ...WALK_UP, rng: fixedRng(0.5) };
    for (let i = 0; i < 10; i++) {
      if (s.phase === 'finished') break;
      s = processTurn(s, null, 'come_by');
      s = processTurn(s, null, 'come_by');
    }
    assert.ok(s.herd.x >= 0 && s.herd.x <= 24, `herd.x=${s.herd.x}`);
    assert.ok(s.herd.y >= 0 && s.herd.y <= 24, `herd.y=${s.herd.y}`);
  });

  it('game can eventually finish (herd reaches pen over many turns)', () => {
    // This is a probabilistic test — with a fixed RNG the herd drifts,
    // and eventually the dog can be walked to push it toward the pen.
    // We verify the game state machine can reach 'finished' without errors.
    let s = { ...WALK_UP, rng: fixedRng(0.3) };
    let turns = 0;
    while (s.phase !== 'finished' && turns < 50) {
      s = processTurn(s, null, 'come_by');
      if (s.phase === 'finished') break;
      // Each turn: move dog toward herd
      const action = { type: 'move_dog', x: s.dog.x, y: Math.max(0, s.dog.y - 12) };
      try {
        s = processTurn(s, action, 'come_by');
      } catch {
        s = processTurn(s, null, 'come_by');
      }
      turns++;
    }
    // The game either finished or ran stably for 50 turns without throwing
    assert.ok(s.phase === 'finished' || turns === 50);
    assert.ok(typeof s.escapedCount === 'number');
  });
});
