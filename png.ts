// png.ts — a minimal, dependency-free PNG encoder built on node:zlib.
//
// It takes a raw RGB pixel buffer (3 bytes per pixel, row-major, top row
// first) and produces a complete PNG file: signature, IHDR, one IDAT with
// the deflated scanlines, and IEND. Each scanline is prefixed with a filter
// byte; the filter is chosen per row among None / Sub / Up by whichever
// gives the smallest sum of absolute signed byte values, a cheap heuristic
// that tracks the real compressed size well on poster-style artwork.

import { deflateSync } from "node:zlib";

// ---- CRC32 (the PNG chunk checksum) --------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---- chunk framing --------------------------------------------------------

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)], 0);
  crcInput.set(data, 4);
  out.writeUInt32BE(crc32(crcInput), 8 + data.length);
  return out;
}

// ---- scanline filtering ---------------------------------------------------

const BPP = 3; // bytes per pixel for 8-bit RGB

function filterScore(filtered: Uint8Array): number {
  let score = 0;
  for (let i = 0; i < filtered.length; i++) {
    const b = filtered[i];
    score += b < 128 ? b : 256 - b;
  }
  return score;
}

function applyFilter(kind: number, row: Uint8Array, prev: Uint8Array | null): Uint8Array {
  const out = new Uint8Array(row.length);
  for (let i = 0; i < row.length; i++) {
    const left = i >= BPP ? row[i - BPP] : 0;
    const up = prev ? prev[i] : 0;
    const upLeft = prev && i >= BPP ? prev[i - BPP] : 0;
    let predictor = 0;
    if (kind === 1) predictor = left;
    else if (kind === 2) predictor = up;
    else if (kind === 3) predictor = (left + up) >> 1;
    else if (kind === 4) {
      const p = left + up - upLeft;
      const pa = Math.abs(p - left);
      const pb = Math.abs(p - up);
      const pc = Math.abs(p - upLeft);
      predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
    }
    out[i] = (row[i] - predictor) & 0xff;
  }
  return out;
}

function filterScanlines(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const rowBytes = width * BPP;
  const out = new Uint8Array(height * (rowBytes + 1));
  let prev: Uint8Array | null = null;
  for (let y = 0; y < height; y++) {
    const row = rgb.subarray(y * rowBytes, (y + 1) * rowBytes);
    let bestKind = 0;
    let bestData = applyFilter(0, row, prev);
    let bestScore = filterScore(bestData);
    for (const kind of [1, 2, 4]) {
      const data = applyFilter(kind, row, prev);
      const score = filterScore(data);
      if (score < bestScore) {
        bestKind = kind;
        bestData = data;
        bestScore = score;
      }
    }
    const offset = y * (rowBytes + 1);
    out[offset] = bestKind;
    out.set(bestData, offset + 1);
    prev = row;
  }
  return out;
}

// ---- public entry ---------------------------------------------------------

export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2: truecolour RGB
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // no interlace

  const filtered = filterScanlines(width, height, rgb);
  const idat = deflateSync(filtered, { level: 9 });

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(idat)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
