/**
 * Herding28 Game Engine
 *
 * Coordinate system: (x, y) in inches, origin at top-left.
 * Board is BOARD_SIZE x BOARD_SIZE inches (default 24" = 2').
 *
 * Entity shapes:
 *   Herd:        { id, type: 'herd',  x, y, radius }   (5" diameter → radius 2.5")
 *   LooseAnimal: { id, type: 'loose', x, y, radius }   (20–40mm token → radius ~0.75")
 *   Dog:         { id, type: 'dog',   x, y, radius }   (20–40mm token → radius ~0.75")
 *   Pen:         { id, type: 'pen',   x, y, radius }   (defined per trial)
 *
 * GameState:
 *   {
 *     boardSize:    number,          // inches, default 24
 *     turn:         number,
 *     phase:        string,          // 'dumb_animals' | 'come_by' | 'loose_animal' | 'move_herd' | 'finished'
 *     dog:          DogEntity,
 *     herd:         HerdEntity,
 *     looseAnimals: LooseAnimalEntity[],
 *     pen:          PenEntity,
 *     escapedCount: number,
 *     events:       string[],
 *     rng:          () => number,    // injectable RNG (returns 0–1), defaults to Math.random
 *   }
 *
 * PlayerAction (for Come-by phase):
 *   { type: 'move_dog', x: number, y: number }   // target position, must be ≤12" away
 *   { type: 'end_turn' }                          // skip dog movement
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const BOARD_DEFAULT = 24;          // 2' board in inches
export const HERD_RADIUS = 2.5;           // 5" diameter template
export const TOKEN_RADIUS = 0.75;         // ~20–30mm token
export const DOG_MOVE_MAX = 12;           // dog max movement per turn
export const DOG_SPOOK_RANGE = 8;         // loose-animal trigger radius
export const HERD_CLEARANCE = 10;         // target gap between herd centre and dog

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Euclidean distance between two points. */
export function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** Unit vector from a → b. Returns {x,y}. */
export function unitVector(a, b) {
  const d = dist(a, b);
  if (d === 0) return { x: 1, y: 0 };
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}

/** Move point p by (dx, dy), clamping to board. Returns new {x, y}. */
export function clampToBoard(p, boardSize) {
  return {
    x: Math.max(0, Math.min(boardSize, p.x)),
    y: Math.max(0, Math.min(boardSize, p.y)),
  };
}

/** Returns true if point p is outside the board. */
export function isOffBoard(p, boardSize) {
  return p.x < 0 || p.x > boardSize || p.y < 0 || p.y > boardSize;
}

/** Returns true if entity's centre is at or beyond the board edge. */
export function touchesEdge(entity, boardSize) {
  return (
    entity.x <= entity.radius ||
    entity.y <= entity.radius ||
    entity.x >= boardSize - entity.radius ||
    entity.y >= boardSize - entity.radius
  );
}

/**
 * Returns true if two circular entities overlap / are in base-to-base contact.
 * "Base-to-base" means centre distance ≤ sum of radii.
 */
export function entitiesContact(a, b) {
  return dist(a, b) <= a.radius + b.radius;
}

/**
 * Convert a random angle (radians) into a direction offset of `inches`.
 */
export function angleToOffset(angleDeg, inches) {
  const rad = (angleDeg * Math.PI) / 180;
  return { dx: Math.cos(rad) * inches, dy: Math.sin(rad) * inches };
}

// ---------------------------------------------------------------------------
// Dice helpers
// ---------------------------------------------------------------------------

const DICE_FACES = [4, 6, 8, 10, 20];

/**
 * Roll a die with `faces` sides using the provided rng.
 * Returns integer 1..faces.
 */
export function rollDie(faces, rng) {
  return Math.floor(rng() * faces) + 1;
}

/**
 * Given a base die size and net upgrade steps (positive = upgrade, negative = downgrade),
 * return the adjusted die size, clamped to [D4, D20].
 */
export function adjustDie(baseFaces, netSteps) {
  const idx = DICE_FACES.indexOf(baseFaces);
  if (idx === -1) throw new Error(`Unknown die: D${baseFaces}`);
  const newIdx = Math.max(0, Math.min(DICE_FACES.length - 1, idx + netSteps));
  return DICE_FACES[newIdx];
}

// ---------------------------------------------------------------------------
// State factories
// ---------------------------------------------------------------------------

export function createInitialState({
  boardSize = BOARD_DEFAULT,
  dog,
  herd,
  looseAnimals = [],
  pen,
  rng = Math.random,
} = {}) {
  return {
    boardSize,
    turn: 1,
    phase: 'dumb_animals',
    dog: { id: 'dog', type: 'dog', radius: TOKEN_RADIUS, ...dog },
    herd: { id: 'herd', type: 'herd', radius: HERD_RADIUS, ...herd },
    looseAnimals: looseAnimals.map((a, i) => ({
      id: `loose_${i}`,
      type: 'loose',
      radius: TOKEN_RADIUS,
      ...a,
    })),
    pen: { id: 'pen', type: 'pen', radius: HERD_RADIUS, ...pen },
    escapedCount: 0,
    events: [],
    rng,
  };
}

