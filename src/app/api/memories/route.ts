import { NextRequest } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

const VALID_KINDS = new Set(["face", "item"]);
const NAME_MAX = 60;
const NOTE_MAX = 120;
const IMAGE_MAX_BYTES = 400000; // ~320px jpeg dataURL stays far below this

interface MemoryBody {
  kind?: string;
  name?: string;
  note?: string | null;
  image?: string;
}

/** GET /api/memories — newest first. */
export async function GET() {
  try {
    const items = await db.knownMemory.findMany({
      orderBy: { createdAt: "desc" },
    });
    return Response.json({ items });
  } catch (err) {
    console.error("[memories] list failed:", err);
    return Response.json({ error: "Could not load memories." }, { status: 500 });
  }
}

/**
 * POST /api/memories — teach the app a face or item.
 * Body: { kind: "face"|"item", name: string, note?: string|null, image: dataURL }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as MemoryBody;

    const kind = typeof body?.kind === "string" ? body.kind : "";
    if (!VALID_KINDS.has(kind)) {
      return Response.json(
        { error: 'kind must be "face" or "item".' },
        { status: 400 }
      );
    }

    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (name.length < 1 || name.length > NAME_MAX) {
      return Response.json(
        { error: `Name must be 1-${NAME_MAX} characters.` },
        { status: 400 }
      );
    }

    const image = typeof body?.image === "string" ? body.image : "";
    if (!image.startsWith("data:image/")) {
      return Response.json(
        { error: "A photo is required (image dataURL)." },
        { status: 400 }
      );
    }
    if (image.length >= IMAGE_MAX_BYTES) {
      return Response.json(
        { error: "Photo is too large. Please retake it." },
        { status: 400 }
      );
    }

    let note: string | null = null;
    if (typeof body?.note === "string" && body.note.trim().length > 0) {
      if (body.note.trim().length > NOTE_MAX) {
        return Response.json(
          { error: `Note must be at most ${NOTE_MAX} characters.` },
          { status: 400 }
        );
      }
      note = body.note.trim();
    }

    const created = await db.knownMemory.create({
      data: { kind, name, note, image },
    });
    return Response.json(created, { status: 201 });
  } catch (err) {
    console.error("[memories] create failed:", err);
    return Response.json({ error: "Could not save memory." }, { status: 500 });
  }
}

/** DELETE /api/memories?id=<id> — forget one face/item. */
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return Response.json(
        { error: "Missing id query parameter." },
        { status: 400 }
      );
    }
    const existing = await db.knownMemory.findUnique({ where: { id } });
    if (!existing) {
      return Response.json({ error: "Memory not found." }, { status: 404 });
    }
    await db.knownMemory.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[memories] delete failed:", err);
    return Response.json({ error: "Could not delete memory." }, { status: 500 });
  }
}
