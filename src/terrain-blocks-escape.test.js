// Test that terrain blocks escape during moveHerd phase
// Bug: Animal marked as escaped even though it was stopped by terrain before reaching edge

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  TOKEN_RADIUS,
  HERD_RADIUS,
  phaseMoveHerd,
} from './engine.js';

test('terrain should block escape - animal stopped by terrain before reaching edge', () => {
  // Scenario: loose animal is pushed toward board edge, but terrain blocks it
  // Expected: animal stops at terrain, does NOT escape

  const terrain = [{
    id: 'wall',
    type: 'impassable',
    x: 6,
    y: 12,
    w: 4,
    h: 4,
  }];

  // Terrain bounds: x=[4, 8], y=[10, 14]
  // Board left edge at x=0

  const state = {
    boardSize: 24,
    turn: 2,
    phase: 'move_herd',
    dog: { id: 'dog', type: 'dog', x: 10, y: 12, radius: TOKEN_RADIUS },
    herd: { id: 'herd', type: 'herd', x: 20, y: 12, radius: HERD_RADIUS },
    looseAnimals: [
      // Loose animal at x=8.5 will be pushed LEFT toward x=0
      // Target would be off-board (negative x), but terrain at x=[4,8] should stop it
      { id: 'loose_1_t1', type: 'loose', x: 8.5, y: 12, radius: TOKEN_RADIUS }
    ],
    pen: { id: 'pen', type: 'pen', x: 20, y: 18, w: 6, h: 6, openSide: 'left' },
    escapedCount: 0,
    events: [],
    terrain,
    rng: Math.random,
  };

  console.log('Before moveHerd:');
  console.log(`  Loose animal: x=${state.looseAnimals[0].x}, y=${state.looseAnimals[0].y}`);
  console.log(`  Dog: x=${state.dog.x}, y=${state.dog.y}`);
  console.log(`  Terrain bounds: x=[4, 8], y=[10, 14]`);
  console.log(`  Board left edge: x=0`);

  const result = phaseMoveHerd(state);

  console.log('After moveHerd:');
  console.log(`  Loose animal: x=${result.looseAnimals[0].x.toFixed(2)}, y=${result.looseAnimals[0].y.toFixed(2)}`);
  console.log(`  Escaped count: ${result.escapedCount}`);
  console.log(`  Loose animals remaining: ${result.looseAnimals.length}`);

  // Animal should still exist (not removed from array)
  assert.equal(result.looseAnimals.length, 1, 'Animal should not be removed - terrain blocked escape');

  // Animal should be stopped by terrain (near right edge at x≈8)
  const loose = result.looseAnimals[0];
  assert.ok(loose.x >= 8 - TOKEN_RADIUS, `Animal x=${loose.x.toFixed(2)} should be at or past terrain right edge (8)`);
  assert.ok(loose.x > 2, `Animal x=${loose.x.toFixed(2)} should not be at board edge (0.75)`);

  // Escaped count should be 0
  assert.equal(result.escapedCount, 0, 'No animals should have escaped - terrain blocked the path');
});

test('animal should escape when reaching board edge (no terrain blocking)', () => {
  // Control case: without terrain, animal should escape normally

  const state = {
    boardSize: 24,
    turn: 2,
    phase: 'move_herd',
    dog: { id: 'dog', type: 'dog', x: 10, y: 12, radius: TOKEN_RADIUS },
    herd: { id: 'herd', type: 'herd', x: 20, y: 12, radius: HERD_RADIUS },
    looseAnimals: [
      { id: 'loose_1', type: 'loose', x: 2, y: 12, radius: TOKEN_RADIUS }
    ],
    pen: { id: 'pen', type: 'pen', x: 20, y: 18, w: 6, h: 6, openSide: 'left' },
    escapedCount: 0,
    events: [],
    terrain: [], // No terrain
    rng: Math.random,
  };

  const result = phaseMoveHerd(state);

  console.log(`Control test - Loose animals remaining: ${result.looseAnimals.length}`);
  console.log(`Escaped count: ${result.escapedCount}`);

  // Animal should be marked as escaped and removed from array
  assert.equal(result.escapedCount, 1, 'Animal should have escaped');
  assert.equal(result.looseAnimals.length, 0, 'Escaped animal should be removed from looseAnimals array');
});
