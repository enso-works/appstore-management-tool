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
