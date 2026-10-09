import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const FIXTURE_ROOT = path.resolve(import.meta.dirname, "..", "fixtures", "demo-app");

/** Copy the fixture project into a temp dir so tests can break it freely. */
export function tempFixture(): { root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "store-shots-fixture-"));
  fs.cpSync(FIXTURE_ROOT, root, { recursive: true });
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

export function readJson<T = unknown>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyJson = any;

export function editJson(file: string, mutate: (v: AnyJson) => void): void {
  const v = readJson<AnyJson>(file);
  mutate(v);
  writeJson(file, v);
}

/** A minimal MP4: ftyp, then a moov with one video track of `frames` samples. */
export function mp4(opts: {
  width: number;
  height: number;
  seconds: number;
  fps: number;
  /** Variable frame rate: [frames, fps] runs instead of one constant rate. */
  runs?: [number, number][];
}): Buffer {
  const box = (type: string, ...parts: Buffer[]) => {
    const body = Buffer.concat(parts);
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + body.length, 0);
    head.write(type, 4, "latin1");
    return Buffer.concat([head, body]);
  };
  const u32 = (...values: number[]) => {
    const b = Buffer.alloc(4 * values.length);
    values.forEach((v, i) => b.writeUInt32BE(v, i * 4));
    return b;
  };
  const scale = 600;
  const runs = opts.runs ?? [[Math.round(opts.seconds * opts.fps), opts.fps]];
  // version/flags, creation, modification, timescale, duration, then fields the reader skips
  const mvhd = box("mvhd", u32(0, 0, 0, scale, Math.round(opts.seconds * scale)), Buffer.alloc(80));
  const tkhd = box("tkhd", Buffer.alloc(76), u32(opts.width * 65536, opts.height * 65536));
  const mdhd = box("mdhd", u32(0, 0, 0, scale, Math.round(opts.seconds * scale), 0));
  const hdlr = box("hdlr", u32(0, 0), Buffer.from("vide"), Buffer.alloc(13));
  const stts = box("stts", u32(0, runs.length, ...runs.flatMap(([n, fps]) => [n, Math.round(scale / fps)])));
  const trak = box("trak", tkhd, box("mdia", mdhd, hdlr, box("minf", box("stbl", stts))));
  return Buffer.concat([
    box("ftyp", Buffer.from("isom"), u32(0)),
    box("mdat", Buffer.alloc(32)),
    box("moov", mvhd, trak),
  ]);
}
