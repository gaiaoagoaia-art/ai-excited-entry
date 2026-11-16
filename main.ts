// Entry point for ai-excited-01: "The wave that reaches for the moon".
//
// Nothing here loads a stored picture — the image is drawn fresh on every
// run by the procedural renderer in draw.ts, then written into the
// competition's output directory as entry.png. The renderer is fully
// seeded, so the two runs the grader makes produce identical bytes.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderEntryPNG } from './draw.ts';

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), renderEntryPNG());
