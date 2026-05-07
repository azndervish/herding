import { readFileSync, writeFileSync } from 'fs';

const content = readFileSync('src/App.js', 'utf8');
const start   = content.indexOf('// ENGINE (inlined)');
const engEnd  = content.indexOf('// SCENARIO');
const scenEnd = content.indexOf('// BOARD SVG');
const engine  = content.slice(start, engEnd).split('\n')
  .filter(l => !l.trim().startsWith('// ─') && l.trim() !== '// ENGINE (inlined)')
  .join('\n');
const scenario = content.slice(engEnd, scenEnd).split('\n')
  .filter(l => !l.trim().startsWith('// ─') && l.trim() !== '// SCENARIOS')
  .join('\n');

const exports = `export {
  HERD_RADIUS, TOKEN_RADIUS, DOG_MOVE_MAX, DOG_SPOOK_RANGE, HERD_CLEARANCE,
  dist, unitVector, touchesEdge, entitiesContact, circleRectContact, rollDie, angleToOffset, cloneState,
  getTerrainEdges,
  phaseDumbAnimals, phaseComeBy, phaseLooseAnimal, phaseMoveHerd,
  processTurn, WALK_UP, ROTTEN_BRIDGE, DEAD_MOUNT, BOGS_EDGE, SCENARIOS,
};`;

writeFileSync('src/appEngine.js', `// appEngine.js — auto-generated from App.js\n\n${engine}\n\n${scenario}\n\n${exports}\n`);
console.log('✓ appEngine.js regenerated');
