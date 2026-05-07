// validation.test.js — tests for map validation rules

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HERD_RADIUS, TOKEN_RADIUS,
  validateDogZone, validatePenOpening, validateHerdStart, validateMap,
  WALK_UP, ROTTEN_BRIDGE, DEAD_MOUNT, BOGS_EDGE,
  dist, generateProceduralMap, createSeededRNG, PROCEDURAL,
} from './appEngine.js';

// ─────────────────────────────────────────────────────────────────────────────
// validateDogZone tests
// ─────────────────────────────────────────────────────────────────────────────

test('validateDogZone: no terrain passes', () => {
  const state = { terrain: [] };
  const result = validateDogZone(state);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('validateDogZone: terrain fully outside dog zone passes', () => {
  const state = {
    terrain: [
      { id: 'safe', type: 'impassable', x: 12, y: 12, w: 4, h: 4 }, // center at 12", far from x=2"
    ],
  };
  const result = validateDogZone(state);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('validateDogZone: terrain touching dog zone boundary (x=2") passes', () => {
  const state = {
    terrain: [
      { id: 'edge', type: 'impassable', x: 3, y: 12, w: 2, h: 4 }, // left edge at x=2"
    ],
  };
  const result = validateDogZone(state);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('validateDogZone: terrain overlapping dog zone fails', () => {
  const state = {
    terrain: [
      { id: 'bad', type: 'labouring', x: 1, y: 12, w: 2, h: 4 }, // center at 1", left at 0"
    ],
  };
  const result = validateDogZone(state);
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /bad.*overlaps dog zone/);
});

test('validateDogZone: multiple terrain violations', () => {
  const state = {
    terrain: [
      { id: 'bad1', type: 'impassable', x: 1, y: 6, w: 2, h: 4 },
      { id: 'bad2', type: 'antithetical', x: 1.5, y: 18, w: 3, h: 6 },
      { id: 'ok', type: 'labouring', x: 12, y: 12, w: 4, h: 4 },
    ],
  };
  const result = validateDogZone(state);
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /bad1/);
  assert.match(result.errors[1], /bad2/);
});

// ─────────────────────────────────────────────────────────────────────────────
// validatePenOpening tests
// ─────────────────────────────────────────────────────────────────────────────

test('validatePenOpening: opening 8" from edge passes', () => {
  const state = {
    boardSize: 24,
    pen: { x: 16, y: 12, w: 8, h: 6, openSide: 'left' }, // left edge at 12", 12" from left board edge
  };
  const result = validatePenOpening(state);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('validatePenOpening: opening exactly 8" from edge passes', () => {
  const state = {
    boardSize: 24,
    pen: { x: 12, y: 12, w: 8, h: 6, openSide: 'left' }, // left edge at 8"
  };
  const result = validatePenOpening(state);
  assert.equal(result.valid, true);
});

test('validatePenOpening: opening less than 8" from edge fails', () => {
  const state = {
    boardSize: 24,
    pen: { x: 10, y: 12, w: 8, h: 6, openSide: 'left' }, // left edge at 6"
  };
  const result = validatePenOpening(state);
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /left.*6\.0".*minimum 8"/);
});

test('validatePenOpening: right side opening validation', () => {
  const state = {
    boardSize: 24,
    pen: { x: 18, y: 12, w: 8, h: 6, openSide: 'right' }, // right edge at 22", 2" from right board edge
  };
  const result = validatePenOpening(state);
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /right.*2\.0".*minimum 8"/);
});

test('validatePenOpening: top side opening validation', () => {
  const state = {
    boardSize: 24,
    pen: { x: 12, y: 5, w: 8, h: 6, openSide: 'top' }, // top edge at 2", 2" from top board edge
  };
  const result = validatePenOpening(state);
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /top.*2\.0".*minimum 8"/);
});

test('validatePenOpening: bottom side opening validation', () => {
  const state = {
    boardSize: 24,
    pen: { x: 12, y: 16, w: 8, h: 6, openSide: 'bottom' }, // bottom edge at 19", 5" from bottom board edge
  };
  const result = validatePenOpening(state);
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /bottom.*5\.0".*minimum 8"/);
});

test('validatePenOpening: invalid openSide fails', () => {
  const state = {
    boardSize: 24,
    pen: { x: 12, y: 12, w: 8, h: 6, openSide: 'invalid' },
  };
  const result = validatePenOpening(state);
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /invalid openSide.*"invalid"/);
});

// ─────────────────────────────────────────────────────────────────────────────
// validateHerdStart tests
// ─────────────────────────────────────────────────────────────────────────────

test('validateHerdStart: valid herd position passes', () => {
  const state = {
    boardSize: 24,
    herd: { x: 10, y: 12, radius: HERD_RADIUS },
    pen: { x: 18, y: 12, w: 8, h: 6 },
  };
  const result = validateHerdStart(state);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('validateHerdStart: herd in dog zone fails', () => {
  const state = {
    boardSize: 24,
    herd: { x: 2, y: 12, radius: HERD_RADIUS }, // x=2" means it overlaps x<=2" dog zone
    pen: { x: 18, y: 12, w: 8, h: 6 },
  };
  const result = validateHerdStart(state);
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /overlaps dog zone/);
});

test('validateHerdStart: herd exactly at dog zone boundary passes', () => {
  const state = {
    boardSize: 24,
    herd: { x: 2 + HERD_RADIUS + 0.01, y: 12, radius: HERD_RADIUS },
    pen: { x: 18, y: 12, w: 8, h: 6 },
  };
  const result = validateHerdStart(state);
  assert.equal(result.valid, true);
});

test('validateHerdStart: herd overlapping pen fails', () => {
  const state = {
    boardSize: 24,
    herd: { x: 15, y: 12, radius: HERD_RADIUS }, // overlaps pen at x=18
    pen: { x: 18, y: 12, w: 8, h: 6 },
  };
  const result = validateHerdStart(state);
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /overlaps pen/);
});

test('validateHerdStart: herd extending past left edge fails', () => {
  const state = {
    boardSize: 24,
    herd: { x: 1, y: 12, radius: HERD_RADIUS }, // x=1 with radius 2.5 extends past x=0, also overlaps dog zone
    pen: { x: 18, y: 12, w: 8, h: 6 },
  };
  const result = validateHerdStart(state);
  assert.equal(result.valid, false);
  // This position violates both dog zone and left edge rules
  assert.ok(result.errors.length > 0);
});

test('validateHerdStart: herd extending past right edge fails', () => {
  const state = {
    boardSize: 24,
    herd: { x: 23, y: 12, radius: HERD_RADIUS }, // x=23 with radius 2.5 extends past x=24
    pen: { x: 10, y: 12, w: 8, h: 6 },
  };
  const result = validateHerdStart(state);
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /past right edge/);
});

