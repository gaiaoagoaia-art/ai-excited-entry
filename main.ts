// Entry point for ai-excited-01: "The wave that reaches for the moon".
//
// The picture is not stored and copied — it is drawn, fresh, by the
// procedural renderer in draw.ts every time this program runs, and written
// to the competition's output directory as entry.png. The renderer is fully
// seeded, so the two runs the grader makes produce the same bytes.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderEntryPNG } from './draw.ts';

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), renderEntryPNG());
