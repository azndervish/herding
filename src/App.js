import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// ENGINE (inlined)
// ─────────────────────────────────────────────────────────────────────────────

const HERD_RADIUS   = 2.5;
const TOKEN_RADIUS  = 0.75;
const DOG_MOVE_MAX  = 12;
const DOG_SPOOK_RANGE = 8;
const HERD_CLEARANCE  = 10;

function dist(a, b) { return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2); }

function unitVector(a, b) {
  const d = dist(a, b);
  if (d === 0) return { x: 1, y: 0 };
  return { x: (b.x-a.x)/d, y: (b.y-a.y)/d };
}

function touchesEdge(e, boardSize) {
  return e.x <= e.radius || e.y <= e.radius ||
         e.x >= boardSize - e.radius || e.y >= boardSize - e.radius;
}

function entitiesContact(a, b) { return dist(a, b) <= a.radius + b.radius; }

function circleRectContact(circle, rect) {
  // Find closest point on rectangle to circle center
  const closestX = Math.max(rect.x - rect.w/2, Math.min(circle.x, rect.x + rect.w/2));
  const closestY = Math.max(rect.y - rect.h/2, Math.min(circle.y, rect.y + rect.h/2));

  // Calculate distance from circle center to closest point
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  const distSquared = dx * dx + dy * dy;

  return distSquared <= (circle.radius * circle.radius);
}

function pointInRect(x, y, rect) {
  // Check if point (x, y) is inside rectangle
  const left = rect.x - rect.w/2;
  const right = rect.x + rect.w/2;
  const top = rect.y - rect.h/2;
  const bottom = rect.y + rect.h/2;
  return x >= left && x <= right && y >= top && y <= bottom;
}

function isInLabouringTerrain(x, y, terrain = []) {
  // Check if point (x, y) is inside any labouring terrain
  for (const t of terrain) {
    if (t.type === 'labouring' && pointInRect(x, y, t)) {
      return true;
    }
  }
  return false;
}

function isInAntitheticalTerrain(x, y, terrain = []) {
  // Check if point (x, y) is inside any antithetical terrain
  for (const t of terrain) {
    if (t.type === 'antithetical' && pointInRect(x, y, t)) {
      return true;
    }
  }
  return false;
}

function getPenWalls(pen) {
  // Returns array of line segments [x1, y1, x2, y2] for closed sides only
  // Open side has no walls - animals can enter/exit freely
  const left = pen.x - pen.w/2;
  const right = pen.x + pen.w/2;
  const top = pen.y - pen.h/2;
  const bottom = pen.y + pen.h/2;

  const walls = [];

  // Only add walls for closed sides
  if (pen.openSide !== 'left')   walls.push([left, top, left, bottom]);     // left wall
  if (pen.openSide !== 'right')  walls.push([right, top, right, bottom]);   // right wall
  if (pen.openSide !== 'top')    walls.push([left, top, right, top]);       // top wall
  if (pen.openSide !== 'bottom') walls.push([left, bottom, right, bottom]); // bottom wall

  return walls;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  // Distance from point (px, py) to line segment (x1,y1)-(x2,y2)
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx*dx + dy*dy;

  if (lenSq === 0) return Math.sqrt((px-x1)*(px-x1) + (py-y1)*(py-y1)); // point segment

  // Find closest point on segment
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;

  return Math.sqrt((px - closestX) * (px - closestX) + (py - closestY) * (py - closestY));
}

function circleSegmentCollision(circle, x1, y1, x2, y2) {
  return distToSegment(circle.x, circle.y, x1, y1, x2, y2) <= circle.radius;
}

function rollDie(faces, rng) { return Math.floor(rng() * faces) + 1; }

function angleToOffset(angleDeg, inches) {
  const rad = angleDeg * Math.PI / 180;
  return { dx: Math.cos(rad) * inches, dy: Math.sin(rad) * inches };
}

function cloneState(s) {
  return {
    ...s,
    dog: { ...s.dog },
    herd: { ...s.herd },
    looseAnimals: s.looseAnimals.map(a => ({ ...a })),
    pen: { ...s.pen },
    events: [...s.events],
    terrain: s.terrain ? s.terrain.map(t => ({ ...t })) : [],
  };
}

function getTerrainEdges(terrain) {
  // Returns array of line segments [x1, y1, x2, y2] for all terrain edges
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

// ─────────────────────────────────────────────────────────────────────────────
// DEBUG HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function _pos(e) {
  return `(${e.x.toFixed(2)}, ${e.y.toFixed(2)}) r=${e.radius}`;
}

/** Returns an array of human-readable boundary violations for entity e. */
function _oobViolations(e, boardSize) {
  const v = [];
  if (e.x - e.radius < 0)         v.push(`left  | x=${e.x.toFixed(2)} < ${e.radius}`);
  if (e.y - e.radius < 0)         v.push(`top   | y=${e.y.toFixed(2)} < ${e.radius}`);
  if (e.x + e.radius > boardSize) v.push(`right | x=${e.x.toFixed(2)} > ${(boardSize - e.radius).toFixed(2)}`);
  if (e.y + e.radius > boardSize) v.push(`bot   | y=${e.y.toFixed(2)} > ${(boardSize - e.radius).toFixed(2)}`);
  return v;
}

/** Logs a warn line for every boundary violation on a single entity. */
function _checkOob(tag, e, boardSize) {
  _oobViolations(e, boardSize).forEach(msg =>
    console.warn(`[OOB] ${tag} "${e.id}" — ${msg}`)
  );
}