// ---------------------------------------------------------------------------
// Deep-clone helpers (keep state immutable across calls)
// ---------------------------------------------------------------------------

function cloneState(state) {
  return {
    ...state,
    dog: { ...state.dog },
    herd: { ...state.herd },
    looseAnimals: state.looseAnimals.map((a) => ({ ...a })),
    pen: { ...state.pen },
    events: [...state.events],
  };
}

// ---------------------------------------------------------------------------
// Phase 1: Dumb Animals
// ---------------------------------------------------------------------------

/**
 * Move each animal (herd + loose animals) D6" in a random direction,
 * starting with the animal furthest from the dog.
 *
 * Returns updated state with events appended.
 */
export function phaseDumbAnimals(state) {
  const s = cloneState(state);
  const { rng, boardSize } = s;
  const events = [];

  // Collect all animals (herd + loose), sort by distance from dog (desc)
  const animals = [s.herd, ...s.looseAnimals].sort(
    (a, b) => dist(b, s.dog) - dist(a, s.dog)
  );

  for (const animal of animals) {
    const roll = rollDie(6, rng);
    const angle = rng() * 360;
    const { dx, dy } = angleToOffset(angle, roll);

    const newX = animal.x + dx;
    const newY = animal.y + dy;

    if (animal.type === 'herd') {
      s.herd.x = newX;
      s.herd.y = newY;
      events.push(`Dumb Animals: Herd wanders ${roll}" (angle ${angle.toFixed(0)}°).`);
    } else {
      const la = s.looseAnimals.find((a) => a.id === animal.id);
      if (la) {
        la.x = newX;
        la.y = newY;
        events.push(`Dumb Animals: ${la.id} wanders ${roll}" (angle ${angle.toFixed(0)}°).`);

        // Check escape during dumb animals movement (touched edge)
        if (touchesEdge(la, boardSize)) {
          events.push(`${la.id} reached the board edge and escaped!`);
          // Escaped loose animals are removed at the end of Move Herd,
          // but we flag them now so Move Herd can clean up.
          la._escaped = true;
        }
      }
    }
  }

  // Rejoin: loose animal base-to-base with herd (in a later turn) is handled in Move Herd
  // per rules, a loose animal can return during *any movement* that brings it into contact.
  const rejoined = [];
  for (const la of s.looseAnimals) {
    if (!la._escaped && entitiesContact(la, s.herd)) {
      rejoined.push(la.id);
      events.push(`${la.id} rejoined the herd!`);
    }
  }
  s.looseAnimals = s.looseAnimals.filter(
    (a) => !rejoined.includes(a.id) && !a._escaped
  );

  s.events = [...s.events, ...events];
  s.phase = 'come_by';
  return s;
}

// ---------------------------------------------------------------------------
// Phase 2: Come-by  (player action)
// ---------------------------------------------------------------------------

/**
 * Apply the player's dog movement.
 *
 * action: { type: 'move_dog', x, y } | { type: 'end_turn' }
 *
 * Rules:
 *  - Dog moves up to 12" total.
 *  - Cannot move *through* a herd or loose animal.
 *  - We model "through" as: if the straight-line path intersects any entity,
 *    the dog stops just before contact.
 *
 * Returns updated state.
 */
export function phaseComeBy(state, action) {
  const s = cloneState(state);
  const events = [];

  if (action.type === 'end_turn') {
    events.push('Come-by: Player skipped dog movement.');
    s.events = [...s.events, ...events];
    s.phase = 'loose_animal';
    return s;
  }

  if (action.type !== 'move_dog') {
    throw new Error(`Unknown action type: ${action.type}`);
  }

  const target = { x: action.x, y: action.y };
  const distance = dist(s.dog, target);

  if (distance > DOG_MOVE_MAX + 1e-9) {
    throw new Error(
      `Invalid move: distance ${distance.toFixed(2)}" exceeds max ${DOG_MOVE_MAX}".`
    );
  }

  // Check if path is blocked by any animal entity
  const obstacles = [s.herd, ...s.looseAnimals];
  let blockedAt = null;
  let blockedEntity = null;
  let closestBlock = Infinity;

  for (const obs of obstacles) {
    const t = rayCircleIntersect(s.dog, target, obs);
    if (t !== null && t < closestBlock) {
      closestBlock = t;
      blockedAt = t;
      blockedEntity = obs;
    }
  }

  if (blockedAt !== null) {
    // Stop just before the obstacle
    const dir = unitVector(s.dog, target);
    const stopDist = blockedAt - (s.dog.radius + blockedEntity.radius) - 0.01;
    if (stopDist > 0) {
      s.dog.x = s.dog.x + dir.x * stopDist;
      s.dog.y = s.dog.y + dir.y * stopDist;
    }
    events.push(
      `Come-by: Dog blocked by ${blockedEntity.id} and stopped short at (${s.dog.x.toFixed(2)}, ${s.dog.y.toFixed(2)}).`
    );
  } else {
    s.dog.x = target.x;
    s.dog.y = target.y;
    events.push(
      `Come-by: Dog moves to (${s.dog.x.toFixed(2)}, ${s.dog.y.toFixed(2)}).`
    );
  }

  s.events = [...s.events, ...events];
  s.phase = 'loose_animal';
  return s;
}

