import { NextResponse } from "next/server";
import { getMongoClient } from "@/lib/mongodb";

export async function GET() {
  try {
    const client = await getMongoClient();
    await client.db("admin").command({ ping: 1 });
    return NextResponse.json({ ok: true, mongo: "connected" });
  } catch (err) {
    return NextResponse.json(
      { ok: false, mongo: "error", error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