/** Checks every entity in state for boundary violations. */
function _checkStateOob(tag, s) {
  _checkOob(tag, s.herd, s.boardSize);
  _checkOob(tag, s.dog,  s.boardSize);
  s.looseAnimals.forEach(la => _checkOob(tag, la, s.boardSize));
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves movement from current position to target, handling all collision types.
 * Returns { x, y, blocked, obstacle } where:
 * - x, y: final position after collision resolution
 * - blocked: true if movement was blocked by another entity
 * - obstacle: description of what blocked movement (if any)
 * @param {boolean} checkEntityCollisions - if false, only check walls/terrain (for dumb_animals phase)
 */
function resolveMovement(animal, targetX, targetY, state, escapedIds = new Set(), checkEntityCollisions = true) {
  const { boardSize, pen, terrain = [], dog, herd, looseAnimals } = state;
  let newX = targetX;
  let newY = targetY;
  let blocked = false;
  let obstacle = null;

  // Check pen wall collisions along the movement path
  const walls = getPenWalls(pen);
  let wallBlockDist = Infinity;
  for (const wall of walls) {
    const t = raySegmentIntersect(animal, { x: newX, y: newY }, wall[0], wall[1], wall[2], wall[3], animal.radius);
    if (t !== null && t < wallBlockDist) {
      wallBlockDist = t;
    }
  }

  // Check terrain collision along the path
  const terrainEdges = getTerrainEdges(terrain);
  let terrainBlockDist = Infinity;
  for (const edge of terrainEdges) {
    const t = raySegmentIntersect(animal, { x: newX, y: newY }, edge[0], edge[1], edge[2], edge[3], animal.radius);
    if (t !== null && t < terrainBlockDist) {
      terrainBlockDist = t;
    }
  }

  const blockDist = Math.min(wallBlockDist, terrainBlockDist);

  if (blockDist < Infinity) {
    // Stop just before hitting the obstacle
    const dir = unitVector(animal, { x: newX, y: newY });
    const stopDist = Math.max(0, blockDist - 0.01);
    newX = animal.x + dir.x * stopDist;
    newY = animal.y + dir.y * stopDist;
    obstacle = terrainBlockDist < wallBlockDist ? 'impassable terrain' : 'pen wall';
  }

  // Check entity collisions (dog, herd, other loose animals)
  if (checkEntityCollisions) {
    // Loose animals can move into contact with herd (for rejoining), but not other entities
    const others = animal.type === 'loose'
      ? [dog, ...looseAnimals].filter(e => e.id !== animal.id && !escapedIds.has(e.id))
      : [dog, herd, ...looseAnimals].filter(e => e.id !== animal.id && !escapedIds.has(e.id));

    for (const other of others) {
      const testPos = { x: newX, y: newY, radius: animal.radius };
      if (entitiesContact(testPos, other)) {
        const dir = unitVector(animal, { x: newX, y: newY });
        const stopDist = Math.max(0, dist(animal, other) - animal.radius - other.radius - 0.01);
        newX = animal.x + dir.x * stopDist;
        newY = animal.y + dir.y * stopDist;
        obstacle = other.id;
        blocked = true;
        break;
      }
    }
  }

  return { x: newX, y: newY, blocked, obstacle };
}

// ─────────────────────────────────────────────────────────────────────────────

function phaseDumbAnimals(state) {
  const s = cloneState(state);
  const { rng, boardSize } = s;
  const events = [];

  console.log(`[dumbAnimals T${s.turn}] entry — herd ${_pos(s.herd)}, dog ${_pos(s.dog)}, loose: ${s.looseAnimals.length}`);
  _checkStateOob('dumbAnimals:entry', s);

  const animals = [s.herd, ...s.looseAnimals].sort(
    (a, b) => dist(b, s.dog) - dist(a, s.dog)
  );
  for (const animal of animals) {
    let roll = rollDie(6, rng);
    const angle = rng() * 360;

    // Check if animal center is in labouring terrain - halve movement (round up)
    const inLabouring = isInLabouringTerrain(animal.x, animal.y, s.terrain);
    if (inLabouring) {
      roll = Math.ceil(roll / 2);
    }

    const { dx, dy } = angleToOffset(angle, roll);
    if (animal.type === 'herd') {
      const _hBefore = { x: s.herd.x, y: s.herd.y };
      const targetX = s.herd.x + dx;
      const targetY = s.herd.y + dy;

      const result = resolveMovement(s.herd, targetX, targetY, s, new Set(), true);
      s.herd.x = result.x;
      s.herd.y = result.y;

      console.log(`[dumbAnimals T${s.turn}] herd: roll=${roll} angle=${angle.toFixed(0)}°${inLabouring ? ' (labouring)' : ''} | (${_hBefore.x.toFixed(2)},${_hBefore.y.toFixed(2)}) → ${_pos(s.herd)}`);

      if (result.obstacle) {
        console.log(`[dumbAnimals T${s.turn}] herd blocked by ${result.obstacle}, stopped at ${_pos(s.herd)}`);
        events.push(`Dumb Animals: Herd bumped into ${result.obstacle}.`);
      } else {
        const labourMsg = inLabouring ? ' (labouring terrain)' : '';
        events.push(`Dumb Animals: Herd wanders ${roll}" (${angle.toFixed(0)}°)${labourMsg}.`);
      }

      if (touchesEdge(s.herd, boardSize)) {
        console.warn(`[dumbAnimals T${s.turn}] herd OOB at ${_pos(s.herd)} — clamping to board`);
        s.herd.x = Math.max(s.herd.radius, Math.min(boardSize - s.herd.radius, s.herd.x));
        s.herd.y = Math.max(s.herd.radius, Math.min(boardSize - s.herd.radius, s.herd.y));
        s.escapedCount = (s.escapedCount || 0) + 1;
        events.push(`Dumb Animals: Herd hit the board edge! +1 escape (${s.escapedCount} total).`);
      }
    } else {
      const la = s.looseAnimals.find(a => a.id === animal.id);
      if (la) {
        const _laBefore = { x: la.x, y: la.y };
        const targetX = la.x + dx;
        const targetY = la.y + dy;

        const result = resolveMovement(la, targetX, targetY, s, new Set(), true);
        la.x = result.x;
        la.y = result.y;

        console.log(`[dumbAnimals T${s.turn}] ${la.id}: roll=${roll} angle=${angle.toFixed(0)}°${inLabouring ? ' (labouring)' : ''} | (${_laBefore.x.toFixed(2)},${_laBefore.y.toFixed(2)}) → ${_pos(la)}`);

        if (result.obstacle) {
          console.log(`[dumbAnimals T${s.turn}] ${la.id} blocked by ${result.obstacle}, stopped at ${_pos(la)}`);
          events.push(`Dumb Animals: ${la.id} bumped into ${result.obstacle}.`);
        } else {
          const labourMsg = inLabouring ? ' (labouring terrain)' : '';
          events.push(`Dumb Animals: ${la.id} wanders ${roll}"${labourMsg}.`);
        }

        if (touchesEdge(la, boardSize)) {
          console.warn(`[dumbAnimals T${s.turn}] ${la.id} OOB at ${_pos(la)} — marking escaped`);
          la._escaped = true; events.push(`${la.id} reached the edge and escaped!`);
        }
      }
    }
  }
  const rejoined = [];
  for (const la of s.looseAnimals) {
    if (!la._escaped && entitiesContact(la, s.herd)) {
      console.log(`[dumbAnimals T${s.turn}] ${la.id} rejoined herd (dist=${dist(la, s.herd).toFixed(2)}")`);
      rejoined.push(la.id); events.push(`${la.id} rejoined the herd!`);
    }
  }
  s.looseAnimals = s.looseAnimals.filter(a => !rejoined.includes(a.id) && !a._escaped);
  s.events = [...s.events, ...events];
  s.phase = 'come_by';

  console.log(`[dumbAnimals T${s.turn}] exit  — herd ${_pos(s.herd)}, loose: ${s.looseAnimals.length}, escaped: ${s.escapedCount || 0}`);
  _checkStateOob('dumbAnimals:exit', s);
  return s;
}

function rayCircleIntersect(from, to, obstacle) {
  const combinedRadius = obstacle.radius + (from.radius ?? TOKEN_RADIUS);
  const dx = to.x - from.x, dy = to.y - from.y;
  const fx = from.x - obstacle.x, fy = from.y - obstacle.y;
  const a = dx*dx + dy*dy, b = 2*(fx*dx + fy*dy);
  const c = fx*fx + fy*fy - combinedRadius*combinedRadius;
  const disc = b*b - 4*a*c;
  if (disc < 0) return null;
  const t1 = (-b - Math.sqrt(disc)) / (2*a);
  if (t1 >= 0 && t1 <= 1) return t1 * Math.sqrt(a);
  return null;
}

function raySegmentIntersect(from, to, x1, y1, x2, y2, radius) {
  // Check if a circle moving from 'from' to 'to' hits the wall segment
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const moveLen = Math.sqrt(dx*dx + dy*dy);
  if (moveLen === 0) return null;

  // Use fine-grained sampling for accuracy
  const steps = Math.max(20, Math.ceil(moveLen * 10));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = from.x + dx * t;
    const py = from.y + dy * t;
    const d = distToSegment(px, py, x1, y1, x2, y2);
    if (d <= radius) {
      // Found collision - do binary search for more precision
      const t0 = i > 0 ? (i-1)/steps : 0;
      const t1 = t;

      // Binary search between t0 and t1
      let tMin = t0, tMax = t1;
      for (let j = 0; j < 10; j++) {
        const tMid = (tMin + tMax) / 2;
        const pmx = from.x + dx * tMid;
        const pmy = from.y + dy * tMid;
        const dMid = distToSegment(pmx, pmy, x1, y1, x2, y2);
        if (dMid <= radius) {
          tMax = tMid;  // collision at or before midpoint
        } else {
          tMin = tMid;  // collision after midpoint
        }
      }
      return tMax * moveLen;
    }
  }
  return null;
}

function phaseComeBy(state, action) {
  const s = cloneState(state);
  const events = [];

  console.log(`[comeBy T${s.turn}] entry — dog ${_pos(s.dog)}, action=${JSON.stringify(action)}`);
  _checkStateOob('comeBy:entry', s);

  if (!action || action.type === 'end_turn') {
    console.log(`[comeBy T${s.turn}] dog holds position`);
    events.push('Come-by: Dog holds position.');
    s.events = [...s.events, ...events]; s.phase = 'loose_animal'; return s;
  }
  if (action.type !== 'move_dog') throw new Error(`Unknown action: ${action.type}`);
  const target = { x: action.x, y: action.y };
  const distance = dist(s.dog, target);
  console.log(`[comeBy T${s.turn}] target=(${target.x.toFixed(2)},${target.y.toFixed(2)}) dist=${distance.toFixed(2)}"${distance > DOG_MOVE_MAX ? ' ⚠ EXCEEDS MAX' : ''}`);
  if (distance > DOG_MOVE_MAX + 1e-9) throw new Error(`Move exceeds max ${DOG_MOVE_MAX}".`);
  // Check for pen wall collisions
  const walls = getPenWalls(s.pen);
  let wallBlockDist = Infinity;
  for (const wall of walls) {
    const t = raySegmentIntersect(s.dog, target, wall[0], wall[1], wall[2], wall[3], s.dog.radius);
    if (t !== null && t < wallBlockDist) {
      wallBlockDist = t;
    }
  }

  // Check terrain collision along the path
  const terrainEdges = getTerrainEdges(s.terrain || []);
  let terrainBlockDist = Infinity;
  for (const edge of terrainEdges) {
    const t = raySegmentIntersect(s.dog, target, edge[0], edge[1], edge[2], edge[3], s.dog.radius);
    if (t !== null && t < terrainBlockDist) {
      terrainBlockDist = t;
    }
  }

  const obstacles = [s.herd, ...s.looseAnimals];
  let closestBlock = Infinity, blockedEntity = null;
  for (const obs of obstacles) {
    const t = rayCircleIntersect(s.dog, target, obs);
    if (t !== null && t < closestBlock) { closestBlock = t; blockedEntity = obs; }
  }

  // Use whichever blocker is closest
  const blockDist = Math.min(wallBlockDist, terrainBlockDist, closestBlock);

  if (blockDist < Infinity) {
    const dir = unitVector(s.dog, target);
    const stopDist = Math.max(0, blockDist - 0.01);
    s.dog.x += dir.x * stopDist; s.dog.y += dir.y * stopDist;

    let obstacle = 'unknown';
    if (terrainBlockDist === blockDist) obstacle = 'impassable terrain';
    else if (wallBlockDist === blockDist) obstacle = 'pen wall';
    else obstacle = blockedEntity.id;

    console.log(`[comeBy T${s.turn}] dog blocked by ${obstacle} at dist=${blockDist.toFixed(2)}", stopped at ${_pos(s.dog)}`);
    events.push(`Come-by: Dog blocked by ${obstacle}, stopped at (${s.dog.x.toFixed(1)}, ${s.dog.y.toFixed(1)}).`);
  } else {
    s.dog.x = target.x; s.dog.y = target.y;
    console.log(`[comeBy T${s.turn}] dog moved to ${_pos(s.dog)}`);
    events.push(`Come-by: Dog moves to (${s.dog.x.toFixed(1)}, ${s.dog.y.toFixed(1)}).`);
  }
  _checkOob('comeBy:exit | dog', s.dog, s.boardSize);
  s.events = [...s.events, ...events]; s.phase = 'loose_animal'; return s;
}

