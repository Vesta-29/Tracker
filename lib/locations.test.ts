import { describe, expect, it } from "vitest";
import { resolveAddressLocation, resolveLocation } from "./locations";

describe("resolveAddressLocation", () => {
  it("infers a unique PSGC path from barangay, municipality, and province", () => {
    const result = resolveAddressLocation("Cabangahan, Panitan, Capiz");
    expect(result.issue).toBeUndefined();
    expect(result.location).toMatchObject({
      islandGroup: "Visayas",
      province: "Capiz",
      municipality: "Panitan",
      barangay: "Cabangahan",
    });
  });
});

describe("resolveLocation", () => {
  it("accepts Region IX shorthand from directory spreadsheets", () => {
    const result = resolveLocation({
      islandGroup: "Mindanao",
      region: "IX",
      province: "Zamboanga del Sur",
      municipality: "Pagadian City",
    });

    expect(result.location).toMatchObject({
      islandGroup: "Mindanao",
      region: "Region IX (Zamboanga Peninsula)",
      province: "Zamboanga del Sur",
      municipality: "City of Pagadian",
    });
  });

  it("does not let an NCR island value block a valid region match", () => {
    const result = resolveLocation({
      islandGroup: "NCR",
      region: "IX",
      province: "Zamboanga del Sur",
      municipality: "Pagadian City",
    });

    expect(result.issue).not.toBe("Region not recognized: IX");
  });

  it("resolves a directory locality with a minor spelling difference", () => {
    const result = resolveLocation({
      islandGroup: "Mindanao",
      region: "VII",
      province: "Cebu",
      municipality: "Pinamungahan",
      barangay: "Anislag",
    });

    expect(result.location).toMatchObject({
      islandGroup: "Visayas",
      region: "Region VII (Central Visayas)",
      province: "Cebu",
      municipality: "Pinamungajan",
      barangay: "Anislag",
    });
  });

  it("returns matched region and province when municipality is unresolved", () => {
    const result = resolveLocation({
      islandGroup: "Luzon",
      region: "III",
      province: "Zambales",
      municipality: "Olongapo City",
    });

    expect(result.location).toBeUndefined();
    expect(result.issue).toBe("Municipality not recognized under Zambales: Olongapo City");
    expect(result.partialLocation).toMatchObject({
      islandGroup: "Luzon",
      region: "Region III (Central Luzon)",
      province: "Zambales",
      municipality: "",
    });
  });
});
