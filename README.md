# Herding28

A mobile-first React web app implementation of **Herding28**, a solo non-combat tabletop miniatures game. Guide your herding dog to move a flock toward the pen across a 24"×24" board while managing random animal behavior.

## 🎮 Game Overview

Control a herding dog to move animals toward the pen. Each turn:
1. **Dumb Animals** — Animals wander randomly (D6" in random direction)
2. **Come-by** — Move your dog up to 12"
3. **Loose Animal** — Risk of animals breaking away if too close
4. **Move Herd** — Push animals away from dog (10" clearance)

**Victory:** Get the herd's center point inside the pen  
**Challenge:** Keep animals from escaping off the board edge

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Run development server
npm start

# Run tests
node src/appEngine.test.js
```

Open [http://localhost:3000](http://localhost:3000) to play.

## 🗺️ Scenarios

- **Walk Up** — Basic scenario with clear path to pen
- **Rotten Bridge** — Two impassable rivers with 8" crossing gap
- **Dead Mount** — Right half is labouring terrain (halves movement)
- **Bog's Edge** — Murky water pulls animals toward dog (antithetical terrain)

## 🎯 Features

### Terrain Types

**Impassable** — Blocks all movement (rendered as blue water)

**Labouring** — Halves movement distance when entity's center is in terrain (rendered as brown mud)
- Example: D6 roll of 5 → moves 3" (ceil(5/2))

**Antithetical** — Pulls animals TOWARD dog instead of pushing away during Move Herd phase (rendered as dark teal murky water)
- Only applies within 10" of dog
- Example: At 8" from dog → pulled 2" closer instead of pushed 2" away

### Collision Detection

- Pen walls with ray-casting collision detection
- Entity-to-entity collision with sub-inch precision
- Terrain obstacles
- Loose animals can rejoin herd on contact

### Animation System

- Smooth 500ms animations for each phase
- Visual feedback for rejoining animals (green tint)
- Separate animation sequences for move_herd and dumb_animals phases

## 🏗️ Architecture

```
src/
├── App.js              - Complete game: engine + React UI
├── appEngine.js        - Auto-generated engine export for testing
├── appEngine.test.js   - Engine unit tests (Node test runner)
└── index.js           - React entry point
```

**Key Design:** Engine and UI are in the same file but cleanly separated. The engine section (pure JS, no React) can be extracted for testing.

## 🧪 Testing

```bash
# Run all tests
node src/appEngine.test.js

# Tests cover:
# - All game phases (dumb_animals, come_by, loose_animal, move_herd, deployment)
# - Terrain collision (impassable, labouring, antithetical)
# - Edge cases (board boundaries, entity overlap, rejoining)
# - Victory conditions
```

All 106 tests pass ✓

## 🎨 Visual Design

- **Board:** 24"×24" grid with 1" and 5" markers
- **Dog:** Dark blue circle (0.75" radius)
- **Herd:** Light green circle with sheep texture (2.5" radius)
- **Loose Animals:** Yellow circles with labels (0.75" radius)
- **Pen:** Beige rectangle with 3 solid walls, 1 open side
- **Terrain:** Color-coded with visual textures

## 📐 Coordinate System

- Origin at top-left (0, 0)
- All positions in game-inches (not pixels)
- SVG rendering converts via `toPx(inches)`
- Board: 24"×24" → 480×480px viewport

## 🔧 Development

### Regenerating Engine Export

After editing `App.js` engine code, regenerate the test export:

```bash
cd src
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'fs';
const content = readFileSync('App.js', 'utf8');
const start   = content.indexOf('// ENGINE (inlined)');
const engEnd  = content.indexOf('// SCENARIO');
const scenEnd = content.indexOf('// BOARD SVG');
const engine  = content.slice(start, engEnd).split('\n')
  .filter(l => !l.trim().startsWith('// ─') && l.trim() !== '// ENGINE (inlined)')
  .join('\n');
const scenario = content.slice(engEnd, scenEnd).split('\n')
  .filter(l => !l.trim().startsWith('// ─') && l.trim() !== '// SCENARIOS')
  .join('\n');
writeFileSync('appEngine.js', \`// appEngine.js — auto-generated from App.js\n\n\${engine}\n\n\${scenario}\n\nexport { /* exports */ };\`);
"
```

### Project Structure

See [CLAUDE.md](./CLAUDE.md) for detailed documentation on:
- Game engine internals
- Turn phase mechanics
- Animation system
- Collision detection algorithms
- Scenario definitions

## 📱 Mobile Support

- Touch-friendly controls
- Responsive layout (max-width: 480px)
- Tap to preview dog movement
- Clear visual feedback for invalid moves

## 🎲 Game Rules

- **Dog Movement:** Up to 12" per turn
- **Spook Range:** Within 8" of herd
- **Clearance:** Animals pushed to 10" from dog
- **Board Edge:** Animals touching edge are removed (escaped)
- **Victory:** Herd center inside pen rectangle

## 📦 Technologies

- React 18 (Hooks)
- Create React App
- Node.js test runner (built-in)
- Pure SVG rendering (no canvas)

## 📄 License

This is a digital implementation of a tabletop miniatures game.

## 🤝 Contributing

This is a personal project, but feel free to fork and experiment!

---

**Made with Claude Code**
