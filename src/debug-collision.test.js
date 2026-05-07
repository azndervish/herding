// Debug test to understand the exact collision scenario

import { strict as assert } from 'node:assert';

// Manually implement the key functions to debug
function dist(a, b) {
  return Math.sqrt((a.x - b.x)**2 + (a.y - b.y)**2);
}

function unitVector(from, to) {
  const d = dist(from, to);
  if (d === 0) return { x: 0, y: 0 };
  return { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  if (lenSq !== 0) param = dot / lenSq;
  let xx, yy;
  if (param < 0) {
    xx = x1; yy = y1;
  } else if (param > 1) {
    xx = x2; yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }
  const dx = px - xx;
  const dy = py - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

function raySegmentIntersect(from, to, x1, y1, x2, y2, radius) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const moveLen = Math.sqrt(dx*dx + dy*dy);
  if (moveLen === 0) return null;

  const steps = Math.max(20, Math.ceil(moveLen * 10));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = from.x + dx * t;
    const py = from.y + dy * t;
    const d = distToSegment(px, py, x1, y1, x2, y2);
    if (d <= radius) {
      const t0 = i > 0 ? (i-1)/steps : 0;
      const t1 = t;

      let tMin = t0, tMax = t1;
      for (let j = 0; j < 10; j++) {
        const tMid = (tMin + tMax) / 2;
        const pmx = from.x + dx * tMid;
        const pmy = from.y + dy * tMid;
        const dMid = distToSegment(pmx, pmy, x1, y1, x2, y2);
        if (dMid <= radius) {
          tMax = tMid;
        } else {
          tMin = tMid;
        }
      }
      return tMax * moveLen;
    }
  }
  return null;
}

function getTerrainEdges(terrain) {
  const edges = [];
  for (const t of terrain) {
    if (t.type !== 'impassable') continue;
    const left = t.x - t.w/2;
    const right = t.x + t.w/2;
    const top = t.y - t.h/2;
    const bottom = t.y + t.h/2;
    edges.push(
      [left, top, right, top],       // top edge
      [right, top, right, bottom],   // right edge
      [left, bottom, right, bottom], // bottom edge
      [left, top, left, bottom]      // left edge
    );
  }
  return edges;
}

// Test the exact scenario from the bug report
console.log('=== Debugging terrain penetration bug ===\n');

const terrain = [{
  id: 'impassable_1',
  type: 'impassable',
  x: 6.3,
  y: 12.1,
  w: 3,
  h: 3,
}];

const animal = { x: 7, y: 12, radius: 0.75 };
const dog = { x: 5, y: 8 };

// Calculate push direction (away from dog)
const d = dist(animal, dog);
const needed = 10 - d;  // HERD_CLEARANCE = 10
const dir = unitVector(dog, animal);
const targetX = animal.x + dir.x * needed;
const targetY = animal.y + dir.y * needed;

console.log(`Animal start: (${animal.x.toFixed(2)}, ${animal.y.toFixed(2)}), radius=${animal.radius}`);
console.log(`Dog: (${dog.x.toFixed(2)}, ${dog.y.toFixed(2)})`);
console.log(`Distance: ${d.toFixed(2)}"`);
console.log(`Push needed: ${needed.toFixed(2)}"`);
console.log(`Push direction: (${dir.x.toFixed(3)}, ${dir.y.toFixed(3)})`);
console.log(`Target: (${targetX.toFixed(2)}, ${targetY.toFixed(2)})`);
console.log();

// Terrain bounds
const tLeft = 6.3 - 1.5;
const tRight = 6.3 + 1.5;
const tTop = 12.1 - 1.5;
const tBottom = 12.1 + 1.5;
console.log(`Terrain: center=(${terrain[0].x}, ${terrain[0].y}), size=${terrain[0].w}×${terrain[0].h}`);
console.log(`Terrain bounds: x=[${tLeft.toFixed(1)}, ${tRight.toFixed(1)}], y=[${tTop.toFixed(1)}, ${tBottom.toFixed(1)}]`);
console.log();

// Check collisions with each edge
const edges = getTerrainEdges(terrain);
const edgeNames = ['top', 'right', 'bottom', 'left'];

console.log('Checking collision with each edge:');
let minDist = Infinity;
let minEdge = null;

edges.forEach((edge, i) => {
  const [x1, y1, x2, y2] = edge;
  const collisionDist = raySegmentIntersect(animal, { x: targetX, y: targetY }, x1, y1, x2, y2, animal.radius);
  console.log(`  ${edgeNames[i]} edge: (${x1.toFixed(1)}, ${y1.toFixed(1)}) to (${x2.toFixed(1)}, ${y2.toFixed(1)})`);
  if (collisionDist !== null) {
    console.log(`    ✓ Collision at distance ${collisionDist.toFixed(3)}"`);
    if (collisionDist < minDist) {
      minDist = collisionDist;
      minEdge = edgeNames[i];
    }
  } else {
    console.log(`    ✗ No collision`);
  }
});

console.log();
if (minDist < Infinity) {
  console.log(`Earliest collision: ${minEdge} edge at ${minDist.toFixed(3)}"`);

  // Calculate stop position
  const stopDist = Math.max(0, minDist - 0.01);
  const stopX = animal.x + dir.x * stopDist;
  const stopY = animal.y + dir.y * stopDist;

  console.log(`Stop distance: ${stopDist.toFixed(3)}"`);
  console.log(`Stop position: (${stopX.toFixed(3)}, ${stopY.toFixed(3)})`);
  console.log();

  // Check if stop position is inside terrain
  const insideX = stopX > tLeft && stopX < tRight;
  const insideY = stopY > tTop && stopY < tBottom;
  const inside = insideX && insideY;

  console.log(`Is stop position inside terrain?`);
  console.log(`  x: ${stopX.toFixed(3)} in (${tLeft.toFixed(1)}, ${tRight.toFixed(1)})? ${insideX ? 'YES ❌' : 'NO ✓'}`);
  console.log(`  y: ${stopY.toFixed(3)} in (${tTop.toFixed(1)}, ${tBottom.toFixed(1)})? ${insideY ? 'YES ❌' : 'NO ✓'}`);
  console.log(`  INSIDE TERRAIN: ${inside ? 'YES ❌ BUG!' : 'NO ✓'}`);

  if (inside) {
    console.log();
    console.log('❌ BUG CONFIRMED: Entity stopped inside terrain!');
  }
} else {
  console.log('No collision detected - entity moves to target');
}
