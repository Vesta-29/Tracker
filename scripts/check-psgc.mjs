import { barangays, muncities, provinces, regions } from "./psgc-data.mjs";

const islandGroups = {
  "01": "Luzon", "02": "Luzon", "03": "Luzon", "04": "Luzon", "05": "Luzon", "13": "Luzon", "14": "Luzon", "17": "Luzon",
  "06": "Visayas", "07": "Visayas", "08": "Visayas", "18": "Visayas",
  "09": "Mindanao", "10": "Mindanao", "11": "Mindanao", "12": "Mindanao", "16": "Mindanao", "19": "Mindanao",
};
const paths = [
  ["0700000000", "0730600000", "30600", "0730600041"],
  ["0300000000", "0301400000", "0301420000", "0301420007"],
  ["0500000000", "0500500000", "0500506000", "0500506064"],
  ["0400000000", "0403400000", "0403405000", "0403405011"],
  ["0300000000", "0330100000", "30100", "0330100003"],
  ["0400000000", "0401000000", "0401014000", "0401014054"],
];
const find = (rows, code) => rows.find((row) => row.psgcCode === code);
const norm = (value) => value?.trim().toLowerCase() ?? "";
function resolveNames({ region, province, locality, barangay }) {
  return regions.flatMap((regionRow) => norm(regionRow.regionName) === norm(region)
    ? provinces.filter((provinceRow) => provinceRow.regCode === regionRow.regCode && norm(provinceRow.provName) === norm(province)).flatMap((provinceRow) =>
      muncities.filter((municipalityRow) => municipalityRow.provCode === provinceRow.provCode && norm(municipalityRow.munCityName) === norm(locality)).flatMap((municipalityRow) =>
        barangays.filter((barangayRow) => barangayRow.munCityCode === municipalityRow.munCityCode && norm(barangayRow.brgyName) === norm(barangay))))
    : []);
}
for (const region of regions) if (!islandGroups[region.regCode]) throw new Error(`Unmapped region ${region.regCode}`);
for (const [regionCode, provinceCode, municipalityCode, barangayCode] of paths) {
  const region = find(regions, regionCode); const province = find(provinces, provinceCode); const municipality = find(muncities, municipalityCode); const barangay = find(barangays, barangayCode);
  if (!region || !province || !municipality || !barangay || province.regCode !== region.regCode || municipality.provCode !== province.provCode || barangay.munCityCode !== municipality.munCityCode) throw new Error(`Invalid demo path ending in ${barangayCode}`);
}
const nameOnly = resolveNames({ region: "region iv-a (calabarzon)", province: "laguna", locality: "city of calamba", barangay: "canlubang" });
const legacyLocality = resolveNames({ region: "Region IV-A (CALABARZON)", province: "Batangas", locality: "City of Lipa", barangay: "Sabang" });
const ambiguousLegacyName = barangays.filter((row) => row.munCityCode === "01420" && norm(row.brgyOldName) === "muzon");
const invalid = resolveNames({ region: "Region IV-A (CALABARZON)", province: "Laguna", locality: "City of Calamba", barangay: "Not a barangay" });
if (nameOnly.length !== 1 || legacyLocality.length !== 1 || ambiguousLegacyName.length < 2 || invalid.length) throw new Error("Workbook location resolution regression detected.");
console.log(`Verified island-group coverage for ${regions.length} regions, ${paths.length} canonical demo paths, code and name resolution, legacy locality fallback, and rejection fixtures.`);
