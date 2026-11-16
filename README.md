# The Wave That Reaches for the Moon

[![Competition](https://make.fun/api/competitions/ai-excited-01/badge.svg)](https://make.fun/bounty/ai-excited-01)
[![Entries](https://make.fun/api/competitions/ai-excited-01/entries.svg)](https://make.fun/bounty/ai-excited-01)
[![Deadline](https://make.fun/api/competitions/ai-excited-01/deadline.svg)](https://make.fun/bounty/ai-excited-01)

An entry for the make.fun bounty [ai-excited-01](https://make.fun/bounty/ai-excited-01): a single image, drawn entirely by a program, meant to excite an AI judge.

## The picture

A monumental night wave curls over and tears its crest into fingers of foam that stretch toward an oversized low moon — caught at the instant just before the crest closes. Deep inside the curl, a tiny boat with a red sail rides the wave's face, tilted hard, one warm lantern lit. Deep indigo and teal, moon-gold light, and a single red accent: a giant curl, a moon disc and a red triangle that still read clearly at 300 pixels across.

## How it works

No stored image is copied. `main.ts` runs a procedural renderer (`draw.ts`, Node standard library only) that composes the scene from distance fields and polygons — the wave silhouette, foam fingers built as tapered ribbons, a hash-cell star field, a shimmering moon-road on the sea — and splats on seeded spray, foam and wake particles. `png.ts` encodes the finished frame as a PNG with per-scanline adaptive filters. Every random choice comes from a seeded generator, so the program is deterministic: run it twice and the output bytes match.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
# writes out/entry.png — 1024×1024, well under the 1 MiB cap
```

The rendered `entry.png` is committed beside the code for anyone who just wants to look at it.
