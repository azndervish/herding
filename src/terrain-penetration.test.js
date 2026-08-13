// Test for terrain penetration bug
// Bug: loose animal ends up inside impassable terrain after collision resolution

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

// Import necessary functions from appEngine
import {
  TOKEN_RADIUS,
  HERD_RADIUS,
  phaseMoveHerd,
  processTurn,
} from './engine.js';

test('loose animal starting inside impassable terrain does not move deeper', () => {
  // Recreate scenario from logs: seed=1777946334097
  // impassable_1 at (6.3", 12.1"), dimensions 3×3"
  // Loose animal pushed from position, stopped at (6.81, 11.05) which is INSIDE terrain

  const terrain = [{
    id: 'impassable_1',
    type: 'impassable',
    x: 6.3,
    y: 12.1,
    w: 3,
    h: 3,
  }];

  // Terrain boundaries:
  // Left: 6.3 - 1.5 = 4.8
  // Right: 6.3 + 1.5 = 7.8
  // Top: 12.1 - 1.5 = 10.6
  // Bottom: 12.1 + 1.5 = 13.6

  const state = {
    boardSize: 24,
    turn: 1,
    phase: 'move_herd',
    dog: { id: 'dog', type: 'dog', x: 5, y: 8, radius: TOKEN_RADIUS },
    herd: { id: 'herd', type: 'herd', x: 15, y: 12, radius: HERD_RADIUS },
    looseAnimals: [
      // Position loose animal so it gets pushed toward the terrain
      { id: 'loose_1', type: 'loose', x: 7, y: 12, radius: TOKEN_RADIUS }
    ],
    pen: { id: 'pen', type: 'pen', x: 20, y: 12, w: 6, h: 6, openSide: 'left' },
    escapedCount: 0,
    events: [],
    terrain,
    rng: Math.random,
  };

  const result = phaseMoveHerd(state);
  const loose = result.looseAnimals[0];

  console.log(`Loose animal final position: (${loose.x.toFixed(2)}, ${loose.y.toFixed(2)})`);
  console.log(`Terrain bounds: x=[4.8, 7.8], y=[10.6, 13.6]`);

  // This fixture starts with the animal center inside the rectangle.
  const terrainLeft = 4.8;
  const terrainRight = 7.8;
  const terrainTop = 10.6;
  const terrainBottom = 13.6;

  // Entity is inside terrain if its CENTER is inside the rectangle
  // (We use center because collision detection should prevent the center from entering)
  const isInside = loose.x > terrainLeft && loose.x < terrainRight &&
                   loose.y > terrainTop && loose.y < terrainBottom;

  assert.ok(isInside);
  assert.equal(loose.x, state.looseAnimals[0].x);
  assert.equal(loose.y, state.looseAnimals[0].y);
});

test('loose animal pushed across terrain stops at the last center point before it', () => {
  // Simplified case: animal pushed directly through terrain
  const terrain = [{
    id: 'terrain',
    type: 'impassable',
    x: 10,
    y: 10,
    w: 4,
    h: 4,
  }];

  // Terrain bounds: x=[8, 12], y=[8, 12]

  const state = {
    boardSize: 24,
    turn: 1,
    phase: 'move_herd',
    dog: { id: 'dog', type: 'dog', x: 5, y: 10, radius: TOKEN_RADIUS },
    herd: { id: 'herd', type: 'herd', x: 20, y: 10, radius: HERD_RADIUS },
    looseAnimals: [
      // Loose animal at x=7 will be pushed right toward terrain at x=8
      { id: 'loose_1', type: 'loose', x: 7, y: 10, radius: TOKEN_RADIUS }
    ],
    pen: { id: 'pen', type: 'pen', x: 20, y: 18, w: 6, h: 6, openSide: 'left' },
    escapedCount: 0,
    events: [],
    terrain,
    rng: Math.random,
  };

  const result = phaseMoveHerd(state);
  const loose = result.looseAnimals[0];

  console.log(`Loose animal pushed from x=7 to x=${loose.x.toFixed(2)}`);
  console.log(`Terrain left edge at x=8, entity radius=${TOKEN_RADIUS}`);
  console.log('Entity center should stop before x=8');

  // Radius overlap is allowed; only the center must remain outside.
  const terrainLeft = 8;
  assert.ok(loose.x < terrainLeft,
    `Loose animal center entered terrain! x=${loose.x.toFixed(2)} should be < ${terrainLeft.toFixed(2)}`
  );
});
