import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { SITE_REPORT_FIELDS, sanitizeSiteReportValues } from "@/lib/site-report-parser";

const descriptions: Record<(typeof SITE_REPORT_FIELDS)[number], string> = {
  schoolId: "School ID or Site Code.", siteName: "School Name or Site Name.", address: "Complete school address.",
  longitude: "Flag Pole longitude, or the only site longitude when no sections exist.", latitude: "Flag Pole latitude, or the only site latitude when no sections exist.",
  commboxLongitude: "Commbox longitude for diagnostics only.", commboxLatitude: "Commbox latitude for diagnostics only.",
  starlinkKitNumber: "Starlink kit number.", activationDate: "Explicit activation date, YYYY-MM-DD.",
  ap1IndoorSerial: "First Indoor AP serial.", ap2IndoorSerial: "Second Indoor AP serial.", ap3OutdoorSerial: "Outdoor AP serial.",
  ruijieRouterSerial: "Ruijie router serial.", contractor: "Company Name or MSP.", installerTeamLead: "Installer or Team Lead name.",
  installDate: "Installation date or general report Date, YYYY-MM-DD.", beneficiaryName: "Contact Person (School Head/ICT Teacher) name when present; otherwise Beneficiary name.",
  beneficiaryRole: "Beneficiary position or role, including an unlabeled line after the name.", beneficiaryPhone: "Beneficiary phone number.",
  remarks: "Remarks or notes.", logInTime: "Log-In Time for diagnostics only.",
};

async function requireEditor(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) throw new Error("Missing session.");
  const supabase = getSupabaseAdmin();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error("Invalid session.");
  const { data: profile } = await supabase.from("profiles").select("role,active").eq("id", user.id).single();
  if (!profile?.active || !["admin", "staff"].includes(profile.role)) throw new Error("Editor access required.");
}

function extractionError(error: unknown) {
  const message = error instanceof Error ? error.message : "Gemini extraction failed.";
  if (/quota|rate limit|429/i.test(message)) return { status: 429, message: "Gemini's rate limit was reached. Local extraction is still available." };
  if (/api key|permission|401|403/i.test(message)) return { status: 502, message: "Gemini rejected the configured API key." };
  return { status: 502, message: "Gemini could not extract this report. Local extraction is still available." };
}

export async function POST(request: Request) {
  try {
    await requireEditor(request);
    const body = await request.json();
    const report = typeof body.report === "string" ? body.report.trim() : "";
    if (!report) return NextResponse.json({ error: "Paste an activation report first." }, { status: 400 });
    if (report.length > 50_000) return NextResponse.json({ error: "The report must be 50,000 characters or fewer." }, { status: 413 });
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Gemini is not configured. Add GEMINI_API_KEY to the server environment." }, { status: 503 });
    const properties = Object.fromEntries(SITE_REPORT_FIELDS.map((field) => [field, { type: "string", description: descriptions[field] }]));
    const ai = new GoogleGenAI({ apiKey });
    const result = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      contents: `Extract only values explicitly present in this activation report. Return an empty string when absent. Never invent or correct names, identifiers, phone numbers, coordinates, or serial numbers. Prefer Flag Pole coordinates over Commbox coordinates. A general Date is the installation date. When both Beneficiary and Contact Person are present, use Contact Person as beneficiaryName. Beneficiary role and phone may be unlabeled lines after the beneficiary name.\n\n${report}`,
      config: { temperature: 0, responseMimeType: "application/json", responseJsonSchema: { type: "object", properties, required: [...SITE_REPORT_FIELDS], additionalProperties: false } },
    });
    if (!result.text) throw new Error("Gemini returned an empty response.");
    const values = sanitizeSiteReportValues(JSON.parse(result.text));
    if (!values.activationDate && values.installDate) values.activationDate = values.installDate;
    const missing = SITE_REPORT_FIELDS.filter((field) => !values[field] && !field.startsWith("commbox") && field !== "logInTime");
    return NextResponse.json({ extraction: { values, found: SITE_REPORT_FIELDS.filter((field) => Boolean(values[field])).length, missing, diagnostics: ["Checked with Gemini."], decisions: [] } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to extract report.";
    if (/session|access/i.test(message)) return NextResponse.json({ error: message }, { status: 403 });
    const handled = extractionError(error);
    return NextResponse.json({ error: handled.message }, { status: handled.status });
  }
}
