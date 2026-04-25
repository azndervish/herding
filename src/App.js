import { useState, useCallback, useRef, useEffect } from "react";

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

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// BOARD SVG — pure rendering
// ─────────────────────────────────────────────────────────────────────────────

const BOARD_PX = 480;

function toPx(inches) { return (inches / 24) * BOARD_PX; }

function TerrainLayer() {
  return (
    <g opacity="0.9">
      {/* Grass patches */}
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
  const cx=toPx(pen.x), cy=toPx(pen.y), r=toPx(pen.radius);
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="#ede4c8" stroke="#7a5a38"
        strokeWidth={1.5} strokeDasharray="6,3" opacity={0.85}/>
      <line x1={cx-r*.6} y1={cy-r*.6} x2={cx+r*.6} y2={cy+r*.6}
        stroke="#7a5a38" strokeWidth={1} opacity={0.25}/>
      <line x1={cx+r*.6} y1={cy-r*.6} x2={cx-r*.6} y2={cy+r*.6}
        stroke="#7a5a38" strokeWidth={1} opacity={0.25}/>
      <text x={cx} y={cy+r+14} textAnchor="middle"
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
  return (
    <g>
      <circle cx={cx+1} cy={cy+1} r={r} fill="#9a9070" opacity={0.22}/>
      <circle cx={cx} cy={cy} r={r} fill="#f4f0d8"
        stroke="#b89828" strokeWidth={1.5} strokeDasharray="2,1.5"/>
      <circle cx={cx} cy={cy} r={2.5} fill="#b89828"/>
      <text x={cx} y={cy+r+10} textAnchor="middle"
        fontSize={8} fontFamily="monospace" fill="#9a8010">
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
  dumb_animals:  { label: "Dumb Animals",  color: "#c8b888", border: "#a89868", text: "#3a2e1a" },
  come_by:       { label: "Come-by",       color: "#b8c8a0", border: "#8aaa70", text: "#2a3a1a" },
  loose_animal:  { label: "Loose Animal",  color: "#c8b888", border: "#a89868", text: "#3a2e1a" },
  move_herd:     { label: "Move Herd",     color: "#c8b888", border: "#a89868", text: "#3a2e1a" },
  finished:      { label: "Finished!",     color: "#a0c0a0", border: "#6a9060", text: "#1a3a1a" },
};

// ─────────────────────────────────────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  // Game state
  const [gameState, setGameState] = useState(null);
  // UI interaction state
  const [preview, setPreview] = useState(null);   // {x, y} in game-inches, or null
  const [invalid, setInvalid]   = useState(false); // flash for out-of-range tap
  const svgRef = useRef(null);

  // ── Bootstrap ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const initial = { ...WALK_UP, rng: Math.random };
    // Run through dumb_animals, stop just before come_by
    const ready = processTurn(initial, null, 'come_by');
    setGameState(ready);
  }, []);

  // ── SVG tap → game coordinates ──────────────────────────────────────────────
  const svgToGame = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const svgX = (clientX - rect.left) / rect.width  * BOARD_PX;
    const svgY = (clientY - rect.top)  / rect.height * BOARD_PX;
    return { x: svgX / BOARD_PX * 24, y: svgY / BOARD_PX * 24 };
  }, []);

  // ── Handle tap on board ─────────────────────────────────────────────────────
  const handleBoardTap = useCallback((e) => {
    if (!gameState || gameState.phase !== 'come_by') return;
    e.preventDefault();

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const tap = svgToGame(clientX, clientY);
    if (!tap) return;

    const d = dist(gameState.dog, tap);
    if (d > DOG_MOVE_MAX) {
      // Out of range — flash invalid
      setInvalid(true);
      setTimeout(() => setInvalid(false), 600);
      return;
    }
    setPreview(tap);
  }, [gameState, svgToGame]);

  // ── Confirm move ────────────────────────────────────────────────────────────
  const handleConfirm = useCallback(() => {
    if (!preview || !gameState) return;
    const action = { type: 'move_dog', x: preview.x, y: preview.y };
    const next = processTurn(gameState, action, 'come_by');
    setGameState(next);
    setPreview(null);
  }, [preview, gameState]);

  // ── Cancel preview ──────────────────────────────────────────────────────────
  const handleCancel = useCallback(() => setPreview(null), []);

  // ── Skip (end_turn) ──────────────────────────────────────────────────────────
  const handleSkip = useCallback(() => {
    if (!gameState) return;
    const next = processTurn(gameState, { type: 'end_turn' }, 'come_by');
    setGameState(next);
    setPreview(null);
  }, [gameState]);

  if (!gameState) {
    return (
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',
        fontFamily:'monospace',color:'#7a6a48',fontSize:13}}>
        Setting up the pasture…
      </div>
    );
  }

  const { dog, herd, pen, looseAnimals, phase, turn, escapedCount=0, events=[] } = gameState;
  const phaseMeta = PHASE_META[phase] || PHASE_META.dumb_animals;
  const isInteractive = phase === 'come_by' && !gameState.phase !== 'finished';
  const isFinished = phase === 'finished';

  // Last few events for the log
  const recentEvents = [...events].reverse().slice(0, 12);

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
          {' '}— Trial No. 1
        </div>
        <div style={{
          fontSize:9, textTransform:'uppercase', letterSpacing:'0.1em',
          padding:'3px 8px', borderRadius:2,
          background: phaseMeta.color,
          color: phaseMeta.text,
          border:`1px solid ${phaseMeta.border}`,
          whiteSpace:'nowrap',
        }}>
          {phaseMeta.label}
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
          onMouseDown={isInteractive && !preview ? handleBoardTap : undefined}
          onTouchStart={isInteractive && !preview ? handleBoardTap : undefined}
        >
          {/* Grid */}
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

          <TerrainLayer/>
          <RulerLayer/>
          <PenEntity pen={pen}/>
          <SpookRing dog={dog}/>

          {/* Dog range ring — only during come_by */}
          {isInteractive && <DogRangeRing dog={dog} preview={!!preview}/>}

          {/* Move preview line + ghost */}
          {preview && (
            <>
              <MoveLine from={dog} to={preview}/>
              <GhostDog x={preview.x} y={preview.y}/>
            </>
          )}

          <HerdEntity herd={herd}/>
          {looseAnimals.map(la => <LooseAnimalEntity key={la.id} la={la}/>)}
          <DogEntity dog={dog}/>

          {/* Invalid tap flash overlay */}
          {invalid && (
            <rect width={BOARD_PX} height={BOARD_PX} fill="rgba(200,64,48,0.12)"
              style={{pointerEvents:'none'}}/>
          )}

          {/* Finished overlay */}
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

        {/* Out-of-range hint */}
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
          { label:'Dog↔Herd', value: dist(dog,herd).toFixed(1)+'"', small: true },
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
          <div style={{fontSize:12,color:'#2a4a2a',fontFamily:'monospace',flex:1,textAlign:'center'}}>
            🐕 Good dog. Give it a pat.
          </div>
        ) : phase !== 'come_by' ? (
          <div style={{fontSize:11,color:'#7a6a48',fontFamily:'monospace',flex:1,textAlign:'center'}}>
            Processing…
          </div>
        ) : preview ? (
          <>
            <div style={{fontSize:11,color:'#4a3c22',flex:1}}>
              Move to ({preview.x.toFixed(1)}", {preview.y.toFixed(1)}")?{' '}
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
