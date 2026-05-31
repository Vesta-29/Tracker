import rawBarangays from "@jobuntux/psgc/data/2025-2Q/barangays.json";
import rawMuncities from "@jobuntux/psgc/data/2025-2Q/muncities.json";
import rawProvinces from "@jobuntux/psgc/data/2025-2Q/provinces.json";
import rawRegions from "@jobuntux/psgc/data/2025-2Q/regions.json";
import type { IslandGroup } from "@/lib/types";

export const islandGroups: IslandGroup[] = ["Luzon", "Visayas", "Mindanao"];

const islandGroupByRegionCode: Record<string, IslandGroup> = {
  "01": "Luzon", "02": "Luzon", "03": "Luzon", "04": "Luzon", "05": "Luzon", "13": "Luzon", "14": "Luzon", "17": "Luzon",
  "06": "Visayas", "07": "Visayas", "08": "Visayas", "18": "Visayas",
  "09": "Mindanao", "10": "Mindanao", "11": "Mindanao", "12": "Mindanao", "16": "Mindanao", "19": "Mindanao",
};

export type Region = { psgcCode: string; regCode: string; regionName: string; islandGroup: IslandGroup };
export type Province = { psgcCode: string; regCode: string; provCode: string; provName: string; cityClass: string | null };
export type Muncity = { psgcCode: string; regCode: string; provCode: string; munCityCode: string; munCityName: string };
export type Barangay = { psgcCode: string; regCode: string; provCode: string; munCityCode: string; brgyCode: string; brgyName: string };
export type LocationSelection = {
  islandGroup: IslandGroup;
  region: string;
  regionCode: string;
  province: string;
  provinceCode: string;
  municipality: string;
  municipalityCode: string;
  barangay: string;
  barangayCode: string;
};
export type LocationInput = Omit<Partial<LocationSelection>, "islandGroup"> & { islandGroup?: string };
export type LocationResolution = { location?: LocationSelection; issue?: string };

const trimValues = <T extends Record<string, unknown>>(row: T) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])) as T;
const regions: Region[] = rawRegions.map((row) => ({ ...trimValues(row), islandGroup: islandGroupByRegionCode[row.regCode] }));
const provinces: Province[] = rawProvinces.map(trimValues);
const muncities: Muncity[] = rawMuncities.map(trimValues);
const barangays: Barangay[] = rawBarangays.map(trimValues);

const unmappedRegions = regions.filter((region) => !region.islandGroup);
if (unmappedRegions.length) throw new Error(`Missing island-group mapping for PSGC regions: ${unmappedRegions.map((region) => region.regCode).join(", ")}`);

const byCode = <T extends { psgcCode: string }>(rows: T[]) => new Map(rows.map((row) => [row.psgcCode, row]));
const regionByCode = byCode(regions);
const provinceByCode = byCode(provinces);
const muncityByCode = byCode(muncities);
const barangayByCode = byCode(barangays);
const norm = (value?: string) => value?.trim().toLocaleLowerCase("en-PH") ?? "";
const matchesName = (expected: string, actual?: string) => !actual || norm(expected) === norm(actual);

export function listRegions(islandGroup?: string) { return islandGroup ? regions.filter((row) => row.islandGroup === islandGroup) : [...regions]; }
export function listProvinces(regionCode?: string) { const region = regionCode ? regionByCode.get(regionCode) : undefined; return region ? provinces.filter((row) => row.regCode === region.regCode) : regionCode ? [] : [...provinces]; }
export function listMuncities(provinceCode?: string) { const province = provinceCode ? provinceByCode.get(provinceCode) : undefined; return province ? muncities.filter((row) => row.provCode === province.provCode) : provinceCode ? [] : [...muncities]; }
export function listBarangays(municipalityCode?: string) { const municipality = municipalityCode ? muncityByCode.get(municipalityCode) : undefined; return municipality ? barangays.filter((row) => row.munCityCode === municipality.munCityCode) : municipalityCode ? [] : [...barangays]; }
export function getIslandGroup(regionCode: string) { return regionByCode.get(regionCode)?.islandGroup; }

function selection(region: Region, province: Province, municipality: Muncity, barangay: Barangay): LocationSelection {
  return { islandGroup: region.islandGroup, region: region.regionName, regionCode: region.psgcCode, province: province.provName, provinceCode: province.psgcCode, municipality: municipality.munCityName, municipalityCode: municipality.psgcCode, barangay: barangay.brgyName, barangayCode: barangay.psgcCode };
}

export function resolveLocation(input: LocationInput): LocationResolution {
  const hasCodes = Boolean(input.regionCode || input.provinceCode || input.municipalityCode || input.barangayCode);
  if (hasCodes) {
    if (!input.regionCode || !input.provinceCode || !input.municipalityCode || !input.barangayCode) return { issue: "Complete all PSGC code columns" };
    const region = regionByCode.get(input.regionCode); const province = provinceByCode.get(input.provinceCode); const municipality = muncityByCode.get(input.municipalityCode); const barangay = barangayByCode.get(input.barangayCode);
    if (!region || !province || !municipality || !barangay) return { issue: "Invalid PSGC location code" };
    if (!listProvinces(region.psgcCode).some((row) => row.psgcCode === province.psgcCode) || !listMuncities(province.psgcCode).some((row) => row.psgcCode === municipality.psgcCode) || !listBarangays(municipality.psgcCode).some((row) => row.psgcCode === barangay.psgcCode)) return { issue: "PSGC location codes do not form a valid path" };
    return { location: selection(region, province, municipality, barangay) };
  }
  if (!input.region || !input.province || !input.municipality || !input.barangay) return { issue: "Complete Region, Province, Locality, and Barangay" };
  const candidates = regions.flatMap((region) => matchesName(region.regionName, input.region) && matchesName(region.islandGroup, input.islandGroup)
    ? listProvinces(region.psgcCode).flatMap((province) => matchesName(province.provName, input.province)
      ? listMuncities(province.psgcCode).flatMap((municipality) => matchesName(municipality.munCityName, input.municipality)
        ? listBarangays(municipality.psgcCode).filter((barangay) => matchesName(barangay.brgyName, input.barangay)).map((barangay) => selection(region, province, municipality, barangay))
        : [])
      : [])
    : []);
  return candidates.length === 1 ? { location: candidates[0] } : { issue: candidates.length ? "Ambiguous name-only location path; add PSGC codes" : "Invalid name-only location path" };
}

export function requireLocation(input: LocationInput) {
  const resolved = resolveLocation(input);
  if (!resolved.location) throw new Error(resolved.issue);
  return resolved.location;
}

export function assertIslandGroupCoverage() {
  if (unmappedRegions.length) throw new Error("Every PSGC region must have an island-group mapping.");
  return true;
}
