// procedural-demo.js — generate and display sample procedural maps

import { generateProceduralMap, validateMap } from './engine.js';

console.log('Generating 5 procedural maps...\n');

for (let seed = 1; seed <= 5; seed++) {
  const map = generateProceduralMap(seed);
  const validation = validateMap(map);

  console.log(`─────────────────────────────────────────────────────────`);
  console.log(`Seed ${seed}:`);
  console.log(`  Valid: ${validation.valid ? '✓' : '✗'}`);
  if (!validation.valid) {
    console.log(`  Errors: ${validation.errors.join(', ')}`);
  }
  console.log(`  Herd: (${map.herd.x.toFixed(1)}", ${map.herd.y.toFixed(1)}")`);
  console.log(`  Pen: (${map.pen.x.toFixed(1)}", ${map.pen.y.toFixed(1)}") ${map.pen.w}×${map.pen.h} opens ${map.pen.openSide}`);
  console.log(`  Terrain pieces: ${map.terrain.length}`);

  if (map.terrain.length > 0) {
    map.terrain.forEach(t => {
      console.log(`    - ${t.type} at (${t.x.toFixed(1)}", ${t.y.toFixed(1)}") ${t.w}×${t.h}`);
    });
  }
  console.log('');
}

console.log('─────────────────────────────────────────────────────────');
console.log('All procedural maps generated successfully!');
