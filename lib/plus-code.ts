const CODE_ALPHABET = "23456789CFGHJMPQRVWX";
const SEPARATOR = "+";
const SEPARATOR_POSITION = 8;
const PAIR_RESOLUTIONS = [20, 1, 0.05, 0.0025, 0.000125];

function clipLatitude(latitude: number) {
  return Math.min(90 - 1e-12, Math.max(-90, latitude));
}

function normalizeLongitude(longitude: number) {
  let value = longitude;
  while (value < -180) value += 360;
  while (value >= 180) value -= 360;
  return value;
}

export function plusCodeFromCoordinates(latitude: number, longitude: number) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
  let lat = clipLatitude(latitude) + 90;
  let lng = normalizeLongitude(longitude) + 180;
  let code = "";

  for (const place of PAIR_RESOLUTIONS) {
    const latDigit = Math.floor(lat / place);
    const lngDigit = Math.floor(lng / place);
    code += CODE_ALPHABET[latDigit] + CODE_ALPHABET[lngDigit];
    lat -= latDigit * place;
    lng -= lngDigit * place;
  }

  return `${code.slice(0, SEPARATOR_POSITION)}${SEPARATOR}${code.slice(SEPARATOR_POSITION)}`;
}

export function plusCodeFromStrings(latitude: string, longitude: string) {
  return plusCodeFromCoordinates(Number(latitude.trim()), Number(longitude.trim()));
}
