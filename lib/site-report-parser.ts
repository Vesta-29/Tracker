export const SITE_REPORT_FIELDS = [
  "schoolId",
  "siteName",
  "address",
  "longitude",
  "latitude",
  "commboxLongitude",
  "commboxLatitude",
  "starlinkKitNumber",
  "activationDate",
  "ap1IndoorSerial",
  "ap2IndoorSerial",
  "ap3OutdoorSerial",
  "ruijieRouterSerial",
  "contractor",
  "installerTeamLead",
  "installDate",
  "beneficiaryName",
  "beneficiaryRole",
  "beneficiaryPhone",
  "remarks",
  "logInTime",
] as const;

export type SiteReportField = (typeof SITE_REPORT_FIELDS)[number];
export type SiteReportValues = Record<SiteReportField, string>;

export type SiteReportExtraction = {
  values: SiteReportValues;
  found: number;
  missing: SiteReportField[];
  diagnostics: string[];
};

const aliases: Partial<Record<SiteReportField, readonly string[]>> = {
  schoolId: ["School ID", "Site Code"],
  siteName: ["School Name", "Site Name"],
  address: ["Complete School Address", "School Address", "Complete Address", "Address"],
  starlinkKitNumber: ["Starlink KIT Number", "Starlink Kit", "KIT Number"],
  activationDate: ["Starlink Date Activated", "Date Activated", "Activation Date"],
  ap1IndoorSerial: ["AP 1 Indoor", "AP1 Indoor", "AP 1 Indoor Serial Number"],
  ap2IndoorSerial: ["AP 2 Indoor", "AP2 Indoor", "AP 2 Indoor Serial Number"],
  ap3OutdoorSerial: ["AP 3 Outdoor", "AP3 Outdoor", "AP 3 Outdoor Serial Number"],
  ruijieRouterSerial: ["Ruijie Router S/N", "Ruijie Router SN", "Ruijie Router Serial Number", "Router S/N", "Router SN", "Router Serial Number", "Router"],
  contractor: ["Company Name", "MSP"],
  installerTeamLead: ["Team Lead Name", "MSP Installer/Team Lead", "Installer Team Lead", "Team Lead"],
  installDate: ["Date Installed", "Installation Date", "Date"],
  beneficiaryName: ["Contact Person (School Head/ICT Teacher)", "Contact Person", "School Contact", "Primary Contact", "Beneficiary"],
  beneficiaryRole: ["Beneficiary Role", "Contact Person Position", "Position", "Role"],
  beneficiaryPhone: ["Active Contact Number", "Contact Number", "Mobile Number", "Phone Number"],
  remarks: ["Remarks", "Notes"],
  logInTime: ["Log-In Time", "Log In Time", "Login Time"],
};

const clean = (value: unknown) => typeof value === "string" ? value.replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim() : "";
const cleanSerial = (value: unknown) => typeof value === "string" ? value.replace(/[\t\r\n]+/g, " ").trim() : "";
const normalizeLabel = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const labelMatches = (label: string, candidates: readonly string[]) => {
  const normalized = normalizeLabel(label);
  return candidates.some((candidate) => {
    const target = normalizeLabel(candidate);
    return normalized === target || normalized.startsWith(`${target} `);
  });
};
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const inlineLabelPattern = new RegExp(
  String.raw`(^|[^\r\n])\s*(${Object.values(aliases).flatMap((group) => group ?? []).sort((a, b) => b.length - a.length).map(escapeRegex).join("|")})\s*:`,
  "gi",
);
const normalizeInlineLabels = (text: string) => text.replace(inlineLabelPattern, (_match, prefix: string, label: string) => `${prefix}${prefix ? "\n" : ""}${label}:`);

const splitLines = (text: string) => normalizeInlineLabels(text).split(/\r?\n/).map((raw, index) => {
  const colon = raw.indexOf(":");
  return { index, raw, label: colon >= 0 ? raw.slice(0, colon).trim() : "", value: colon >= 0 ? raw.slice(colon + 1).trim() : "" };
});

function labeledValue(text: string, field: SiteReportField) {
  const candidates = aliases[field] ?? [];
  const lines = splitLines(text);
  const match = lines.find((line) => line.label && labelMatches(line.label, candidates));
  if (!match) return undefined;
  if (match.value) return { value: match.value, index: match.index };
  for (const line of lines.slice(match.index + 1)) {
    const raw = line.raw.trim();
    if (!raw) continue;
    if (line.label && Object.values(aliases).some((group) => labelMatches(line.label, group ?? []))) break;
    return { value: raw, index: match.index };
  }
  return undefined;
}

