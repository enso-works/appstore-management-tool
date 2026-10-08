import fs from "node:fs";
import { isPngFile, readPngInfo } from "./png";

export interface ImageInfo {
  format: "png" | "jpeg";
  width: number;
  height: number;
  /** JPEG has no alpha channel, so this is only ever true for PNG. */
  hasAlpha: boolean;
}

/**
 * Dimensions and alpha of a PNG or JPEG from its header, without decoding
 * pixels. App Store Connect takes both formats for screenshots. Throws on
 * anything else or on a truncated header.
 */
export function readImageInfo(file: string): ImageInfo {
  if (isPngFile(file)) {
    const { width, height, hasAlpha } = readPngInfo(file);
    return { format: "png", width, height, hasAlpha };
  }
  if (isJpegFile(file)) {
    const { width, height } = readJpegSize(file);
    return { format: "jpeg", width, height, hasAlpha: false };
  }
  throw new Error(`${file} is not a PNG or JPEG`);
}

export function isJpegFile(file: string): boolean {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const sig = Buffer.alloc(3);
      return fs.readSync(fd, sig, 0, 3, 0) === 3 && sig[0] === 0xff && sig[1] === 0xd8 && sig[2] === 0xff;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

/** Walk the JPEG segments up to the first start-of-frame marker, which carries the size. */
function readJpegSize(file: string): { width: number; height: number } {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(9);
    let offset = 2;
    // EXIF and ICC segments can be large, but the frame header comes within a few hundred segments.
    for (let i = 0; i < 512; i++) {
      if (fs.readSync(fd, head, 0, 4, offset) < 4 || head[0] !== 0xff) break;
      const marker = head[1];
      // Fill bytes before a marker.
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      // Standalone markers carry no length.
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = head.readUInt16BE(2);
      // SOF0-SOF15 except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (fs.readSync(fd, head, 0, 9, offset) < 9) break;
        return { height: head.readUInt16BE(5), width: head.readUInt16BE(7) };
      }
      if (marker === 0xda || marker === 0xd9) break; // scan data or end before any frame header
      offset += 2 + length;
    }
    throw new Error(`${file}: no JPEG frame header`);
  } finally {
    fs.closeSync(fd);
  }
}