function phaseLooseAnimal(state) {
  const s = cloneState(state);
  const { rng } = s;
  const events = [];

  const dogToHerd = dist(s.dog, s.herd);
  console.log(`[looseAnimal T${s.turn}] entry — dog ${_pos(s.dog)}, herd ${_pos(s.herd)}, dog↔herd=${dogToHerd.toFixed(2)}"`);
  _checkStateOob('looseAnimal:entry', s);

  if (dogToHerd <= DOG_SPOOK_RANGE) {
    const roll = rollDie(8, rng);
    console.log(`[looseAnimal T${s.turn}] within spook range — D8 roll: ${roll} vs distance ${dogToHerd.toFixed(2)}"`);
    events.push(`Loose Animal: Dog ${dogToHerd.toFixed(1)}" from herd. Rolled D8: ${roll}.`);
    if (roll >= dogToHerd) {
      const spawnDist = rollDie(6, rng);
      const angle = rng() * 360;
      const { dx, dy } = angleToOffset(angle, spawnDist);
      const newId = `loose_${s.looseAnimals.length + 1}_t${s.turn}`;
      const la = { id: newId, type: 'loose', radius: TOKEN_RADIUS, x: s.herd.x + dx, y: s.herd.y + dy };
      console.log(`[looseAnimal T${s.turn}] spawned ${newId} — ${spawnDist}" @ ${angle.toFixed(0)}° → ${_pos(la)}`);
      _checkOob(`looseAnimal:spawn | ${newId}`, la, s.boardSize);
      s.looseAnimals.push(la);
      events.push(`Loose Animal: Animal spooked! ${newId} placed ${spawnDist}" from herd.`);
    } else {
      events.push(`Loose Animal: Herd holds — roll ${roll} < distance ${dogToHerd.toFixed(1)}".`);
    }
  } else {
    events.push(`Loose Animal: Dog ${dogToHerd.toFixed(1)}" away — too far to spook.`);
  }
  s.events = [...s.events, ...events]; s.phase = 'move_herd';

  _checkStateOob('looseAnimal:exit', s);
  return s;
}

function phaseMoveHerd(state) {
  const s = cloneState(state);
  const { boardSize } = s;
  const events = [];

  console.log(`[moveHerd T${s.turn}] entry — herd ${_pos(s.herd)}, dog ${_pos(s.dog)}, loose: ${s.looseAnimals.length}`);
  _checkStateOob('moveHerd:entry', s);

  const animals = [s.herd, ...s.looseAnimals].sort((a,b) => dist(b,s.dog) - dist(a,s.dog));
  const escapedIds = new Set();

  for (const animal of animals) {
    if (escapedIds.has(animal.id)) continue;
    const d = dist(animal, s.dog);
    if (d >= HERD_CLEARANCE) {
      console.log(`[moveHerd T${s.turn}] ${animal.id} already ${d.toFixed(2)}" from dog — no push needed`);
      continue;
    }

    // Check if animal center is in antithetical terrain - pull TOWARD dog instead of pushing away
    const inAntithetical = isInAntitheticalTerrain(animal.x, animal.y, s.terrain);
    const inLabouring = isInLabouringTerrain(animal.x, animal.y, s.terrain);

    let targetX, targetY, needed;

    if (inAntithetical) {
      // Pull toward dog: distance = 10" - current distance
      needed = HERD_CLEARANCE - d;
      const dirToDog = unitVector(animal, s.dog); // Direction TOWARD dog
      targetX = animal.x + dirToDog.x * needed;
      targetY = animal.y + dirToDog.y * needed;
      console.log(`[moveHerd T${s.turn}] ${animal.id}: dist=${d.toFixed(2)}", pulling ${needed.toFixed(2)}" toward dog (antithetical) → (${targetX.toFixed(2)},${targetY.toFixed(2)})`);
    } else {
      // Normal push away from dog
      needed = HERD_CLEARANCE - d;

      // Check if animal center is in labouring terrain - halve movement (round up)
      if (inLabouring) {
        needed = Math.ceil(needed / 2);
      }

      const dir = unitVector(s.dog, animal);
      targetX = animal.x + dir.x * needed;
      targetY = animal.y + dir.y * needed;
      console.log(`[moveHerd T${s.turn}] ${animal.id}: dist=${d.toFixed(2)}", pushing ${needed.toFixed(2)}"${inLabouring ? ' (labouring)' : ''} → (${targetX.toFixed(2)},${targetY.toFixed(2)})`);
    }

    const wouldEscape = targetX < animal.radius || targetY < animal.radius ||
                        targetX > boardSize - animal.radius || targetY > boardSize - animal.radius;
    if (wouldEscape) {
      const newX = Math.max(animal.radius, Math.min(boardSize - animal.radius, targetX));
      const newY = Math.max(animal.radius, Math.min(boardSize - animal.radius, targetY));
      console.warn(`[moveHerd T${s.turn}] ${animal.id} would escape at (${targetX.toFixed(2)},${targetY.toFixed(2)}) — clamping`);
      if (animal.type === 'herd') {
        s.herd.x = newX; s.herd.y = newY;
        s.escapedCount = (s.escapedCount || 0) + 1;
        events.push(`Move Herd: Herd hit the board edge! +1 escape (${s.escapedCount} total).`);
      } else {
        escapedIds.add(animal.id);
        s.escapedCount = (s.escapedCount || 0) + 1;
        events.push(`Move Herd: ${animal.id} escaped off the board! (${s.escapedCount} total)`);
      }
      continue;
    }

    const result = resolveMovement(animal, targetX, targetY, s, escapedIds);
    let newX = result.x;
    let newY = result.y;

    if (result.obstacle) {
      console.log(`[moveHerd T${s.turn}] ${animal.id} blocked by ${result.obstacle}, stopped at (${newX.toFixed(2)},${newY.toFixed(2)})`);
      events.push(`Move Herd: ${animal.id} blocked by ${result.obstacle}.`);
    }

    if (inAntithetical) {
      events.push(`Move Herd: ${animal.id} drawn ${needed.toFixed(1)}" toward dog (antithetical terrain).`);
    }
    // Update entity position
    if (animal.type === 'herd') {
      s.herd.x = newX;
      s.herd.y = newY;
    } else {
      const la = s.looseAnimals.find(a => a.id === animal.id);
      if (la) {
        la.x = newX;
        la.y = newY;
      }
    }

    // Check if loose animal rejoined herd
    if (animal.type === 'loose') {
      const la = s.looseAnimals.find(a => a.id === animal.id);
      const contactsHerd = la && (entitiesContact(la, s.herd) ||
        (blocked && dist({ x: newX, y: newY }, s.herd) <= la.radius + s.herd.radius + 0.05));
      if (contactsHerd) {
        console.log(`[moveHerd T${s.turn}] ${la.id} rejoined herd at (${newX.toFixed(2)},${newY.toFixed(2)})`);
        escapedIds.add(la.id);
        events.push(`Move Herd: ${la.id} rejoined the herd!`);
        continue;
      }
    }

    if (!result.obstacle && !inAntithetical) {
      const labourMsg = inLabouring ? ' (labouring terrain)' : '';
      events.push(`Move Herd: ${animal.id} moved ${needed.toFixed(1)}" away from dog${labourMsg}.`);
    }
  }
  s.looseAnimals = s.looseAnimals.filter(a => !escapedIds.has(a.id) && !a._escaped);
  s.events = [...s.events, ...events];

  // Victory condition: herd center must be inside the pen
  if (pointInRect(s.herd.x, s.herd.y, s.pen)) {
    console.log(`[moveHerd T${s.turn}] herd center reached pen — FINISHED`);
    s.events.push("🐑 The herd is in the pen! That'll do!");
    s.phase = 'finished'; return s;
  }
  s.turn = (s.turn || 1) + 1; s.phase = 'dumb_animals';

  console.log(`[moveHerd T${s.turn - 1}] exit  — herd ${_pos(s.herd)}, loose: ${s.looseAnimals.length}, escaped: ${s.escapedCount || 0}`);
  _checkStateOob('moveHerd:exit', s);
  return s;
}

function phaseDeployment(state, action) {
  const s = cloneState(state);
  const events = [];

  console.log(`[deployment T${s.turn}] entry — action=${JSON.stringify(action)}`);

  if (!action || action.type !== 'deploy_dog') {
    throw new Error('deployment phase requires deploy_dog action');
  }

  const target = { x: action.x, y: action.y };

  // Validate deployment zone: within 2" of left edge
  if (target.x > 2 + s.dog.radius) {
    throw new Error(`Dog must be deployed within 2" of left edge. Target x=${target.x.toFixed(2)}" exceeds ${(2 + s.dog.radius).toFixed(2)}"`);
  }

  // Validate within board bounds (allow edges, just like normal gameplay)
  if (target.x < 0 || target.y < 0 || target.x > s.boardSize || target.y > s.boardSize) {
    throw new Error('Dog deployment must be within board bounds');
  }

  s.dog.x = target.x;
  s.dog.y = target.y;
  console.log(`[deployment T${s.turn}] dog deployed at ${_pos(s.dog)}`);
  events.push(`Deployment: Dog placed at (${s.dog.x.toFixed(1)}, ${s.dog.y.toFixed(1)}).`);

  s.events = [...s.events, ...events];
  s.phase = 'dumb_animals';

  return s;
}

const PHASE_RUNNERS = {
  deployment:   (s,  a) => phaseDeployment(s, a),
  dumb_animals: (s, _a) => phaseDumbAnimals(s),
  come_by:      (s,  a) => phaseComeBy(s, a),
  loose_animal: (s, _a) => phaseLooseAnimal(s),
  move_herd:    (s, _a) => phaseMoveHerd(s),
};

