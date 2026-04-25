import { useMemo } from "react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BOARD_IN = 24;
const PX = 480; // SVG coordinate space (square)
const S = PX / BOARD_IN; // scale: pixels per inch

function px(inches) { return inches * S; }
function dist(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }

// ---------------------------------------------------------------------------
// Sample state (replace with real engine state)
// ---------------------------------------------------------------------------
const SAMPLE_STATE = {
  boardSize: 24,
  turn: 3,
  phase: "come_by",
  escapedCount: 1,
  dog:  { id: "dog",  type: "dog",  x: 10, y: 14, radius: 0.75 },
  herd: { id: "herd", type: "herd", x: 6,  y: 6,  radius: 2.5  },
  looseAnimals: [
    { id: "loose_1", type: "loose", x: 14, y: 8,  radius: 0.75 },
    { id: "loose_2", type: "loose", x: 9,  y: 16, radius: 0.75 },
  ],
  pen: { id: "pen", type: "pen", x: 20, y: 20, radius: 2.5 },
  events: [
    "Turn 1 — Dumb Animals: Herd wanders 4\" (angle 312°).",
    "Turn 1 — Loose Animal: Dog is 5.83\" from herd. Rolled D8: 7. An animal got spooked! loose_1 placed 3\" from herd.",
    "Turn 2 — Move Herd: Herd moved 3.20\" away from dog.",
    "Turn 2 — loose_2 fled near board edge!",
    "Turn 3 — Come-by: Dog moves to (10.00, 14.00).",
  ],
};

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------

