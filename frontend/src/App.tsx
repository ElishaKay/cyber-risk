import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>("");
  const [sortDesc, setSortDesc] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<Vulnerability[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.z = 4;

    const geometry = new THREE.IcosahedronGeometry(1.3, 1);
    const material = new THREE.MeshStandardMaterial({
      color: 0x7dd3fc,
      emissive: 0x082f49,
      roughness: 0.32,
      metalness: 0.68,
      wireframe: true
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    scene.add(new THREE.AmbientLight(0x7dd3fc, 0.45));
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
    keyLight.position.set(3, 3, 5);
    scene.add(keyLight);

    const resize = () => {
      const width = canvas.clientWidth || 320;
      const height = canvas.clientHeight || 220;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener("resize", resize);

    let frameId = 0;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      mesh.rotation.x += 0.003;
      mesh.rotation.y += 0.006;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    void loadData();
  }, []);

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
      <section className="hero">
        <div className="hero-copy">
          <h1>Vulnerability Risk Dashboard</h1>
          <p className="subtle">Risk = CVSS(60%) + exploitability(20%) + age(20%)</p>
          <div className="controls">
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
            <button onClick={() => setSortDesc((prev) => !prev)}>
              Sort by Risk: {sortDesc ? "High -> Low" : "Low -> High"}
            </button>
            <button onClick={loadData}>Refresh</button>
          </div>
        </div>
        <canvas ref={canvasRef} className="hero-canvas" aria-hidden="true" />
      </section>

      {error && <p className="error">{error}</p>}
      {loading && <p className="status">Loading vulnerability data...</p>}

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
          <ul className="vendors">
            {stats.topVendors.map((v) => (
              <li key={v.vendor}>
                <span>{v.vendor}</span>
                <strong>{v.count}</strong>
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
                <td title={row.description}>{row.description.length > 120 ? `${row.description.slice(0, 120)}...` : row.description}</td>
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
