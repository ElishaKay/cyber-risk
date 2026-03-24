import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const SAMPLE_JSON_DIR = join(process.cwd(), "..", "sample-json");

type RouteParams = { params: { key: string } };

export async function GET(_req: Request, { params }: RouteParams) {
  const key = params.key;
  if (!key || Array.isArray(key)) {
    return NextResponse.json({ error: "Invalid sample key" }, { status: 400 });
  }

  let filename: string;
  try {
    filename = decodeURIComponent(key);
  } catch {
    return NextResponse.json({ error: "Invalid sample key encoding" }, { status: 400 });
  }

  if (filename.includes("..") || filename.includes("/")) {
    return NextResponse.json({ error: "Invalid sample key" }, { status: 400 });
  }

  const filePath = join(SAMPLE_JSON_DIR, filename);
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "Sample not found" }, { status: 404 });
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const json = JSON.parse(raw) as unknown;
    return NextResponse.json(json);
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to read or parse sample", details: String(e) },
      { status: 500 }
    );
  }
}
