## Installation

```bash
npm install copilotkit-agent-runner
# or
pnpm add copilotkit-agent-runner
# or
yarn add copilotkit-agent-runner
```

### Peer Dependencies

This package requires the following peer dependencies:

```bash
npm install @copilotkit/runtime @copilotkitnext/runtime @ag-ui/core @langchain/langgraph-sdk rxjs
```

## Quick Start

### Next.js App Router

```typescript
// app/api/copilotkit/route.ts
import { CopilotRuntime, createCopilotEndpointSingleRoute } from "@copilotkit/runtime/v2";
import {
  HistoryHydratingAgentRunner,
  createIsolatedAgent,
} from "copilotkit-agent-runner";

const deploymentUrl = process.env.LANGGRAPH_DEPLOYMENT_URL!;
const langsmithApiKey = process.env.LANGSMITH_API_KEY;
const graphId = "cyber_risk";

function createRuntime() {
  // Create isolated agent (prevents serverless state contamination)
  const agent = createIsolatedAgent({
    deploymentUrl,
    graphId,
    langsmithApiKey,
  });

  // Create history-hydrating runner
  const runner = new HistoryHydratingAgentRunner({
    agent,
    deploymentUrl,
    graphId,
    langsmithApiKey,
    historyLimit: 100, // Max messages to load
  });

  return new CopilotRuntime({
    agents: { [graphId]: agent },
    runner,
  });
}

export const POST = async (req: Request) => {
  const runtime = createRuntime();
  const route = createCopilotEndpointSingleRoute({
    runtime,
    basePath: "/api/copilotkit",
  });
  return route.handleRequest(req);
};
```

### Frontend (React)

```tsx
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";

function App() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="cyber_risk"
      threadId={threadId} // Pass your thread ID here
    >
      <CopilotChat />
    </CopilotKit>
  );
}
```

## Configuration

### `HistoryHydratingAgentRunner` Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `agent` | `LangGraphAgent` | **required** | The LangGraphAgent instance |
| `deploymentUrl` | `string` | **required** | LangGraph deployment URL |
| `graphId` | `string` | **required** | Graph identifier |
| `langsmithApiKey` | `string` | `undefined` | LangSmith API key |
| `historyLimit` | `number` | `100` | Max checkpoints to fetch (max 1000) |
| `clientTimeoutMs` | `number` | `1800000` | HTTP timeout (default 30 min) |
| `debug` | `boolean` | `false` | Enable debug logging |
| `stateExtractor` | `function` | `undefined` | Custom state extraction |

### `createIsolatedAgent` Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `deploymentUrl` | `string` | **required** | LangGraph deployment URL |
| `graphId` | `string` | **required** | Graph identifier |
| `langsmithApiKey` | `string` | `undefined` | LangSmith API key |
| `clientTimeoutMs` | `number` | `1800000` | HTTP timeout |
| `debug` | `boolean` | `false` | Enable debug mode |

## Advanced Usage

### Custom State Extraction

If you need to extract custom fields from the CopilotKit request:

```typescript
const runner = new HistoryHydratingAgentRunner({
  agent,
  deploymentUrl,
  graphId,
  stateExtractor: (input, forwardedProps) => ({
    // Extract from forwardedProps.configurable (useCoAgent config)
    tenantId: forwardedProps?.configurable?.tenantId as string,
    userId: forwardedProps?.configurable?.userId as string,
    // Or from input.state (useCoAgent initialState)
    ...input.state,
  }),
});
```

### Why `createIsolatedAgent`?

In serverless environments (especially Vercel Fluid Compute), Node.js module-level state can be shared between bundled routes. This causes a critical bug where the LangGraph deployment URL gets contaminated between different agent configurations.

`createIsolatedAgent` fixes this by:
1. Creating agents with frozen, immutable config
2. Verifying the internal client URL matches expected
3. Force-replacing the client if contamination is detected

**Always use `createIsolatedAgent` instead of `new LangGraphAgent()` in serverless environments.**

### Debug Mode

Enable debug logging to troubleshoot issues:

```typescript
const runner = new HistoryHydratingAgentRunner({
  // ...
  debug: true,
});
```

This logs:
- History fetching progress
- Message transformation details
- Stream processing events
- State extraction results

## How It Works

### History Hydration Flow

When a client connects to an existing thread:

1. **Fetch History**: Retrieves all checkpoints from LangGraph via `client.threads.getHistory()`
2. **Extract Messages**: Processes checkpoints chronologically, deduplicating messages by ID
3. **Transform Format**: Converts LangGraph messages to CopilotKit format
4. **Emit Events**: Sends `MESSAGES_SNAPSHOT` and `STATE_SNAPSHOT` events to frontend
5. **Join Stream**: If thread is busy, joins the active execution stream

### Event Types Handled

- `on_chat_model_stream` → `TEXT_MESSAGE_CONTENT`
- `on_chat_model_start` → `TEXT_MESSAGE_START`
- `on_chat_model_end` → `TEXT_MESSAGE_END`
- `on_tool_start` → `TOOL_CALL_START`
- `on_tool_end` → `TOOL_CALL_END`
- Custom CopilotKit events (manual message/tool/state emission)
- Interrupt events

## API Reference

### Exports

```typescript
// Core
export { HistoryHydratingAgentRunner } from "copilotkit-agent-runner";
export { createIsolatedAgent } from "copilotkit-agent-runner";

// Types
export type {
  HistoryHydratingRunnerConfig,
  StateExtractor,
  CreateIsolatedAgentConfig,
  LangGraphMessage,
  ThreadState,
} from "copilotkit-agent-runner";

// Constants
export {
  DEFAULT_TIMEOUT,
  DEFAULT_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
} from "copilotkit-agent-runner";

// Event Enums
export {
  CustomEventNames,
  LangGraphEventTypes,
} from "copilotkit-agent-runner";

// Utilities (advanced)
export {
  transformMessages,
  extractContent,
  processStreamChunk,
} from "copilotkit-agent-runner";
```