import fs from "node:fs";

/**
 * The few facts App Store Connect checks on an app preview, read from the
 * MP4/QuickTime box structure (.mp4, .m4v, .mov) without decoding anything:
 * the movie's duration, and the video track's size and frame rate. Only the
 * `moov` box is read, so a 500 MB file costs a few kilobytes.
 */

export interface VideoInfo {
  durationSeconds: number;
  width: number;
  height: number;
  /** Average frame rate of the video track (samples / track duration). */
  fps: number;
  /** Highest frame rate held for half a second or more: a variable-rate screen recording can average 25 and peak at 60. */
  maxFps: number;
  bytes: number;
}

export class VideoError extends Error {}

interface Box {
  type: string;
  /** Payload start and end, absolute in the buffer it was found in. */
  start: number;
  end: number;
}

function* boxes(buf: Buffer, start: number, end: number): Generator<Box> {
  let at = start;
  while (at + 8 <= end) {
    let size = buf.readUInt32BE(at);
    const type = buf.toString("latin1", at + 4, at + 8);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(at + 8));
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) throw new VideoError(`malformed "${type}" box`);
    yield { type, start: at + header, end: at + size };
    at += size;
  }
}

function child(buf: Buffer, box: Box, type: string): Box | undefined {
  for (const b of boxes(buf, box.start, box.end)) if (b.type === type) return b;
  return undefined;
}

function children(buf: Buffer, box: Box, type: string): Box[] {
  return [...boxes(buf, box.start, box.end)].filter((b) => b.type === type);
}

/** The top-level `moov` box, found by walking the file's box headers. */
function readMoov(fd: number, fileSize: number): Buffer {
  const head = Buffer.alloc(16);
  let at = 0;
  while (at + 8 <= fileSize) {
    fs.readSync(fd, head, 0, 16, at);
    let size = head.readUInt32BE(0);
    const type = head.toString("latin1", 4, 8);
    if (size === 1) size = Number(head.readBigUInt64BE(8));
    else if (size === 0) size = fileSize - at;
    if (size < 8) throw new VideoError(`malformed "${type}" box`);
    if (type === "moov") {
      if (size > 64 * 1024 * 1024) throw new VideoError("moov box is implausibly large");
      const moov = Buffer.alloc(size);
      fs.readSync(fd, moov, 0, size, at);
      return moov;
    }
    at += size;
  }
  throw new VideoError("no moov box: not an MP4 or QuickTime movie");
}

/** timescale and duration from an mvhd or mdhd payload (version 0 or 1). */
function timing(buf: Buffer, box: Box): { timescale: number; duration: number } {
  const version = buf.readUInt8(box.start);
  return version === 1
    ? { timescale: buf.readUInt32BE(box.start + 20), duration: Number(buf.readBigUInt64BE(box.start + 24)) }
    : { timescale: buf.readUInt32BE(box.start + 12), duration: buf.readUInt32BE(box.start + 16) };
}

export function readVideoInfo(file: string): VideoInfo {
  const bytes = fs.statSync(file).size;
  const fd = fs.openSync(file, "r");
  let moov: Buffer;
  try {
    moov = readMoov(fd, bytes);
  } finally {
    fs.closeSync(fd);
  }
  const root: Box = { type: "moov", start: 8, end: moov.length };
  if (moov.readUInt32BE(0) === 1) root.start = 16;
  const mvhd = child(moov, root, "mvhd");
  if (!mvhd) throw new VideoError("no movie header (mvhd)");
  const movie = timing(moov, mvhd);
  for (const trak of children(moov, root, "trak")) {
    const mdia = child(moov, trak, "mdia");
    const hdlr = mdia && child(moov, mdia, "hdlr");
    if (!mdia || !hdlr || moov.toString("latin1", hdlr.start + 8, hdlr.start + 12) !== "vide") continue;
    const tkhd = child(moov, trak, "tkhd");
    const mdhd = child(moov, mdia, "mdhd");
    const minf = child(moov, mdia, "minf");
    const stbl = minf && child(moov, minf, "stbl");
    const stts = stbl && child(moov, stbl, "stts");
    if (!tkhd || !mdhd || !stts) throw new VideoError("video track without tkhd, mdhd or stts");
    // tkhd ends with width and height as 16.16 fixed point.
    const width = Math.round(moov.readUInt32BE(tkhd.end - 8) / 65536);
    const height = Math.round(moov.readUInt32BE(tkhd.end - 4) / 65536);
    const track = timing(moov, mdhd);
    const entries = moov.readUInt32BE(stts.start + 4);
    // Frame times from the sample table, then the busiest half second: jittery variable-rate
    // recordings split one 60 fps stretch into many short runs, a single short gap is no rate.
    const times: number[] = [];
    let t = 0;
    for (let i = 0; i < entries; i++) {
      const count = moov.readUInt32BE(stts.start + 8 + i * 8);
      const delta = moov.readUInt32BE(stts.start + 12 + i * 8);
      for (let k = 0; k < count && times.length < 200_000; k++) {
        times.push(t);
        t += delta;
      }
    }
    const samples = times.length;
    const window = track.timescale / 2;
    let maxFps = 0;
    for (let lo = 0, hi = 0; hi < times.length; hi++) {
      while (times[hi] - times[lo] >= window) lo++;
      if (times[hi] - times[0] >= window) maxFps = Math.max(maxFps, (hi - lo + 1) / 0.5);
    }
    const trackSeconds = track.duration / track.timescale;
    const average = trackSeconds > 0 ? samples / trackSeconds : 0;
    return {
      durationSeconds: movie.duration / movie.timescale,
      width,
      height,
      fps: average,
      maxFps: Math.max(maxFps, average),
      bytes,
    };
  }
  throw new VideoError("no video track");
}
