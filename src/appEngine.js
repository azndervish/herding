// appEngine.js — auto-generated from App.js


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
    const roll = rollDie(6, rng);
    const angle = rng() * 360;
    const { dx, dy } = angleToOffset(angle, roll);
    if (animal.type === 'herd') {
      const _hBefore = { x: s.herd.x, y: s.herd.y };
      const targetX = s.herd.x + dx;
      const targetY = s.herd.y + dy;

      // Check pen wall collision along the path
      const walls = getPenWalls(s.pen);
      let wallBlockDist = Infinity;
      for (const wall of walls) {
        const t = raySegmentIntersect(s.herd, { x: targetX, y: targetY }, wall[0], wall[1], wall[2], wall[3], s.herd.radius);
        if (t !== null && t < wallBlockDist) {
          wallBlockDist = t;
        }
      }

      if (wallBlockDist < Infinity) {
        // Stop just before hitting the wall
        const dir = unitVector(s.herd, { x: targetX, y: targetY });
        const stopDist = Math.max(0, wallBlockDist - 0.01);
        s.herd.x += dir.x * stopDist;
        s.herd.y += dir.y * stopDist;
        console.log(`[dumbAnimals T${s.turn}] herd blocked by pen wall at dist=${wallBlockDist.toFixed(2)}", stopped at ${_pos(s.herd)}`);
        events.push(`Dumb Animals: Herd bumped into pen wall.`);
      } else {
        s.herd.x = targetX;
        s.herd.y = targetY;
        events.push(`Dumb Animals: Herd wanders ${roll}" (${angle.toFixed(0)}°).`);
      }

      console.log(`[dumbAnimals T${s.turn}] herd: roll=${roll} angle=${angle.toFixed(0)}° | (${_hBefore.x.toFixed(2)},${_hBefore.y.toFixed(2)}) → ${_pos(s.herd)}`);
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

        // Check pen wall collision along the path
        const walls = getPenWalls(s.pen);
        let wallBlockDist = Infinity;
        for (const wall of walls) {
          const t = raySegmentIntersect(la, { x: targetX, y: targetY }, wall[0], wall[1], wall[2], wall[3], la.radius);
          if (t !== null && t < wallBlockDist) {
            wallBlockDist = t;
          }
        }

        if (wallBlockDist < Infinity) {
          // Stop just before hitting the wall
          const dir = unitVector(la, { x: targetX, y: targetY });
          const stopDist = Math.max(0, wallBlockDist - 0.01);
          la.x += dir.x * stopDist;
          la.y += dir.y * stopDist;
          console.log(`[dumbAnimals T${s.turn}] ${la.id} blocked by pen wall at dist=${wallBlockDist.toFixed(2)}", stopped at ${_pos(la)}`);
          events.push(`Dumb Animals: ${la.id} bumped into pen wall.`);
        } else {
          la.x = targetX;
          la.y = targetY;
          events.push(`Dumb Animals: ${la.id} wanders ${roll}".`);
        }

        console.log(`[dumbAnimals T${s.turn}] ${la.id}: roll=${roll} angle=${angle.toFixed(0)}° | (${_laBefore.x.toFixed(2)},${_laBefore.y.toFixed(2)}) → ${_pos(la)}`);
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

  const obstacles = [s.herd, ...s.looseAnimals];
  let closestBlock = Infinity, blockedEntity = null;
  for (const obs of obstacles) {
    const t = rayCircleIntersect(s.dog, target, obs);
    if (t !== null && t < closestBlock) { closestBlock = t; blockedEntity = obs; }
  }

  // Use whichever blocker is closest
  if (wallBlockDist < closestBlock) {
    const dir = unitVector(s.dog, target);
    const stopDist = Math.max(0, wallBlockDist - 0.01);
    s.dog.x += dir.x * stopDist; s.dog.y += dir.y * stopDist;
    console.log(`[comeBy T${s.turn}] dog blocked by pen wall at dist=${wallBlockDist.toFixed(2)}", stopped at ${_pos(s.dog)}`);
    events.push(`Come-by: Dog blocked by pen wall, stopped at (${s.dog.x.toFixed(1)}, ${s.dog.y.toFixed(1)}).`);
  } else if (blockedEntity !== null) {
    const dir = unitVector(s.dog, target);
    const stopDist = Math.max(0, closestBlock - 0.01);
    s.dog.x += dir.x * stopDist; s.dog.y += dir.y * stopDist;
    console.log(`[comeBy T${s.turn}] dog blocked by ${blockedEntity.id} at dist=${closestBlock.toFixed(2)}", stopped at ${_pos(s.dog)}`);
    events.push(`Come-by: Dog blocked by ${blockedEntity.id}, stopped at (${s.dog.x.toFixed(1)}, ${s.dog.y.toFixed(1)}).`);
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
    const needed = HERD_CLEARANCE - d;
    const dir = unitVector(s.dog, animal);
    let newX = animal.x + dir.x * needed, newY = animal.y + dir.y * needed;
    console.log(`[moveHerd T${s.turn}] ${animal.id}: dist=${d.toFixed(2)}", pushing ${needed.toFixed(2)}" → (${newX.toFixed(2)},${newY.toFixed(2)})`);
    const wouldEscape = newX < animal.radius || newY < animal.radius ||
                        newX > boardSize - animal.radius || newY > boardSize - animal.radius;
    if (wouldEscape) {
      console.warn(`[moveHerd T${s.turn}] ${animal.id} would escape at (${newX.toFixed(2)},${newY.toFixed(2)}) — clamping`);
      newX = Math.max(animal.radius, Math.min(boardSize - animal.radius, newX));
      newY = Math.max(animal.radius, Math.min(boardSize - animal.radius, newY));
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
    // Check for pen wall collisions along the movement path
    const walls = getPenWalls(s.pen);
    let wallBlockDist = Infinity;
    for (const wall of walls) {
      const t = raySegmentIntersect(animal, { x: newX, y: newY }, wall[0], wall[1], wall[2], wall[3], animal.radius);
      if (t !== null && t < wallBlockDist) {
        wallBlockDist = t;
      }
    }
    if (wallBlockDist < Infinity) {
      // Stop just before hitting the wall
      const dir = unitVector(animal, { x: newX, y: newY });
      const stopDist = Math.max(0, wallBlockDist - 0.01);
      newX = animal.x + dir.x * stopDist;
      newY = animal.y + dir.y * stopDist;
      console.log(`[moveHerd T${s.turn}] ${animal.id} blocked by pen wall at dist=${wallBlockDist.toFixed(2)}", stopped at (${newX.toFixed(2)},${newY.toFixed(2)})`);
      events.push(`Move Herd: ${animal.id} blocked by pen wall.`);
    }

    const others = [s.dog, s.herd, ...s.looseAnimals].filter(e => e.id !== animal.id && !escapedIds.has(e.id));
    let blocked = false;
    for (const other of others) {
      const testPos2 = { x: newX, y: newY, radius: animal.radius };
      if (entitiesContact(testPos2, other)) {
        const stopDist = Math.max(0, dist(animal, other) - animal.radius - other.radius - 0.01);
        newX = animal.x + dir.x * stopDist; newY = animal.y + dir.y * stopDist;
        console.log(`[moveHerd T${s.turn}] ${animal.id} blocked by ${other.id}, stopping at (${newX.toFixed(2)},${newY.toFixed(2)})`);
        events.push(`Move Herd: ${animal.id} stopped — contact with ${other.id}.`);
        blocked = true; break;
      }
    }
    if (animal.type === 'herd') { s.herd.x = newX; s.herd.y = newY; }
    else {
      const la = s.looseAnimals.find(a => a.id === animal.id);
      if (la) { la.x = newX; la.y = newY; }
    }
    if (animal.type === 'loose') {
      const la = s.looseAnimals.find(a => a.id === animal.id);
      const contactsHerd = la && (entitiesContact(la, s.herd) ||
        (blocked && dist({ x: newX, y: newY }, s.herd) <= la.radius + s.herd.radius + 0.05));
      if (contactsHerd) {
        console.log(`[moveHerd T${s.turn}] ${la.id} rejoined herd at (${newX.toFixed(2)},${newY.toFixed(2)})`);
        escapedIds.add(la.id); events.push(`Move Herd: ${la.id} rejoined the herd!`); continue;
      }
    }
    if (!blocked) events.push(`Move Herd: ${animal.id} moved ${needed.toFixed(1)}" away from dog.`);
  }
  s.looseAnimals = s.looseAnimals.filter(a => !escapedIds.has(a.id) && !a._escaped);
  s.events = [...s.events, ...events];

  if (circleRectContact(s.herd, s.pen)) {
    console.log(`[moveHerd T${s.turn}] herd reached pen — FINISHED`);
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

  // Validate within board bounds
  if (target.x < s.dog.radius || target.y < s.dog.radius ||
      target.x > s.boardSize - s.dog.radius || target.y > s.boardSize - s.dog.radius) {
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
  rng: Math.random,
};

const SCENARIOS = [
  { id: 'walk_up', name: 'Walk Up', state: WALK_UP },
];



export {
  HERD_RADIUS, TOKEN_RADIUS, DOG_MOVE_MAX, DOG_SPOOK_RANGE, HERD_CLEARANCE,
  dist, unitVector, touchesEdge, entitiesContact, rollDie, angleToOffset, cloneState,
  phaseDumbAnimals, phaseComeBy, phaseLooseAnimal, phaseMoveHerd, phaseDeployment,
  processTurn, WALK_UP,
};
