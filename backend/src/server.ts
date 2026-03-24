import cors from "cors";
import express from "express";
import { checkSupabaseConnection } from "./db";
import { fetchVulnerabilities } from "./nvdService";
import type { Severity } from "./types";

const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(cors());
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  const supabaseConnected = await checkSupabaseConnection();
  res.json({ ok: true, supabaseConnected });
});

app.get("/api/vulnerabilities", async (req, res) => {
  try {
    const severity = (req.query.severity as string | undefined)?.toUpperCase() as Severity | undefined;
    const rows = await fetchVulnerabilities();
    const filtered = severity ? rows.filter((item) => item.severity === severity) : rows;
    res.json(filtered);
  } catch (error) {
    res.status(502).json({
      error: "Failed to fetch vulnerabilities from NVD",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

app.get("/api/vulnerabilities/:id", async (req, res) => {
  try {
    const rows = await fetchVulnerabilities();
    const found = rows.find((item) => item.id === req.params.id);
    if (!found) {
      res.status(404).json({ error: "Vulnerability not found" });
      return;
    }
    res.json(found);
  } catch (error) {
    res.status(502).json({
      error: "Failed to fetch vulnerabilities from NVD",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

app.get("/api/stats", async (_req, res) => {
  try {
    const rows = await fetchVulnerabilities();
    const severityBreakdown = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.severity] = (acc[row.severity] || 0) + 1;
      return acc;
    }, {});

    const vendorCounts = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.vendor] = (acc[row.vendor] || 0) + 1;
      return acc;
    }, {});

    const topVendors = Object.entries(vendorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([vendor, count]) => ({ vendor, count }));

    res.json({ severityBreakdown, topVendors, total: rows.length });
  } catch (error) {
    res.status(502).json({
      error: "Failed to compute stats from NVD data",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
