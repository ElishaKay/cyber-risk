import { describe, expect, it } from "vitest";
import { calculateRiskScore, getVendor, normalizeSeverity } from "../src/risk";

describe("risk score calculation", () => {
  it("returns a higher score for newer and more severe vulnerabilities", () => {
    const fresh = calculateRiskScore(9.8, 3.9, new Date().toISOString());
    const old = calculateRiskScore(4.3, 1.2, "2019-01-01T00:00:00.000Z");
    expect(fresh).toBeGreaterThan(old);
  });

  it("normalizes severity values and fallback to UNKNOWN", () => {
    expect(normalizeSeverity("high")).toBe("HIGH");
    expect(normalizeSeverity("not-real")).toBe("UNKNOWN");
  });

  it("extracts vendor from cpe", () => {
    const cpe = "cpe:2.3:a:microsoft:office:2019:*:*:*:*:*:*:*";
    expect(getVendor(cpe)).toBe("microsoft");
  });
});
