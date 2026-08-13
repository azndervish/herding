// Pure game engine and scenario definitions. React UI lives in App.js.


const HERD_RADIUS   = 2.5;
const TOKEN_RADIUS  = 0.75;
const DOG_MOVE_MAX  = 12;
const DOG_SPOOK_RANGE = 8;
const HERD_CLEARANCE  = 10;
const INCHES_PER_FRAME = 2; // Dog sprite animation: inches traveled per frame change

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

function segmentsIntersect(a, b, x1, y1, x2, y2) {
  const cross = (p, q, r) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const onSegment = (p, q, r) =>
    q.x >= Math.min(p.x, r.x) - 1e-9 && q.x <= Math.max(p.x, r.x) + 1e-9 &&
    q.y >= Math.min(p.y, r.y) - 1e-9 && q.y <= Math.max(p.y, r.y) + 1e-9;
  const c = { x: x1, y: y1 };
  const d = { x: x2, y: y2 };
  const o1 = cross(a, b, c);
  const o2 = cross(a, b, d);
  const o3 = cross(c, d, a);
  const o4 = cross(c, d, b);

  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) &&
      ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  if (Math.abs(o1) <= 1e-9 && onSegment(a, c, b)) return true;
  if (Math.abs(o2) <= 1e-9 && onSegment(a, d, b)) return true;
  if (Math.abs(o3) <= 1e-9 && onSegment(c, a, d)) return true;
  if (Math.abs(o4) <= 1e-9 && onSegment(c, b, d)) return true;
  return false;
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

// DEBUG HELPERS

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


/**
 * Check if a point (x, y) is inside any impassable terrain rectangle.
 * Returns the terrain object if inside, null otherwise.
 */
function isInsideImpassableTerrain(x, y, terrain) {
  for (const t of terrain) {
    if (t.type !== 'impassable') continue;
    const left = t.x - t.w/2;
    const right = t.x + t.w/2;
    const top = t.y - t.h/2;
    const bottom = t.y + t.h/2;
    if (x >= left && x <= right && y >= top && y <= bottom) {
      return t;
    }
  }
  return null;
}

/**
 * If a placement point is inside impassable terrain, return a corrected
 * center point just outside the nearest edge.
 * Returns { x, y, corrected: boolean }.
 */
function correctImpassablePoint(x, y, terrain) {
  const overlapping = isInsideImpassableTerrain(x, y, terrain);
  if (!overlapping) {
    return { x, y, corrected: false };
  }

  // Find nearest edge and push entity outside
  const left = overlapping.x - overlapping.w/2;
  const right = overlapping.x + overlapping.w/2;
  const top = overlapping.y - overlapping.h/2;
  const bottom = overlapping.y + overlapping.h/2;

  // Calculate distance to each edge
  const distToLeft = Math.abs(x - left);
  const distToRight = Math.abs(x - right);
  const distToTop = Math.abs(y - top);
  const distToBottom = Math.abs(y - bottom);

  // Find minimum distance
  const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);

  let newX = x;
  let newY = y;

  if (minDist === distToLeft) {
    newX = left - 0.01;
  } else if (minDist === distToRight) {
    newX = right + 0.01;
  } else if (minDist === distToTop) {
    newY = top - 0.01;
  } else {
    newY = bottom + 0.01;
  }

  return { x: newX, y: newY, corrected: true };
}

/**
 * Resolves movement from current position to target, handling all collision types.
 * Returns { x, y, blocked, obstacle } where:
 * - x, y: final position after collision resolution
 * - blocked: true if movement was blocked by another entity
 * - obstacle: description of what blocked movement (if any)
 * @param {boolean} checkEntityCollisions - if false, only check walls/terrain (for dumb_animals phase)
 */
