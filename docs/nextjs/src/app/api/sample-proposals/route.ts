import { NextResponse } from "next/server";
import { readdirSync } from "fs";
import { join } from "path";

const SAMPLE_JSON_DIR = join(process.cwd(), "..", "sample-json");

function listSampleKeys(): { key: string; title: string }[] {
  try {
    const files = readdirSync(SAMPLE_JSON_DIR, { withFileTypes: true })
      .filter((f) => f.isFile() && f.name.toLowerCase().endsWith(".json"))
      .map((f) => f.name);

    return files.map((filename) => {
      const key = encodeURIComponent(filename);
      const title = filename.replace(/\s*\(Example\)\.json$/i, "").replace(/\.json$/i, "") || filename;
      return { key, title };
    });
  } catch {
    return [];
  }
}

export async function GET() {
  const list = listSampleKeys();
  return NextResponse.json(list);
}
