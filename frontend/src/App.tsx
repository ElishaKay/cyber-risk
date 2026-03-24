import { useMemo, useState } from "react";

type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";

interface Vulnerability {
  id: string;
  description: string;
  severity: Severity;
  riskScore: number;
  publishedDate: string;
}

interface StatsResponse {
  severityBreakdown: Record<string, number>;
  topVendors: Array<{ vendor: string; count: number }>;
  total: number;
}

function scoreColor(score: number): string {
  if (score <= 30) return "green";
  if (score <= 60) return "yellow";
  if (score <= 80) return "orange";
  return "red";
}

export function App() {
  const [severityFilter, setSeverityFilter] = useState<string>("");
  const [sortDesc, setSortDesc] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<Vulnerability[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [vulnRes, statsRes] = await Promise.all([
        fetch(`/api/vulnerabilities${severityFilter ? `?severity=${severityFilter}` : ""}`),
        fetch("/api/stats")
      ]);

      if (!vulnRes.ok) throw new Error("Failed to fetch vulnerabilities");
      if (!statsRes.ok) throw new Error("Failed to fetch stats");

      setRows(await vulnRes.json());
      setStats(await statsRes.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => (sortDesc ? b.riskScore - a.riskScore : a.riskScore - b.riskScore)),
    [rows, sortDesc]
  );

  return (
    <main className="container">
      <h1>Vulnerability Risk Dashboard</h1>
      <p className="subtle">Risk = CVSS(60%) + exploitability(20%) + age(20%)</p>

      <section className="controls">
        <label>
          Severity filter:
          <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
            <option value="">All</option>
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
        </label>
        <button onClick={() => setSortDesc((prev) => !prev)}>Sort by Risk: {sortDesc ? "High -> Low" : "Low -> High"}</button>
        <button onClick={loadData}>Load Data</button>
      </section>

      {error && <p className="error">{error}</p>}
      {loading && <p>Loading vulnerability data...</p>}

      {stats && (
        <section className="panel">
          <h2>Stats Panel</h2>
          <p>Total CVEs: {stats.total}</p>
          <div className="stats-grid">
            {Object.entries(stats.severityBreakdown).map(([sev, count]) => (
              <div key={sev} className="chip">
                {sev}: {count}
              </div>
            ))}
          </div>
          <h3>Top Vendors</h3>
          <ul>
            {stats.topVendors.map((v) => (
              <li key={v.vendor}>
                {v.vendor}: {v.count}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h2>Vulnerability Table</h2>
        <table>
          <thead>
            <tr>
              <th>CVE ID</th>
              <th>Description</th>
              <th>Severity</th>
              <th>Risk Score</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.id}>
                <td>{row.id}</td>
                <td title={row.description}>{row.description.slice(0, 120)}...</td>
                <td>{row.severity}</td>
                <td>
                  <span className={`badge ${scoreColor(row.riskScore)}`}>{row.riskScore}</span>
                </td>
                <td>{new Date(row.publishedDate).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
