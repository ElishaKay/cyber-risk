# Getting Started

## Step 1: Set up environment variables (`.env` files)

**Project root `.env`** (for the Node backend + CopilotKit runtime)

```
# Point to your local LangGraph dev server
LANGGRAPH_DEPLOYMENT_URL=http://localhost:8000
# Must match the graph name in agent/langgraph.json and the frontend agent prop
LANGGRAPH_GRAPH_ID=cyber_risk

# Optional (for authentication)
# LANGSMITH_API_KEY=your-api-key
```

**`agents/copilotkit/agent/.env`**

```
OPENAI_API_KEY=
NEXT_PUBLIC_AGENT_TYPE=langgraph
# Base URL the LangGraph agent uses to call the Node API (stats / CVE list)
CYBER_RISK_API_BASE_URL=http://127.0.0.1:3001
```

## Step 2: Running the Langgraph Agent

`langgraph-api` **0.7.x** needs **langgraph 1.0.x** and **langgraph-sdk 0.3.x**. Older pins (`langgraph` 0.4.x + `pip install -U langgraph-api`) caused:

`ImportError: cannot import name 'MISSING' from 'langgraph_grpc_common.conversion._compat'`

Everything is aligned via Poetry (including CLI + API).

a) Create and activate a **Python 3.11 or 3.12** virtual environment (3.11+ required by `langgraph-api`):

```bash
cd agents/copilotkit/agent
python3.12 -m venv .venv
source .venv/bin/activate
```

b) Install dependencies (app + LangGraph CLI/API):

```bash
poetry install --with langgraph
```

c) Run the LangGraph development server:

```bash
poetry run langgraph dev --host localhost --port 8000 --no-browser
```

If you use a fresh clone, run `poetry lock` only when you change `pyproject.toml`; otherwise use the committed `poetry.lock`.
