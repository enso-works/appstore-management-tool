import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { allSchemas } from "../lib/schema";

const outDir = path.resolve(import.meta.dirname, "..", "schema");
fs.mkdirSync(outDir, { recursive: true });
for (const [name, schema] of Object.entries(allSchemas)) {
  const json = z.toJSONSchema(schema, { target: "draft-7", io: "input" });
  const file = path.join(outDir, `${name}.schema.json`);
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
