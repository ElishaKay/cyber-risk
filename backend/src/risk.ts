import type { Severity, VulnerabilityItem } from "./types";

const MAX_AGE_DAYS = 365;

export function normalizeSeverity(baseSeverity?: string): Severity {
  const sev = (baseSeverity || "").toUpperCase();
  if (sev === "LOW" || sev === "MEDIUM" || sev === "HIGH" || sev === "CRITICAL") {
    return sev;
  }
  return "UNKNOWN";
}

export function calculateRiskScore(cvssScore: number, exploitabilityScore: number, publishedDate: string): number {
  const cvssNormalized = Math.max(0, Math.min(cvssScore, 10)) * 10;
  const exploitabilityNormalized = Math.max(0, Math.min(exploitabilityScore, 10)) * 10;

  const publishedAt = new Date(publishedDate);
  const ageDays = Number.isNaN(publishedAt.getTime())
    ? MAX_AGE_DAYS
    : Math.max(0, (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60 * 24));
  const ageFactor = Math.max(0, 1 - Math.min(ageDays, MAX_AGE_DAYS) / MAX_AGE_DAYS) * 100;

  const weighted = cvssNormalized * 0.6 + exploitabilityNormalized * 0.2 + ageFactor * 0.2;
  return Math.round(weighted);
}

export function getVendor(cpeCriteria?: string): string {
  if (!cpeCriteria) return "unknown";
  const parts = cpeCriteria.split(":");
  return parts[3] || "unknown";
}

export function toVulnerabilityItem(raw: any): VulnerabilityItem {
  const cve = raw.cve || {};
  const metrics = cve.metrics || {};
  const cvssV31 = metrics.cvssMetricV31?.[0] || metrics.cvssMetricV30?.[0];
  const cvssV2 = metrics.cvssMetricV2?.[0];

  const cvssData = cvssV31?.cvssData || cvssV2?.cvssData || {};
  const cvssScore = cvssData.baseScore ?? 0;
  const severity = normalizeSeverity(cvssData.baseSeverity);
  const exploitabilityScore = cvssV31?.exploitabilityScore ?? cvssV2?.exploitabilityScore ?? 0;
  const publishedDate = cve.published || new Date(0).toISOString();
  const riskScore = calculateRiskScore(cvssScore, exploitabilityScore, publishedDate);
  const description = cve.descriptions?.find((d: any) => d.lang === "en")?.value || "No description";
  const cpeCriteria =
    cve.configurations?.[0]?.nodes?.[0]?.cpeMatch?.[0]?.criteria ||
    cve.configurations?.[0]?.nodes?.[0]?.cpeMatch?.[0]?.cpe23Uri;

  return {
    id: cve.id || "unknown-id",
    description,
    severity,
    cvssScore,
    exploitabilityScore,
    publishedDate,
    vendor: getVendor(cpeCriteria),
    riskScore
  };
}
