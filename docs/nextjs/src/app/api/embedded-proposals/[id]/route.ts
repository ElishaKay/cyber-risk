import { NextResponse } from "next/server";

const RTDB_BASE_URL =
  "https://structuretracks.firebaseio.com/embedded-proposals";

type RouteParams = {
  params: { id: string };
};

export async function GET(_req: Request, { params }: RouteParams) {
  const id = params.id;

  if (!id || Array.isArray(id)) {
    return NextResponse.json({ error: "Invalid embedded proposal id" }, { status: 400 });
  }

  const upstreamUrl = `${RTDB_BASE_URL}/${encodeURIComponent(id)}.json`;

  try {
    const res = await fetch(upstreamUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const text = await res.text();

    if (!res.ok) {
      return new NextResponse(text || "Upstream error", { status: res.status });
    }

    try {
      const json = JSON.parse(text);
      return NextResponse.json(json);
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON from upstream RTDB" },
        { status: 502 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to reach upstream RTDB", details: String(error) },
      { status: 502 }
    );
  }
}

