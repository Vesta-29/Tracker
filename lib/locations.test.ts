import { describe, expect, it } from "vitest";
import { resolveAddressLocation } from "./locations";

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