/**
 * Ray-circle intersection.
 * Ray starts at `from`, ends at `to`.
 * Circle is `circle` with radius `circle.radius`.
 * Returns the parametric t (0..1, then scaled to actual distance) at first intersection,
 * or null if no intersection along the segment.
 *
 * We treat the ray as the dog's path (also a circle of dog.radius),
 * so we expand the obstacle radius by the dog's radius (Minkowski sum).
 */
function rayCircleIntersect(from, to, obstacle) {
  const combinedRadius = obstacle.radius + (from.radius ?? TOKEN_RADIUS);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const fx = from.x - obstacle.x;
  const fy = from.y - obstacle.y;

  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - combinedRadius * combinedRadius;

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const sqrtDisc = Math.sqrt(discriminant);
  const t1 = (-b - sqrtDisc) / (2 * a);
  // t is in [0,1] parametric along the ray from→to
  if (t1 >= 0 && t1 <= 1) {
    const segLen = Math.sqrt(a);
    return t1 * segLen; // distance along ray
  }
  return null;
}

// ---------------------------------------------------------------------------
// Phase 3: Loose Animal
// ---------------------------------------------------------------------------

/**
 * For each herd (and loose animals don't trigger more loose animals):
 *  - If dog is within 8" of herd centre, roll D8.
 *  - If roll >= distance, spawn a loose animal D6" from herd in random direction.
 *
 * Returns updated state.
 */
export function phaseLooseAnimal(state) {
  const s = cloneState(state);
  const { rng } = s;
  const events = [];

  const dogToHerd = dist(s.dog, s.herd);

  if (dogToHerd <= DOG_SPOOK_RANGE) {
    const roll = rollDie(8, rng);
    events.push(
      `Loose Animal: Dog is ${dogToHerd.toFixed(2)}" from herd centre. Rolled D8: ${roll}.`
    );

    if (roll >= dogToHerd) {
      // Spawn loose animal
      const spawnDist = rollDie(6, rng);
      const angle = rng() * 360;
      const { dx, dy } = angleToOffset(angle, spawnDist);

      const newId = `loose_${s.looseAnimals.length + 1}_t${s.turn}`;
      const la = {
        id: newId,
        type: 'loose',
        radius: TOKEN_RADIUS,
        x: s.herd.x + dx,
        y: s.herd.y + dy,
      };
      s.looseAnimals.push(la);
      events.push(
        `Loose Animal: An animal got spooked! ${newId} placed ${spawnDist}" from herd (angle ${angle.toFixed(0)}°) at (${la.x.toFixed(2)}, ${la.y.toFixed(2)}).`
      );
    } else {
      events.push(`Loose Animal: Roll did not meet distance — herd holds together.`);
    }
  } else {
    events.push(
      `Loose Animal: Dog is ${dogToHerd.toFixed(2)}" from herd — too far to spook (> ${DOG_SPOOK_RANGE}").`
    );
  }

  s.events = [...s.events, ...events];
  s.phase = 'move_herd';
  return s;
}

// ---------------------------------------------------------------------------
// Phase 4: Move Herd
// ---------------------------------------------------------------------------

/**
 * Move each animal directly away from the dog until ≥10" gap exists between
 * the animal's centre and the dog.
 *
 * Stops early if the animal:
 *  - Touches the board edge (herd stops, counts as escape; loose animal escapes)
 *  - Touches another animal or the dog
 *
 * Also: loose animals that touched an edge in Dumb Animals are removed here.
 *
 * Returns updated state, potentially with escapedCount incremented and finished phase set.
 */
