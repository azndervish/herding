import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
import {
  TOKEN_RADIUS, DOG_MOVE_MAX, DOG_SPOOK_RANGE,
  dist, processTurn, SCENARIOS,
} from "./engine.js";

const BUILD_HASH = process.env.REACT_APP_BUILD_HASH || 'local';

// BOARD SVG — pure rendering
// ─────────────────────────────────────────────────────────────────────────────

const BOARD_PX = 480;
const INCHES_PER_FRAME = 2;

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

  // Herd sprite size - sized to cover the herd radius nicely
  const herdSpriteSize = r * 2; // Sprite covers the diameter

  return (
    <g>
      {/* Shadow */}
      <ellipse cx={cx+2} cy={cy+2} rx={r} ry={r*0.9} fill="#9a9070" opacity={0.15}/>

      {/* Collision reference circle - dotted green outline only */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#5a8040"
        strokeWidth={2} strokeDasharray="4,2.5" opacity={0.6}/>

      {/* Herd sprite - centered on the herd position */}
      <image
        href="/herding/sheep.png"
        x={cx - herdSpriteSize/2}
        y={cy - herdSpriteSize/2}
        width={herdSpriteSize}
        height={herdSpriteSize}
        preserveAspectRatio="xMidYMid meet"
      />

      {/* Label */}
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

  // Loose sheep sprite size - sized to match the token radius
  const spriteSize = r * 2.5; // Slightly larger than the collision circle for visibility

  return (
    <g opacity={rejoining ? 0.6 : 1}>
      {/* Shadow */}
      <ellipse cx={cx+1} cy={cy+1} rx={r*0.8} ry={r*0.5} fill="#9a9070" opacity={0.22}/>

      {/* Collision reference circle - dotted outline */}
      <circle cx={cx} cy={cy} r={r} fill="none"
        stroke={rejoining ? "#5a8040" : "#b89828"}
        strokeWidth={rejoining ? 2 : 1.5}
        strokeDasharray="2,1.5" opacity={0.6}/>

      {/* Loose sheep sprite */}
      <image
        href="/herding/loose_sheep.png"
        x={cx - spriteSize/2}
        y={cy - spriteSize/2}
        width={spriteSize}
        height={spriteSize}
        preserveAspectRatio="xMidYMid meet"
      />

      {/* Label */}
      <text x={cx} y={cy+r+10} textAnchor="middle"
        fontSize={8} fontFamily="monospace" fill={rejoining ? "#3a5a20" : "#9a8010"}>
        {la.id.replace('loose_','L')}
      </text>
    </g>
  );
}

function DogEntity({ dog, dogTypeId = 'peaches', animFrame = 0 }) {
  const cx=toPx(dog.x), cy=toPx(dog.y), r=toPx(dog.radius);
  const dogType = DOG_TYPES.find(dt => dt.id === dogTypeId) || DOG_TYPES[0];
  const facing = dog.facing || 'right'; // Default to right if not set

  // All dogs now use sprite rendering
  // Sprite is designed in 24x24 viewBox with center at (12, 12)
  // Scale it so the overall sprite fits within ~2.5x the dog radius
  const scale = (r * 2.5) / 12; // Scale based on sprite center point (12)

  return (
    <g>
      {/* Shadow */}
      <ellipse cx={cx+1} cy={cy+r*1.2+1} rx={r*0.8} ry={r*0.3} fill="#000" opacity={0.2}/>

      {/* Sprite - translate to position, then scale around origin */}
      <g transform={`translate(${cx}, ${cy}) scale(${scale}) translate(-12, -12)`}>
        <DogSprite
          idleSprite={dogType.idleSprite}
          runSprite={dogType.runSprite}
          frame={animFrame}
          facing={facing}
        />
      </g>

      {/* Label */}
      <text x={cx} y={cy+r*1.8+10} textAnchor="middle"
        fontSize={9} fontFamily="monospace" fontWeight="600" fill="#3a2e1a">
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
// DOG SELECTOR
// ─────────────────────────────────────────────────────────────────────────────

const DOG_TYPES = [
  { id: 'peaches', name: 'Peaches', idleSprite: '/herding/chihuahua.png', runSprite: '/herding/chihuahua_run.png' },
  { id: 'lucy', name: 'Lucy', idleSprite: '/herding/boxer.png', runSprite: '/herding/boxer_run.png' },
  { id: 'dean', name: 'Dean', idleSprite: '/herding/jackrussell.png', runSprite: '/herding/jackrussell_run.png' },
  { id: 'rosy', name: 'Rosy', idleSprite: '/herding/beagle.png', runSprite: '/herding/beagle_run.png' },

  // Add more dogs here - just specify name, idleSprite, and runSprite paths
  // Example: { id: 'fluffy', name: 'Fluffy', idleSprite: '/herding/fluffy.png', runSprite: '/herding/fluffy_run.png' },
];

// Dog sprite component - uses PNG images (idle and run)
function DogSprite({ idleSprite, runSprite, frame = 0, facing = 'right' }) {
  // Alternate between idle and run frames
  const isRunFrame = frame % 2 === 1;
  const imageSrc = isRunFrame ? runSprite : idleSprite;

  // Flip horizontally if facing left
  const transform = facing === 'left' ? 'scale(-1, 1) translate(-24, 0)' : '';

  return (
    <g transform={transform}>
      <image
        href={imageSrc}
        x="0"
        y="0"
        width="24"
        height="24"
        preserveAspectRatio="xMidYMid meet"
      />
    </g>
  );
}

// Generic dog renderer for selector (standalone SVG wrapper)
function DogAvatar({ dogType, size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <DogSprite idleSprite={dogType.idleSprite} runSprite={dogType.runSprite} frame={0} facing="right" />
    </svg>
  );
}

function DogSelector({ selectedDogId, onSelect, onClose }) {
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: '#e8dfc8',
        border: '2px solid #8a7a5a',
        borderRadius: 8,
        padding: 20,
        minWidth: 280,
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }}>
        <div style={{
          fontSize: 14,
          fontWeight: 600,
          color: '#3a2e1a',
          marginBottom: 16,
          textAlign: 'center',
        }}>
          Select Your Dog
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          marginBottom: 16,
        }}>
          {DOG_TYPES.map(dogType => {
            const isSelected = selectedDogId === dogType.id;
            return (
              <button
                key={dogType.id}
                onClick={() => {
                  onSelect(dogType.id);
                  onClose();
                }}
                style={{
                  padding: '10px 12px',
                  border: `2px solid ${isSelected ? '#4a7ba7' : '#9a8a6a'}`,
                  borderRadius: 6,
                  background: isSelected ? '#fff' : '#ddd3b8',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  transition: 'all 0.15s',
                  boxShadow: isSelected ? '0 0 0 3px rgba(74,123,167,0.2)' : 'none',
                }}
              >
                <DogAvatar dogType={dogType} size={24} />
                <span style={{
                  fontSize: 13,
                  color: '#3a2e1a',
                  fontWeight: isSelected ? 600 : 400,
                  flex: 1,
                }}>
                  {dogType.name}
                </span>
                {isSelected && (
                  <span style={{ fontSize: 16, color: '#4a7ba7' }}>✓</span>
                )}
              </button>
            );
          })}
        </div>

        <button
          onClick={onClose}
          style={{
            width: '100%',
            padding: '8px',
            border: '1.5px solid #8a7a5a',
            borderRadius: 4,
            background: '#ddd3b8',
            color: '#3a2e1a',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

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

      <div style={{
        marginTop: 'auto',
        padding: '12px 16px 16px',
        color: '#8a7a5a',
        fontSize: 9,
        letterSpacing: '0.08em',
        textAlign: 'center',
      }}>
        Build {BUILD_HASH}
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
    dog:         { x: state.dog.x,  y: state.dog.y, facing: state.dog.facing || 'right' },
    herd:        { x: state.herd.x, y: state.herd.y },
    looseAnimals: state.looseAnimals.map(la => ({
      id: la.id, radius: la.radius, x: la.x, y: la.y,
    })),
  };
}

