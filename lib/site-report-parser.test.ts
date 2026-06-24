import { describe, expect, it } from "vitest";
import { parseSiteActivationReport } from "./site-report-parser";

const cabangahanReport = `LOG-IN
Hi Comclark Activation Team - for your assistance on activation of Starlink and Access Points.

Log-In Time: 5:29 pm

Date: June 24, 2026
Company Name: Amers
Team Lead Name: Adrian Trillana

Site Code: 115647
School Name: Cabangahan Es
Address: Cabangahan, Panitan, Capiz

Actual Coordinates:
Flag Pole
Lat: 11.368908
Long: 122.75106

Commbox
Lat: 11.369157
Long: 122.750482

Starlink KIT Number: KIT4P00054292MG7
Ruijie Router S/N: H1V10XN001454

Access Points S/N:
AP 1 Indoor: G1UC2LK011689
AP 2 Indoor: G1UC2LK00941A
AP 3 Outdoor: G1UC09S011774

Beneficiary: Febe D. Jalandoni
Teacher II
09300498263`;

describe("parseSiteActivationReport", () => {
  it("extracts the supplied activation report", () => {
    const result = parseSiteActivationReport(cabangahanReport);
    expect(result.values).toMatchObject({
      schoolId: "115647",
      siteName: "Cabangahan Es",
      address: "Cabangahan, Panitan, Capiz",
      latitude: "11.368908",
      longitude: "122.75106",
      commboxLatitude: "11.369157",
      commboxLongitude: "122.750482",
      starlinkKitNumber: "KIT4P00054292MG7",
      ap1IndoorSerial: "G1UC2LK011689",
      ap2IndoorSerial: "G1UC2LK00941A",
      ap3OutdoorSerial: "G1UC09S011774",
      ruijieRouterSerial: "H1V10XN001454",
      contractor: "Amers",
      installerTeamLead: "Adrian Trillana",
      installDate: "2026-06-24",
      activationDate: "2026-06-24",
      beneficiaryName: "Febe D. Jalandoni",
      beneficiaryRole: "Teacher II",
      beneficiaryPhone: "09300498263",
    });
    expect(result.diagnostics).toContain("Flag Pole coordinates selected for the site.");
  });

  it("handles reordered labels, casing, spacing, and an explicit activation date", () => {
    const result = parseSiteActivationReport(`router s/n : R-1\nACTIVATION DATE: 25 June 2026\nsite name: Test ES\nsite code: 42\nlat = 10.1\nlng = 120.2`);
    expect(result.values).toMatchObject({ schoolId: "42", siteName: "Test ES", ruijieRouterSerial: "R-1", activationDate: "2026-06-25", latitude: "10.1", longitude: "120.2" });
  });

  it("captures multiline remarks and tolerates missing optional fields", () => {
    const result = parseSiteActivationReport("School Name: Small ES\nRemarks: First line\nSecond line");
    expect(result.values.remarks).toBe("First line Second line");
    expect(result.values.starlinkKitNumber).toBe("");
  });
});
