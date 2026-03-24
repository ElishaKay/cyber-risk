import { NextResponse } from "next/server";

const RTDB_BASE_URL =
  "https://structuretracks.firebaseio.com/embedded-proposals";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (body == null || typeof body !== "object") {
    return NextResponse.json(
      { error: "Body must be a proposal object" },
      { status: 400 }
    );
  }

  const id = String(Date.now());
  const proposal = {
    ...(body as Record<string, unknown>),
    id,
  };

  const url = `${RTDB_BASE_URL}/${encodeURIComponent(id)}.json`;

  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(proposal),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        {
          id,
          proposal,
          firebaseError: `Firebase RTDB write failed: ${res.status} ${text}`,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({ id, proposal });
  } catch (error) {
    return NextResponse.json(
      {
        id,
        proposal,
        firebaseError: `Failed to reach Firebase: ${String(error)}`,
      },
      { status: 200 }
    );
  }
}
