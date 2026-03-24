import { type BaseEvent, EventType } from "@ag-ui/core";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import {
  AgentRunner,
  type AgentRunnerConnectRequest,
  type AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
} from "@copilotkitnext/runtime";
import { Client, type Run, type StreamMode } from "@langchain/langgraph-sdk";
import { Observable } from "rxjs";

import {
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_TIMEOUT,
  MAX_HISTORY_LIMIT,
} from "./constants";
import type {
  FrozenAgentConfig,
  HistoryHydratingRunnerConfig,
  LangGraphMessage,
  StateExtractor,
  ThreadState,
} from "./types";
import { createIsolatedAgent } from "../utils/create-isolated-agent";
import { transformMessages } from "../utils/message-transformer";
import {
  processStreamChunk,
  type StreamChunk,
} from "../utils/stream-processor";

export class HistoryHydratingAgentRunner extends AgentRunner {
  private agent: LangGraphAgent;
  private historyLimit: number;
  private debug: boolean;
  private stateExtractor?: StateExtractor;
  private activeRun: {
    manuallyEmittedState?: Record<string, unknown>;
  } = {};

  private readonly frozenConfig: Readonly<FrozenAgentConfig>;

  constructor(config: HistoryHydratingRunnerConfig) {
    super();
    this.agent = config.agent;
    this.debug = config.debug ?? false;
    this.stateExtractor = config.stateExtractor;

    this.historyLimit = Math.min(
      config.historyLimit ?? DEFAULT_HISTORY_LIMIT,
      MAX_HISTORY_LIMIT
    );

    this.frozenConfig = Object.freeze({
      deploymentUrl: config.deploymentUrl,
      graphId: config.graphId,
      langsmithApiKey: config.langsmithApiKey,
      clientTimeoutMs: config.clientTimeoutMs ?? DEFAULT_TIMEOUT,
    });
  }

  private createFreshAgent(): LangGraphAgent {
    return createIsolatedAgent({
      deploymentUrl: this.frozenConfig.deploymentUrl,
      graphId: this.frozenConfig.graphId,
      langsmithApiKey: this.frozenConfig.langsmithApiKey,
      clientTimeoutMs: this.frozenConfig.clientTimeoutMs,
    });
  }

  private createFreshClient(): Client {
    return new Client({
      apiUrl: this.frozenConfig.deploymentUrl,
      apiKey: this.frozenConfig.langsmithApiKey,
      timeoutMs: this.frozenConfig.clientTimeoutMs,
    });
  }

  private log(message: string, ...args: unknown[]): void {
    if (this.debug) {
      console.log(`[HistoryHydratingRunner] ${message}`, ...args);
    }
  }

  private warn(message: string, ...args: unknown[]): void {
    console.warn(`[HistoryHydratingRunner] ${message}`, ...args);
  }

  private error(message: string, ...args: unknown[]): void {
    console.error(`[HistoryHydratingRunner] ${message}`, ...args);
  }

  run(request: AgentRunnerRunRequest) {
    const freshAgent = this.createFreshAgent();

    const inputWithProps = request.input as typeof request.input & {
      forwardedProps?: { configurable?: Record<string, unknown> };
    };
    const forwardedProps = inputWithProps.forwardedProps;
    const existingState = (request.input.state || {}) as Record<
      string,
      unknown
    >;

    let enrichedState: Record<string, unknown>;

    if (this.stateExtractor) {
      const extractedState = this.stateExtractor(
        request.input,
        forwardedProps
      );
      enrichedState = {
        ...existingState,
        ...extractedState,
      };
    } else {
      enrichedState = existingState;
    }

    this.log("State extraction:", {
      hasStateExtractor: !!this.stateExtractor,
      hasForwardedProps: !!forwardedProps,
      hasState: !!request.input.state,
      threadId: request.input.threadId,
    });

    freshAgent.setState(enrichedState);

    const inputWithState = {
      ...request.input,
      state: enrichedState,
    };

    return freshAgent.run(inputWithState);
  }

  async isRunning(): Promise<boolean> {
    return this.agent.isRunning;
  }

