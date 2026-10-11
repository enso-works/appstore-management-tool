import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { allSchemas } from "../lib/schema";
import { SchemaReader } from "./docs-reference-lib";

const outDir = path.resolve(import.meta.dirname, "..", "schema");
fs.mkdirSync(outDir, { recursive: true });

// Each key's doc comment in lib/schema.ts becomes its "description", so an editor shows it
// on hover in an app's store-shots.config.json, manifest or content files.
const reader = SchemaReader.load("lib/schema.ts");
const documented: Partial<Record<keyof typeof allSchemas, string>> = {
  project: "projectConfigSchema",
  manifest: "manifestSchema",
  content: "localeContentSchema",
};

type Node = { properties?: Record<string, Node>; items?: Node; description?: string };
function annotate(node: Node | undefined, docs: Map<string, string>, prefix = ""): void {
  for (const [key, child] of Object.entries(node?.properties ?? {})) {
    const name = `${prefix}${key}`;
    const doc = docs.get(name);
    if (doc && !child.description) child.description = doc;
    annotate(child, docs, `${name}.`);
    if (child.items) annotate(child.items, docs, `${name}[].`);
  }
}

for (const [name, schema] of Object.entries(allSchemas)) {
  const json = z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Node;
  const source = documented[name as keyof typeof allSchemas];
  if (source)
    annotate(
      json,
      new Map(
        reader
          .rows(source)
          .filter((r) => r.doc)
          .map((r) => [r.key, r.doc]),
      ),
    );
  const file = path.join(outDir, `${name}.schema.json`);
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
