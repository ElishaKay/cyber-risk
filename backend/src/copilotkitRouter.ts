import { CopilotRuntime } from "@copilotkit/runtime/v2";
import { createCopilotEndpointSingleRouteExpress } from "@copilotkitnext/runtime/express";
import type { Router } from "express";
import {
  HistoryHydratingAgentRunner,
  createIsolatedAgent
} from "./copilotkit-agent-runner/index.ts";

/**
 * CopilotKit single-route handler backed by the LangGraph `cyber_risk` deployment.
 * Mirrors `docs/nextjs/src/app/api/copilotkit/route.ts`: isolated LangGraph client,
 * history hydration from the LangGraph API, and the v2 runtime stack.
 *
 * Env: LANGGRAPH_DEPLOYMENT_URL (e.g. http://localhost:8000), LANGGRAPH_GRAPH_ID, optional LANGSMITH_API_KEY.
 */
function createCyberRiskCopilotRuntime(): CopilotRuntime {
  const deploymentUrl = (process.env.LANGGRAPH_DEPLOYMENT_URL ?? "http://127.0.0.1:8000").replace(
    /\/$/,
    ""
  );
  const graphId = process.env.LANGGRAPH_GRAPH_ID ?? "cyber_risk";
  const langsmithApiKey = process.env.LANGSMITH_API_KEY;
  const debug = process.env.NODE_ENV !== "production";

  const agent = createIsolatedAgent({
    deploymentUrl,
    graphId,
    langsmithApiKey,
    debug
  });

  const runner = new HistoryHydratingAgentRunner({
    agent,
    deploymentUrl,
    graphId,
    langsmithApiKey,
    historyLimit: 100,
    debug
  });

  return new CopilotRuntime({
    agents: { [graphId]: agent },
    runner
  });
}

export function createCyberRiskCopilotRouter(): Router {
  const runtime = createCyberRiskCopilotRuntime();

  return createCopilotEndpointSingleRouteExpress({
    runtime,
    basePath: "/api/copilotkit"
  });
}