function processTurn(state, action, targetPhase) {
  const stopBefore = targetPhase ?? state.phase;
  let s = state;
  const MAX_STEPS = 9;
  let steps = 0;

  console.log(`[processTurn] T${s.turn} phase=${s.phase} stopBefore=${stopBefore} action=${action?.type ?? 'null'}`);

  while (steps < MAX_STEPS) {
    if (s.phase === 'finished') {
      console.log(`[processTurn] game finished — returning`);
      return s;
    }
    if (steps > 0 && s.phase === stopBefore) {
      console.log(`[processTurn] reached stopBefore="${stopBefore}" after ${steps} step(s) — T${s.turn}`);
      return s;
    }
    const runner = PHASE_RUNNERS[s.phase];
    if (!runner) throw new Error(`No runner for phase: ${s.phase}`);
    s = runner(s, action);
    steps++;
  }
  throw new Error('processTurn exceeded max steps');
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────

const WALK_UP = {
  boardSize: 24,
  dog:  { id: 'dog',  type: 'dog',  x: 1,  y: 12, radius: TOKEN_RADIUS },  // Default position (will be overridden by deployment)
  herd: { id: 'herd', type: 'herd', x: 6,  y: 10, radius: HERD_RADIUS  },
  pen:  { id: 'pen',  type: 'pen',  x: 18, y: 10, w: 8, h: 6, openSide: 'left' },
  looseAnimals: [],
  escapedCount: 0,
  events: [],
  turn: 1,
  phase: 'deployment',
  terrain: [],
  rng: Math.random,
};

const ROTTEN_BRIDGE = {
  boardSize: 24,
  dog:  { id: 'dog',  type: 'dog',  x: 1,  y: 12, radius: TOKEN_RADIUS },
  herd: { id: 'herd', type: 'herd', x: 6,  y: 12, radius: HERD_RADIUS  },
  pen:  { id: 'pen',  type: 'pen',  x: 22 - 4, y: 4, w: 8, h: 8, openSide: 'bottom' }, // 2" from right edge, 0" from top
  looseAnimals: [],
  escapedCount: 0,
  events: [],
  turn: 1,
  phase: 'deployment',
  terrain: [
    { id: 'river_top', type: 'impassable', x: 12, y: 4, w: 2, h: 8 },     // Top river: 2" wide, 8" tall (vertical)
    { id: 'river_bottom', type: 'impassable', x: 12, y: 20, w: 2, h: 8 }, // Bottom river: 2" wide, 8" tall (vertical)
  ],
  rng: Math.random,
};

const DEAD_MOUNT = {
  boardSize: 24,
  dog:  { id: 'dog',  type: 'dog',  x: 1,  y: 12, radius: TOKEN_RADIUS },
  herd: { id: 'herd', type: 'herd', x: 10, y: 22, radius: HERD_RADIUS  }, // 10" from left (24-10=14" from right), 2" from bottom (24-2=22)
  pen:  { id: 'pen',  type: 'pen',  x: 20, y: 4, w: 8, h: 8, openSide: 'bottom' }, // Top right corner: center at (20,4), opens bottom
  looseAnimals: [],
  escapedCount: 0,
  events: [],
  turn: 1,
  phase: 'deployment',
  terrain: [
    { id: 'labouring_right', type: 'labouring', x: 18, y: 12, w: 12, h: 24 }, // Right half of board: center at x=18, covers x=12 to x=24
  ],
  rng: Math.random,
};

const BOGS_EDGE = {
  boardSize: 24,
  dog:  { id: 'dog',  type: 'dog',  x: 1,  y: 12, radius: TOKEN_RADIUS },
  herd: { id: 'herd', type: 'herd', x: 10, y: 8,  radius: HERD_RADIUS  }, // 10" from left, 8" from top
  pen:  { id: 'pen',  type: 'pen',  x: 10, y: 18, w: 8, h: 8, openSide: 'right' }, // 8" from right (24-8=16, center at 12), 2" from bottom (24-2=22, center at 22), 8"x4", opens right
  looseAnimals: [],
  escapedCount: 0,
  events: [],
  turn: 1,
  phase: 'deployment',
  terrain: [
    { id: 'murky_water', type: 'antithetical', x: 20, y: 12, w: 8, h: 24 }, // 8" wide strip along right side: spans x=16 to x=24, center at x=20
  ],
  rng: Math.random,
};

const SCENARIOS = [
  { id: 'walk_up', name: 'Walk Up', state: WALK_UP },
  { id: 'rotten_bridge', name: 'Rotten Bridge', state: ROTTEN_BRIDGE },
  { id: 'dead_mount', name: 'Dead Mount', state: DEAD_MOUNT },
  { id: 'bogs_edge', name: "Bog's Edge", state: BOGS_EDGE },
];

// ─────────────────────────────────────────────────────────────────────────────
// BOARD SVG — pure rendering
// ─────────────────────────────────────────────────────────────────────────────

const BOARD_PX = 480;

function toPx(inches) { return (inches / 24) * BOARD_PX; }

function TerrainLayer({ terrain = [] }) {
  return (
    <g>
      {/* Antithetical terrain (murky water - pulls animals toward dog) */}
      {terrain.filter(t => t.type === 'antithetical').map(t => {
        const left = toPx(t.x - t.w/2);
        const top = toPx(t.y - t.h/2);
        const width = toPx(t.w);
        const height = toPx(t.h);
        return (
          <g key={t.id}>
            <rect x={left} y={top} width={width} height={height}
              fill="#4a6a58" opacity={0.5} />
            <rect x={left} y={top} width={width} height={height}
              fill="none" stroke="#2a4a38" strokeWidth={2} strokeDasharray="6,4" opacity={0.7} />
            {/* Swirling pattern */}
            {[0.2, 0.4, 0.6, 0.8].map((rx, i) => (
              <circle key={`c${i}`}
                cx={left + width * rx} cy={top + height * 0.5}
                r={8 + i * 2}
                fill="none" stroke="#3a5a48" strokeWidth={1.5} opacity={0.3}
                strokeDasharray="4,4" />
            ))}
          </g>
        );
      })}

      {/* Labouring terrain (muddy/rough ground) */}
      {terrain.filter(t => t.type === 'labouring').map(t => {
        const left = toPx(t.x - t.w/2);
        const top = toPx(t.y - t.h/2);
        const width = toPx(t.w);
        const height = toPx(t.h);
        return (
          <g key={t.id}>
            <rect x={left} y={top} width={width} height={height}
              fill="#8a7a5a" opacity={0.25} />
            <rect x={left} y={top} width={width} height={height}
              fill="none" stroke="#7a6a48" strokeWidth={1.5} strokeDasharray="4,3" opacity={0.6} />
            {/* Mud texture - diagonal lines */}
            {Array.from({length: Math.ceil(width / 15)}, (_, i) => (
              <line key={`v${i}`}
                x1={left + i * 15} y1={top}
                x2={left + i * 15 + height * 0.3} y2={top + height}
                stroke="#7a6a48" strokeWidth={1} opacity={0.2} />
            ))}
          </g>
        );
      })}

      {/* Impassable terrain (water) */}
      {terrain.filter(t => t.type === 'impassable').map(t => {
        const left = toPx(t.x - t.w/2);
        const top = toPx(t.y - t.h/2);
        const width = toPx(t.w);
        const height = toPx(t.h);
        return (
          <g key={t.id}>
            <rect x={left} y={top} width={width} height={height}
              fill="#5a8ab8" opacity={0.6} />
            <rect x={left} y={top} width={width} height={height}
              fill="none" stroke="#3a6a98" strokeWidth={2} />
            {/* Water ripples */}
            {[0.25, 0.5, 0.75].map((ry, i) => (
              <line key={i}
                x1={left + 4} y1={top + height * ry}
                x2={left + width - 4} y2={top + height * ry}
                stroke="#7aa8d8" strokeWidth={1.5} opacity={0.4}
                strokeDasharray="8,6" />
            ))}
          </g>
        );
      })}

      {/* Decorative grass patches */}
      <g opacity="0.9">
        {[
          {cx:3,  cy:19, rx:3,   ry:2,   rot:-8,  fill:"#cdd89a"},
          {cx:20, cy:4,  rx:3.5, ry:2.2, rot:12,  fill:"#c5d490"},
          {cx:20, cy:20, rx:2.5, ry:1.8, rot:5,   fill:"#cdd89a"},
          {cx:10, cy:3,  rx:2.8, ry:1.6, rot:-15, fill:"#c5d490"},
          {cx:3,  cy:6,  rx:2,   ry:1.5, rot:10,  fill:"#cdd89a"},
        ].map((p,i) => (
          <ellipse key={i} cx={toPx(p.cx)} cy={toPx(p.cy)} rx={toPx(p.rx)} ry={toPx(p.ry)}
            transform={`rotate(${p.rot},${toPx(p.cx)},${toPx(p.cy)})`}
            fill={p.fill} stroke="#a8b870" strokeWidth={0.8} opacity={0.35} />
        ))}
        {/* Grass blades */}
        {Array.from({length:22},(_,i)=>({
          x:(Math.sin(i*6.1)*0.5+0.5)*22+1,
          y:(Math.cos(i*3.9)*0.5+0.5)*22+1,
        })).map((b,i)=>(
          <line key={i} x1={toPx(b.x)} y1={toPx(b.y)} x2={toPx(b.x+0.12)} y2={toPx(b.y-0.45)}
            stroke="#849858" strokeWidth={1.1} opacity={0.3} />
        ))}
      </g>
    </g>
  );
}

function RulerLayer() {
  return (
    <g>
      {Array.from({length:13},(_,i)=>i*2).map(i=>(
        <g key={i}>
          <line x1={toPx(i)} y1={476} x2={toPx(i)} y2={480}
            stroke="#8a7a5a" strokeWidth={0.8} opacity={0.55}/>
          {i>0 && i%4===0 && (
            <text x={toPx(i)} y={475} textAnchor="middle"
              fontSize={7} fontFamily="monospace" fill="#7a6a48" opacity={0.65}>
              {i}"
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

function PenEntity({ pen }) {
  const cx=toPx(pen.x), cy=toPx(pen.y), w=toPx(pen.w), h=toPx(pen.h);
  const x = cx - w/2, y = cy - h/2;

  // Determine which sides have solid walls
  const hasLeftWall = pen.openSide !== 'left';
  const hasRightWall = pen.openSide !== 'right';
  const hasTopWall = pen.openSide !== 'top';
  const hasBottomWall = pen.openSide !== 'bottom';

  return (
    <g>
      {/* Floor area */}
      <rect x={x} y={y} width={w} height={h} fill="#ede4c8" opacity={0.85}/>

      {/* Solid walls (thick brown lines) */}
      {hasLeftWall && (
        <line x1={x} y1={y} x2={x} y2={y+h}
          stroke="#5a4a28" strokeWidth={3} opacity={0.95}/>
      )}
      {hasRightWall && (
        <line x1={x+w} y1={y} x2={x+w} y2={y+h}
          stroke="#5a4a28" strokeWidth={3} opacity={0.95}/>
      )}
      {hasTopWall && (
        <line x1={x} y1={y} x2={x+w} y2={y}
          stroke="#5a4a28" strokeWidth={3} opacity={0.95}/>
      )}
      {hasBottomWall && (
        <line x1={x} y1={y+h} x2={x+w} y2={y+h}
          stroke="#5a4a28" strokeWidth={3} opacity={0.95}/>
      )}

      {/* Open side (dashed line) */}
      {!hasLeftWall && (
        <line x1={x} y1={y} x2={x} y2={y+h}
          stroke="#7a5a38" strokeWidth={1.5} strokeDasharray="6,3" opacity={0.5}/>
      )}
      {!hasRightWall && (
        <line x1={x+w} y1={y} x2={x+w} y2={y+h}
          stroke="#7a5a38" strokeWidth={1.5} strokeDasharray="6,3" opacity={0.5}/>
      )}
      {!hasTopWall && (
        <line x1={x} y1={y} x2={x+w} y2={y}
          stroke="#7a5a38" strokeWidth={1.5} strokeDasharray="6,3" opacity={0.5}/>
      )}
      {!hasBottomWall && (
        <line x1={x} y1={y+h} x2={x+w} y2={y+h}
          stroke="#7a5a38" strokeWidth={1.5} strokeDasharray="6,3" opacity={0.5}/>
      )}

      <text x={cx} y={cy+h/2+14} textAnchor="middle"
        fontSize={10} fontFamily="monospace" fontWeight="600"
        fill="#7a5a38" letterSpacing={1}>PEN</text>
    </g>
  );
}

function DogRangeRing({ dog, preview }) {
  const cx=toPx(dog.x), cy=toPx(dog.y), r=toPx(DOG_MOVE_MAX);
  return (
    <g>
      <circle cx={cx} cy={cy} r={r}
        fill={preview ? "none" : "rgba(58,88,120,0.06)"}
        stroke="#3a5878" strokeWidth={1.5} strokeDasharray="5,4" opacity={0.65}/>
      <text x={cx+r+4} y={cy} dominantBaseline="middle"
        fontSize={8} fontFamily="monospace" fill="#3a5878" opacity={0.7}>
        12"
      </text>
    </g>
  );
}

function SpookRing({ dog }) {
  const cx=toPx(dog.x), cy=toPx(dog.y), r=toPx(DOG_SPOOK_RANGE);
  return (
    <circle cx={cx} cy={cy} r={r} fill="none"
      stroke="#c87040" strokeWidth={1} strokeDasharray="3,3" opacity={0.4}/>
  );
}

function HerdEntity({ herd }) {
  const cx=toPx(herd.x), cy=toPx(herd.y), r=toPx(herd.radius);
  const blobs=[{dx:-.55,dy:-.35},{dx:.45,dy:-.28},{dx:-.15,dy:.45},{dx:.5,dy:.42},{dx:.02,dy:-.7}];
  return (
    <g>
      <circle cx={cx+2} cy={cy+2} r={r} fill="#9a9070" opacity={0.18}/>
      <circle cx={cx} cy={cy} r={r} fill="#d8f0c0" stroke="#5a8040"
        strokeWidth={2} strokeDasharray="4,2.5"/>
      {blobs.map((o,i)=> {
        const bx=cx+o.dx*(r-6), by=cy+o.dy*(r-6);
        const br=Math.min(r*0.22, 7);
        return Math.sqrt(o.dx**2+o.dy**2)*(r-6) < r-6 ? (
          <circle key={i} cx={bx} cy={by} r={br}
            fill="#f4f0e0" stroke="#9ab878" strokeWidth={0.5}/>
        ) : null;
      })}
      <circle cx={cx} cy={cy} r={r*.27} fill="#5a8040"/>
      <text x={cx} y={cy+r+15} textAnchor="middle"
        fontSize={11} fontFamily="monospace" fontWeight="600" fill="#3a5a20">
        HERD
      </text>
    </g>
  );
}

function LooseAnimalEntity({ la }) {
  const cx=toPx(la.x), cy=toPx(la.y), r=toPx(la.radius);
  const rejoining = la.rejoining;
  return (
    <g opacity={rejoining ? 0.6 : 1}>
      <circle cx={cx+1} cy={cy+1} r={r} fill="#9a9070" opacity={0.22}/>
      <circle cx={cx} cy={cy} r={r} fill="#f4f0d8"
        stroke={rejoining ? "#5a8040" : "#b89828"}
        strokeWidth={rejoining ? 2 : 1.5}
        strokeDasharray="2,1.5"/>
      <circle cx={cx} cy={cy} r={2.5} fill={rejoining ? "#5a8040" : "#b89828"}/>
      <text x={cx} y={cy+r+10} textAnchor="middle"
        fontSize={8} fontFamily="monospace" fill={rejoining ? "#3a5a20" : "#9a8010"}>
        {la.id.replace('loose_','L')}
      </text>
    </g>
  );
}

function DogEntity({ dog }) {
  const cx=toPx(dog.x), cy=toPx(dog.y), r=toPx(dog.radius);
  return (
    <g>
      <circle cx={cx+1} cy={cy+1} r={r} fill="#304058" opacity={0.25}/>
      <circle cx={cx} cy={cy} r={r} fill="#3a5878" stroke="#1a3858" strokeWidth={1.8}/>
      <circle cx={cx-r*.3} cy={cy-r*.3} r={r*.28} fill="#aaccee" opacity={0.65}/>
      <text x={cx} y={cy+r+10} textAnchor="middle"
        fontSize={9} fontFamily="monospace" fontWeight="600" fill="#1a3858">
        DOG
      </text>
    </g>
  );
}

// Ghost dog shown at tap preview location
function GhostDog({ x, y }) {
  const cx=toPx(x), cy=toPx(y), r=toPx(TOKEN_RADIUS);
  return (
    <g opacity={0.55}>
      <circle cx={cx} cy={cy} r={r} fill="#3a5878" stroke="#1a3858"
        strokeWidth={1.5} strokeDasharray="2,1"/>
      <line x1={toPx(0)} y1={0} x2={toPx(0)} y2={0}/>
    </g>
  );
}

// Dashed line from dog to ghost
function MoveLine({ from, to }) {
  return (
    <line
      x1={toPx(from.x)} y1={toPx(from.y)}
      x2={toPx(to.x)}   y2={toPx(to.y)}
      stroke="#3a5878" strokeWidth={1.2}
      strokeDasharray="4,3" opacity={0.5}/>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE BANNER
// ─────────────────────────────────────────────────────────────────────────────

const PHASE_META = {
  deployment:    { label: "Deployment",    color: "#a8b8c8", border: "#7898b8", text: "#1a2a3a" },
  dumb_animals:  { label: "Dumb Animals",  color: "#c8b888", border: "#a89868", text: "#3a2e1a" },
  come_by:       { label: "Come-by",       color: "#b8c8a0", border: "#8aaa70", text: "#2a3a1a" },
  loose_animal:  { label: "Loose Animal",  color: "#c8b888", border: "#a89868", text: "#3a2e1a" },
  move_herd:     { label: "Move Herd",     color: "#c8b888", border: "#a89868", text: "#3a2e1a" },
  finished:      { label: "Finished!",     color: "#a0c0a0", border: "#6a9060", text: "#1a3a1a" },
};

// ─────────────────────────────────────────────────────────────────────────────
// MAP SELECTOR
// ─────────────────────────────────────────────────────────────────────────────

function MapSelector({ onSelect }) {
  return (
    <div style={{
      fontFamily: "'Source Code Pro', monospace",
      maxWidth: 480,
      margin: '0 auto',
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100dvh',
      background: '#e8dfc8',
    }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Source+Code+Pro:wght@400;600&display=swap"/>

      {/* Header */}
      <div style={{
        padding: '16px 16px 12px',
        borderBottom: '1.5px solid #8a7a5a',
        background: '#ddd3b8',
      }}>
        <div style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: 22, fontWeight: 700, color: '#3a2e1a',
          lineHeight: 1.1, marginBottom: 3,
        }}>
          Herding<sup style={{
            fontSize: 11, fontFamily: 'monospace',
            color: '#7a6a48', fontWeight: 400,
          }}>28</sup>
        </div>
        <div style={{
          fontSize: 9, textTransform: 'uppercase',
          letterSpacing: '0.12em', color: '#7a6a48',
        }}>
          Choose a field trial
        </div>
      </div>

      {/* Map list */}
      <div style={{ padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {SCENARIOS.map(scenario => (
          <button
            key={scenario.id}
            onClick={() => onSelect(scenario)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: '14px 16px',
              background: '#ddd3b8',
              border: '1px solid #b0a07a',
              borderRadius: 3,
              cursor: 'pointer',
              textAlign: 'left',
              WebkitTapHighlightColor: 'transparent',
              minHeight: 56,
            }}
          >
            <div>
              <div style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: 16, fontWeight: 700,
                color: '#3a2e1a', lineHeight: 1.2,
              }}>
                {scenario.name}
              </div>
            </div>
            <div style={{
              fontSize: 16, color: '#8a7a5a', lineHeight: 1,
            }}>›</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// ANIMATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function lerp(a, b, t) { return a + (b - a) * t; }

/** Extract just the renderable positions from a game state. */
function snapshotPos(state) {
  return {
    dog:         { x: state.dog.x,  y: state.dog.y  },
    herd:        { x: state.herd.x, y: state.herd.y },
    looseAnimals: state.looseAnimals.map(la => ({
      id: la.id, radius: la.radius, x: la.x, y: la.y,
    })),
  };
}

export default function App() {
  // ── Screen routing ───────────────────────────────────────────────────────
  const [screen,    setScreen]      = useState('select'); // 'select' | 'game'
  const [scenario,  setScenario]    = useState(null);

  // ── Core game state ───────────────────────────────────────────────────────
  const [gameState, setGameState]   = useState(null);
  const [preview,   setPreview]     = useState(null);
  const [invalid,   setInvalid]     = useState(false);
  const svgRef = useRef(null);

  // ── Animation state ───────────────────────────────────────────────────────
  // displayPos holds the positions actually rendered; lerped during animation.
  const [displayPos, setDisplayPos] = useState(null);
  // animRef carries mutable animation bookkeeping outside React render cycle.
  const animRef = useRef({
    phase:      'idle',   // 'dog' | 'loose' | 'herd' | 'dumb_loose' | 'dumb_herd' | 'idle'
    startMs:    0,
    fromDog:    null,     // {x,y}
    toDog:      null,
    fromHerd:   null,
    toHerd:     null,
    // Array of {id, radius, fromX, fromY, toX, toY}
    looseFrames: [],
    // Second animation set for dumb_animals phase
    fromHerd2:   null,
    toHerd2:     null,
    looseFrames2: [],
    raf:        null,
    midState:   null,     // state after move_herd, before dumb_animals
    finalState: null,     // final state after dumb_animals
  });

  // ── Start a scenario ─────────────────────────────────────────────────────
  const startScenario = useCallback((sc) => {
    // Cancel any in-flight animation
    const anim = animRef.current;
    if (anim.raf) { cancelAnimationFrame(anim.raf); anim.raf = null; }
    anim.phase = 'idle';

    const initial = { ...sc.state, rng: Math.random };

    // If starting with deployment, don't process any turns yet
    let ready;
    if (initial.phase === 'deployment') {
      ready = initial;
      // Initialize preview with dog's starting position so Deploy button shows immediately
      setPreview({ x: ready.dog.x, y: ready.dog.y });
    } else {
      ready = processTurn(initial, null, 'come_by');
      setPreview(null);
    }

    setDisplayPos(snapshotPos(ready));
    setGameState(ready);
    setScenario(sc);
    setScreen('game');
  }, []);

  // ── Return to map selector ────────────────────────────────────────────────
  const goToSelect = useCallback(() => {
    const anim = animRef.current;
    if (anim.raf) { cancelAnimationFrame(anim.raf); anim.raf = null; }
    anim.phase = 'idle';
    setGameState(null);
    setDisplayPos(null);
    setPreview(null);
    setScreen('select');
  }, []);

  // ── Animation loop ────────────────────────────────────────────────────────
  // Starts when handleConfirm / handleSkip call commitMove().
  const runAnim = useCallback(() => {
    const anim = animRef.current;
    const now  = performance.now();
    const t    = Math.min(1, (now - anim.startMs) / 500); // 0..1 over 500 ms
    const ease = t; // linear per spec

    if (anim.phase === 'dog') {
      const dx = lerp(anim.fromDog.x, anim.toDog.x, ease);
      const dy = lerp(anim.fromDog.y, anim.toDog.y, ease);
      setDisplayPos(prev => ({ ...prev, dog: { x: dx, y: dy } }));

      if (t >= 1) {
        // Skip loose animals stage if there are none
        if (anim.looseFrames.length === 0) {
          anim.phase   = 'herd';
          anim.startMs = performance.now();
        } else {
          // Advance to loose animals stage — show all of them at their from positions
          anim.phase   = 'loose';
          anim.startMs = performance.now();
          // Seed displayPos with all loose animals at their from positions
          setDisplayPos(prev => ({
            ...prev,
            looseAnimals: anim.looseFrames.map(f => ({
              id: f.id, radius: f.radius, x: f.fromX, y: f.fromY,
            })),
          }));
        }
      }
    } else if (anim.phase === 'loose') {
      const frames = anim.looseFrames.map(f => ({
        id:     f.id,
        radius: f.radius,
        x: lerp(f.fromX, f.toX, ease),
        y: lerp(f.fromY, f.toY, ease),
        rejoining: f.rejoining,
      }));
      setDisplayPos(prev => ({ ...prev, looseAnimals: frames }));

      if (t >= 1) {
        // Filter out rejoined animals before advancing to herd stage
        const stillPresent = anim.looseFrames
          .filter(f => !f.rejoining)
          .map(f => ({ id: f.id, radius: f.radius, x: f.toX, y: f.toY }));
        setDisplayPos(prev => ({ ...prev, looseAnimals: stillPresent }));

        // Advance to herd stage
        anim.phase   = 'herd';
        anim.startMs = performance.now();
      }
    } else if (anim.phase === 'herd') {
      const hx = lerp(anim.fromHerd.x, anim.toHerd.x, ease);
      const hy = lerp(anim.fromHerd.y, anim.toHerd.y, ease);
      setDisplayPos(prev => ({ ...prev, herd: { x: hx, y: hy } }));

      if (t >= 1) {
        // Transition to dumb_animals phase animations
        // Check if there are loose animals that wander
        if (anim.looseFrames2.length > 0) {
          anim.phase = 'dumb_loose';
          anim.startMs = performance.now();
          // Seed displayPos with loose animals at their post-move_herd positions
          setDisplayPos(prev => ({
            ...prev,
            looseAnimals: anim.looseFrames2.map(f => ({
              id: f.id, radius: f.radius, x: f.fromX, y: f.fromY,
            })),
          }));
        } else {
          // Check if herd wanders
          const herdMoved = anim.fromHerd2.x !== anim.toHerd2.x || anim.fromHerd2.y !== anim.toHerd2.y;
          if (herdMoved) {
            anim.phase = 'dumb_herd';
            anim.startMs = performance.now();
          } else {
            // No dumb_animals movement, finish
            anim.phase = 'idle';
            anim.raf   = null;
            setDisplayPos(snapshotPos(anim.finalState));
            setGameState(anim.finalState);
            return; // stop loop
          }
        }
      }
    } else if (anim.phase === 'dumb_loose') {
      const frames = anim.looseFrames2.map(f => ({
        id:     f.id,
        radius: f.radius,
        x: lerp(f.fromX, f.toX, ease),
        y: lerp(f.fromY, f.toY, ease),
        rejoining: f.rejoining,
      }));
      setDisplayPos(prev => ({ ...prev, looseAnimals: frames }));

      if (t >= 1) {
        // Filter out rejoined animals before advancing to dumb_herd stage
        const stillPresent = anim.looseFrames2
          .filter(f => !f.rejoining)
          .map(f => ({ id: f.id, radius: f.radius, x: f.toX, y: f.toY }));
        setDisplayPos(prev => ({ ...prev, looseAnimals: stillPresent }));

        // Advance to dumb_herd stage
        anim.phase   = 'dumb_herd';
        anim.startMs = performance.now();
      }
    } else if (anim.phase === 'dumb_herd') {
      const hx = lerp(anim.fromHerd2.x, anim.toHerd2.x, ease);
      const hy = lerp(anim.fromHerd2.y, anim.toHerd2.y, ease);
      setDisplayPos(prev => ({ ...prev, herd: { x: hx, y: hy } }));

      if (t >= 1) {
        // Animation complete — snap to final game state positions
        anim.phase = 'idle';
        anim.raf   = null;
        setDisplayPos(snapshotPos(anim.finalState));
        setGameState(anim.finalState);
        return; // stop loop
      }
    }

    anim.raf = requestAnimationFrame(runAnim);
  }, []);

  // ── Commit a move: compute from→to, kick off animation ───────────────────
  const commitMove = useCallback((action) => {
    if (!gameState) return;
    const prev = gameState;

    const anim = animRef.current;
    // Cancel any in-flight animation
    if (anim.raf) cancelAnimationFrame(anim.raf);

    // ── Deployment phase: skip to dumb_animals animation only ────
    if (prev.phase === 'deployment') {
      // Deploy dog, then run dumb_animals
      const afterDeployment = processTurn(prev, action, 'dumb_animals');
      const final = processTurn(afterDeployment, null, 'come_by');

      // Set up animation state (required for cleanup)
      anim.fromDog  = { x: afterDeployment.dog.x,  y: afterDeployment.dog.y  };
      anim.toDog    = { x: afterDeployment.dog.x,  y: afterDeployment.dog.y  };
      anim.looseFrames = [];
      anim.fromHerd = { x: afterDeployment.herd.x, y: afterDeployment.herd.y };
      anim.toHerd   = { x: afterDeployment.herd.x, y: afterDeployment.herd.y };
      anim.looseFrames2 = [];

      // ── Animate dumb_animals wandering directly ────
      anim.fromHerd2 = { x: afterDeployment.herd.x, y: afterDeployment.herd.y };
      anim.toHerd2   = { x: final.herd.x, y: final.herd.y };

      anim.midState   = afterDeployment;
      anim.finalState = final;

      // Skip directly to dumb_herd phase (no 500ms delay for dog/loose/herd)
      const herdMoved = anim.fromHerd2.x !== anim.toHerd2.x || anim.fromHerd2.y !== anim.toHerd2.y;
      if (herdMoved) {
        anim.phase      = 'dumb_herd';
        anim.startMs    = performance.now();
        setDisplayPos(snapshotPos(afterDeployment));
        anim.raf = requestAnimationFrame(runAnim);
      } else {
        // Herd didn't move, finish immediately
        anim.phase = 'idle';
        setDisplayPos(snapshotPos(final));
        setGameState(final);
      }
      return;
    }

    // ── Normal turn: process through move_herd, then dumb_animals ────

    // Process through move_herd, stop before dumb_animals
    const afterMoveHerd = processTurn(prev, action, 'dumb_animals');

    // Process dumb_animals, stop before come_by
    const final = processTurn(afterMoveHerd, null, 'come_by');

    // ── First animation: move_herd phase (dog + loose + herd movements) ────

    // Record from→to for dog
    anim.fromDog  = { x: prev.dog.x,  y: prev.dog.y  };
    anim.toDog    = { x: afterMoveHerd.dog.x,  y: afterMoveHerd.dog.y  };

    // Record from→to for herd
    anim.fromHerd = { x: prev.herd.x, y: prev.herd.y };
    anim.toHerd   = { x: afterMoveHerd.herd.x, y: afterMoveHerd.herd.y };

    // Record from→to for each loose animal during move_herd.
    // New animals (not in prev) start at prev herd position (spawn point).
    // Animals that rejoined during move_herd animate to herd center before disappearing.
    const prevLaMap = Object.fromEntries(prev.looseAnimals.map(la => [la.id, la]));
    const midLaIds = new Set(afterMoveHerd.looseAnimals.map(la => la.id));

    // Animals still present after move_herd
    const presentFrames = afterMoveHerd.looseAnimals.map(la => {
      const from = prevLaMap[la.id] ?? { x: prev.herd.x, y: prev.herd.y };
      return { id: la.id, radius: la.radius, fromX: from.x, fromY: from.y, toX: la.x, toY: la.y };
    });

    // Animals that rejoined during move_herd - animate to herd center
    const rejoinedFrames = prev.looseAnimals
      .filter(la => !midLaIds.has(la.id) && afterMoveHerd.events.some(e => e.includes(la.id) && e.includes('rejoined')))
      .map(la => ({
        id: la.id,
        radius: la.radius,
        fromX: la.x,
        fromY: la.y,
        toX: afterMoveHerd.herd.x,
        toY: afterMoveHerd.herd.y,
        rejoining: true,
      }));

    anim.looseFrames = [...presentFrames, ...rejoinedFrames];

    // ── Second animation: dumb_animals phase (wandering) ────

    // Record from→to for herd during dumb_animals
    anim.fromHerd2 = { x: afterMoveHerd.herd.x, y: afterMoveHerd.herd.y };
    anim.toHerd2   = { x: final.herd.x, y: final.herd.y };

    // Record from→to for loose animals during dumb_animals
    const midLaMap = Object.fromEntries(afterMoveHerd.looseAnimals.map(la => [la.id, la]));
    const finalLaIds = new Set(final.looseAnimals.map(la => la.id));

    // Animals still present after dumb_animals
    const presentFrames2 = final.looseAnimals.map(la => {
      const from = midLaMap[la.id];
      if (!from) return null; // animal was removed (escaped/rejoined)
      return { id: la.id, radius: la.radius, fromX: from.x, fromY: from.y, toX: la.x, toY: la.y };
    }).filter(Boolean);

    // Animals that rejoined during dumb_animals - animate to herd center
    const rejoinedFrames2 = afterMoveHerd.looseAnimals
      .filter(la => !finalLaIds.has(la.id) && final.events.some(e => e.includes(la.id) && e.includes('rejoined')))
      .map(la => ({
        id: la.id,
        radius: la.radius,
        fromX: la.x,
        fromY: la.y,
        toX: final.herd.x,
        toY: final.herd.y,
        rejoining: true,
      }));

    anim.looseFrames2 = [...presentFrames2, ...rejoinedFrames2];

    anim.midState   = afterMoveHerd;
    anim.finalState = final;
    anim.phase      = 'dog';
    anim.startMs    = performance.now();

    // Start displayPos at current (pre-move) positions
    setDisplayPos(snapshotPos(prev));
    // Keep gameState as prev during animation; commitMove will set it when done.
    // (gameState stays prev until anim.phase reaches 'idle')

    anim.raf = requestAnimationFrame(runAnim);
  }, [gameState, runAnim]);

  // ── SVG tap → game coordinates ───────────────────────────────────────────
  const svgToGame = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const svgX = (clientX - rect.left) / rect.width  * BOARD_PX;
    const svgY = (clientY - rect.top)  / rect.height * BOARD_PX;
    return { x: svgX / BOARD_PX * 24, y: svgY / BOARD_PX * 24 };
  }, []);

  // ── Handle tap on board ───────────────────────────────────────────────────
  const handleBoardTap = useCallback((e) => {
    if (!gameState) return;
    if (animRef.current.phase !== 'idle') return; // ignore taps during animation
    e.preventDefault();

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const tap = svgToGame(clientX, clientY);
    if (!tap) return;

    // Deployment phase - place dog within 2" of left edge
    if (gameState.phase === 'deployment') {
      const deploymentZone = 2 + gameState.dog.radius;
      if (tap.x > deploymentZone) {
        setInvalid(true);
        setTimeout(() => setInvalid(false), 600);
        return;
      }
      setPreview(tap);
      return;
    }

    // Come-by phase - move dog within 12"
    if (gameState.phase === 'come_by') {
      const distance = dist(gameState.dog, tap);
      if (distance > DOG_MOVE_MAX) {
        setInvalid(true);
        setTimeout(() => setInvalid(false), 600);
        return;
      }
      // Always update preview on valid click, even if preview already exists
      setPreview(tap);
      return;
    }
  }, [gameState, svgToGame]);

  // ── Confirm move/deployment ───────────────────────────────────────────────
  const handleConfirm = useCallback(() => {
    if (!preview || !gameState) return;
    setPreview(null);

    if (gameState.phase === 'deployment') {
      // Deploy dog - triggers animation through commitMove
      commitMove({ type: 'deploy_dog', x: preview.x, y: preview.y });
    } else {
      commitMove({ type: 'move_dog', x: preview.x, y: preview.y });
    }
  }, [preview, gameState, commitMove]);

  // ── Cancel preview ────────────────────────────────────────────────────────
  const handleCancel = useCallback(() => setPreview(null), []);

  // ── Skip ──────────────────────────────────────────────────────────────────
  const handleSkip = useCallback(() => {
    if (!gameState) return;
    setPreview(null);
    commitMove({ type: 'end_turn' });
  }, [gameState, commitMove]);

  // ── Cleanup rAF on unmount ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (animRef.current.raf) cancelAnimationFrame(animRef.current.raf);
    };
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  // ── Screen routing ───────────────────────────────────────────────────────
  if (screen === 'select') {
    return <MapSelector onSelect={startScenario} />;
  }

  if (!gameState || !displayPos) {
    return (
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',
        fontFamily:'monospace',color:'#7a6a48',fontSize:13}}>
        Setting up the pasture…
      </div>
    );
  }

  const isAnimating  = animRef.current.phase !== 'idle';
  // During animation use displayPos for positions; use gameState for everything else.
  // gameState itself is only updated when animation completes, so phase/events/etc.
  // remain stable (showing the pre-move state in the UI chrome until animation ends).
  const { phase, turn, escapedCount=0, events=[], pen } = gameState;
  const dog         = displayPos.dog  ? { ...gameState.dog,  ...displayPos.dog  } : gameState.dog;
  const herd        = displayPos.herd ? { ...gameState.herd, ...displayPos.herd } : gameState.herd;
  const looseAnimals = displayPos.looseAnimals ?? gameState.looseAnimals;

  const phaseMeta   = PHASE_META[phase] || PHASE_META.dumb_animals;
  const isDeployment  = phase === 'deployment' && !isAnimating;
  const isInteractive = phase === 'come_by' && !isAnimating && phase !== 'finished';
  const isFinished    = phase === 'finished';
  const recentEvents  = [...events].reverse().slice(0, 12);

  return (
    <div style={{
      fontFamily: "'Source Code Pro', monospace",
      maxWidth: 480,
      margin: '0 auto',
      display: 'flex',
      flexDirection: 'column',
      background: 'transparent',
      userSelect: 'none',
      WebkitUserSelect: 'none',
    }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Source+Code+Pro:wght@400;600&display=swap"/>

      {/* ── Header ── */}
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'8px 10px 7px',
        borderBottom:'1.5px solid #8a7a5a',
        background:'#ddd3b8',
      }}>
        <div style={{
          fontFamily:"'Playfair Display', serif",
          fontSize:17, fontWeight:700, color:'#3a2e1a',
        }}>
          Herding<sup style={{fontSize:9,fontFamily:'monospace',color:'#7a6a48',fontWeight:400}}>28</sup>
          {' '}
        </div>
        <div style={{
          fontSize:9, textTransform:'uppercase', letterSpacing:'0.1em',
          padding:'3px 8px', borderRadius:2,
          background: phaseMeta.color,
          color: phaseMeta.text,
          border:`1px solid ${phaseMeta.border}`,
          whiteSpace:'nowrap',
        }}>
          {isAnimating ? 'Animating…' : phaseMeta.label}
        </div>
      </div>

      {/* ── Board ── */}
      <div style={{
        width:'100%', position:'relative',
        border: invalid ? '2px solid #c84030' : '2px solid #8a7a5a',
        transition: 'border-color 0.2s',
        boxSizing: 'border-box',
      }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${BOARD_PX} ${BOARD_PX}`}
          style={{display:'block', width:'100%', aspectRatio:'1/1', background:'#e8dfc8', touchAction:'none'}}
          onMouseDown={(isInteractive || isDeployment) ? handleBoardTap : undefined}
          onTouchStart={(isInteractive || isDeployment) ? handleBoardTap : undefined}
        >
          <defs>
            <pattern id="g1" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M20 0L0 0 0 20" fill="none" stroke="#c4b898" strokeWidth={0.5} opacity={0.55}/>
            </pattern>
            <pattern id="g5" width="100" height="100" patternUnits="userSpaceOnUse">
              <path d="M100 0L0 0 0 100" fill="none" stroke="#b0a07a" strokeWidth={1} opacity={0.4}/>
            </pattern>
          </defs>
          <rect width={BOARD_PX} height={BOARD_PX} fill="#e8dfc8"/>
          <rect width={BOARD_PX} height={BOARD_PX} fill="url(#g1)"/>
          <rect width={BOARD_PX} height={BOARD_PX} fill="url(#g5)"/>
          <rect x={1} y={1} width={BOARD_PX-2} height={BOARD_PX-2}
            fill="none" stroke="#8a7a5a" strokeWidth={2}/>

          <TerrainLayer terrain={gameState.terrain}/>
          <RulerLayer/>
          <PenEntity pen={pen}/>
          <SpookRing dog={dog}/>

          {/* Deployment zone indicator */}
          {isDeployment && (
            <rect x={0} y={0} width={toPx(2)} height={BOARD_PX}
              fill="rgba(58,88,120,0.12)" stroke="#3a5878"
              strokeWidth={2} strokeDasharray="8,4" opacity={0.7}/>
          )}

          {isInteractive && <DogRangeRing dog={dog} preview={!!preview}/>}

          {preview && (
            <>
              <MoveLine from={dog} to={preview}/>
              <GhostDog x={preview.x} y={preview.y}/>
            </>
          )}

          <HerdEntity herd={herd}/>
          {looseAnimals.map(la => <LooseAnimalEntity key={la.id} la={la}/>)}
          <DogEntity dog={dog}/>

          {invalid && (
            <rect width={BOARD_PX} height={BOARD_PX} fill="rgba(200,64,48,0.12)"
              style={{pointerEvents:'none'}}/>
          )}

          {isFinished && (
            <g>
              <rect width={BOARD_PX} height={BOARD_PX} fill="rgba(40,80,40,0.55)"/>
              <text x={BOARD_PX/2} y={BOARD_PX/2 - 18} textAnchor="middle"
                fontSize={38} fontFamily="'Playfair Display', serif" fill="#e8f4d8">
                That'll Do!
              </text>
              <text x={BOARD_PX/2} y={BOARD_PX/2 + 18} textAnchor="middle"
                fontSize={13} fontFamily="monospace" fill="#b8d8b0">
                {escapedCount === 0 ? "Perfect score — no escapes!" : `${escapedCount} animal${escapedCount===1?'':'s'} escaped`}
              </text>
            </g>
          )}
        </svg>

        {invalid && (
          <div style={{
            position:'absolute', bottom:8, left:'50%', transform:'translateX(-50%)',
            background:'rgba(180,40,30,0.88)', color:'#fff',
            fontSize:11, padding:'4px 12px', borderRadius:2,
            fontFamily:'monospace', letterSpacing:'0.05em',
            pointerEvents:'none',
          }}>
            Out of range — max 12"
          </div>
        )}
      </div>

      {/* ── Stats row ── */}
      <div style={{
        display:'flex', background:'#ddd3b8',
        borderBottom:'1px solid #b0a07a', borderTop:'1px solid #b0a07a',
      }}>
        {[
          { label:'Turn',     value: turn },
          { label:'Loose',    value: looseAnimals.length },
          { label:'Escaped',  value: escapedCount, danger: true },
          { label:'Dog↔Herd', value: dist(dog,herd).toFixed(1)+'"'  , small: true },
        ].map((s,i,arr) => (
          <div key={s.label} style={{
            flex:1, textAlign:'center', padding:'7px 4px 6px',
            borderRight: i<arr.length-1 ? '0.5px solid #bfaf90' : 'none',
          }}>
            <div style={{fontSize:8,textTransform:'uppercase',letterSpacing:'0.1em',color:'#7a6a48',marginBottom:1}}>
              {s.label}
            </div>
            <div style={{
              fontSize: s.small ? 13 : 16,
              fontWeight:600,
              color: s.danger && escapedCount > 0 ? '#8a3020' : '#3a2e1a',
              lineHeight:1.1,
              paddingTop: s.small ? 2 : 0,
            }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Action bar ── */}
      <div style={{
        background:'#d0c8b0',
        borderBottom:'1px solid #b0a07a',
        padding:'8px 10px',
        minHeight: 52,
        display:'flex', alignItems:'center', gap:8,
      }}>
        {isFinished ? (
          <>
            <div style={{fontSize:12,color:'#2a4a2a',fontFamily:'monospace',flex:1}}>
              🐕 Good dog. Give it a pat.
            </div>
            <button onClick={goToSelect} style={btnStyle('ghost')}>Maps</button>
          </>
        ) : isAnimating ? (
          <div style={{fontSize:11,color:'#7a6a48',fontFamily:'monospace',flex:1,textAlign:'center',letterSpacing:'0.04em'}}>
            {animRef.current.phase === 'dog'        ? 'Dog moving…' :
             animRef.current.phase === 'loose'      ? 'Loose animals fleeing…' :
             animRef.current.phase === 'herd'       ? 'Herd pushed back…' :
             animRef.current.phase === 'dumb_loose' ? 'Loose animals wandering…' :
                                                      'Herd wandering…'}
          </div>
        ) : isDeployment ? (
          <>
            <div style={{fontSize:11,color:'#4a3c22',flex:1}}>
              {preview ? `Deploy dog at (${preview.x.toFixed(1)}", ${preview.y.toFixed(1)}")?` : 'Tap within the blue zone to adjust position.'}
            </div>
            {preview && <button onClick={handleCancel} style={btnStyle('ghost')}>Cancel</button>}
            {preview && <button onClick={handleConfirm} style={btnStyle('primary')}>Deploy</button>}
          </>
        ) : preview ? (
          <>
            <div style={{fontSize:11,color:'#4a3c22',flex:1}}>
              Move to ({preview.x.toFixed(1)}", {preview.y.toFixed(1)}")?{" "}
              <span style={{color:'#7a6a48'}}>({dist(dog,preview).toFixed(1)}")</span>
            </div>
            <button onClick={handleCancel} style={btnStyle('ghost')}>Cancel</button>
            <button onClick={handleConfirm} style={btnStyle('primary')}>Send Dog</button>
          </>
        ) : (
          <>
            <div style={{fontSize:11,color:'#4a3c22',flex:1,lineHeight:1.4}}>
              Tap within the blue ring to move your dog.
            </div>
            <button onClick={handleSkip} style={btnStyle('ghost')}>Skip</button>
          </>
        )}
      </div>

      {/* ── Event log ── */}
      <div style={{
        background:'#ddd3b8',
        padding:'8px 10px',
        maxHeight: 130,
        overflowY:'auto',
      }}>
        <div style={{fontSize:8,textTransform:'uppercase',letterSpacing:'0.1em',color:'#7a6a48',marginBottom:5}}>
          Field notes
        </div>
        {(recentEvents.length ? recentEvents : ['Awaiting orders…']).map((ev,i)=>(
          <div key={i} style={{
            fontSize:9.5, lineHeight:1.45,
            borderBottom:'0.5px solid #bfaf90',
            padding:'2px 0',
            color: ev.includes('escaped')||ev.includes('fled') ? '#8a3020'
                 : ev.includes('spooked')||ev.includes('Spooked') ? '#7a5010'
                 : ev.includes('rejoined') ? '#3a6020'
                 : ev.includes("That'll do") ? '#1a4a2a'
                 : '#4a3c22',
          }}>
            {ev}
          </div>
        ))}
      </div>
    </div>
  );
}


function btnStyle(variant) {
  const base = {
    fontFamily:"'Source Code Pro', monospace",
    fontSize:11, fontWeight:600,
    padding:'7px 14px', borderRadius:2,
    border:'1px solid',
    cursor:'pointer',
    letterSpacing:'0.04em',
    textTransform:'uppercase',
    whiteSpace:'nowrap',
    minHeight:38,
    WebkitTapHighlightColor:'transparent',
  };
  if (variant === 'primary') return { ...base,
    background:'#3a5878', color:'#ddeeff',
    borderColor:'#1a3858',
  };
  return { ...base,
    background:'transparent', color:'#6a5a38',
    borderColor:'#a89868',
  };
}