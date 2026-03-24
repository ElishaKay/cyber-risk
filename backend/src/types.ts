export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";

export interface VulnerabilityItem {
  id: string;
  description: string;
  severity: Severity;
  cvssScore: number;
  exploitabilityScore: number;
  publishedDate: string;
  vendor: string;
  riskScore: number;
}
