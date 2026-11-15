import path from "node:path";
import { fileURLToPath } from "node:url";
import { qualitykitGrow } from "../dist/tools/qualitykit-grow.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  process.argv[2] ?? "website",
);
const siteUrl = process.argv[3] ?? "https://qualitykit.dev";

const result = await qualitykitGrow({ projectRoot: root, siteUrl });
console.log(result.content[0].text);