export default function App() {
  // ── Preload sprite images ─────────────────────────────────────────────────
  useEffect(() => {
    // Preload all dog and sheep sprites to avoid flickering on first animation
    const preloadImages = [
      ...DOG_TYPES.flatMap(dog => [dog.idleSprite, dog.runSprite]),
      '/herding/sheep.png',
      '/herding/loose_sheep.png',
    ];
    preloadImages.forEach(src => {
      const img = new Image();
      img.src = src;
    });
  }, []);

  // ── Screen routing ───────────────────────────────────────────────────────
  const [screen,    setScreen]      = useState('select'); // 'select' | 'game'
  const [scenario,  setScenario]    = useState(null);

  // ── Core game state ───────────────────────────────────────────────────────
  const [gameState, setGameState]   = useState(null);
  const [preview,   setPreview]     = useState(null);
  const [invalid,   setInvalid]     = useState(false);
  const [selectedDog, setSelectedDog] = useState('peaches'); // Current dog selection
  const [showDogSelector, setShowDogSelector] = useState(false); // Dog selector modal visibility
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

      // Calculate animation frame based on distance and progress
      // Total frames = distance / INCHES_PER_FRAME (rounded)
      // Frame alternates: 0 (idle), 1 (run), 0 (idle), 1 (run)...
      const distance = Math.sqrt(
        (anim.toDog.x - anim.fromDog.x) ** 2 +
        (anim.toDog.y - anim.fromDog.y) ** 2
      );
      const totalFrames = Math.max(1, Math.round(distance / INCHES_PER_FRAME));
      const currentFrame = t >= 1 ? 0 : Math.floor(ease * totalFrames); // End in idle (frame 0)

      // Determine facing direction based on movement
      // Only change facing if the dog actually moved (deltaX !== 0)
      const deltaX = anim.toDog.x - anim.fromDog.x;
      const facing = deltaX !== 0 ? (deltaX < 0 ? 'left' : 'right') : (anim.fromDog.facing || 'right');

      setDisplayPos(prev => ({ ...prev, dog: { x: dx, y: dy, frame: currentFrame, facing } }));

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
      anim.fromDog  = { x: afterDeployment.dog.x,  y: afterDeployment.dog.y, facing: afterDeployment.dog.facing || 'right' };
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
    anim.fromDog  = { x: prev.dog.x,  y: prev.dog.y, facing: prev.dog.facing || 'right' };
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
          <DogEntity dog={dog} dogTypeId={selectedDog} animFrame={dog.frame || 0}/>

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
        {(() => {
          const score = looseAnimals.length + escapedCount;
          return [
            { label:'Turn',     value: turn },
            { label:'Score',    value: score, danger: true },
            { label:'Dog↔Herd', value: dist(dog,herd).toFixed(1)+'"'  , small: true },
          ];
        })().map((s,i,arr) => (
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
              color: s.danger && s.value > 0 ? '#8a3020' : '#3a2e1a',
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
              Tap within the blue zone to position your dog.
            </div>
            <button onClick={() => setShowDogSelector(true)} style={btnStyle('ghost')}>Select Dog</button>
            <button onClick={handleConfirm} style={btnStyle('primary')}>Deploy</button>
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

      {/* ── Dog selector modal ── */}
      {showDogSelector && (
        <DogSelector
          selectedDogId={selectedDog}
          onSelect={setSelectedDog}
          onClose={() => setShowDogSelector(false)}
        />
      )}
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
