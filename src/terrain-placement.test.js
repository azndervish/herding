// terrain-placement.test.js — tests for impassable terrain placement rules

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateProceduralMap, dist } from './engine.js';

test('impassable terrain: dimensions are 2-4 inches', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const map = generateProceduralMap(seed);
    const impassable = map.terrain.filter(t => t.type === 'impassable');

    impassable.forEach(t => {
      assert.ok(t.w >= 2 && t.w <= 4, `Width ${t.w}" out of range [2-4]`);
      assert.ok(t.h >= 2 && t.h <= 4, `Height ${t.h}" out of range [2-4]`);
    });
  }
});

test('impassable terrain: placement bounds 4" <= x <= 22", 2" <= y <= 22"', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const map = generateProceduralMap(seed);
    const impassable = map.terrain.filter(t => t.type === 'impassable');

    impassable.forEach(t => {
      // Check center position (x, y)
      assert.ok(t.x >= 4, `X position ${t.x}" below minimum 4"`);
      assert.ok(t.x <= 22, `X position ${t.x}" above maximum 22"`);
      assert.ok(t.y >= 2, `Y position ${t.y}" below minimum 2"`);
      assert.ok(t.y <= 22, `Y position ${t.y}" above maximum 22"`);

      // Also verify edges stay within bounds
      const left = t.x - t.w/2;
      const right = t.x + t.w/2;
      const top = t.y - t.h/2;
      const bottom = t.y + t.h/2;

      assert.ok(left >= 0, `Left edge ${left}" off board`);
      assert.ok(right <= 24, `Right edge ${right}" off board`);
      assert.ok(top >= 0, `Top edge ${top}" off board`);
      assert.ok(bottom <= 24, `Bottom edge ${bottom}" off board`);
    });
  }
});

test('impassable terrain: does not intersect 8"×8" clear zone in front of pen', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const map = generateProceduralMap(seed);
    const impassable = map.terrain.filter(t => t.type === 'impassable');

    // Define 8"×8" clear zone in front of pen opening
    const pen = map.pen;
    const CLEAR_ZONE_SIZE = 8;
    let clearZoneX, clearZoneY;

    if (pen.openSide === 'left') {
      clearZoneX = pen.x - pen.w/2 - CLEAR_ZONE_SIZE/2;
      clearZoneY = pen.y;
    } else if (pen.openSide === 'right') {
      clearZoneX = pen.x + pen.w/2 + CLEAR_ZONE_SIZE/2;
      clearZoneY = pen.y;
    } else if (pen.openSide === 'top') {
      clearZoneX = pen.x;
      clearZoneY = pen.y - pen.h/2 - CLEAR_ZONE_SIZE/2;
    } else if (pen.openSide === 'bottom') {
      clearZoneX = pen.x;
      clearZoneY = pen.y + pen.h/2 + CLEAR_ZONE_SIZE/2;
    }

    const clearLeft = clearZoneX - CLEAR_ZONE_SIZE/2;
    const clearRight = clearZoneX + CLEAR_ZONE_SIZE/2;
    const clearTop = clearZoneY - CLEAR_ZONE_SIZE/2;
    const clearBottom = clearZoneY + CLEAR_ZONE_SIZE/2;

    impassable.forEach(t => {
      const terrainLeft = t.x - t.w/2;
      const terrainRight = t.x + t.w/2;
      const terrainTop = t.y - t.h/2;
      const terrainBottom = t.y + t.h/2;

      // Rectangles intersect if they overlap on both axes
      const xOverlap = terrainLeft < clearRight && terrainRight > clearLeft;
      const yOverlap = terrainTop < clearBottom && terrainBottom > clearTop;
      const intersects = xOverlap && yOverlap;

      assert.ok(
        !intersects,
        `Seed ${seed}: Terrain ${t.id} at (${t.x.toFixed(1)}, ${t.y.toFixed(1)}) intersects with clear zone at (${clearZoneX.toFixed(1)}, ${clearZoneY.toFixed(1)})`
      );
    });
  }
});

