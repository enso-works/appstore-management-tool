import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/**
 * Minimal PNG writer for solid-colour or simple-gradient images. Used for
 * test fixtures only; real output goes through Sharp (Phase 2).
 */
export interface SolidPngOptions {
  width: number;
  height: number;
  /** [r,g,b] or [r,g,b,a]. With alpha the file gets colour type 6 (RGBA). */
  color: [number, number, number] | [number, number, number, number];
  /** Optional second colour for a vertical gradient (makes fixtures distinguishable). */
  colorBottom?: [number, number, number];
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

export function encodeSolidPng(opts: SolidPngOptions): Buffer {
  const { width, height, color } = opts;
  const channels = color.length;
  const colorType = channels === 4 ? 6 : 2;
  const rowLen = 1 + width * channels;
  const raw = Buffer.alloc(rowLen * height);
  for (let y = 0; y < height; y++) {
    const off = y * rowLen;
    raw[off] = 0; // filter: none
    let px: number[] = [...color];
    if (opts.colorBottom) {
      const t = height <= 1 ? 0 : y / (height - 1);
      px = [
        Math.round(color[0] + (opts.colorBottom[0] - color[0]) * t),
        Math.round(color[1] + (opts.colorBottom[1] - color[1]) * t),
        Math.round(color[2] + (opts.colorBottom[2] - color[2]) * t),
        ...(channels === 4 ? [color[3] as number] : []),
      ];
    }
    for (let x = 0; x < width; x++) {
      const p = off + 1 + x * channels;
      for (let c = 0; c < channels; c++) raw[p + c] = px[c];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function writeSolidPng(file: string, opts: SolidPngOptions): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodeSolidPng(opts));
}