test('validateHerdStart: herd extending past top edge fails', () => {
  const state = {
    boardSize: 24,
    herd: { x: 12, y: 1, radius: HERD_RADIUS },
    pen: { x: 18, y: 12, w: 8, h: 6 },
  };
  const result = validateHerdStart(state);
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /past top edge/);
});

test('validateHerdStart: herd extending past bottom edge fails', () => {
  const state = {
    boardSize: 24,
    herd: { x: 12, y: 23, radius: HERD_RADIUS },
    pen: { x: 18, y: 12, w: 8, h: 6 },
  };
  const result = validateHerdStart(state);
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /past bottom edge/);
});

test('validateHerdStart: multiple violations reported', () => {
  const state = {
    boardSize: 24,
    herd: { x: 1, y: 1, radius: HERD_RADIUS }, // overlaps dog zone, extends past left and top
    pen: { x: 3, y: 3, w: 8, h: 6 },
  };
  const result = validateHerdStart(state);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 2); // At least dog zone + edge violations
});

// ─────────────────────────────────────────────────────────────────────────────
// validateMap: integration tests
// ─────────────────────────────────────────────────────────────────────────────

test('validateMap: valid map passes all checks', () => {
  const state = {
    boardSize: 24,
    herd: { x: 10, y: 12, radius: HERD_RADIUS },
    pen: { x: 18, y: 12, w: 8, h: 6, openSide: 'left' },
    terrain: [
      { id: 'ok', type: 'labouring', x: 12, y: 6, w: 4, h: 4 },
    ],
  };
  const result = validateMap(state);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('validateMap: multiple rule violations collected', () => {
  const state = {
    boardSize: 24,
    herd: { x: 1, y: 12, radius: HERD_RADIUS }, // dog zone + left edge violation
    pen: { x: 4, y: 12, w: 8, h: 6, openSide: 'left' }, // opening too close to edge
    terrain: [
      { id: 'bad', type: 'impassable', x: 1, y: 6, w: 2, h: 4 }, // dog zone violation
    ],
  };
  const result = validateMap(state);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 3); // terrain + pen + herd violations
  assert.ok(result.errors.some(e => e.includes('dog zone')));
  assert.ok(result.errors.some(e => e.includes('opening')));
});

// ─────────────────────────────────────────────────────────────────────────────
// Existing scenario validation
// ─────────────────────────────────────────────────────────────────────────────

test('existing scenarios: WALK_UP is valid', () => {
  const result = validateMap(WALK_UP);
  assert.equal(result.valid, true, `WALK_UP validation errors: ${result.errors.join(', ')}`);
});

test('existing scenarios: ROTTEN_BRIDGE is valid', () => {
  const result = validateMap(ROTTEN_BRIDGE);
  assert.equal(result.valid, true, `ROTTEN_BRIDGE validation errors: ${result.errors.join(', ')}`);
});

test('existing scenarios: DEAD_MOUNT is valid', () => {
  const result = validateMap(DEAD_MOUNT);
  assert.equal(result.valid, true, `DEAD_MOUNT validation errors: ${result.errors.join(', ')}`);
});

test('existing scenarios: BOGS_EDGE is valid', () => {
  const result = validateMap(BOGS_EDGE);
  assert.equal(result.valid, true, `BOGS_EDGE validation errors: ${result.errors.join(', ')}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Procedural generation tests
// ─────────────────────────────────────────────────────────────────────────────

test('generateProceduralMap: generates valid map with fixed seed', () => {
  const state = generateProceduralMap(12345);
  const result = validateMap(state);
  assert.equal(result.valid, true, `Procedural map invalid: ${result.errors.join(', ')}`);
});

test('generateProceduralMap: generates different maps with different seeds', () => {
  const map1 = generateProceduralMap(1);
  const map2 = generateProceduralMap(2);

  // Maps should be different (at least one entity position differs)
  const sameHerd = map1.herd.x === map2.herd.x && map1.herd.y === map2.herd.y;
  const samePen = map1.pen.x === map2.pen.x && map1.pen.y === map2.pen.y;

  assert.equal(sameHerd && samePen, false, 'Different seeds should generate different maps');
});

test('generateProceduralMap: same seed generates same map', () => {
  const map1 = generateProceduralMap(42);
  const map2 = generateProceduralMap(42);

  assert.equal(map1.herd.x, map2.herd.x);
  assert.equal(map1.herd.y, map2.herd.y);
  assert.equal(map1.pen.x, map2.pen.x);
  assert.equal(map1.pen.y, map2.pen.y);
  assert.equal(map1.pen.openSide, map2.pen.openSide);
  assert.equal(map1.terrain.length, map2.terrain.length);
});

test('generateProceduralMap: multiple generations all valid', () => {
  for (let i = 0; i < 20; i++) {
    const state = generateProceduralMap(i);
    const result = validateMap(state);
    assert.equal(result.valid, true, `Map with seed ${i} invalid: ${result.errors.join(', ')}`);
  }
});

test('generateProceduralMap: herd and pen are spatially separated', () => {
  const state = generateProceduralMap(99);
  const herdToPen = dist(state.herd, state.pen);

  // Herd should be at least a few inches from pen
  assert.ok(herdToPen > 5, `Herd too close to pen: ${herdToPen.toFixed(1)}"`);
});

test('generateProceduralMap: pen opening has clearance', () => {
  const state = generateProceduralMap(123);
  const result = validatePenOpening(state);

  assert.equal(result.valid, true, `Pen opening validation failed: ${result.errors.join(', ')}`);
});

test('generateProceduralMap: terrain respects dog zone', () => {
  const state = generateProceduralMap(456);
  const result = validateDogZone(state);

  assert.equal(result.valid, true, `Dog zone validation failed: ${result.errors.join(', ')}`);
});

test('createSeededRNG: produces deterministic sequence', () => {
  const rng1 = createSeededRNG(100);
  const rng2 = createSeededRNG(100);

  const seq1 = [rng1(), rng1(), rng1()];
  const seq2 = [rng2(), rng2(), rng2()];

  assert.deepEqual(seq1, seq2, 'Same seed should produce same RNG sequence');
});

test('createSeededRNG: different seeds produce different sequences', () => {
  const rng1 = createSeededRNG(100);
  const rng2 = createSeededRNG(101);

  const val1 = rng1();
  const val2 = rng2();

  assert.notEqual(val1, val2, 'Different seeds should produce different values');
});

test('existing scenarios: PROCEDURAL is valid', () => {
  const result = validateMap(PROCEDURAL);
  assert.equal(result.valid, true, `PROCEDURAL validation errors: ${result.errors.join(', ')}`);
});
