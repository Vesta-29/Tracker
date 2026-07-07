import rawBarangays from "@jobuntux/psgc/data/2025-2Q/barangays.json";
import rawMuncities from "@jobuntux/psgc/data/2025-2Q/muncities.json";
import rawProvinces from "@jobuntux/psgc/data/2025-2Q/provinces.json";
import rawRegions from "@jobuntux/psgc/data/2025-2Q/regions.json";
import { islandGroups } from "@/lib/location-groups";
import type { IslandGroup } from "@/lib/types";

export { islandGroups };

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
const norm = (value?: string) => value?.trim().toLocaleLowerCase("en-PH").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ") ?? "";
const locationName = (value?: string) => norm(value?.replace(/\([^)]*\)/g, " ")).replace(/^(?:city|municipality) of /, "").replace(/ (?:city|municipality)$/, "").replace(/^(?:barangay|brgy) /, "").trim();
function editDistance(a: string, b: string) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = a[i - 1] === b[j - 1] ? diagonal : Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + 1);
      diagonal = above;
    }
  }
  return previous[b.length];
}
function closeLocationName(expected: string, actual: string) {
  return expected.length >= 8 && actual.length >= 8 && Math.abs(expected.length - actual.length) <= 1 && editDistance(expected, actual) <= 1;
}
const matchesName = (expected: string, actual?: string) => {
  if (!actual) return true;
  const expectedName = locationName(expected);
  const actualName = locationName(actual);
  return expectedName === actualName || closeLocationName(expectedName, actualName);
};
const regionAliases: Record<string, string[]> = {
  "01": ["i", "1", "region i", "region 1", "ilocos region"],
  "02": ["ii", "2", "region ii", "region 2", "cagayan valley"],
  "03": ["iii", "3", "region iii", "region 3", "central luzon"],
  "04": ["iv a", "iva", "4a", "4 a", "region iv a", "region 4a", "region 4 a", "calabarzon"],
  "05": ["v", "5", "region v", "region 5", "bicol region"],
  "06": ["vi", "6", "region vi", "region 6", "western visayas"],
  "07": ["vii", "7", "region vii", "region 7", "central visayas"],
  "08": ["viii", "8", "region viii", "region 8", "eastern visayas"],
  "09": ["ix", "9", "region ix", "region 9", "zamboanga peninsula"],
  "10": ["x", "10", "region x", "region 10", "northern mindanao"],
  "11": ["xi", "11", "region xi", "region 11", "davao region"],
  "12": ["xii", "12", "region xii", "region 12", "soccsksargen"],
  "13": ["ncr", "national capital region", "metro manila"],
  "14": ["car", "cordillera administrative region", "cordillera"],
  "16": ["xiii", "13", "region xiii", "region 13", "caraga", "caraga region"],
  "17": ["iv b", "ivb", "4b", "4 b", "region iv b", "region 4b", "region 4 b", "mimaropa", "mimaropa region"],
  "18": ["nir", "negros island region"],
  "19": ["barmm", "bangsamoro autonomous region in muslim mindanao", "bangsamoro"],
};
function matchesRegion(region: Region, actual?: string) {
  if (!actual) return true;
  const actualName = norm(actual);
  const official = norm(region.regionName);
  const beforeParenthesis = norm(region.regionName.replace(/\s*\([^)]*\)\s*$/, ""));
  const insideParenthesis = norm(region.regionName.match(/\(([^)]*)\)/)?.[1]);
  return [official, beforeParenthesis, insideParenthesis, ...(regionAliases[region.regCode] ?? []).map(norm)].filter(Boolean).includes(actualName);
}

export function listRegions(islandGroup?: string) { return islandGroup ? regions.filter((row) => row.islandGroup === islandGroup) : [...regions]; }
export function listProvinces(regionCode?: string) { const region = regionCode ? regionByCode.get(regionCode) : undefined; return region ? provinces.filter((row) => row.regCode === region.regCode) : regionCode ? [] : [...provinces]; }
export function listMuncities(provinceCode?: string) { const province = provinceCode ? provinceByCode.get(provinceCode) : undefined; return province ? muncities.filter((row) => row.provCode === province.provCode) : provinceCode ? [] : [...muncities]; }
export function listBarangays(municipalityCode?: string) { const municipality = municipalityCode ? muncityByCode.get(municipalityCode) : undefined; return municipality ? barangays.filter((row) => row.munCityCode === municipality.munCityCode) : municipalityCode ? [] : [...barangays]; }
export function getIslandGroup(regionCode: string) { return regionByCode.get(regionCode)?.islandGroup; }

