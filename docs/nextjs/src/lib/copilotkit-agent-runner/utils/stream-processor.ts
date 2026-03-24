import type { BaseEvent } from "@ag-ui/core";
import type {
  CustomStreamEvent,
  ErrorStreamEvent,
  EventsStreamEvent,
  MetadataStreamEvent,
  UpdatesStreamEvent,
  ValuesStreamEvent,
} from "@langchain/langgraph-sdk";
import { CustomEventNames } from "../events/custom-events";
import { LangGraphEventTypes } from "../events/langgraph-events";
import type { PredictStateTool } from "../runner/types";

export interface StreamProcessorContext {
  threadId: string;
  runId: string;
  subscriber: { next: (event: BaseEvent) => void };
  startedMessages?: Set<string>;
  startedToolCalls?: Set<string>;
  debug?: boolean;
  manuallyEmittedState?: Record<string, unknown>;
}

export interface StreamChunk {
  id?: string;
  event: string;
  data: unknown;
  metadata?: Record<string, unknown>;
}

export async function processStreamChunk(
  chunk: StreamChunk,
  context: StreamProcessorContext
): Promise<{ runId: string; manuallyEmittedState?: Record<string, unknown> }> {
  const { event, data } = chunk;
  let { runId } = context;
  const { threadId, subscriber, startedMessages, startedToolCalls, debug } =
    context;
  let manuallyEmittedState = context.manuallyEmittedState;

  switch (event) {
    case "metadata": {
      const metadataData = data as MetadataStreamEvent["data"];
      if (metadataData.run_id) {
        runId = metadataData.run_id;
      }
      break;
    }

    case "events": {
      const eventsData = data as EventsStreamEvent["data"];

      const rawEvent: BaseEvent = {
        type: "RAW" as unknown as BaseEvent["type"],
        event: eventsData.event,
        name: eventsData.name,
        data: eventsData.data,
        run_id: eventsData.run_id,
        metadata: chunk.metadata,
        rawEvent: {
          id: runId,
          event: eventsData.event,
          name: eventsData.name,
          data: eventsData.data,
          run_id: eventsData.run_id,
          metadata: chunk.metadata,
        },
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent;

      const eventType = eventsData.event;
      const toolCallData = (
        eventsData.data as { chunk?: { tool_call_chunks?: Array<{ name?: string }> } }
      )?.chunk?.tool_call_chunks?.[0];
      const metadata = chunk.metadata || {};
      const emitIntermediateState = metadata[
        "copilotkit:emit-intermediate-state"
      ] as PredictStateTool[] | undefined;
      const toolCallUsedToPredictState = emitIntermediateState?.some(
        (predictStateTool: PredictStateTool) =>
          predictStateTool.tool === toolCallData?.name
      );

      if (
        eventType === LangGraphEventTypes.OnChatModelStream &&
        toolCallUsedToPredictState
      ) {
        subscriber.next({
          type: "CUSTOM" as unknown as BaseEvent["type"],
          name: "PredictState",
          value: metadata["copilotkit:emit-intermediate-state"],
          rawEvent,
          timestamp: Date.now(),
          threadId,
          runId,
        } as unknown as BaseEvent);
        break;
      }

      if (eventType === LangGraphEventTypes.OnChatModelStream) {
        const messageChunk = (
          eventsData.data as { chunk?: { content?: string | unknown[] } }
        )?.chunk;
        if (messageChunk?.content) {
          if (
            "copilotkit:emit-messages" in metadata &&
            metadata["copilotkit:emit-messages"] === false
          ) {
            break;
          }

          const messageId = eventsData.run_id || runId;
          const delta =
            typeof messageChunk.content === "string"
              ? messageChunk.content
              : "";

          if (startedMessages && !startedMessages.has(messageId)) {
            subscriber.next({
              type: "TEXT_MESSAGE_START" as unknown as BaseEvent["type"],
              role: "assistant",
              messageId,
              rawEvent,
              timestamp: Date.now(),
              threadId,
              runId,
            } as unknown as BaseEvent);
            startedMessages.add(messageId);
          }

          subscriber.next({
            type: "TEXT_MESSAGE_CONTENT" as unknown as BaseEvent["type"],
            messageId,
            delta,
            rawEvent,
            timestamp: Date.now(),
            threadId,
            runId,
          } as unknown as BaseEvent);
        }
      }

      if (eventType === LangGraphEventTypes.OnChatModelStart) {
        const eventMetadata = chunk.metadata || {};
        if (
          "copilotkit:emit-messages" in eventMetadata &&
          eventMetadata["copilotkit:emit-messages"] === false
        ) {
          break;
        }

        const messageId = eventsData.run_id || runId;

        if (!startedMessages || !startedMessages.has(messageId)) {
          subscriber.next({
            type: "TEXT_MESSAGE_START" as unknown as BaseEvent["type"],
            role: "assistant",
            messageId,
            rawEvent,
            timestamp: Date.now(),
            threadId,
            runId,
          } as unknown as BaseEvent);

          if (startedMessages) {
            startedMessages.add(messageId);
          }
        }
      }

      if (eventType === LangGraphEventTypes.OnChatModelEnd) {
        const eventMetadata = chunk.metadata || {};
        if (
          "copilotkit:emit-messages" in eventMetadata &&
          eventMetadata["copilotkit:emit-messages"] === false
        ) {
          break;
        }

        const messageId = eventsData.run_id || runId;

        if (startedMessages && !startedMessages.has(messageId)) {
          subscriber.next({
            type: "TEXT_MESSAGE_START" as unknown as BaseEvent["type"],
            role: "assistant",
            messageId,
            rawEvent,
            timestamp: Date.now(),
            threadId,
            runId,
          } as unknown as BaseEvent);
          startedMessages.add(messageId);
        }

        subscriber.next({
          type: "TEXT_MESSAGE_END" as unknown as BaseEvent["type"],
          messageId,
          rawEvent,
          timestamp: Date.now(),
          threadId,
          runId,
        } as unknown as BaseEvent);
      }

      if (eventType === LangGraphEventTypes.OnToolStart) {
        const eventMetadata = chunk.metadata || {};
        if (
          "copilotkit:emit-tool-calls" in eventMetadata &&
          eventMetadata["copilotkit:emit-tool-calls"] === false
        ) {
          break;
        }

        const toolData = (eventsData.data as { input?: unknown })?.input;
        const toolName = eventsData.name;
        const toolCallId = eventsData.run_id || runId;

        if (!startedToolCalls || !startedToolCalls.has(toolCallId)) {
          subscriber.next({
            type: "TOOL_CALL_START" as unknown as BaseEvent["type"],
            toolCallId,
            toolCallName: toolName,
            parentMessageId: runId,
            rawEvent,
            timestamp: Date.now(),
            threadId,
            runId,
          } as unknown as BaseEvent);

          if (startedToolCalls) {
            startedToolCalls.add(toolCallId);
          }
        }

        if (toolData) {
          subscriber.next({
            type: "TOOL_CALL_ARGS" as unknown as BaseEvent["type"],
            toolCallId,
            delta: JSON.stringify(toolData),
            rawEvent,
            timestamp: Date.now(),
            threadId,
            runId,
          } as unknown as BaseEvent);
        }
      }

      if (eventType === LangGraphEventTypes.OnToolEnd) {
        const eventMetadata = chunk.metadata || {};
        if (
          "copilotkit:emit-tool-calls" in eventMetadata &&
          eventMetadata["copilotkit:emit-tool-calls"] === false
        ) {
          break;
        }

        const toolCallId = eventsData.run_id || runId;
        const toolName = eventsData.name;

        if (startedToolCalls && !startedToolCalls.has(toolCallId)) {
          subscriber.next({
            type: "TOOL_CALL_START" as unknown as BaseEvent["type"],
            toolCallId,
            toolCallName: toolName,
            parentMessageId: runId,
            rawEvent,
            timestamp: Date.now(),
            threadId,
            runId,
          } as unknown as BaseEvent);
          startedToolCalls.add(toolCallId);
        }

        subscriber.next({
          type: "TOOL_CALL_END" as unknown as BaseEvent["type"],
          toolCallId,
          rawEvent,
          timestamp: Date.now(),
          threadId,
          runId,
        } as unknown as BaseEvent);
      }

      subscriber.next({
        type: "CUSTOM" as unknown as BaseEvent["type"],
        name: eventsData.event,
        value: JSON.stringify(eventsData.data),
        rawEvent,
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);
      break;
    }

    case "updates": {
      const updatesData = data as UpdatesStreamEvent<unknown>["data"];

      subscriber.next({
        type: "STATE_SNAPSHOT" as unknown as BaseEvent["type"],
        snapshot: updatesData,
        rawEvent: {
          id: runId,
          event: "updates",
          data: updatesData,
        },
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);
      break;
    }

    case "values": {
      const valuesData = data as ValuesStreamEvent<unknown>["data"];

      subscriber.next({
        type: "STATE_SNAPSHOT" as unknown as BaseEvent["type"],
        snapshot: valuesData,
        rawEvent: {
          id: runId,
          event: "values",
          data: valuesData,
        },
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);
      break;
    }

    case "custom": {
      const customData = data as CustomStreamEvent<unknown>["data"];

      const result = handleCustomEvent(
        customData,
        threadId,
        runId,
        subscriber,
        manuallyEmittedState
      );
      manuallyEmittedState = result.manuallyEmittedState;
      break;
    }

    case "error": {
      const errorData = data as ErrorStreamEvent["data"];

      if (debug) {
        console.error(
          "[HistoryHydratingRunner] Stream error:",
          errorData.message
        );
      }

      subscriber.next({
        type: "CUSTOM" as unknown as BaseEvent["type"],
        name: "on_error",
        value: JSON.stringify(errorData),
        rawEvent: {
          id: runId,
          error: errorData.error,
          message: errorData.message,
        },
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);
      break;
    }

    default: {
      if (debug) {
        console.log(
          `[HistoryHydratingRunner] Unhandled event type: ${event}`,
          data
        );
      }
    }
  }

  return { runId, manuallyEmittedState };
}

function handleCustomEvent(
  customData: unknown,
  threadId: string,
  runId: string,
  subscriber: { next: (event: BaseEvent) => void },
  manuallyEmittedState?: Record<string, unknown>
): { manuallyEmittedState?: Record<string, unknown> } {
  const rawEvent = {
    id: runId,
    data: customData,
  };

  const typedData = customData as {
    name?: string;
    event?: string;
    value?: unknown;
  };
  const eventName = typedData?.name || typedData?.event;

  switch (eventName) {
    case CustomEventNames.CopilotKitManuallyEmitMessage: {
      const value =
        (typedData.value as { message_id?: string; message?: string }) ||
        undefined;
      const messageId = value?.message_id || runId;
      const message = value?.message || "";

      subscriber.next({
        type: "TEXT_MESSAGE_START" as unknown as BaseEvent["type"],
        role: "assistant",
        messageId,
        rawEvent,
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);

      subscriber.next({
        type: "TEXT_MESSAGE_CONTENT" as unknown as BaseEvent["type"],
        messageId,
        delta: message,
        rawEvent,
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);

      subscriber.next({
        type: "TEXT_MESSAGE_END" as unknown as BaseEvent["type"],
        messageId,
        rawEvent,
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);
      break;
    }

    case CustomEventNames.CopilotKitManuallyEmitToolCall: {
      const value =
        (typedData.value as { id?: string; name?: string; args?: unknown }) ||
        undefined;
      const toolCallId = value?.id || runId;
      const toolCallName = value?.name || "";
      const args = value?.args || {};

      subscriber.next({
        type: "TOOL_CALL_START" as unknown as BaseEvent["type"],
        toolCallId,
        toolCallName,
        parentMessageId: toolCallId,
        rawEvent,
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);

      subscriber.next({
        type: "TOOL_CALL_ARGS" as unknown as BaseEvent["type"],
        toolCallId,
        delta: JSON.stringify(args),
        rawEvent,
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);

      subscriber.next({
        type: "TOOL_CALL_END" as unknown as BaseEvent["type"],
        toolCallId,
        rawEvent,
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);
      break;
    }

    case CustomEventNames.CopilotKitManuallyEmitIntermediateState: {
      manuallyEmittedState = typedData.value as Record<string, unknown>;

      subscriber.next({
        type: "STATE_SNAPSHOT" as unknown as BaseEvent["type"],
        snapshot: manuallyEmittedState,
        rawEvent,
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);
      break;
    }

    case CustomEventNames.CopilotKitExit: {
      subscriber.next({
        type: "CUSTOM" as unknown as BaseEvent["type"],
        name: "Exit",
        value: true,
        rawEvent,
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);
      break;
    }

    case CustomEventNames.MCPToolStart: {
      subscriber.next({
        type: "CUSTOM" as unknown as BaseEvent["type"],
        name: CustomEventNames.MCPToolStart,
        value: JSON.stringify(typedData.value ?? {}),
        rawEvent,
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);
      break;
    }

    case CustomEventNames.MCPToolResult: {
      subscriber.next({
        type: "CUSTOM" as unknown as BaseEvent["type"],
        name: CustomEventNames.MCPToolResult,
        value: JSON.stringify(typedData.value ?? {}),
        rawEvent,
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);
      break;
    }

    default: {
      subscriber.next({
        type: "CUSTOM" as unknown as BaseEvent["type"],
        name: eventName || "on_custom_event",
        value: JSON.stringify(customData),
        rawEvent,
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);
    }
  }

  return { manuallyEmittedState };
}