export function phaseMoveHerd(state) {
  const s = cloneState(state);
  const { rng, boardSize } = s;
  const events = [];

  // Sort animals furthest from dog first
  const animals = [s.herd, ...s.looseAnimals].sort(
    (a, b) => dist(b, s.dog) - dist(a, s.dog)
  );

  const escapedIds = new Set();

  for (const animal of animals) {
    if (escapedIds.has(animal.id)) continue;

    const d = dist(animal, s.dog);
    if (d >= HERD_CLEARANCE) {
      // Already far enough
      continue;
    }

    // Move directly away from dog
    const needed = HERD_CLEARANCE - d;
    const dir = unitVector(s.dog, animal); // away from dog

    let newX = animal.x + dir.x * needed;
    let newY = animal.y + dir.y * needed;

    // Check board edge
    const wouldEscape = isOffBoard({ x: newX, y: newY }, boardSize) ||
      touchesEdge({ x: newX, y: newY, radius: animal.radius }, boardSize);

    if (wouldEscape) {
      // Clamp to edge
      newX = Math.max(animal.radius, Math.min(boardSize - animal.radius, newX));
      newY = Math.max(animal.radius, Math.min(boardSize - animal.radius, newY));

      if (animal.type === 'herd') {
        animal.x = newX;
        animal.y = newY;
        s.herd.x = newX;
        s.herd.y = newY;
        s.escapedCount += 1;
        events.push(
          `Move Herd: Herd hit the board edge and stopped! Counts as +1 escape (total: ${s.escapedCount}).`
        );
      } else {
        escapedIds.add(animal.id);
        s.escapedCount += 1;
        events.push(
          `Move Herd: ${animal.id} fled off the board edge and escaped! (total: ${s.escapedCount})`
        );
      }
      continue;
    }

    // Check collision with other animals / dog
    const testPos = { x: newX, y: newY, radius: animal.radius };
    const others = [s.dog, s.herd, ...s.looseAnimals].filter(
      (e) => e.id !== animal.id && !escapedIds.has(e.id)
    );

    let blocked = false;
    for (const other of others) {
      if (entitiesContact(testPos, other)) {
        // Stop just before contact along the movement vector
        const stopDist = Math.max(0, dist(animal, other) - animal.radius - other.radius - 0.01);
        newX = animal.x + dir.x * stopDist;
        newY = animal.y + dir.y * stopDist;
        events.push(
          `Move Herd: ${animal.id} stopped due to contact with ${other.id}.`
        );
        blocked = true;
        break;
      }
    }

    if (animal.type === 'herd') {
      s.herd.x = newX;
      s.herd.y = newY;
    } else {
      const la = s.looseAnimals.find((a) => a.id === animal.id);
      if (la) {
        la.x = newX;
        la.y = newY;
      }
    }

    // Check if loose animal rejoins herd after movement
    // A loose animal rejoins if movement would bring it into base-to-base contact with the herd.
    // This includes when it stops because it contacted the herd (blocked by herd).
    if (animal.type === 'loose') {
      const la = s.looseAnimals.find((a) => a.id === animal.id);
      const contactsHerd = la && (
        entitiesContact(la, s.herd) ||
        (blocked && s.looseAnimals.find(x => x.id === animal.id) &&
          dist({ x: newX, y: newY }, s.herd) <= la.radius + s.herd.radius + 0.05)
      );
      if (contactsHerd) {
        escapedIds.add(la.id); // mark for removal (rejoined, not escaped)
        events.push(`Move Herd: ${la.id} rejoined the herd during movement!`);
        continue;
      }
    }

    if (!blocked) {
      events.push(
        `Move Herd: ${animal.id} moved ${needed.toFixed(2)}" away from dog to (${newX.toFixed(2)}, ${newY.toFixed(2)}).`
      );
    }
  }

  // Remove escaped and rejoined loose animals
  s.looseAnimals = s.looseAnimals.filter((a) => !escapedIds.has(a.id) && !a._escaped);

  s.events = [...s.events, ...events];

  // Check win condition: is herd centre in the pen?
  if (entitiesContact(s.herd, s.pen)) {
    events.push('🐑 The herd is in the pen! That\'ll do!');
    s.phase = 'finished';
    s.events = [...s.events]; // already updated above
    // Push the win message properly
    s.events.push('🐑 The herd is in the pen! That\'ll do!');
    return s;
  }

  // Advance turn
  s.turn += 1;
  s.phase = 'dumb_animals';
  return s;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * processTurn(state, action) → nextState
 *
 * Runs all four phases of a turn in sequence:
 *   1. Dumb Animals  (automatic)
 *   2. Come-by       (applies player action)
 *   3. Loose Animal  (automatic)
 *   4. Move Herd     (automatic)
 *
 * The returned state has phase set to 'dumb_animals' (next turn) or 'finished'.
 */
export function processTurn(state, action) {
  let s = state;
  s = phaseDumbAnimals(s);
  s = phaseComeBy(s, action);
  s = phaseLooseAnimal(s);
  s = phaseMoveHerd(s);
  return s;
}