  async stop(_request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    const result = this.agent.abortRun();
    return result !== undefined ? result : true;
  }

  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    const { threadId } = request;

    const client = this.createFreshClient();

    return new Observable<BaseEvent>((subscriber) => {
      const hydrate = async () => {
        try {
          const history = await client.threads.getHistory(threadId, {
            limit:
              this.historyLimit > 0
                ? this.historyLimit
                : DEFAULT_HISTORY_LIMIT,
          });

          if (!history || history.length === 0) {
            this.warn(`No history found for thread ${threadId}`);
            const fallbackRunId =
              "hydration_" + Math.random().toString(36).slice(2);
            subscriber.next({
              type: EventType.RUN_STARTED,
              timestamp: Date.now(),
              threadId,
              runId: fallbackRunId,
            } as BaseEvent);
            subscriber.next({
              type: EventType.MESSAGES_SNAPSHOT,
              messages: [],
              timestamp: Date.now(),
              threadId,
              runId: fallbackRunId,
            } as BaseEvent);
            subscriber.next({
              type: EventType.RUN_FINISHED,
              timestamp: Date.now(),
              threadId,
              runId: fallbackRunId,
            } as BaseEvent);
            subscriber.complete();
            return;
          }

          const allMessages: LangGraphMessage[] = [];
          const seenMessageIds = new Set<string>();

          for (const checkpoint of history.reverse()) {
            const state = checkpoint as unknown as ThreadState;
            if (state.values?.messages) {
              const messages = (state.values.messages ||
                []) as LangGraphMessage[];

              for (const msg of messages) {
                if (!seenMessageIds.has(msg.id)) {
                  seenMessageIds.add(msg.id);
                  allMessages.push(msg);
                }
              }
            }
          }

          this.log(
            `Loaded ${allMessages.length} unique messages from ${history.length} checkpoints`
          );

          const limitedMessages =
            this.historyLimit > 0
              ? allMessages.slice(-this.historyLimit)
              : allMessages;

          const transformedMessages = transformMessages(limitedMessages, {
            debug: this.debug,
          });

          let runId: string;
          try {
            const runs = await client.runs.list(threadId);
            runId =
              runs && runs.length > 0
                ? runs[0]!.run_id
                : "hydration_" + Math.random().toString(36).slice(2);
          } catch (error) {
            this.warn("Failed to fetch runs, using generated ID:", error);
            runId = "hydration_" + Math.random().toString(36).slice(2);
          }

          subscriber.next({
            type: EventType.RUN_STARTED,
            timestamp: Date.now(),
            threadId,
            runId,
          } as BaseEvent);

          subscriber.next({
            type: EventType.MESSAGES_SNAPSHOT,
            messages: transformedMessages,
            timestamp: Date.now(),
            threadId,
            runId,
          } as BaseEvent);

          const latestState = history[
            history.length - 1
          ] as unknown as ThreadState;

          if (latestState.values) {
            subscriber.next({
              type: "STATE_SNAPSHOT" as unknown as typeof EventType.CUSTOM,
              snapshot: latestState.values,
              rawEvent: {
                id: runId,
                event: "values",
                data: latestState.values,
              },
              timestamp: Date.now(),
              threadId,
              runId,
            } as unknown as BaseEvent);
          }

          const interruptedTask = latestState.tasks?.find(
            (task) => task.interrupts && task.interrupts.length > 0
          );

          if (
            interruptedTask &&
            interruptedTask.interrupts &&
            interruptedTask.interrupts.length > 0
          ) {
            const interrupt = interruptedTask.interrupts[0];
            const interruptValue = interrupt?.value;

            subscriber.next({
              type: "CUSTOM" as unknown as typeof EventType.CUSTOM,
              name: "on_interrupt",
              value: JSON.stringify(interruptValue),
              rawEvent: {
                id: runId,
                value: interruptValue,
              },
              timestamp: Date.now(),
              threadId,
              runId,
            } as unknown as BaseEvent);
          }

          const isThreadBusy = latestState.next && latestState.next.length > 0;

          let activeRun: Run | undefined;
          if (isThreadBusy) {
            try {
              const runs = await client.runs.list(threadId);
              activeRun = runs?.find(
                (run: Run) =>
                  run.status === "running" || run.status === "pending"
              );
            } catch (error) {
              this.warn("Failed to check for active runs:", error);
            }
          }

          if (activeRun) {
            this.log(`Joining active stream for run ${activeRun.run_id}`);
            try {
              await this.joinAndProcessStream(
                client,
                threadId,
                activeRun.run_id,
                subscriber
              );
            } catch (error) {
              this.error("Error joining stream:", error);
            }
          } else {
            subscriber.next({
              type: EventType.RUN_FINISHED,
              timestamp: Date.now(),
              threadId,
              runId,
            } as BaseEvent);
          }

          subscriber.complete();
        } catch (error) {
          this.error("Failed to hydrate history:", error);
          const fallbackRunId =
            "hydration_error_" + Math.random().toString(36).slice(2);
          subscriber.next({
            type: EventType.RUN_STARTED,
            timestamp: Date.now(),
            threadId,
            runId: fallbackRunId,
          } as BaseEvent);
          subscriber.next({
            type: EventType.MESSAGES_SNAPSHOT,
            messages: [],
            timestamp: Date.now(),
            threadId,
            runId: fallbackRunId,
          } as BaseEvent);
          subscriber.next({
            type: EventType.RUN_FINISHED,
            timestamp: Date.now(),
            threadId,
            runId: fallbackRunId,
          } as BaseEvent);
          subscriber.complete();
        }
      };

      hydrate();
    });
  }

  private async joinAndProcessStream(
    client: Client,
    threadId: string,
    runId: string,
    subscriber: {
      next: (event: BaseEvent) => void;
      complete: () => void;
      error: (err: unknown) => void;
    }
  ): Promise<void> {
    const startedMessages = new Set<string>();
    const startedToolCalls = new Set<string>();

    try {
      const stream = client.runs.joinStream(threadId, runId, {
        streamMode: ["events", "values", "updates", "custom"] as StreamMode[],
      });

      let currentRunId = runId;
      let manuallyEmittedState = this.activeRun.manuallyEmittedState;

      for await (const chunk of stream) {
        try {
          const result = await processStreamChunk(chunk as StreamChunk, {
            threadId,
            runId: currentRunId,
            subscriber,
            startedMessages,
            startedToolCalls,
            debug: this.debug,
            manuallyEmittedState,
          });
          currentRunId = result.runId;
          manuallyEmittedState = result.manuallyEmittedState;
        } catch (chunkError) {
          this.error("Error processing stream chunk:", chunkError);
        }
      }

      this.activeRun.manuallyEmittedState = manuallyEmittedState;

      try {
        const state = await client.threads.getState(threadId);
        const threadState = state as unknown as ThreadState;

        const interruptedTask = threadState.tasks?.find(
          (task) => task.interrupts && task.interrupts.length > 0
        );

        if (
          interruptedTask &&
          interruptedTask.interrupts &&
          interruptedTask.interrupts.length > 0
        ) {
          const interrupt = interruptedTask.interrupts[0];
          const interruptValue = interrupt?.value;

          subscriber.next({
            type: "CUSTOM" as unknown as typeof EventType.CUSTOM,
            name: "on_interrupt",
            value: JSON.stringify(interruptValue),
            rawEvent: {
              id: currentRunId,
              value: interruptValue,
            },
            timestamp: Date.now(),
            threadId,
            runId: currentRunId,
          } as unknown as BaseEvent);
        }
      } catch (stateError) {
        this.warn("Failed to check for interrupts after stream:", stateError);
      }

      subscriber.next({
        type: EventType.RUN_FINISHED,
        timestamp: Date.now(),
        threadId,
        runId: currentRunId,
      } as BaseEvent);
    } catch (error) {
      this.error("Error in joinAndProcessStream:", error);

      subscriber.next({
        type: EventType.RUN_FINISHED,
        timestamp: Date.now(),
        threadId,
        runId,
      } as BaseEvent);

      throw error;
    }
  }
}

