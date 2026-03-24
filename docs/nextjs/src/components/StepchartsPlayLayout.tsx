"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useCoAgent } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import {
  STEPCHARTS_PLAY_URL,
  PLAY_ORIGIN,
  STEPCHARTS_AGENT,
  ProposalState,
  extractEmbeddedIdFromPlayUrl,
  toPlaygroundPayload,
} from "./StepchartsPlayConfig";

type SampleItem = { key: string; title: string };

/**
 * Chat + embedded stepcharts.io/play iframe. Use inside CopilotKit with agent={STEPCHARTS_AGENT}.
 * Uses postMessage bridge: playground:ready → playground:setState → playground:stateApplied / playground:stateChanged.
 */
export function StepchartsPlayLayout() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [playgroundReady, setPlaygroundReady] = useState(false);
  const [playgroundError, setPlaygroundError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const embeddedId = searchParams.get("embeddedId") ?? undefined;
  const [embeddedProposalId, setEmbeddedProposalId] = useState<string | null>(
    embeddedId ?? null
  );
  const iframeSrc = embeddedProposalId
    ? `${STEPCHARTS_PLAY_URL}?embeddedId=${encodeURIComponent(embeddedProposalId)}`
    : STEPCHARTS_PLAY_URL;
  const { state, setState } = useCoAgent<ProposalState>({
    name: STEPCHARTS_AGENT,
    initialState: { proposal: null },
  });

  const [playgroundProposal, setPlaygroundProposal] =
    useState<ProposalState["proposal"] | null>(null);
  const [remoteProposal, setRemoteProposal] = useState<ProposalState["proposal"] | null>(
    null
  );
  const [samples, setSamples] = useState<SampleItem[]>([]);
  const [sampleLoadKey, setSampleLoadKey] = useState<string | null>(null);

  const proposal =
    playgroundProposal ?? remoteProposal ?? state?.proposal ?? null;
  const proposalJson = proposal ? JSON.stringify(proposal, null, 2) : "";

  const sendStateToPlayground = useCallback(() => {
    if (!proposal || !iframeRef.current?.contentWindow) return;
    try {
      iframeRef.current.contentWindow.postMessage(
        { type: "playground:setState", payload: toPlaygroundPayload(proposal) },
        PLAY_ORIGIN
      );
      setPlaygroundError(null);
    } catch (e) {
      setPlaygroundError(e instanceof Error ? e.message : "Failed to send state");
    }
  }, [proposal]);

  // Log the iframe URL we are rendering so you can see it any time iframeSrc changes.
  useEffect(() => {
    console.log("[StepchartsPlayLayout] current iframeSrc prop:", iframeSrc);
  }, [iframeSrc]);

  // Listen for playground messages (ready, stateApplied, stateChanged, error)
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== PLAY_ORIGIN) return;
      const data = event.data;
      if (typeof data !== "object" || !data?.type?.startsWith?.("playground:")) return;

      switch (data.type) {
        case "playground:ready":
          if (data.payload?.proposalId) {
            setEmbeddedProposalId(String(data.payload.proposalId));
          }
          setPlaygroundReady(true);
          setPlaygroundError(null);
          break;
        case "playground:stateApplied":
          if (data.payload?.proposalId) {
            setEmbeddedProposalId(String(data.payload.proposalId));
          }
          setPlaygroundError(null);
          break;
        case "playground:urlChanged": {
          const payload = data.payload as { url?: string; proposalId?: string };
          const url = payload?.url;
          const proposalId = payload?.proposalId;
          const idFromUrl =
            typeof url === "string" ? extractEmbeddedIdFromPlayUrl(url) : null;
          const id = proposalId ?? idFromUrl;
          console.log("[StepchartsPlayLayout] playground:urlChanged — url:", url ?? "(none)", "extracted id:", idFromUrl ?? "(none)", "proposalId:", proposalId ?? "(none)");
          if (id) {
            setEmbeddedProposalId(String(id));
          }
          setPlaygroundError(null);
          break;
        }
        case "playground:stateChanged": {
          const payload = data.payload as ProposalState["proposal"];
          if (payload != null) {
            setPlaygroundProposal(payload);
            setState((prev) => ({ ...prev, proposal: payload }));
          }
          setPlaygroundError(null);
          break;
        }
        case "playground:error":
          setPlaygroundError(data.payload?.error ?? "Unknown playground error");
          break;
        default:
          break;
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [setState]);

  // Whenever the iframe loads a new URL, derive embeddedId from iframe.src and refresh remote proposal
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      const src = iframe.src;
      const id = extractEmbeddedIdFromPlayUrl(src);
      console.log("[StepchartsPlayLayout] iframe URL:", src);
      console.log("[StepchartsPlayLayout] extracted embedded proposal id from URL:", id ?? "(none)");
      if (id) {
        setEmbeddedProposalId((prev) => (prev === id ? prev : id));
      }
    };

    iframe.addEventListener("load", handleLoad);
    return () => {
      iframe.removeEventListener("load", handleLoad);
    };
  }, []);

  // When we know the embedded proposal id (from URL or playground events), fetch latest JSON from Firebase RTDB
  useEffect(() => {
    if (!embeddedProposalId) return;

    const controller = new AbortController();
    const id = embeddedProposalId;

    // Clear current remote and playground proposal so we don't show stale JSON while fetching a new example
    setRemoteProposal(null);
    setPlaygroundProposal(null);

    async function fetchProposal() {
      try {
        const url = `/api/embedded-proposals/${encodeURIComponent(id)}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return;
        const json = (await res.json()) as ProposalState["proposal"];
        setRemoteProposal(json);
      } catch {
        // ignore network/abort errors; UI will still show agent state if available
      }
    }

    fetchProposal();

    return () => {
      controller.abort();
    };
  }, [embeddedProposalId]);

  // Once playground is ready, send current proposal; also send when proposal changes
  useEffect(() => {
    if (!playgroundReady || !proposal) return;
    sendStateToPlayground();
  }, [playgroundReady, proposal, sendStateToPlayground]);

  // List sample proposals when no embedded proposal (e.g. new thread session)
  useEffect(() => {
    if (embeddedProposalId) return;
    let cancelled = false;
    fetch("/api/sample-proposals")
      .then((res) => (res.ok ? res.json() : []))
      .then((list: SampleItem[]) => {
        if (!cancelled) setSamples(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setSamples([]);
      });
    return () => {
      cancelled = true;
    };
  }, [embeddedProposalId]);

  const loadSampleAsEmbeddedProposal = useCallback(
    async (key: string) => {
      if (sampleLoadKey) return;
      setSampleLoadKey(key);
      try {
        const sampleRes = await fetch(`/api/sample-proposals/${encodeURIComponent(key)}`);
        if (!sampleRes.ok) throw new Error("Failed to load sample");
        const sampleJson = (await sampleRes.json()) as ProposalState["proposal"];
        if (!sampleJson || typeof sampleJson !== "object") throw new Error("Invalid sample");

        const createRes = await fetch("/api/embedded-proposals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sampleJson),
        });
        const createData = (await createRes.json()) as {
          id: string;
          proposal: ProposalState["proposal"];
          firebaseError?: string;
        };
        const { id, proposal: createdProposal } = createData;
        const proposalWithId = createdProposal ?? { ...sampleJson, id };

        setEmbeddedProposalId(id);
        setState((prev) => ({ ...prev, proposal: proposalWithId }));
        setRemoteProposal(proposalWithId);
        setPlaygroundProposal(null);
        if (createData.firebaseError) {
          console.warn("[StepchartsPlayLayout] Firebase write:", createData.firebaseError);
        }
      } catch (e) {
        console.error("[StepchartsPlayLayout] Load sample failed:", e);
      } finally {
        setSampleLoadKey(null);
      }
    },
    [sampleLoadKey, setState]
  );

  return (
    <>
      <div className="play-chat">
        <CopilotChat
          instructions={
            embeddedProposalId
              ? [
                  "You are a structure-planning assistant working with Stepcharts.io.",
                  `The user is currently viewing an embedded Stepcharts proposal with embedded_id="${embeddedProposalId}".`,
                  "When they ask you to summarize, explain, or analyze the current chart, you MUST first call the read_proposal tool with this exact embedded_id value to fetch the latest proposal JSON from Firebase.",
                  "Base your explanation only on the tool output (actors, steps, ownership, and cash flows) and avoid inventing steps or actors that are not present in the JSON.",
                ].join(" ")
              : [
                  "You are a structure-planning assistant working with Stepcharts.io.",
                  "If the user mentions an embedded Stepcharts chart id (a numeric embedded_id from the URL), and they ask you to summarize or explain that chart, call the read_proposal tool with that embedded_id before answering.",
                ].join(" ")
          }
          labels={{
            title: "Structure assistant",
            initial:
              "Describe what you want to do (e.g. add a person, form a trust, set up ownership). I'll build the proposal and it will appear in the diagram.",
          }}
        />
      </div>
      <div className="play-embed">
        <div className="play-embed-header">
          <span>Stepcharts Playground</span>
          {embeddedProposalId && (
            <span className="play-embedded-id">
              Embedded ID: <code>{embeddedProposalId}</code>
            </span>
          )}
          {!playgroundReady && proposal && (
            <span className="play-status">Syncing proposal…</span>
          )}
          {(playgroundReady && proposal) || embeddedId ? (
            <a
              href={iframeSrc}
              target="_blank"
              rel="noopener noreferrer"
              className="play-open-link"
            >
              Open in new tab
            </a>
          ) : null}
          {playgroundError && (
            <span className="play-error" title={playgroundError}>
              Playground: {playgroundError}
            </span>
          )}
        </div>
        {!embeddedProposalId && samples.length > 0 && (
          <div className="play-samples">
            <p className="play-samples-title">Start from a sample proposal</p>
            <ul className="play-samples-list">
              {samples.map(({ key, title }) => (
                <li key={key}>
                  <button
                    type="button"
                    className="play-sample-btn"
                    onClick={() => loadSampleAsEmbeddedProposal(key)}
                    disabled={sampleLoadKey !== null}
                  >
                    {title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          title="Stepcharts Play"
          className="play-iframe"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
        {proposal && (
          <div className="play-proposal-actions">
            <p className="play-proposal-hint">
              Proposal is sent to the playground above automatically. You can
              copy the JSON below to share or import elsewhere.
            </p>
            <details className="play-json-details">
              <summary>Proposal JSON</summary>
              <pre className="play-json-pre">{proposalJson}</pre>
              <button
                type="button"
                className="play-copy-btn"
                onClick={() => {
                  navigator.clipboard.writeText(proposalJson);
                }}
              >
                Copy JSON
              </button>
            </details>
          </div>
        )}
      </div>
    </>
  );
}
