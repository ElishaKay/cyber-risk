"use client";

import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
import { StepchartsPlayLayout } from "@/components/StepchartsPlayLayout";
import { useStepchartsThreadIds } from "@/hooks/useStepchartsThreadIds";

function threadLabel(id: string) {
  return id.slice(0, 8) + (id.length > 8 ? "…" : "");
}

export default function Home() {
  const { threadIds, threadId, setThreadId, addNewThread, hydrated } =
    useStepchartsThreadIds();

  return (
    <div className="play-page">
      <header className="play-header">
        <h1>Stepcharts + AI</h1>
        <p>
          Describe your legal or structure need in the chat. The agent builds a
          proposal and you can view it in the embedded Stepcharts Playground.
        </p>
        <p className="play-header-meta">
          <span className="play-thread-label">Thread: </span>
          <select
            className="play-thread-select"
            value={threadId}
            onChange={(e) => setThreadId(e.target.value)}
            disabled={!hydrated}
            aria-label="Select conversation thread"
          >
            {(threadIds.length > 0 ? threadIds : [threadId]).map((id) => (
              <option key={id} value={id}>
                {threadLabel(id)}
              </option>
            ))}
          </select>{" "}
          <button
            type="button"
            className="play-new-thread"
            onClick={() => addNewThread()}
          >
            New thread
          </button>
        </p>
      </header>

      <div className="play-layout">
        <CopilotKit
          runtimeUrl="/api/copilotkit"
          agent="cyber_risk"
          threadId={threadId}
          key={threadId}
        >
          <StepchartsPlayLayout />
        </CopilotKit>
      </div>
    </div>
  );
}
