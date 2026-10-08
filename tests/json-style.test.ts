import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as prettier from "prettier";
import { describe, expect, it } from "vitest";
import { appJsonStyle, formatJson, type JsonStyle } from "../lib/json-style";
import { FIXTURE_ROOT } from "./helpers";

const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, rel), "utf8"));

const samples: Record<string, unknown> = {
  config: read("store-shots.config.json"),
  manifest: read("store/manifest.json"),
  content: read("store/content/en-US.json"),
  layers: {
    screens: [
      {
        id: "rally",
        targets: ["iphone-6.9-2868x1320", "iphone-6.1-2622x1206"],
        layers: [
          {
            type: "image",
            id: "forehand-iphone",
            asset: "characters/forehand.png",
            x: 0.1879,
            y: 0.2511,
            width: 0.3355,
            targets: ["iphone-6.9-2868x1320", "iphone-6.1-2622x1206"],
          },
        ],
        overrides: {
          shell: { iphone: "frame:Apple iPhone 16 Pro Max Black Titanium", ipad: "dark" },
          screenshotScale: 0.6,
        },
      },
    ],
    weights: [400, 600, 700],
    long: Array.from({ length: 40 }, (_, i) => i * 37),
    names: Array.from({ length: 12 }, (_, i) => `a-fairly-long-locale-name-${i}`),
    nested: [
      [1, 2],
      [3, 4],
    ],
    empty: { list: [], object: {} },
    nothing: null,
  },
};

const styles: [string, JsonStyle, prettier.Options][] = [
  ["printWidth 100", { printWidth: 100, indent: "  " }, { printWidth: 100 }],
  ["printWidth 80", { printWidth: 80, indent: "  " }, { printWidth: 80 }],
  ["tabs", { printWidth: 80, indent: "\t" }, { printWidth: 80, useTabs: true }],
  ["four spaces", { printWidth: 120, indent: "    " }, { printWidth: 120, tabWidth: 4 }],
];

describe("JSON in the app's Prettier style", () => {
  for (const [label, style, options] of styles) {
    for (const [name, value] of Object.entries(samples)) {
      it(`matches Prettier for ${name} (${label})`, async () => {
        const expected = await prettier.format(JSON.stringify(value, null, 2), { parser: "json", ...options });
        expect(formatJson(value, style)).toBe(expected);
      });
    }
  }

  it("reads the style from the app, and keeps JSON.stringify for apps without Prettier", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "store-shots-style-"));
    try {
      expect(appJsonStyle(dir)).toBeUndefined();
      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ devDependencies: { prettier: "^3" } }));
      expect(appJsonStyle(dir)).toEqual({ printWidth: 80, indent: "  " });
      fs.writeFileSync(path.join(dir, ".prettierrc"), JSON.stringify({ printWidth: 100, singleQuote: true }));
      expect(appJsonStyle(dir)).toEqual({ printWidth: 100, indent: "  " });
      expect(formatJson({ a: [1, 2] })).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