function TerrainLayer() {
  return (<g/>)
  const patches = [
    { cx: 3.5, cy: 3,  rx: 2.5, ry: 2,   rot: -10, fill: "#d4cc9a", stroke: "#b0a870" },
    { cx: 18,  cy: 5,  rx: 3,   ry: 2.2, rot:  15, fill: "#c0c888", stroke: "#90a858" },
    { cx: 21,  cy: 18, rx: 2.8, ry: 2,   rot:   5, fill: "#d4cc9a", stroke: "#b0a870" },
    { cx: 7,   cy: 20, rx: 2,   ry: 1.5, rot: -20, fill: "#c0c888", stroke: "#90a858" },
  ];

  const blades = useMemo(() =>
    Array.from({ length: 18 }, (_, i) => ({
      x: (Math.sin(i * 7.3) * 0.5 + 0.5) * 22 + 1,
      y: (Math.cos(i * 4.7) * 0.5 + 0.5) * 22 + 1,
    })), []
  );

  const rulers = useMemo(() =>
    Array.from({ length: 13 }, (_, i) => i * 2), []
  );

  return (
    <g>
      {patches.map((p, i) => (
        <ellipse
          key={i}
          cx={px(p.cx)} cy={px(p.cy)} rx={px(p.rx)} ry={px(p.ry)}
          transform={`rotate(${p.rot},${px(p.cx)},${px(p.cy)})`}
          fill={p.fill} stroke={p.stroke} strokeWidth={1} opacity={0.3}
        />
      ))}
      {blades.map((b, i) => (
        <line key={i}
          x1={px(b.x)} y1={px(b.y)}
          x2={px(b.x + 0.15)} y2={px(b.y - 0.5)}
          stroke="#8a9858" strokeWidth={1.2} opacity={0.35}
        />
      ))}
      {/* Ruler ticks along bottom */}
      {rulers.map(i => (
        <g key={i}>
          <line x1={px(i)} y1={476} x2={px(i)} y2={480} stroke="#8a7a5a" strokeWidth={0.8} opacity={0.6} />
          {i > 0 && i % 4 === 0 && (
            <text x={px(i)} y={475} textAnchor="middle" fontSize={7} fontFamily="monospace" fill="#7a6a48" opacity={0.7}>
              {i}"
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

function Pen({ pen }) {
  const cx = px(pen.x), cy = px(pen.y), half = px(pen.radius) * 1.3;
  return (
    <g>
      <rect x={cx - half} y={cy - half} width={half * 2} height={half * 2}
        rx={3} fill="#e0d4b0" stroke="#7a5a38" strokeWidth={1.5} strokeDasharray="5,3" />
      <line x1={cx - half + 4} y1={cy - half + 4} x2={cx + half - 4} y2={cy + half - 4}
        stroke="#7a5a38" strokeWidth={1} opacity={0.35} />
      <line x1={cx + half - 4} y1={cy - half + 4} x2={cx - half + 4} y2={cy + half - 4}
        stroke="#7a5a38" strokeWidth={1} opacity={0.35} />
      <text x={cx} y={cy - half - 5} textAnchor="middle" fontSize={18} fontFamily="monospace"
        fontWeight="600" fill="#7a5a38" letterSpacing={1}>
        PEN
      </text>
    </g>
  );
}

function SpookRange({ dog }) {
  const cx = px(dog.x), cy = px(dog.y), r = px(8);
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="none"
        stroke="#c87040" strokeWidth={1} strokeDasharray="3,3" opacity={0.45} />
      <text x={cx + r * 0.707 + 3} y={cy - r * 0.707}
        fontSize={18} fontFamily="monospace" fill="#c87040" opacity={0.75}>
        8"
      </text>
    </g>
  );
}

function Herd({ herd }) {
  const cx = px(herd.x), cy = px(herd.y), r = px(herd.radius);
  const sheepOffsets = [
    { dx: -0.6, dy: -0.4 }, { dx: 0.5, dy: -0.3 },
    { dx: -0.2, dy: 0.5  }, { dx: 0.6, dy: 0.5  },
    { dx: 0,    dy: -0.8 },
  ];
  return (
    <g>
      {/* Shadow */}
      <circle cx={cx + 2} cy={cy + 2} r={r} fill="#b0a078" opacity={0.2} />
      {/* Body */}
      <circle cx={cx} cy={cy} r={r} fill="#d8f0c0" stroke="#5a8040" strokeWidth={2} strokeDasharray="4,2" />
      {/* Sheep blobs */}
      {sheepOffsets.map((o, i) =>
        Math.sqrt(o.dx ** 2 + o.dy ** 2) * S < r - 5 ? (
          <circle key={i}
            cx={cx + o.dx * S} cy={cy + o.dy * S} r={6}
            fill="#f4f0e0" stroke="#9ab878" strokeWidth={0.5} />
        ) : null
      )}
      {/* Centre dot */}
      <circle cx={cx} cy={cy} r={r * 0.28} fill="#5a8040" />
      <text x={cx} y={cy + r + 14} textAnchor="middle"
        fontSize={11} fontFamily="monospace" fontWeight="600" fill="#3a5a20">
        HERD
      </text>
    </g>
  );
}

function LooseAnimal({ la }) {
  const cx = px(la.x), cy = px(la.y), r = px(la.radius);
  const label = la.id.replace("loose_", "L");
  return (
    <g>
      <circle cx={cx + 1} cy={cy + 1} r={r} fill="#b0a078" opacity={0.25} />
      <circle cx={cx} cy={cy} r={r} fill="#f4f0d8" stroke="#b89828" strokeWidth={1.5} strokeDasharray="2,1.5" />
      <circle cx={cx} cy={cy} r={2.5} fill="#b89828" />
      <text x={cx} y={cy + r + 10} textAnchor="middle"
        fontSize={8} fontFamily="monospace" fill="#9a8010">
        {label}
      </text>
    </g>
  );
}

function Dog({ dog }) {
  const cx = px(dog.x), cy = px(dog.y), r = px(dog.radius);
  return (
    <g>
      <circle cx={cx + 1} cy={cy + 1} r={r} fill="#4a5870" opacity={0.28} />
      <circle cx={cx} cy={cy} r={r} fill="#3a5878" stroke="#1a3858" strokeWidth={1.5} />
      <circle cx={cx - r * 0.3} cy={cy - r * 0.3} r={r * 0.28} fill="#aaccee" opacity={0.6} />
      <text x={cx} y={cy + r + 10} textAnchor="middle"
        fontSize={9} fontFamily="monospace" fontWeight="600" fill="#1a3858">
        DOG
      </text>
    </g>
  );
}

function Board({ state }) {
  return (
    <svg
      viewBox="0 0 480 480"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", width: "100%", aspectRatio: "1/1", background: "#e8dfc8" }}
    >
      <defs>
        <pattern id="g1" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0L0 0 0 20" fill="none" stroke="#c4b898" strokeWidth={0.5} opacity={0.6} />
        </pattern>
        <pattern id="g5" width="100" height="100" patternUnits="userSpaceOnUse">
          <path d="M100 0L0 0 0 100" fill="none" stroke="#b0a07a" strokeWidth={1} opacity={0.45} />
        </pattern>
      </defs>

      <rect width={480} height={480} fill="#e8dfc8" />
      <rect width={480} height={480} fill="url(#g1)" />
      <rect width={480} height={480} fill="url(#g5)" />
      <rect x={1} y={1} width={478} height={478} fill="none" stroke="#8a7a5a" strokeWidth={2} />

      <TerrainLayer />
      <Pen pen={state.pen} />
      <SpookRange dog={state.dog} />
      <Herd herd={state.herd} />
      {state.looseAnimals.map(la => <LooseAnimal key={la.id} la={la} />)}
      <Dog dog={state.dog} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Stats bar
// ---------------------------------------------------------------------------
const PHASE_LABELS = {
  dumb_animals: "Dumb Animals",
  come_by:      "Come-by",
  loose_animal: "Loose Animal",
  move_herd:    "Move Herd",
  finished:     "Finished!",
};

const PHASE_COLORS = {
  dumb_animals: { bg: "#c8b888", border: "#a89868", color: "#3a2e1a" },
  come_by:      { bg: "#b8c8a0", border: "#8aaa70", color: "#2a3a1a" },
  loose_animal: { bg: "#c8b888", border: "#a89868", color: "#3a2e1a" },
  move_herd:    { bg: "#c8b888", border: "#a89868", color: "#3a2e1a" },
  finished:     { bg: "#a0c0a0", border: "#6a9060", color: "#1a3a1a" },
};

function PhaseBadge({ phase }) {
  const c = PHASE_COLORS[phase] || PHASE_COLORS.dumb_animals;
  return (
    <span style={{
      fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em",
      padding: "3px 8px", borderRadius: 2,
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
      whiteSpace: "nowrap", fontFamily: "'Source Code Pro', monospace",
    }}>
      {PHASE_LABELS[phase] || phase}
    </span>
  );
}

function StatCell({ label, value, danger }) {
  return (
    <div style={{
      flex: 1, textAlign: "center",
      padding: "7px 4px 6px",
      borderRight: "0.5px solid #bfaf90",
    }}>
      <div style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: "0.1em", color: "#7a6a48", marginBottom: 1 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: danger ? "#8a3020" : "#3a2e1a", lineHeight: 1.1 }}>
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------
const LEGEND_ITEMS = [
  {
    label: "Herd",
    svg: (
      <svg width={16} height={16} viewBox="0 0 16 16">
        <circle cx={8} cy={8} r={6} fill="#d8f0c0" stroke="#5a8040" strokeWidth={1.5} strokeDasharray="3,2" />
        <circle cx={8} cy={8} r={2} fill="#5a8040" />
      </svg>
    ),
  },
  {
    label: "Loose",
    svg: (
      <svg width={16} height={16} viewBox="0 0 16 16">
        <circle cx={8} cy={8} r={5} fill="#f4f0d8" stroke="#b89828" strokeWidth={1.5} strokeDasharray="2,1" />
      </svg>
    ),
  },
  {
    label: "Dog",
    svg: (
      <svg width={16} height={16} viewBox="0 0 16 16">
        <circle cx={8} cy={8} r={5} fill="#3a5878" stroke="#1a3858" strokeWidth={1.5} />
        <circle cx={6} cy={6} r={1.5} fill="#aaccee" opacity={0.7} />
      </svg>
    ),
  },
  {
    label: "Pen",
    svg: (
      <svg width={16} height={16} viewBox="0 0 16 16">
        <rect x={2} y={2} width={12} height={12} rx={1} fill="none" stroke="#7a5a38" strokeWidth={1.5} strokeDasharray="3,2" />
        <path d="M5,5L11,11M11,5L5,11" stroke="#7a5a38" strokeWidth={1} opacity={0.5} />
      </svg>
    ),
  },
  {
    label: "8\" range",
    svg: (
      <svg width={16} height={16} viewBox="0 0 16 16">
        <circle cx={8} cy={8} r={6} fill="none" stroke="#c87040" strokeWidth={1} strokeDasharray="2,2" opacity={0.8} />
      </svg>
    ),
  },
];

function Legend() {
  return (
    <div style={{ padding: "8px 10px", borderRight: "0.5px solid #bfaf90", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: "0.1em", color: "#7a6a48", marginBottom: 2 }}>
        Key
      </div>
      {LEGEND_ITEMS.map(item => (
        <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#4a3c22", whiteSpace: "nowrap" }}>
          {item.svg}
          {item.label}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------
function eventClass(ev) {
  if (ev.includes("escaped") || ev.includes("fled")) return "#8a3020";
  if (ev.includes("spooked") || ev.includes("spook")) return "#7a5010";
  if (ev.includes("rejoined")) return "#3a6020";
  if (ev.includes("That'll do")) return "#1a4a2a";
  return "#4a3c22";
}

function EventLog({ events }) {
  const reversed = [...events].reverse();
  return (
    <div style={{ padding: "8px 10px", overflowY: "auto", maxHeight: 120, flex: 1 }}>
      <div style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: "0.1em", color: "#7a6a48", marginBottom: 4 }}>
        Field notes
      </div>
      {(reversed.length ? reversed : ["Awaiting orders…"]).map((ev, i) => (
        <div key={i} style={{
          fontSize: 9.5, color: eventClass(ev), lineHeight: 1.45,
          borderBottom: "0.5px solid #bfaf90", padding: "2px 0",
        }}>
          {ev}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------
export default function Herding28({ state = SAMPLE_STATE }) {
  const dogHerdDist = dist(state.dog, state.herd).toFixed(1) + '"';

  return (
    <div style={{
      fontFamily: "'Source Code Pro', monospace",
      maxWidth: 480,
      margin: "0 auto",
      display: "flex",
      flexDirection: "column",
      background: "transparent",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 10px 7px",
        borderBottom: "1.5px solid #8a7a5a",
        background: "#ddd3b8",
      }}>
        <div style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: 17, fontWeight: 700, color: "#3a2e1a", lineHeight: 1,
        }}>
          Herding
          <sup style={{ fontSize: 9, fontFamily: "'Source Code Pro', monospace", color: "#7a6a48", fontWeight: 400, letterSpacing: "0.06em" }}>
            28
          </sup>
          {" "}— Trial No. 1
        </div>
        <PhaseBadge phase={state.phase} />
      </div>

      {/* Board */}
      <div style={{ width: "100%", borderBottom: "1px solid #b0a07a" }}>
        <Board state={state} />
      </div>

      {/* Stats row */}
      <div style={{
        display: "flex",
        borderBottom: "1px solid #b0a07a",
        background: "#ddd3b8",
      }}>
        <StatCell label="Turn"      value={state.turn} />
        <StatCell label="Loose"     value={state.looseAnimals.length} />
        <StatCell label="Escaped"   value={state.escapedCount} danger />
        <StatCell label="Dog↔Herd"  value={dogHerdDist} />
      </div>

      {/* Legend + Log */}
      <div style={{
        display: "flex",
        background: "#ddd3b8",
        borderBottom: "1px solid #b0a07a",
        maxHeight: 120,
        overflow: "hidden",
      }}>
        <Legend />
        <EventLog events={state.events} />
      </div>

      {/* Google Fonts (loaded once) */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Source+Code+Pro:wght@400;600&display=swap"
      />
    </div>
  );
}
