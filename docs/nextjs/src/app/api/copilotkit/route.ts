/**
 * CopilotKit API Route with History Hydration
 *
 * This route demonstrates how to use the HistoryHydratingAgentRunner
 * to persist and restore chat history across page refreshes.
 */

import {
  CopilotRuntime,
  createCopilotEndpointSingleRoute,
} from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";
import {
  HistoryHydratingAgentRunner,
  createIsolatedAgent,
} from "@/lib/copilotkit-agent-runner";

// Configuration from environment variables
const deploymentUrl = process.env.LANGGRAPH_DEPLOYMENT_URL!;
const langsmithApiKey = process.env.LANGSMITH_API_KEY;
const graphId = process.env.LANGGRAPH_GRAPH_ID || "query_fan_out";

/**
 * Creates a fresh CopilotRuntime for each request.
 *
 * IMPORTANT: In serverless environments (like Vercel), always create
 * a fresh runtime per request to prevent state contamination.
 */
function createRuntime() {
  // Create isolated agent (prevents serverless state contamination)
  const agent = createIsolatedAgent({
    deploymentUrl,
    graphId,
    langsmithApiKey,
    debug: process.env.NODE_ENV === "development",
  });

  // Create history-hydrating runner
  const runner = new HistoryHydratingAgentRunner({
    agent,
    deploymentUrl,
    graphId,
    langsmithApiKey,
    historyLimit: 100, // Max messages to load on reconnect
    debug: process.env.NODE_ENV === "development",
  });

  return new CopilotRuntime({
    agents: { [graphId]: agent },
    runner,
  });
}

// Handle POST requests
export const POST = async (req: Request) => {
  // Create fresh runtime for this request
  const runtime = createRuntime();

  // Create CopilotKit endpoint (returns a Hono app; wrap with handle for Next.js)
  const copilotRoute = createCopilotEndpointSingleRoute({
    runtime,
    basePath: "/api/copilotkit",
  });
  const handleRequest = handle(copilotRoute as any);

  return handleRequest(req);
};

// Export config for Next.js
export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes max for long-running agents
