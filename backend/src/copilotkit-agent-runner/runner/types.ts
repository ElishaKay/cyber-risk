import type { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import type { AgentRunnerRunRequest } from "@copilotkitnext/runtime";

export interface HistoryHydratingRunnerConfig {
  agent: LangGraphAgent;
  deploymentUrl: string;
  graphId: string;
  langsmithApiKey?: string;
  historyLimit?: number;
  clientTimeoutMs?: number;
  debug?: boolean;
  stateExtractor?: StateExtractor;
}

export type StateExtractor = (
  input: AgentRunnerRunRequest["input"],
  forwardedProps?: Record<string, unknown>
) => Record<string, unknown>;

export interface LangGraphMessage {
  id: string;
  type: "human" | "ai" | "tool" | "system";
  content: string | Array<{ type: string; text?: string }>;
  tool_calls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
  tool_call_id?: string;
}

export interface ThreadState {
  values: {
    messages?: LangGraphMessage[];
    [key: string]: unknown;
  };
  next: string[];
  config?: unknown;
  created_at?: string;
  parent_config?: unknown;
  tasks?: Array<{
    id: string;
    name: string;
    interrupts?: Array<{
      value?: unknown;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  }>;
  checkpoint: unknown;
  metadata: unknown;
  parent_checkpoint?: unknown;
}

export interface PredictStateTool {
  tool: string;
  state_key: string;
  tool_argument: string;
}

export interface FrozenAgentConfig {
  deploymentUrl: string;
  graphId: string;
  langsmithApiKey?: string;
  clientTimeoutMs: number;
}

