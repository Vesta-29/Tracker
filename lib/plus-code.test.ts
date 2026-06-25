import { describe, expect, it } from "vitest";
import { plusCodeFromCoordinates, plusCodeFromStrings } from "./plus-code";

describe("plusCodeFromCoordinates", () => {
  it("encodes a known full plus code", () => {
    expect(plusCodeFromCoordinates(47.36559, 8.524997)).toBe("8FVC9G8F+6X");
  });

  it("encodes Philippine coordinates from strings", () => {
    expect(plusCodeFromStrings("13.291712", "123.239024")).toBe("7Q5576RQ+MJ");
  });
});