function resolveMovement(animal, targetX, targetY, state, escapedIds = new Set(), checkEntityCollisions = true) {
  const { pen, terrain = [], dog, herd, looseAnimals } = state;
  const walls = getPenWalls(pen);
  const others = !checkEntityCollisions ? [] : animal.type === 'loose'
    ? [dog, ...looseAnimals].filter(e => e.id !== animal.id && !escapedIds.has(e.id))
    : [dog, herd, ...looseAnimals].filter(e => e.id !== animal.id && !escapedIds.has(e.id));
  let lastValid = { x: animal.x, y: animal.y };

  // Ten equal steps, checked from the origin toward the requested destination.
  // Area terrain uses the token center only; fences use center-path crossing.
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    const candidate = {
      x: animal.x + (targetX - animal.x) * t,
      y: animal.y + (targetY - animal.y) * t,
      radius: animal.radius,
    };

    if (isInsideImpassableTerrain(candidate.x, candidate.y, terrain)) {
      return { ...lastValid, blocked: false, obstacle: 'impassable terrain' };
    }
    if (walls.some(wall => segmentsIntersect(lastValid, candidate, wall[0], wall[1], wall[2], wall[3]))) {
      return { ...lastValid, blocked: false, obstacle: 'pen wall' };
    }
    const hitEntity = others.find(other => entitiesContact(candidate, other));
    if (hitEntity) {
      return { ...lastValid, blocked: true, obstacle: hitEntity.id };
    }
    lastValid = { x: candidate.x, y: candidate.y };
  }

  return { ...lastValid, blocked: false, obstacle: null };
}


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
    const before = { x: animal.x, y: animal.y };
    const result = resolveMovement(animal, animal.x + dx, animal.y + dy, s);
    animal.x = result.x;
    animal.y = result.y;

    console.log(`[dumbAnimals T${s.turn}] ${animal.id}: roll=${roll} angle=${angle.toFixed(0)}°${inLabouring ? ' (labouring)' : ''} | (${before.x.toFixed(2)},${before.y.toFixed(2)}) → ${_pos(animal)}`);

    if (result.obstacle) {
      console.log(`[dumbAnimals T${s.turn}] ${animal.id} blocked by ${result.obstacle}, stopped at ${_pos(animal)}`);
      events.push(`Dumb Animals: ${animal.type === 'herd' ? 'Herd' : animal.id} bumped into ${result.obstacle}.`);
    } else {
      const labourMsg = inLabouring ? ' (labouring terrain)' : '';
      const angleMsg = animal.type === 'herd' ? ` (${angle.toFixed(0)}°)` : '';
      events.push(`Dumb Animals: ${animal.type === 'herd' ? 'Herd' : animal.id} wanders ${roll}"${angleMsg}${labourMsg}.`);
    }

    if (touchesEdge(animal, boardSize)) {
      if (animal.type === 'herd') {
        console.warn(`[dumbAnimals T${s.turn}] herd OOB at ${_pos(animal)} — clamping to board`);
        animal.x = Math.max(animal.radius, Math.min(boardSize - animal.radius, animal.x));
        animal.y = Math.max(animal.radius, Math.min(boardSize - animal.radius, animal.y));
        s.escapedCount = (s.escapedCount || 0) + 1;
        events.push(`Dumb Animals: Herd hit the board edge! +1 escape (${s.escapedCount} total).`);
      } else {
        console.warn(`[dumbAnimals T${s.turn}] ${animal.id} OOB at ${_pos(animal)} — marking escaped`);
        animal._escaped = true;
        events.push(`${animal.id} reached the edge and escaped!`);
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

function phaseComeBy(state, action) {
  const s = cloneState(state);
  const events = [];

  console.log(`[comeBy T${s.turn}] entry — dog ${_pos(s.dog)}, action=${JSON.stringify(action)}`);
  _checkStateOob('comeBy:entry', s);

  if (!action || action.type === 'end_turn') {
    console.log(`[comeBy T${s.turn}] dog holds position`);
    events.push('Come-by: Dog holds position.');
    // Preserve facing when dog doesn't move
    if (!s.dog.facing) s.dog.facing = 'right';
    s.events = [...s.events, ...events]; s.phase = 'loose_animal'; return s;
  }
  if (action.type !== 'move_dog') throw new Error(`Unknown action: ${action.type}`);
  const target = { x: action.x, y: action.y };
  const distance = dist(s.dog, target);
  console.log(`[comeBy T${s.turn}] target=(${target.x.toFixed(2)},${target.y.toFixed(2)}) dist=${distance.toFixed(2)}"${distance > DOG_MOVE_MAX ? ' ⚠ EXCEEDS MAX' : ''}`);
  if (distance > DOG_MOVE_MAX + 1e-9) throw new Error(`Move exceeds max ${DOG_MOVE_MAX}".`);
  // Calculate facing direction based on movement
  const deltaX = target.x - s.dog.x;
  const facing = deltaX < 0 ? 'left' : 'right';

  const result = resolveMovement(s.dog, target.x, target.y, s);
  s.dog.x = result.x;
  s.dog.y = result.y;
  if (result.obstacle) {
    console.log(`[comeBy T${s.turn}] dog blocked by ${result.obstacle}, stopped at ${_pos(s.dog)}`);
    events.push(`Come-by: Dog blocked by ${result.obstacle}, stopped at (${s.dog.x.toFixed(1)}, ${s.dog.y.toFixed(1)}).`);
  } else {
    console.log(`[comeBy T${s.turn}] dog moved to ${_pos(s.dog)}`);
    events.push(`Come-by: Dog moves to (${s.dog.x.toFixed(1)}, ${s.dog.y.toFixed(1)}).`);
  }

  // Update facing direction
  s.dog.facing = facing;

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
      let spawnX = s.herd.x + dx;
      let spawnY = s.herd.y + dy;

      // Check if spawn position is inside impassable terrain and correct if needed
      const correction = correctImpassablePoint(spawnX, spawnY, s.terrain || []);
      if (correction.corrected) {
        console.log(`[looseAnimal T${s.turn}] spawn position (${spawnX.toFixed(2)}, ${spawnY.toFixed(2)}) inside terrain — corrected to (${correction.x.toFixed(2)}, ${correction.y.toFixed(2)})`);
        spawnX = correction.x;
        spawnY = correction.y;
      }

      const la = { id: newId, type: 'loose', radius: TOKEN_RADIUS, x: spawnX, y: spawnY };
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

    const wouldEscapeTarget = targetX < animal.radius || targetY < animal.radius ||
                              targetX > boardSize - animal.radius || targetY > boardSize - animal.radius;

    let clampedTarget = { x: targetX, y: targetY };
    if (wouldEscapeTarget) {
      // Clamp to board edges but still check for pen walls/terrain
      clampedTarget.x = Math.max(animal.radius, Math.min(boardSize - animal.radius, targetX));
      clampedTarget.y = Math.max(animal.radius, Math.min(boardSize - animal.radius, targetY));
      console.warn(`[moveHerd T${s.turn}] ${animal.id} would escape at (${targetX.toFixed(2)},${targetY.toFixed(2)}) — clamping to (${clampedTarget.x.toFixed(2)},${clampedTarget.y.toFixed(2)})`);
    }

    // Always run collision detection (including pen walls/terrain) even after clamping
    const result = resolveMovement(animal, clampedTarget.x, clampedTarget.y, s, escapedIds);
    const newX = result.x;
    const newY = result.y;

    // Check if FINAL position (after collision resolution) is at board edge
    const finalAtEdge = Math.abs(newX - animal.radius) < 0.01 || Math.abs(newX - (boardSize - animal.radius)) < 0.01 ||
                        Math.abs(newY - animal.radius) < 0.01 || Math.abs(newY - (boardSize - animal.radius)) < 0.01;

    // Only count as escaped if final position is actually at the board edge
    if (wouldEscapeTarget && finalAtEdge) {
      if (animal.type === 'herd') {
        s.escapedCount = (s.escapedCount || 0) + 1;
        events.push(`Move Herd: Herd hit the board edge! +1 escape (${s.escapedCount} total).`);
      } else {
        escapedIds.add(animal.id);
        s.escapedCount = (s.escapedCount || 0) + 1;
        events.push(`Move Herd: ${animal.id} escaped off the board! (${s.escapedCount} total)`);
      }
    }

    if (result.obstacle) {
      console.log(`[moveHerd T${s.turn}] ${animal.id} blocked by ${result.obstacle}, stopped at (${newX.toFixed(2)},${newY.toFixed(2)})`);
      events.push(`Move Herd: ${animal.id} blocked by ${result.obstacle}.`);
    }

    if (inAntithetical) {
      events.push(`Move Herd: ${animal.id} drawn ${needed.toFixed(1)}" toward dog (antithetical terrain).`);
    }
    animal.x = newX;
    animal.y = newY;

    // Check if loose animal rejoined herd
    if (animal.type === 'loose') {
      const contactsHerd = entitiesContact(animal, s.herd) ||
        (result.blocked && dist(animal, s.herd) <= animal.radius + s.herd.radius + 0.05);
      if (contactsHerd) {
        console.log(`[moveHerd T${s.turn}] ${animal.id} rejoined herd at (${newX.toFixed(2)},${newY.toFixed(2)})`);
        escapedIds.add(animal.id);
        events.push(`Move Herd: ${animal.id} rejoined the herd!`);
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

// MAP VALIDATION

const DOG_ZONE_WIDTH = 2; // inches from left edge

/**
 * Validates that no terrain exists in the dog deployment zone (x <= 2").
 * Returns { valid: boolean, errors: string[] }
 */
function validateDogZone(state) {
  const errors = [];
  const { terrain = [] } = state;

  for (const t of terrain) {
    const left = t.x - t.w/2;
    const right = t.x + t.w/2;

    // Check if terrain overlaps with dog zone (x < 2")
    if (left < DOG_ZONE_WIDTH) {
      errors.push(`Terrain "${t.id}" at x=${t.x.toFixed(1)}" overlaps dog zone (x <= ${DOG_ZONE_WIDTH}")`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates that the pen's opening side is at least 8" from the board edge.
 * Returns { valid: boolean, errors: string[] }
 */
function validatePenOpening(state) {
  const errors = [];
  const { pen, boardSize } = state;
  const MIN_CLEARANCE = 8;

  const left = pen.x - pen.w/2;
  const right = pen.x + pen.w/2;
  const top = pen.y - pen.h/2;
  const bottom = pen.y + pen.h/2;

  let edgeDist = 0;
  let edgeName = '';

  switch (pen.openSide) {
    case 'left':
      edgeDist = left;
      edgeName = 'left';
      break;
    case 'right':
      edgeDist = boardSize - right;
      edgeName = 'right';
      break;
    case 'top':
      edgeDist = top;
      edgeName = 'top';
      break;
    case 'bottom':
      edgeDist = boardSize - bottom;
      edgeName = 'bottom';
      break;
    default:
      errors.push(`Pen has invalid openSide: "${pen.openSide}"`);
      return { valid: false, errors };
  }

  if (edgeDist < MIN_CLEARANCE) {
    errors.push(`Pen opening (${edgeName}) is ${edgeDist.toFixed(1)}" from board edge (minimum ${MIN_CLEARANCE}")`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates that the herd starts:
 * - Outside the dog zone (x > 2" + herd radius)
 * - Outside the pen rectangle
 * - Fully inside the game board
 * Returns { valid: boolean, errors: string[] }
 */
function validateHerdStart(state) {
  const errors = [];
  const { herd, pen, boardSize } = state;

  // Rule 1: Herd must be outside dog zone
  const dogZoneRight = DOG_ZONE_WIDTH + herd.radius;
  if (herd.x <= dogZoneRight) {
    errors.push(`Herd at x=${herd.x.toFixed(1)}" overlaps dog zone (must be > ${dogZoneRight.toFixed(1)}")`);
  }

  // Rule 2: Herd must be outside pen
  if (circleRectContact(herd, pen)) {
    errors.push(`Herd at (${herd.x.toFixed(1)}, ${herd.y.toFixed(1)}) overlaps pen`);
  }

  // Rule 3: Herd must be fully inside board
  if (herd.x - herd.radius < 0) {
    errors.push(`Herd extends past left edge (x=${herd.x.toFixed(1)}", radius=${herd.radius})`);
  }
  if (herd.x + herd.radius > boardSize) {
    errors.push(`Herd extends past right edge (x=${herd.x.toFixed(1)}", radius=${herd.radius})`);
  }
  if (herd.y - herd.radius < 0) {
    errors.push(`Herd extends past top edge (y=${herd.y.toFixed(1)}", radius=${herd.radius})`);
  }
  if (herd.y + herd.radius > boardSize) {
    errors.push(`Herd extends past bottom edge (y=${herd.y.toFixed(1)}", radius=${herd.radius})`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Runs all map validation rules.
 * Returns { valid: boolean, errors: string[] }
 */
function validateMap(state) {
  const dogZone = validateDogZone(state);
  const penOpening = validatePenOpening(state);
  const herdStart = validateHerdStart(state);

  const allErrors = [
    ...dogZone.errors,
    ...penOpening.errors,
    ...herdStart.errors,
  ];

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
  };
}




const WALK_UP = {
  boardSize: 24,
  dog:  { id: 'dog',  type: 'dog',  x: 1,  y: 12, radius: TOKEN_RADIUS, facing: 'right' },  // Default position (will be overridden by deployment)
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
  dog:  { id: 'dog',  type: 'dog',  x: 1,  y: 12, radius: TOKEN_RADIUS, facing: 'right' },
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
  dog:  { id: 'dog',  type: 'dog',  x: 1,  y: 12, radius: TOKEN_RADIUS, facing: 'right' },
  herd: { id: 'herd', type: 'herd', x: 10, y: 21, radius: HERD_RADIUS  }, // 10" from left (24-10=14" from right), 3" from bottom (24-3=21)
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
  dog:  { id: 'dog',  type: 'dog',  x: 1,  y: 12, radius: TOKEN_RADIUS, facing: 'right' },
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

// PROCEDURAL GENERATION

/**
 * Simple seedable RNG (mulberry32)
 */
function createSeededRNG(seed) {
  let state = seed;
  return function() {
    state |= 0;
    state = state + 0x6D2B79F5 | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Generates a procedurally generated map that satisfies validation rules.
 * @param {number} seed - Random seed for deterministic generation
 * @returns {object} Valid game state
 */
function generateProceduralMap(seed = Date.now()) {
  const rng = createSeededRNG(seed);
  const boardSize = 24;

  // Helper to generate random value in range
  const randRange = (min, max) => min + rng() * (max - min);

  // Step 1: Place pen (right side of board, respecting 8" opening clearance)
  const penSizes = [
    { w: 8, h: 6 },
    { w: 8, h: 8 },
    { w: 6, h: 8 },
  ];
  const penSize = penSizes[Math.floor(rng() * penSizes.length)];
  const openSides = ['left', 'right', 'top', 'bottom'];
  const openSide = openSides[Math.floor(rng() * openSides.length)];

  // Calculate valid pen placement bounds (must keep opening 8" from edge)
  let penXMin = penSize.w / 2;
  let penXMax = boardSize - penSize.w / 2;
  let penYMin = penSize.h / 2;
  let penYMax = boardSize - penSize.h / 2;

  // Constrain based on opening side (need 8" clearance)
  const MIN_OPENING_CLEARANCE = 8;
  if (openSide === 'left') {
    penXMin = Math.max(penXMin, MIN_OPENING_CLEARANCE + penSize.w / 2);
  } else if (openSide === 'right') {
    penXMax = Math.min(penXMax, boardSize - MIN_OPENING_CLEARANCE - penSize.w / 2);
  } else if (openSide === 'top') {
    penYMin = Math.max(penYMin, MIN_OPENING_CLEARANCE + penSize.h / 2);
  } else if (openSide === 'bottom') {
    penYMax = Math.min(penYMax, boardSize - MIN_OPENING_CLEARANCE - penSize.h / 2);
  }

  // Prefer pen on right side for classic gameplay
  const penX = randRange(Math.max(penXMin, 14), penXMax);
  const penY = randRange(penYMin, penYMax);

  const pen = {
    id: 'pen',
    type: 'pen',
    x: penX,
    y: penY,
    w: penSize.w,
    h: penSize.h,
    openSide: openSide,
  };

  // Step 2: Place herd (left-center area, avoiding dog zone and pen)
  let herdX, herdY;
  let attempts = 0;
  do {
    herdX = randRange(DOG_ZONE_WIDTH + HERD_RADIUS + 1, 14);
    herdY = randRange(HERD_RADIUS, boardSize - HERD_RADIUS);
    attempts++;
  } while (
    circleRectContact({ x: herdX, y: herdY, radius: HERD_RADIUS }, pen) &&
    attempts < 100
  );

  const herd = {
    id: 'herd',
    type: 'herd',
    x: herdX,
    y: herdY,
    radius: HERD_RADIUS,
  };

  // Step 3: Generate terrain pieces one type at a time

  /**
   * Helper: Check if terrain piece intersects with 8"×8" clear zone in front of pen opening
   */
  const intersectsPenClearZone = (tx, ty, tw, th) => {
    // Define 8"×8" clear zone in front of pen opening
    let clearZoneX, clearZoneY;
    const CLEAR_ZONE_SIZE = 8;

    if (openSide === 'left') {
      // Clear zone extends 8" to the left of pen opening
      clearZoneX = pen.x - pen.w/2 - CLEAR_ZONE_SIZE/2;
      clearZoneY = pen.y;
    } else if (openSide === 'right') {
      // Clear zone extends 8" to the right of pen opening
      clearZoneX = pen.x + pen.w/2 + CLEAR_ZONE_SIZE/2;
      clearZoneY = pen.y;
    } else if (openSide === 'top') {
      // Clear zone extends 8" above pen opening
      clearZoneX = pen.x;
      clearZoneY = pen.y - pen.h/2 - CLEAR_ZONE_SIZE/2;
    } else if (openSide === 'bottom') {
      // Clear zone extends 8" below pen opening
      clearZoneX = pen.x;
      clearZoneY = pen.y + pen.h/2 + CLEAR_ZONE_SIZE/2;
    }

    const clearZone = {
      x: clearZoneX,
      y: clearZoneY,
      w: CLEAR_ZONE_SIZE,
      h: CLEAR_ZONE_SIZE,
    };

    // Check if terrain rectangle intersects with clear zone rectangle
    const terrainLeft = tx - tw/2;
    const terrainRight = tx + tw/2;
    const terrainTop = ty - th/2;
    const terrainBottom = ty + th/2;

    const clearLeft = clearZone.x - clearZone.w/2;
    const clearRight = clearZone.x + clearZone.w/2;
    const clearTop = clearZone.y - clearZone.h/2;
    const clearBottom = clearZone.y + clearZone.h/2;

    // Rectangles intersect if they overlap on both axes
    const xOverlap = terrainLeft < clearRight && terrainRight > clearLeft;
    const yOverlap = terrainTop < clearBottom && terrainBottom > clearTop;

    return xOverlap && yOverlap;
  };

  const terrain = [];

  // Generate impassable terrain (3 pieces)
  const numImpassable = 3; //Math.floor(rng() * 4); // 0, 1, 2, or 3
  console.log(`[generateProceduralMap seed=${seed}] Attempting to place ${numImpassable} impassable terrain pieces`);

  for (let i = 0; i < numImpassable; i++) {
    // Dimensions: 2" to 4" for each side
    const w = Math.floor(randRange(2, 5));
    const h = Math.floor(randRange(2, 5));
    console.log(`  [impassable_${i}] Dimensions: ${w}×${h}"`);

    let tx, ty;
    let placed = false;
    const MAX_ATTEMPTS = 10;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Place randomly: 4" <= x <= 22", 2" <= y <= 22"
      // Need to constrain by terrain dimensions to stay on board
      const xMin = Math.max(4, w/2);
      const xMax = Math.min(22, boardSize - w/2);
      const yMin = Math.max(2, h/2);
      const yMax = Math.min(22, boardSize - h/2);

      tx = randRange(xMin, xMax);
      ty = randRange(yMin, yMax);

      console.log(`    Attempt ${attempt + 1}: (${tx.toFixed(1)}", ${ty.toFixed(1)}")`);

      // Check if intersects with pen rectangle
      const terrainLeft = tx - w/2;
      const terrainRight = tx + w/2;
      const terrainTop = ty - h/2;
      const terrainBottom = ty + h/2;

      const penLeft = pen.x - pen.w/2;
      const penRight = pen.x + pen.w/2;
      const penTop = pen.y - pen.h/2;
      const penBottom = pen.y + pen.h/2;

      const xOverlapPen = terrainLeft < penRight && terrainRight > penLeft;
      const yOverlapPen = terrainTop < penBottom && terrainBottom > penTop;
      const intersectsPen = xOverlapPen && yOverlapPen;

      if (intersectsPen) {
        console.log(`      ✗ Overlaps pen`);
        continue;
      }

      // Check if intersects with 8"×8" clear zone in front of pen
      const blocksClearZone = intersectsPenClearZone(tx, ty, w, h);
      if (blocksClearZone) {
        console.log(`      ✗ Blocks 8"×8" clear zone in front of pen`);
        continue;
      }

      // Check if overlaps herd
      const terrainRadius = Math.sqrt(w*w + h*h) / 2;
      const distToHerd = dist({ x: tx, y: ty }, herd);
      const overlapsHerd = distToHerd < (terrainRadius + HERD_RADIUS);
      if (overlapsHerd) {
        console.log(`      ✗ Overlaps herd (distance: ${distToHerd.toFixed(1)}", needs: ${(terrainRadius + HERD_RADIUS).toFixed(1)}")`);
        continue;
      }

      // Valid placement
      console.log(`      ✓ Valid placement`);
      placed = true;
      break;
    }

    if (placed) {
      terrain.push({
        id: `impassable_${i}`,
        type: 'impassable',
        x: tx,
        y: ty,
        w,
        h,
      });
      console.log(`  [impassable_${i}] Placed at (${tx.toFixed(1)}", ${ty.toFixed(1)}")`);
    } else {
      console.log(`  [impassable_${i}] Failed to place after ${MAX_ATTEMPTS} attempts`);
    }
  }

  // Build final state
  const state = {
    boardSize,
    dog: { id: 'dog', type: 'dog', x: 1, y: 12, radius: TOKEN_RADIUS, facing: 'right' },
    herd,
    pen,
    looseAnimals: [],
    escapedCount: 0,
    events: [],
    turn: 1,
    phase: 'deployment',
    terrain,
    rng: Math.random,
  };

  // Validate the generated map
  const validation = validateMap(state);
  if (!validation.valid) {
    console.warn('[generateProceduralMap] Generated invalid map:', validation.errors);
    // Retry with different seed
    return generateProceduralMap(seed + 1);
  }

  return state;
}

const PROCEDURAL = generateProceduralMap();

const SCENARIOS = [
  { id: 'walk_up', name: 'Walk Up', state: WALK_UP },
  { id: 'rotten_bridge', name: 'Rotten Bridge', state: ROTTEN_BRIDGE },
  { id: 'dead_mount', name: 'Dead Mount', state: DEAD_MOUNT },
  { id: 'bogs_edge', name: "Bog's Edge", state: BOGS_EDGE },
  { id: 'procedural', name: 'Procedural', state: PROCEDURAL },
];



export {
  HERD_RADIUS, TOKEN_RADIUS, DOG_MOVE_MAX, DOG_SPOOK_RANGE, HERD_CLEARANCE,
  dist, unitVector, touchesEdge, entitiesContact, circleRectContact, rollDie, angleToOffset, cloneState,
  phaseDumbAnimals, phaseComeBy, phaseLooseAnimal, phaseMoveHerd,
  processTurn,
  validateDogZone, validatePenOpening, validateHerdStart, validateMap,
  createSeededRNG, generateProceduralMap,
  WALK_UP, ROTTEN_BRIDGE, DEAD_MOUNT, BOGS_EDGE, PROCEDURAL, SCENARIOS,
};
