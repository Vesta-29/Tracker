import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve("@jobuntux/psgc/package.json"));
const read = (name) => JSON.parse(readFileSync(join(packageRoot, "data", "2025-2Q", `${name}.json`), "utf8"));
const clean = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]));

export const regions = read("regions").map(clean);
export const provinces = read("provinces").map(clean);
export const muncities = read("muncities").map(clean);
export const barangays = read("barangays").map(clean);