function selection(region: Region, province: Province, municipality: Muncity, barangay?: Barangay): LocationSelection {
  return { islandGroup: region.islandGroup, region: region.regionName, regionCode: region.psgcCode, province: province.provName, provinceCode: province.psgcCode, municipality: municipality.munCityName, municipalityCode: municipality.psgcCode, barangay: barangay?.brgyName ?? "", barangayCode: barangay?.psgcCode ?? "" };
}

export function resolveLocation(input: LocationInput): LocationResolution {
  const hasCodes = Boolean(input.regionCode || input.provinceCode || input.municipalityCode || input.barangayCode);
  if (hasCodes) {
    if (!input.regionCode || !input.provinceCode || !input.municipalityCode) return { issue: "Complete Region, Province, and Locality code columns" };
    const region = regionByCode.get(input.regionCode); const province = provinceByCode.get(input.provinceCode); const municipality = muncityByCode.get(input.municipalityCode); const barangay = input.barangayCode ? barangayByCode.get(input.barangayCode) : undefined;
    if (!region || !province || !municipality || (input.barangayCode && !barangay)) return { issue: "Invalid PSGC location code" };
    if (!listProvinces(region.psgcCode).some((row) => row.psgcCode === province.psgcCode) || !listMuncities(province.psgcCode).some((row) => row.psgcCode === municipality.psgcCode) || (barangay && !listBarangays(municipality.psgcCode).some((row) => row.psgcCode === barangay.psgcCode))) return { issue: "PSGC location codes do not form a valid path" };
    return { location: selection(region, province, municipality, barangay) };
  }
  if (!input.region || !input.province || !input.municipality) return { issue: "Complete Region, Province, and Locality" };
  const matchingRegions = regions.filter((region) => matchesRegion(region, input.region));
  if (!matchingRegions.length) return { issue: `Region not recognized: ${input.region}` };
  const matchingProvinces = matchingRegions.flatMap((region) => listProvinces(region.psgcCode).filter((province) => matchesName(province.provName, input.province)).map((province) => ({ region, province })));
  if (!matchingProvinces.length) return { issue: `Province not recognized under ${input.region}: ${input.province}` };
  const matchingMunicipalities = matchingProvinces.flatMap(({ region, province }) => listMuncities(province.psgcCode).filter((municipality) => matchesName(municipality.munCityName, input.municipality)).map((municipality) => ({ region, province, municipality })));
  if (!matchingMunicipalities.length) return { issue: `Municipality not recognized under ${input.province}: ${input.municipality}` };
  const candidates = matchingMunicipalities.flatMap(({ region, province, municipality }) => input.barangay
    ? listBarangays(municipality.psgcCode).filter((barangay) => matchesName(barangay.brgyName, input.barangay)).map((barangay) => selection(region, province, municipality, barangay))
    : [selection(region, province, municipality)]);
  if (!candidates.length) return { issue: `Barangay not recognized under ${input.municipality}: ${input.barangay}` };
  return candidates.length === 1 ? { location: candidates[0] } : { issue: "Ambiguous name-only location path; add PSGC codes" };
}

export function resolveAddressLocation(address: string): LocationResolution {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return { issue: "Address needs at least a municipality and province" };
  const provinceName = parts.at(-1);
  const municipalityName = parts.at(-2);
  const barangayName = parts.length >= 3 ? parts.at(-3) : undefined;
  const matchingProvinces = provinces.filter((province) => matchesName(province.provName, provinceName));
  const matchingMunicipalities = matchingProvinces.flatMap((province) => {
    const region = regions.find((candidate) => candidate.regCode === province.regCode);
    if (!region) return [];
    return listMuncities(province.psgcCode)
      .filter((municipality) => matchesName(municipality.munCityName, municipalityName))
      .map((municipality) => ({ region, province, municipality }));
  });
  const candidates = matchingMunicipalities.flatMap(({ region, province, municipality }) => {
    if (!barangayName) return [selection(region, province, municipality)];
    const matches = listBarangays(municipality.psgcCode).filter((barangay) => matchesName(barangay.brgyName, barangayName));
    return matches.length ? matches.map((barangay) => selection(region, province, municipality, barangay)) : [selection(region, province, municipality)];
  });
  if (!candidates.length) return { issue: `Address could not be matched to PSGC data: ${address}` };
  return candidates.length === 1 ? { location: candidates[0] } : { issue: `Address matches more than one PSGC location: ${address}` };
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
