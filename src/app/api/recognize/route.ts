import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withAI, withTimeout } from "@/lib/drishti/ai-client";
import type { Lang } from "@/lib/drishti/constants";

export const runtime = "nodejs";
export const maxDuration = 60;

const VLM_TIMEOUT_MS = 45_000;
const MAX_REFS = 4; // keep the prompt small — latency & token budget

interface RecognizeBody {
  image?: string;
  lang?: Lang;
}

type VisionPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** Names/notes go inside double quotes in the prompt — keep them one-line and quote-free. */
const promptSafe = (s: string) => s.replace(/["“”„]/g, "'").replace(/[\r\n]+/g, " ");

const EMPTY_SPOKEN: Record<Lang, string> = {
  hi: "Pehchaan khali hai. Pehle kisi apne ki photo aur naam save karo.",
  en: "No saved people yet. Add a face with a name in the Pehchaan panel first.",
};

function extract(content: string): { name: string; spoken: string; parsed: boolean } {
  const nameMatch = content.match(/NAME\s*=\s*(.+)/i);
  const sayMatch = content.match(/SAY\s*=\s*([\s\S]+)/i);
  if (!nameMatch && !sayMatch) {
    return { name: "", spoken: content.trim().slice(0, 200), parsed: false };
  }
  const name = (nameMatch?.[1] ?? "").trim();
  // SAY: first line only, strip wrapping quotes
  let spoken = (sayMatch?.[1] ?? "").trim().split("\n")[0].trim();
  spoken = spoken.replace(/^["“”']+|["“”']+$/g, "").trim();
  return { name, spoken, parsed: true };
}

/**
 * POST /api/recognize — Pehchaan Mode: "who is in front of me?"
 * Compares the live frame against up to 4 saved face photos in ONE multi-image
 * vision call. Body: { image: dataURL, lang: "en"|"hi" }
 * → { match: boolean, name: string, spoken: string }
 */
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const timing = (label: string, ms?: number) =>
    console.log(
      `[recognize-timing] ${label}${ms !== undefined ? ` ${ms}ms` : ` ${Date.now() - t0}ms`}`
    );
  try {
    const body = (await req.json()) as RecognizeBody;
    const image = typeof body?.image === "string" ? body.image : "";
    const lang: Lang = body?.lang === "hi" ? "hi" : "en";

    if (!image.startsWith("data:image/")) {
      return Response.json(
        { error: "Camera frame missing. Please capture an image first." },
        { status: 400 }
      );
    }

    const faces = await db.knownMemory.findMany({
      where: { kind: "face" },
      orderBy: { createdAt: "desc" },
      take: MAX_REFS,
    });
    timing("faces_loaded", Date.now() - t0);

    if (faces.length === 0) {
      return Response.json({ match: false, name: "", spoken: EMPTY_SPOKEN[lang] });
    }

    // FIRST image = the live frame; then labeled reference faces.
    const content: VisionPart[] = [
      {
        type: "text",
        text: "You are Drishti, a vision assistant for a blind user. The FIRST image is what the user is looking at right now.",
      },
      { type: "image_url", image_url: { url: image } },
    ];
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i];
      content.push({
        type: "text",
        text: `Reference face ${i + 1}: name "${promptSafe(f.name)}"${
          f.note ? `, relation/context "${promptSafe(f.note)}"` : ""
        }.`,
      });
      content.push({ type: "image_url", image_url: { url: f.image } });
    }
    content.push({
      type: "text",
      text: `Task: decide whether the person(s) in the FIRST image match any known reference face. Judge by face similarity, ignore lighting/clothing differences. Reply in EXACTLY this two-line format, nothing else:\nNAME=<exact known name, or UNKNOWN>\nSAY=<ONE short spoken sentence, max 15 words, in ${
        lang === "hi" ? "Hindi written in Devanagari" : "English"
      }: if known — confirm who it is (include relation if known, e.g. 'Yeh Mummy hain'); if unknown — a brief neutral description of the person, never guess identity>`,
    });

    const res = await withTimeout(
      withAI((ai) =>
        ai.chat.completions.createVision({
          model: "",
          messages: [{ role: "user", content }],
          stream: false,
          thinking: { type: "disabled" },
        })
      ),
      VLM_TIMEOUT_MS,
      "Face recognition"
    );
    timing(`vlm ${faces.length + 1}img`);

    const raw = res?.choices?.[0]?.message?.content;
    const contentStr =
      typeof raw === "string" ? raw : Array.isArray(raw) ? JSON.stringify(raw) : "";
    const { name, spoken, parsed } = extract(contentStr);
    if (!parsed) {
      console.warn("[recognize] unparseable VLM reply:", contentStr.slice(0, 200));
    }

    // Models don't always uppercase "UNKNOWN" — compare case-insensitively.
    const match = parsed && name.toUpperCase() !== "UNKNOWN" && name.length > 0;
    timing("total");
    return Response.json({
      match,
      name: match ? name : "UNKNOWN",
      spoken: spoken || (lang === "hi" ? "Koi nahi dikh raha." : "No one is visible."),
    });
  } catch (err) {
    console.error("[recognize] error:", err);
    return Response.json(
      {
        error:
          err instanceof Error
            ? `Recognition failed: ${err.message}`
            : "Recognition failed. Please try again.",
      },
      { status: 500 }
    );
  }
}
