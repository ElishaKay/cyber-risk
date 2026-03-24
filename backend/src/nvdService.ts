import { toVulnerabilityItem } from "./risk";
import type { VulnerabilityItem } from "./types";

const NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=20";

export async function fetchVulnerabilities(): Promise<VulnerabilityItem[]> {
  const response = await fetch(NVD_URL);
  if (!response.ok) {
    throw new Error(`NVD API request failed with status ${response.status}`);
  }
  const payload = await response.json();
  const vulnerabilities = payload?.vulnerabilities || [];
  return vulnerabilities.map((entry: any) => toVulnerabilityItem(entry));
}
