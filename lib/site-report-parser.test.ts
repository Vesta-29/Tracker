import { describe, expect, it } from "vitest";
import { parseContractorAddress, parseSiteActivationReport } from "./site-report-parser";

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

  it("prioritizes School ID over Site Code", () => {
    const result = parseSiteActivationReport(`Site Code: ELRN-L2-0670
School ID: 119552
School Name: Test ES`);
    expect(result.values.schoolId).toBe("119552");
  });

  it("ignores ELRN-prefixed IDs and uses the 6-digit school ID", () => {
    expect(parseSiteActivationReport("School ID: ELRN-L2-0670 119552\nSchool Name: Test ES").values.schoolId).toBe("119552");
    expect(parseSiteActivationReport("School ID:  ELRN-L2-0670\nSite Code: 119552\nSchool Name: Test ES").values.schoolId).toBe("119552");
  });

  it("handles labels with a colon and no following space", () => {
    const result = parseSiteActivationReport(`Site Code:500604
School Name:Agno Elementary School
Date:June 25, 2026
Starlink KIT Number:KIT4P00054292MG7
AP 1 Indoor:G1UC0BC013748
AP 2 Indoor:G1UC2LK00941A
AP 3 Outdoor:G1UC09S011774
Router:H1V10XN001454
Lat:10.577450\u00b0N
Long:123.423355\u00b0E`);
    expect(result.values).toMatchObject({
      schoolId: "500604",
      siteName: "Agno Elementary School",
      installDate: "2026-06-25",
      activationDate: "2026-06-25",
      starlinkKitNumber: "KIT4P00054292MG7",
      ap1IndoorSerial: "G1UC0BC013748",
      ap2IndoorSerial: "G1UC2LK00941A",
      ap3OutdoorSerial: "G1UC09S011774",
      ruijieRouterSerial: "H1V10XN001454",
      latitude: "10.57745",
      longitude: "123.423355",
    });
  });

  it("splits compact inline label-value fields", () => {
    const result = parseSiteActivationReport("Site Code:500604 School Name:Agno Elementary School Date:June 25, 2026 Company Name:Amers Team Lead Name:Adrian Trillana Starlink KIT Number:KIT4P00054292MG7 AP 1 Indoor:G1UC0BC013748 AP 2 Indoor:G1UC2LK00941A AP 3 Outdoor:G1UC09S011774 Router:H1V10XN001454 Beneficiary:Febe D. Jalandoni Contact Number:09300498263 Remarks:Activated");
    expect(result.values).toMatchObject({
      schoolId: "500604",
      siteName: "Agno Elementary School",
      installDate: "2026-06-25",
      activationDate: "2026-06-25",
      contractor: "Amers",
      installerTeamLead: "Adrian Trillana",
      starlinkKitNumber: "KIT4P00054292MG7",
      ap1IndoorSerial: "G1UC0BC013748",
      ap2IndoorSerial: "G1UC2LK00941A",
      ap3OutdoorSerial: "G1UC09S011774",
      ruijieRouterSerial: "H1V10XN001454",
      beneficiaryName: "Febe D. Jalandoni",
      beneficiaryPhone: "09300498263",
      remarks: "Activated",
    });
  });

  it("prefers the contact person over the beneficiary label for contact name", () => {
    const result = parseSiteActivationReport(`Beneficiary:San Andres elementary school
Contact Person (School Head/ICT Teacher):Redemcion F Maulawin`);
    expect(result.values.beneficiaryName).toBe("Redemcion F Maulawin");
  });

  it("captures multiline remarks and tolerates missing optional fields", () => {
    const result = parseSiteActivationReport("School Name: Small ES\nRemarks: First line\nSecond line");
    expect(result.values.remarks).toBe("First line Second line");
    expect(result.values.starlinkKitNumber).toBe("");
  });

  it("reads labeled values from the following line", () => {
    const result = parseSiteActivationReport(`Site Code:
500604
School Name:
Agno Elementary School
Date:
June 25, 2026
Starlink KIT Number:
KIT4P00054292MG7
AP 1 Indoor:
G1UC0BC013748
AP 2 Indoor:
G1UC2LK00941A
AP 3 Outdoor:
G1UC09S011774
Router:
H1V10XN001454
Beneficiary:
Febe D. Jalandoni
Teacher II
09300498263`);
    expect(result.values).toMatchObject({
      schoolId: "500604",
      siteName: "Agno Elementary School",
      installDate: "2026-06-25",
      activationDate: "2026-06-25",
      starlinkKitNumber: "KIT4P00054292MG7",
      ap1IndoorSerial: "G1UC0BC013748",
      ap2IndoorSerial: "G1UC2LK00941A",
      ap3OutdoorSerial: "G1UC09S011774",
      ruijieRouterSerial: "H1V10XN001454",
      beneficiaryName: "Febe D. Jalandoni",
      beneficiaryRole: "Teacher II",
      beneficiaryPhone: "09300498263",
    });
  });

  it("accepts coordinates on one line or separated by commas", () => {
    expect(parseSiteActivationReport("Coordinates: 11.368908, 122.75106").values).toMatchObject({
      latitude: "11.368908",
      longitude: "122.75106",
    });
    expect(parseSiteActivationReport("Actual Coordinates:\n11.368908,122.75106").values).toMatchObject({
      latitude: "11.368908",
      longitude: "122.75106",
    });
    expect(parseSiteActivationReport("Flag Pole\n11.368908 122.75106\n\nCommbox\n11.369157, 122.750482").values).toMatchObject({
      latitude: "11.368908",
      longitude: "122.75106",
      commboxLatitude: "11.369157",
      commboxLongitude: "122.750482",
    });
    const parenthesized = parseSiteActivationReport("Actual Coordinates (Taken at School Flag Pole): (13.291712,123.239024)");
    expect(parenthesized.values).toMatchObject({
      latitude: "13.291712",
      longitude: "123.239024",
    });
    expect(parenthesized.diagnostics).toContain("Flag Pole coordinates selected for the site.");
  });

  it("accepts degree coordinates with cardinal directions", () => {
    expect(parseSiteActivationReport("Actual Coordinates: 10.577450°N, 123.423355°E").values).toMatchObject({
      latitude: "10.57745",
      longitude: "123.423355",
    });
    expect(parseSiteActivationReport("Actual Coordinates: 10.577450°S, 123.423355°W").values).toMatchObject({
      latitude: "-10.57745",
      longitude: "-123.423355",
    });
  });

  it("normalizes contractor-provided address paste formats", () => {
    expect(parseContractorAddress(`Complete School Address (to be verified by the teacher/principal):

BRGY. ZONE 16, TALISAY CITY, NEG. OCC.`)).toBe("BRGY. ZONE 16, TALISAY CITY, NEG. OCC.");
    expect(parseContractorAddress("Complete School Address (to be verified by the teacher/principal): BRGY. ZONE 16, TALISAY CITY, NEG. OCC.")).toBe("BRGY. ZONE 16, TALISAY CITY, NEG. OCC.");
    expect(parseContractorAddress('Complete School Address : (to be verified by the teacher/principal) "BRGY. ZONE 16, TALISAY CITY, NEG. OCC."')).toBe("BRGY. ZONE 16, TALISAY CITY, NEG. OCC.");
    expect(parseContractorAddress("BRGY. ZONE 16, TALISAY CITY, NEG. OCC.")).toBe("BRGY. ZONE 16, TALISAY CITY, NEG. OCC.");
    expect(parseSiteActivationReport("School Name: Test ES\nComplete School Address (to be verified by the teacher/principal): BRGY. ZONE 16, TALISAY CITY, NEG. OCC.").values.address).toBe("BRGY. ZONE 16, TALISAY CITY, NEG. OCC.");
    expect(parseSiteActivationReport('School Name: Test ES\nComplete School Address : (to be verified by the teacher/principal) "BRGY. ZONE 16, TALISAY CITY, NEG. OCC."').values.address).toBe("BRGY. ZONE 16, TALISAY CITY, NEG. OCC.");
  });
});
