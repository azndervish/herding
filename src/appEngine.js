// appEngine.js — engine extracted from App.jsx for testing
// Auto-generated: do not edit manually; edit App.jsx instead.


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

function phaseDumbAnimals(state) {
  const s = cloneState(state);
  const { rng, boardSize } = s;
  const events = [];
  const animals = [s.herd, ...s.looseAnimals].sort(
    (a, b) => dist(b, s.dog) - dist(a, s.dog)
  );
  for (const animal of animals) {
    const roll = rollDie(6, rng);
    const angle = rng() * 360;
    const { dx, dy } = angleToOffset(angle, roll);
    if (animal.type === 'herd') {
      s.herd.x += dx; s.herd.y += dy;
      events.push(`Dumb Animals: Herd wanders ${roll}" (${angle.toFixed(0)}°).`);
      if (touchesEdge(s.herd, boardSize)) {
        s.herd.x = Math.max(s.herd.radius, Math.min(boardSize - s.herd.radius, s.herd.x));
        s.herd.y = Math.max(s.herd.radius, Math.min(boardSize - s.herd.radius, s.herd.y));
        s.escapedCount = (s.escapedCount || 0) + 1;
        events.push(`Dumb Animals: Herd hit the board edge! +1 escape (${s.escapedCount} total).`);
      }
    } else {
      const la = s.looseAnimals.find(a => a.id === animal.id);
      if (la) {
        la.x += dx; la.y += dy;
        events.push(`Dumb Animals: ${la.id} wanders ${roll}".`);
        if (touchesEdge(la, boardSize)) { la._escaped = true; events.push(`${la.id} reached the edge and escaped!`); }
      }
    }
  }
  const rejoined = [];
  for (const la of s.looseAnimals) {
    if (!la._escaped && entitiesContact(la, s.herd)) { rejoined.push(la.id); events.push(`${la.id} rejoined the herd!`); }
  }
  s.looseAnimals = s.looseAnimals.filter(a => !rejoined.includes(a.id) && !a._escaped);
  s.events = [...s.events, ...events];
  s.phase = 'come_by';
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

function phaseComeBy(state, action) {
  const s = cloneState(state);
  const events = [];
  if (!action || action.type === 'end_turn') {
    events.push('Come-by: Dog holds position.');
    s.events = [...s.events, ...events]; s.phase = 'loose_animal'; return s;
  }
  if (action.type !== 'move_dog') throw new Error(`Unknown action: ${action.type}`);
  const target = { x: action.x, y: action.y };
  const distance = dist(s.dog, target);
  if (distance > DOG_MOVE_MAX + 1e-9) throw new Error(`Move exceeds max ${DOG_MOVE_MAX}".`);
  const obstacles = [s.herd, ...s.looseAnimals];
  let closestBlock = Infinity, blockedEntity = null;
  for (const obs of obstacles) {
    const t = rayCircleIntersect(s.dog, target, obs);
    if (t !== null && t < closestBlock) { closestBlock = t; blockedEntity = obs; }
  }
  if (blockedEntity !== null) {
    const dir = unitVector(s.dog, target);
    const stopDist = Math.max(0, closestBlock - (s.dog.radius + blockedEntity.radius) - 0.01);
    s.dog.x += dir.x * stopDist; s.dog.y += dir.y * stopDist;
    events.push(`Come-by: Dog blocked by ${blockedEntity.id}, stopped at (${s.dog.x.toFixed(1)}, ${s.dog.y.toFixed(1)}).`);
  } else {
    s.dog.x = target.x; s.dog.y = target.y;
    events.push(`Come-by: Dog moves to (${s.dog.x.toFixed(1)}, ${s.dog.y.toFixed(1)}).`);
  }
  s.events = [...s.events, ...events]; s.phase = 'loose_animal'; return s;
}

function phaseLooseAnimal(state) {
  const s = cloneState(state);
  const { rng } = s;
  const events = [];
  const dogToHerd = dist(s.dog, s.herd);
  if (dogToHerd <= DOG_SPOOK_RANGE) {
    const roll = rollDie(8, rng);
    events.push(`Loose Animal: Dog ${dogToHerd.toFixed(1)}" from herd. Rolled D8: ${roll}.`);
    if (roll >= dogToHerd) {
      const spawnDist = rollDie(6, rng);
      const angle = rng() * 360;
      const { dx, dy } = angleToOffset(angle, spawnDist);
      const newId = `loose_${s.looseAnimals.length + 1}_t${s.turn}`;
      const la = { id: newId, type: 'loose', radius: TOKEN_RADIUS, x: s.herd.x + dx, y: s.herd.y + dy };
      s.looseAnimals.push(la);
      events.push(`Loose Animal: Animal spooked! ${newId} placed ${spawnDist}" from herd.`);
    } else {
      events.push(`Loose Animal: Herd holds — roll ${roll} < distance ${dogToHerd.toFixed(1)}".`);
    }
  } else {
    events.push(`Loose Animal: Dog ${dogToHerd.toFixed(1)}" away — too far to spook.`);
  }
  s.events = [...s.events, ...events]; s.phase = 'move_herd'; return s;
}

function phaseMoveHerd(state) {
  const s = cloneState(state);
  const { boardSize } = s;
  const events = [];
  const animals = [s.herd, ...s.looseAnimals].sort((a,b) => dist(b,s.dog) - dist(a,s.dog));
  const escapedIds = new Set();

  for (const animal of animals) {
    if (escapedIds.has(animal.id)) continue;
    const d = dist(animal, s.dog);
    if (d >= HERD_CLEARANCE) continue;
    const needed = HERD_CLEARANCE - d;
    const dir = unitVector(s.dog, animal);
    let newX = animal.x + dir.x * needed, newY = animal.y + dir.y * needed;
    const wouldEscape = newX < animal.radius || newY < animal.radius ||
                        newX > boardSize - animal.radius || newY > boardSize - animal.radius;
    if (wouldEscape) {
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
    const others = [s.dog, s.herd, ...s.looseAnimals].filter(e => e.id !== animal.id && !escapedIds.has(e.id));
    let blocked = false;
    for (const other of others) {
      const testPos = { x: newX, y: newY, radius: animal.radius };
      if (entitiesContact(testPos, other)) {
        const stopDist = Math.max(0, dist(animal, other) - animal.radius - other.radius - 0.01);
        newX = animal.x + dir.x * stopDist; newY = animal.y + dir.y * stopDist;
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
      if (contactsHerd) { escapedIds.add(la.id); events.push(`Move Herd: ${la.id} rejoined the herd!`); continue; }
    }
    if (!blocked) events.push(`Move Herd: ${animal.id} moved ${needed.toFixed(1)}" away from dog.`);
  }
  s.looseAnimals = s.looseAnimals.filter(a => !escapedIds.has(a.id) && !a._escaped);
  s.events = [...s.events, ...events];

  if (entitiesContact(s.herd, s.pen)) {
    s.events.push("🐑 The herd is in the pen! That'll do!");
    s.phase = 'finished'; return s;
  }
  s.turn = (s.turn || 1) + 1; s.phase = 'dumb_animals'; return s;
}

const PHASE_RUNNERS = {
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
  while (steps < MAX_STEPS) {
    if (s.phase === 'finished') return s;
    if (steps > 0 && s.phase === stopBefore) return s;
    const runner = PHASE_RUNNERS[s.phase];
    if (!runner) throw new Error(`No runner for phase: ${s.phase}`);
    s = runner(s, action);
    steps++;
  }
  throw new Error('processTurn exceeded max steps');
}



// ── SCENARIO ──

const WALK_UP = {
  boardSize: 24,
  dog:  { id: 'dog',  type: 'dog',  x: 1,  y: 22, radius: TOKEN_RADIUS },
  herd: { id: 'herd', type: 'herd', x: 6,  y: 10, radius: HERD_RADIUS  },
  pen:  { id: 'pen',  type: 'pen',  x: 18, y: 10, radius: 4            },
  looseAnimals: [],
  escapedCount: 0,
  events: [],
  turn: 1,
  phase: 'dumb_animals',
  rng: Math.random,
};



export {
  HERD_RADIUS, TOKEN_RADIUS, DOG_MOVE_MAX, DOG_SPOOK_RANGE, HERD_CLEARANCE,
  dist, unitVector, touchesEdge, entitiesContact, rollDie, angleToOffset, cloneState,
  phaseDumbAnimals, phaseComeBy, phaseLooseAnimal, phaseMoveHerd,
  processTurn,
  WALK_UP,
};
