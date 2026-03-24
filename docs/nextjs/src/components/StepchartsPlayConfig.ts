export const STEPCHARTS_PLAY_URL = "https://stepcharts.io/play";
export const PLAY_ORIGIN = "https://stepcharts.io";
export const STEPCHARTS_AGENT = "cyber_risk";

export type ProposalState = {
  proposal?: {
    id?: string;
    title?: string;
    steps?: Array<{ id?: number; title?: string; instructions?: unknown[] }>;
    actors?: Array<{ type: string; id: string; name: string }>;
    /** Passed to playground so instructions referencing them resolve */
    assets?: unknown[];
    financialAccounts?: unknown[];
    variables?: unknown[];
    actorGroups?: unknown[];
  } | null;
};

export function extractEmbeddedIdFromPlayUrl(url: string): string | null {
  try {
    const parsed = new URL(url);

    const fromQuery = parsed.searchParams.get("embeddedId");
    if (fromQuery) return fromQuery;

    const segments = parsed.pathname.split("/").filter(Boolean);
    const playIndex = segments.indexOf("play");

    if (playIndex >= 0 && segments.length > playIndex + 1) {
      const candidate = segments[playIndex + 1]!;
      return /^\d+$/.test(candidate) ? candidate : null;
    }
  } catch {
    // ignore invalid URLs
  }

  return null;
}

/** Payload for playground:setState (ProposalBuildSpec). Playground requires step IDs to be positive. */
export function toPlaygroundPayload(
  proposal: NonNullable<ProposalState["proposal"]>
): Record<string, unknown> {
  const steps = (proposal.steps ?? []).map((step, index) => ({
    ...step,
    id: typeof step.id === "number" && step.id > 0 ? step.id : index + 1,
  }));
  return {
    id: proposal.id ?? "",
    title: proposal.title ?? "Untitled",
    steps,
    actors: proposal.actors ?? [],
    assets: proposal.assets ?? [],
    financialAccounts: proposal.financialAccounts ?? [],
    variables: proposal.variables ?? [],
    actorGroups: proposal.actorGroups ?? [],
  };
}

