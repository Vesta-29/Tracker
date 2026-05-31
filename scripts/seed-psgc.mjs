import { createClient } from "@supabase/supabase-js";
import { barangays, muncities, provinces, regions } from "./psgc-data.mjs";

const dryRun = process.argv.includes("--dry-run");
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!dryRun && (!url || !key)) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running npm run seed:psgc.");

const regionCodeByShortCode = new Map(regions.map((row) => [row.regCode, row.psgcCode]));
const provinceCodeByShortCode = new Map(provinces.map((row) => [row.provCode, row.psgcCode]));
const municipalityCodeByShortCode = new Map(muncities.map((row) => [row.munCityCode, row.psgcCode]));
const rows = [
  ...regions.map((row) => ({ psgc_code: row.psgcCode, level: "region", name: row.regionName, parent_code: null, active: true })),
  ...provinces.map((row) => ({ psgc_code: row.psgcCode, level: "province", name: row.provName, parent_code: regionCodeByShortCode.get(row.regCode), active: true })),
  ...muncities.map((row) => ({ psgc_code: row.psgcCode, level: "municipality", name: row.munCityName, parent_code: provinceCodeByShortCode.get(row.provCode) ?? regionCodeByShortCode.get(row.regCode), active: true })),
  ...barangays.map((row) => ({ psgc_code: row.psgcCode, level: "barangay", name: row.brgyName, parent_code: municipalityCodeByShortCode.get(row.munCityCode), active: true })),
];

if (rows.some((row) => !row.psgc_code || (row.level !== "region" && !row.parent_code))) throw new Error("PSGC seed contains a row without its required code or parent.");
if (new Set(rows.map((row) => row.psgc_code)).size !== rows.length) throw new Error("PSGC seed contains duplicate canonical codes.");

if (dryRun) {
  console.log(`Validated ${rows.length} PSGC rows: ${regions.length} regions, ${provinces.length} provinces, ${muncities.length} localities, ${barangays.length} barangays.`);
  process.exit(0);
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
for (let start = 0; start < rows.length; start += 500) {
  const batch = rows.slice(start, start + 500);
  const { error } = await supabase.from("locations").upsert(batch, { onConflict: "psgc_code" });
  if (error) throw error;
  console.log(`Upserted ${Math.min(start + batch.length, rows.length)} of ${rows.length} locations.`);
}
console.log("PSGC seed complete.");