function labeledValueByAliasPriority(text: string, field: SiteReportField) {
  const lines = splitLines(text);
  for (const candidate of aliases[field] ?? []) {
    const match = lines.find((line) => line.label && labelMatches(line.label, [candidate]));
    if (!match) continue;
    if (match.value) return { value: match.value, index: match.index };
    for (const line of lines.slice(match.index + 1)) {
      const raw = line.raw.trim();
      if (!raw) continue;
      if (line.label && Object.values(aliases).some((group) => labelMatches(line.label, group ?? []))) break;
      return { value: raw, index: match.index };
    }
  }
  return undefined;
}

export function parseContractorAddress(value: string, fallbackToRaw = true) {
  const labeled = labeledValue(value, "address")?.value;
  return cleanContractorAddress(labeled || (fallbackToRaw ? value : ""));
}

function cleanContractorAddress(value: unknown) {
  return clean(value)
    .replace(/^["']?\s*\(?\s*to\s+be\s+verified\s+by\s+the\s+teacher\s*\/\s*principal\s*\)?\s*["']?\s*/i, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9,
  sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

export function normalizeSiteReportDate(value: unknown) {
  const source = clean(value).replace(/^on\s+/i, "");
  let year = 0;
  let month = 0;
  let day = 0;
  const named = source.match(/\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})\b/i);
  const namedDayFirst = source.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)[,]?\s+(\d{4})\b/i);
  const iso = source.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  const numeric = source.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (named) [month, day, year] = [MONTHS[named[1].toLowerCase()] ?? 0, Number(named[2]), Number(named[3])];
  else if (namedDayFirst) [month, day, year] = [MONTHS[namedDayFirst[2].toLowerCase()] ?? 0, Number(namedDayFirst[1]), Number(namedDayFirst[3])];
  else if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    [month, day, year] = first > 12 ? [second, first, Number(numeric[3])] : [first, second, Number(numeric[3])];
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!year || !month || !day || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function coordinatePair(text: string) {
  const parseDirected = (match: RegExpMatchArray | null, axis: "latitude" | "longitude") => {
    if (!match) return "";
    const value = Number(match[1]) * (/[SW]/i.test(match[2] ?? "") ? -1 : 1);
    const limit = axis === "latitude" ? 90 : 180;
    return Math.abs(value) <= limit ? String(value) : "";
  };
  const degree = String.raw`(?:\u00b0|Â°)?`;
  const latitude = parseDirected(text.match(new RegExp(String.raw`\blat(?:itude)?\b\s*[:=]?\s*(-?\d{1,3}(?:\.\d+)?)\s*${degree}\s*([NS])?`, "i")), "latitude");
  const longitude = parseDirected(text.match(new RegExp(String.raw`\b(?:long(?:itude)?|lng)\b\s*[:=]?\s*(-?\d{1,3}(?:\.\d+)?)\s*${degree}\s*([EW])?`, "i")), "longitude");
  if (latitude || longitude) return { latitude, longitude };
  const directedPair = text.match(new RegExp(String.raw`\(?\s*(\d{1,3}(?:\.\d+)?)\s*${degree}\s*([NS])\s*[,;/ ]+\s*(\d{1,3}(?:\.\d+)?)\s*${degree}\s*([EW])\s*\)?`, "i"));
  if (directedPair) {
    const lat = Number(directedPair[1]) * (directedPair[2].toUpperCase() === "S" ? -1 : 1);
    const lng = Number(directedPair[3]) * (directedPair[4].toUpperCase() === "W" ? -1 : 1);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { latitude: String(lat), longitude: String(lng) };
  }
  const labeledPair = text.match(/\b(?:actual\s+)?coordinates?\b(?:\s*\([^)]*\))?\s*[:=]?\s*\(?\s*(-?\d{1,3}\.\d+)\s*[,;/ ]+\s*(-?\d{1,3}\.\d+)\s*\)?/i);
  const plainPair = text.match(/(?:^|\n|\s|\()(-?\d{1,3}\.\d+)\s*[,;/ ]+\s*(-?\d{1,3}\.\d+)(?:\s|$|\))/);
  const pair = labeledPair ?? plainPair;
  if (!pair) return { latitude: "", longitude: "" };
  const first = Number(pair[1]);
  const second = Number(pair[2]);
  const looksLatLong = Math.abs(first) <= 90 && Math.abs(second) <= 180;
  return looksLatLong ? { latitude: pair[1], longitude: pair[2] } : { latitude: "", longitude: "" };
}

function coordinateSections(text: string) {
  const flagStart = text.search(/(?:^|\n)\s*flag\s*pole\s*(?:\r?\n|$)/i);
  const commboxStart = text.search(/(?:^|\n)\s*comm\s*box\s*(?:\r?\n|$)/i);
  const flagText = flagStart >= 0 ? text.slice(flagStart, commboxStart > flagStart ? commboxStart : undefined) : "";
  const commboxText = commboxStart >= 0 ? text.slice(commboxStart) : "";
  const flag = coordinatePair(flagText);
  const commbox = coordinatePair(commboxText);
  const fallback = coordinatePair(text);
  return {
    latitude: flag.latitude || fallback.latitude,
    longitude: flag.longitude || fallback.longitude,
    commboxLatitude: commbox.latitude,
    commboxLongitude: commbox.longitude,
    usedFlagPole: Boolean(flag.latitude || flag.longitude),
  };
}

