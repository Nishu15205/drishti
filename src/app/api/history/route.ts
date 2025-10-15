import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// GET — recent Drishti insight history (newest first)
export async function GET() {
  try {
    const items = await db.scanLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        kind: true,
        mode: true,
        language: true,
        question: true,
        answer: true,
        thumb: true,
        source: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[history] GET error:", err);
    return NextResponse.json(
      { error: "Could not load history." },
      { status: 500 }
    );
  }
}

// DELETE — clear all history
export async function DELETE() {
  try {
    await db.scanLog.deleteMany({});
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[history] DELETE error:", err);
    return NextResponse.json(
      { error: "Could not clear history." },
      { status: 500 }
    );
  }
}
