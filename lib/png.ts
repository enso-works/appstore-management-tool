import fs from "node:fs";

export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  /** True when the color type carries an alpha channel (4 or 6) or a tRNS chunk exists. */
  hasAlpha: boolean;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Read PNG dimensions and alpha presence from the header without decoding
 * pixels. Sharp (Phase 2) does the heavy lifting for generated output; this
 * is enough for readiness checks on existing files and for tests.
 */
export function readPngInfo(file: string): PngInfo {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(33);
    const n = fs.readSync(fd, head, 0, 33, 0);
    if (n < 33 || !head.subarray(0, 8).equals(SIGNATURE)) {
      throw new Error(`${file} is not a PNG`);
    }
    if (head.toString("ascii", 12, 16) !== "IHDR") throw new Error(`${file}: missing IHDR`);
    const width = head.readUInt32BE(16);
    const height = head.readUInt32BE(20);
    const bitDepth = head.readUInt8(24);
    const colorType = head.readUInt8(25);
    let hasAlpha = colorType === 4 || colorType === 6;
    if (!hasAlpha) hasAlpha = hasTrnsChunk(fd);
    return { width, height, bitDepth, colorType, hasAlpha };
  } finally {
    fs.closeSync(fd);
  }
}

/** Scan chunk headers until IDAT looking for tRNS (palette/grey transparency). */
function hasTrnsChunk(fd: number): boolean {
  let offset = 8;
  const hdr = Buffer.alloc(8);
  for (let i = 0; i < 64; i++) {
    const n = fs.readSync(fd, hdr, 0, 8, offset);
    if (n < 8) return false;
    const length = hdr.readUInt32BE(0);
    const type = hdr.toString("ascii", 4, 8);
    if (type === "tRNS") return true;
    if (type === "IDAT" || type === "IEND") return false;
    offset += 8 + length + 4;
  }
  return false;
}

export function isPngFile(file: string): boolean {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const sig = Buffer.alloc(8);
      return fs.readSync(fd, sig, 0, 8, 0) === 8 && sig.equals(SIGNATURE);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

/**
 * Decode the first `maxRows` rows of an 8-bit RGBA (color type 6) PNG
 * synchronously. Returns row-major RGBA bytes, or undefined for any other
 * layout (interlaced, palette, 16-bit) — callers treat that as "no data".
 * Only used to inspect device-frame artwork; sharp handles real image work.
 */
export function decodeRgbaRows(file: string, maxRows: number): { width: number; rows: Buffer } | undefined {
  const buf = fs.readFileSync(file);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) return undefined;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf.readUInt8(24);
  const colorType = buf.readUInt8(25);
  const interlace = buf.readUInt8(28);
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) return undefined;
  const idat: Buffer[] = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    if (type === "IDAT") idat.push(buf.subarray(off + 8, off + 8 + len));
    if (type === "IEND") break;
    off += 12 + len;
  }
  if (!idat.length) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const zlib = require("node:zlib") as typeof import("node:zlib");
  let raw: Buffer;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    return undefined;
  }
  const bpp = 4;
  const stride = width * bpp;
  const rows = Math.min(maxRows, height);
  if (raw.length < rows * (stride + 1)) return undefined;
  const out = Buffer.alloc(rows * stride);
  const prior = Buffer.alloc(stride);
  for (let y = 0; y < rows; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prior[x];
      const c = x >= bpp ? prior[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) return undefined;
      cur[x] = v & 0xff;
    }
    cur.copy(prior);
  }
  return { width, rows: out };
}
