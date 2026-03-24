# Vulnerability Risk Dashboard

Mini full-stack app that fetches CVE data from NVD, calculates risk scores, and displays results in a React dashboard.

## Stack

- Backend: Node.js + Express + TypeScript
- Frontend: React + TypeScript + Vite
- Data source: NVD CVE API v2
- Environment: Supabase URL used for connectivity check (`/api/health`)

## Risk Score Formula

Score range is `0-100`.

- `CVSS contribution (60%)`: `min(max(cvss,0),10) * 10 * 0.6`
- `Exploitability contribution (20%)`: `min(max(exploitability,0),10) * 10 * 0.2`
- `Age contribution (20%)`: Newer vulnerabilities score higher.
  - `ageFactor = (1 - min(ageDays, 365)/365) * 100`
  - `age contribution = ageFactor * 0.2`

Final score:

`riskScore = round(cvssNorm*0.6 + exploitabilityNorm*0.2 + ageFactor*0.2)`

## API Endpoints

- `GET /api/vulnerabilities` - list vulnerabilities
- `GET /api/vulnerabilities?severity=HIGH` - list filtered by severity
- `GET /api/vulnerabilities/:id` - single vulnerability details by CVE ID
- `GET /api/stats` - severity breakdown + top vendors
- `GET /api/health` - app health + Supabase connectivity check

## UI Features

- Vulnerability table with columns: CVE ID, Description, Severity, Risk Score, Date
- Severity filter
- Sort by risk score (high-to-low / low-to-high)
- Risk score indicator colors:
  - Green `0-30`
  - Yellow `31-60`
  - Orange `61-80`
  - Red `81-100`
- Stats panel for severity counts and top vendors

## Getting Started

Install dependencies:

```bash
npm install
```

Run backend:

```bash
npm run dev:backend
```

Run frontend in another terminal:

```bash
npm run dev:frontend
```

Backend runs on `http://localhost:3001`, frontend on `http://localhost:5173`.

## Tests

Run tests:

```bash
npm test
```

Includes 3 unit tests for:

- relative risk scoring behavior
- severity normalization
- vendor parsing from CPE

## AI Tools Usage

- **Tool used**: Cursor AI assistant
- **Used for**:
  - scaffolding backend and frontend structure
  - implementing API integration and risk scoring logic
  - generating initial React UI components
  - writing initial unit tests
- **Human modifications/improvements**:
  - adjusted endpoint behavior and error handling
  - refined risk score formula and mapping fields from NVD schema
  - cleaned up UI labels, table behavior, and styles
  - verified build and tests locally
