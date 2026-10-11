import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { READINESS_CHECKS } from "../lib/readiness";
import { targetIds } from "../lib/targets";
import { describeCli, FILE_SCHEMAS, SchemaReader, type CliCommand } from "../scripts/docs-reference-lib";

/**
 * The docs site's reference is generated from the code; these keep the code
 * documented and the hand-written pages complete, so neither drifts.
 */
const docs = path.resolve(import.meta.dirname, "..", "site", "content", "docs");
const pageText = (rel: string) => fs.readFileSync(path.join(docs, rel), "utf8");

describe("docs reference", () => {
  it("every key of the app's files has a doc comment", () => {
    const missing = FILE_SCHEMAS.flatMap(([file, schema]) =>
      SchemaReader.load(file)
        .rows(schema)
        .filter((r) => !r.doc)
        .map((r) => `${schema}: ${r.key}`),
    );
    expect(missing).toEqual([]);
  });

  it("every command says what it does", () => {
    const missing: string[] = [];
    const walk = (cmd: CliCommand, prefix: string) => {
      for (const sub of cmd.commands) {
        const name = `${prefix} ${sub.name}`;
        if (!sub.description.trim()) missing.push(name);
        for (const o of sub.options) if (!o.description.trim()) missing.push(`${name} ${o.flags}`);
        walk(sub, name);
      }
    };
    walk(describeCli(), "store-shots");
    expect(missing).toEqual([]);
  }, 30_000);

  it("the Devices page names every device", () => {
    const page = pageText("devices/index.mdx");
    expect(targetIds.filter((id) => !page.includes(`\`${id}\``))).toEqual([]);
  });

  it("the Ship page explains every readiness check", () => {
    const page = pageText("ship/index.mdx");
    expect(READINESS_CHECKS.filter((c) => !page.includes(c.title)).map((c) => c.title)).toEqual([]);
  });
});
