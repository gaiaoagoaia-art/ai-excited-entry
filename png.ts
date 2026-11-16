// Minimal PNG writer built on node:zlib alone.
//
// The renderer hands us a finished RGB frame as floats; this module turns it
// into a standards-clean PNG: one IHDR, one IDAT (deflate of filtered
// scanlines), one IEND, every chunk carrying its CRC-32. For each scanline we
// try all five PNG filters and keep the one whose bytes sum smallest in
// absolute signed value, the usual heuristic, which keeps smooth gradients
// and flat graphic shapes compact.

import { deflateSync } from 'node:zlib';

// CRC-32 (PNG polynomial) lookup table, built once.
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

// Signed-byte cost of a filtered row: the cheaper this is, the better the
// deflate stream usually gets.
function rowCost(row: Buffer): number {
  let cost = 0;
  for (let i = 0; i < row.length; i++) {
    const b = row[i];
    cost += b < 128 ? b : 256 - b;
  }
  return cost;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Encode an RGB frame (floats 0..1, row-major, 3 per pixel) as a PNG Buffer.
 */
export function encodePNG(width: number, height: number, rgb: Float32Array): Buffer {
  // Quantise to bytes first so filters work on the exact stored values.
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height * 3; i++) {
    const v = rgb[i];
    raw[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
  }

  const stride = width * 3;
  const filtered = Buffer.alloc((stride + 1) * height);
  const candidate = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const rowOff = y * stride;
    const upOff = rowOff - stride;
    let bestType = 0;
    let bestCost = Infinity;
    let bestRow: Buffer | null = null;
    for (let type = 0; type <= 4; type++) {
      for (let i = 0; i < stride; i++) {
        const x = raw[rowOff + i];
        const left = i >= 3 ? raw[rowOff + i - 3] : 0;
        const up = y > 0 ? raw[upOff + i] : 0;
        const upLeft = y > 0 && i >= 3 ? raw[upOff + i - 3] : 0;
        let predictor = 0;
        if (type === 1) predictor = left;
        else if (type === 2) predictor = up;
        else if (type === 3) predictor = (left + up) >> 1;
        else if (type === 4) predictor = paeth(left, up, upLeft);
        candidate[i] = (x - predictor) & 0xff;
      }
      const cost = rowCost(candidate);
      if (cost < bestCost) {
        bestCost = cost;
        bestType = type;
        bestRow = Buffer.from(candidate);
      }
    }
    const outOff = y * (stride + 1);
    filtered[outOff] = bestType;
    (bestRow as Buffer).copy(filtered, outOff + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  // bytes 10..12 stay 0: deflate, adaptive filters, no interlace.

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(filtered, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
