// main.ts — entrypoint for the ai-excited-01 submission.
//
// Renders the artwork with the procedural renderer in draw.ts and writes it
// as entry.png into the output directory named by MAKEFUN_OUTPUT_DIR
// (falling back to ./output). The render is fully deterministic: the same
// bytes come out on every run.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderArtwork } from "./draw.ts";
import { encodePng } from "./png.ts";

function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "output";
  const { width, height, rgb } = renderArtwork();
  const png = encodePng(width, height, rgb);
  mkdirSync(outDir, { recursive: true });
  const target = join(outDir, "entry.png");
  writeFileSync(target, png);
  console.log(`wrote ${target} (${png.length} bytes, ${width}x${height})`);
}

main();
