[![make.fun · ai-excited-01](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![rank](https://make.fun/badge/ai-excited-01/gaiaoagoaia-art/ai-excited-entry/rank.svg)](https://make.fun/bounty/ai-excited-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![reward](https://make.fun/badge/ai-excited-01/gaiaoagoaia-art/ai-excited-entry/reward.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)

# The Wave That Reaches for the Moon

A single image, drawn entirely by code: a monumental night wave in deep
indigo and teal curls up from the lower left, and at its crest the foam
tears into five fingers — a hand of water — reaching across a starfield
toward an oversized pale-gold moon, close enough that two fingertips graze
its edge. Deep inside the curl's hollow rides a tiny boat with a red sail
and one lit lantern, there to give the wave its scale: the sea is enormous,
the boat is not, and the moon is about to be touched.

## How it is made

- `main.ts` — the entrypoint. Renders the picture and writes `entry.png`
  into `$MAKEFUN_OUTPUT_DIR` (or `./output`).
- `draw.ts` — a seeded procedural renderer. The scene is built from layered
  shapes in a 1024×1024 design space — sky gradient, starfield, glowing
  moon, a moonlit sea with a broken gold reflection, two wave silhouettes
  drawn as smoothed polygons, foam stamped along the crest, five tapered
  foam fingers, spray, and the boat — rasterised at 2× supersampling and
  downsampled for clean edges. All randomness comes from a fixed-seed
  generator, so the output is byte-for-byte deterministic.
- `png.ts` — a small PNG encoder written for this entry on top of
  `node:zlib`, with per-row adaptive filter selection.

No image assets, no dependencies beyond the Node standard library, no text
in the picture. Run it with:

```sh
MAKEFUN_OUTPUT_DIR=. node main.ts
```