function beneficiaryBlock(text: string) {
  const lines = splitLines(text);
  const nameMatch = labeledValueByAliasPriority(text, "beneficiaryName");
  const explicitRole = labeledValue(text, "beneficiaryRole")?.value ?? "";
  const explicitPhone = labeledValue(text, "beneficiaryPhone")?.value ?? "";
  if (!nameMatch) return { name: "", role: explicitRole, phone: explicitPhone };
  const followers = lines.slice(nameMatch.index + 1).map((line) => line.raw.trim()).filter(Boolean);
  const unlabeled = followers.filter((line) => !line.includes(":"));
  const phoneIndex = unlabeled.findIndex((line) => /(?:\+?63|0)\s*\d[\d\s()-]{7,}/.test(line));
  return {
    name: nameMatch.value,
    role: explicitRole || (phoneIndex > 0 ? unlabeled[phoneIndex - 1] : unlabeled.find((line) => !/(?:\+?63|0)\s*\d/.test(line)) ?? ""),
    phone: explicitPhone || (phoneIndex >= 0 ? unlabeled[phoneIndex] : ""),
  };
}

function multilineRemarks(text: string) {
  const lines = splitLines(text);
  const start = lines.findIndex((line) => line.label && labelMatches(line.label, aliases.remarks ?? []));
  if (start < 0) return "";
  const values = [lines[start].value];
  for (const line of lines.slice(start + 1)) {
    if (!line.raw.trim()) break;
    if (line.label && Object.values(aliases).some((group) => labelMatches(line.label, group ?? []))) break;
    values.push(line.raw.trim());
  }
  return clean(values.join(" "));
}

export function sanitizeSiteReportValues(input: unknown): SiteReportValues {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const values = Object.fromEntries(SITE_REPORT_FIELDS.map((field) => [field, clean(source[field])])) as SiteReportValues;
  values.schoolId = values.schoolId.replace(/^\s*\(\s*school\s+id\s*\)\s*/i, "");
  values.longitude = values.longitude.match(/-?\d{1,3}(?:\.\d+)?/)?.[0] ?? "";
  values.latitude = values.latitude.match(/-?\d{1,3}(?:\.\d+)?/)?.[0] ?? "";
  values.commboxLongitude = values.commboxLongitude.match(/-?\d{1,3}(?:\.\d+)?/)?.[0] ?? "";
  values.commboxLatitude = values.commboxLatitude.match(/-?\d{1,3}(?:\.\d+)?/)?.[0] ?? "";
  values.installDate = normalizeSiteReportDate(values.installDate);
  values.activationDate = normalizeSiteReportDate(values.activationDate);
  for (const field of ["starlinkKitNumber", "ap1IndoorSerial", "ap2IndoorSerial", "ap3OutdoorSerial", "ruijieRouterSerial"] as const) values[field] = cleanSerial(source[field]);
  return values;
}

export function parseSiteActivationReport(text: string): SiteReportExtraction {
  const coordinates = coordinateSections(text);
  const beneficiary = beneficiaryBlock(text);
  const raw = Object.fromEntries(SITE_REPORT_FIELDS.map((field) => [field, labeledValue(text, field)?.value ?? ""])) as SiteReportValues;
  raw.address = parseContractorAddress(text, false);
  raw.latitude = coordinates.latitude;
  raw.longitude = coordinates.longitude;
  raw.commboxLatitude = coordinates.commboxLatitude;
  raw.commboxLongitude = coordinates.commboxLongitude;
  raw.beneficiaryName = beneficiary.name;
  raw.beneficiaryRole = beneficiary.role;
  raw.beneficiaryPhone = beneficiary.phone;
  raw.remarks = multilineRemarks(text);
  const values = sanitizeSiteReportValues(raw);
  if (!values.activationDate && values.installDate) values.activationDate = values.installDate;
  const missing = SITE_REPORT_FIELDS.filter((field) => !values[field] && !field.startsWith("commbox") && field !== "logInTime");
  const diagnostics: string[] = [];
  if (coordinates.usedFlagPole || /flag\s*pole/i.test(text)) diagnostics.push("Flag Pole coordinates selected for the site.");
  if (values.commboxLatitude || values.commboxLongitude) diagnostics.push(`Commbox coordinates: ${values.commboxLatitude || "?"}, ${values.commboxLongitude || "?"}.`);
  if (values.logInTime) diagnostics.push(`Log-In Time: ${values.logInTime}.`);
  return { values, found: SITE_REPORT_FIELDS.filter((field) => Boolean(values[field])).length, missing, diagnostics };
}