test('impassable terrain: generates 0-3 pieces', () => {
  const counts = new Set();

  for (let seed = 1; seed <= 50; seed++) {
    const map = generateProceduralMap(seed);
    const impassable = map.terrain.filter(t => t.type === 'impassable');
    counts.add(impassable.length);

    assert.ok(
      impassable.length >= 0 && impassable.length <= 3,
      `Invalid count: ${impassable.length} impassable pieces`
    );
  }

  // With 50 seeds, we should see some variety in counts
  assert.ok(counts.size >= 2, `Only saw counts: ${[...counts].join(', ')} — expected more variety`);
});

test('impassable terrain: placement succeeds or gives up after 3 attempts', () => {
  // This is more of an integration test - just verify maps are valid
  // and that the generator doesn't hang (3 attempt limit)
  for (let seed = 1; seed <= 30; seed++) {
    const map = generateProceduralMap(seed);
    // Should complete without hanging
    assert.ok(map, `Map generation should complete for seed ${seed}`);
  }
});

test('impassable terrain: all pieces have unique IDs', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const map = generateProceduralMap(seed);
    const impassable = map.terrain.filter(t => t.type === 'impassable');

    const ids = impassable.map(t => t.id);
    const uniqueIds = new Set(ids);

    assert.equal(
      ids.length,
      uniqueIds.size,
      `Duplicate IDs found in seed ${seed}: ${ids.join(', ')}`
    );
  }
});

test('impassable terrain: does not overlap herd', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const map = generateProceduralMap(seed);
    const impassable = map.terrain.filter(t => t.type === 'impassable');

    impassable.forEach(t => {
      const terrainRadius = Math.sqrt(t.w*t.w + t.h*t.h) / 2;
      const distToHerd = dist({ x: t.x, y: t.y }, map.herd);
      const minDistance = terrainRadius + map.herd.radius;

      assert.ok(
        distToHerd >= minDistance,
        `Seed ${seed}: Terrain ${t.id} at (${t.x.toFixed(1)}, ${t.y.toFixed(1)}) overlaps herd (dist: ${distToHerd.toFixed(1)}", min: ${minDistance.toFixed(1)}")`
      );
    });
  }
});

test('impassable terrain: max 10 placement attempts', () => {
  // This test verifies the generator doesn't hang with the new attempt limit
  // Generate several maps quickly to ensure 10 attempts is sufficient
  const start = Date.now();

  for (let seed = 1; seed <= 20; seed++) {
    const map = generateProceduralMap(seed);
    assert.ok(map, `Map generation should complete for seed ${seed}`);
  }

  const elapsed = Date.now() - start;
  // Should complete in reasonable time (< 1 second for 20 maps)
  assert.ok(elapsed < 1000, `Generation took ${elapsed}ms, should be < 1000ms`);
});

test('impassable terrain: does not overlap pen', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const map = generateProceduralMap(seed);
    const impassable = map.terrain.filter(t => t.type === 'impassable');

    const penLeft = map.pen.x - map.pen.w/2;
    const penRight = map.pen.x + map.pen.w/2;
    const penTop = map.pen.y - map.pen.h/2;
    const penBottom = map.pen.y + map.pen.h/2;

    impassable.forEach(t => {
      const terrainLeft = t.x - t.w/2;
      const terrainRight = t.x + t.w/2;
      const terrainTop = t.y - t.h/2;
      const terrainBottom = t.y + t.h/2;

      // Rectangles intersect if they overlap on both axes
      const xOverlap = terrainLeft < penRight && terrainRight > penLeft;
      const yOverlap = terrainTop < penBottom && terrainBottom > penTop;
      const intersects = xOverlap && yOverlap;

      assert.ok(
        !intersects,
        `Seed ${seed}: Terrain ${t.id} at (${t.x.toFixed(1)}, ${t.y.toFixed(1)}) overlaps pen at (${map.pen.x.toFixed(1)}, ${map.pen.y.toFixed(1)})`
      );
    });
  }
});
