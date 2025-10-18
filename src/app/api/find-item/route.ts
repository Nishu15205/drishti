import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withAI, withTimeout } from "@/lib/drishti/ai-client";
import type { Lang } from "@/lib/drishti/constants";

export const runtime = "nodejs";
export const maxDuration = 60;

const VLM_TIMEOUT_MS = 45_000;
const MAX_REFS = 4; // keep the prompt small — latency & token budget

interface FindItemBody {
  image?: string;
  lang?: Lang;
}

type VisionPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** Names/notes go inside double quotes in the prompt — keep them one-line and quote-free. */
const promptSafe = (s: string) => s.replace(/["“”„]/g, "'").replace(/[\r\n]+/g, " ");

const EMPTY_SPOKEN: Record<Lang, string> = {
  hi: "Koi cheez save nahi hai. Pehle apni cheez ki photo aur naam save karo.",
  en: "No saved items yet. Add an item photo with a name first.",
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
 * POST /api/find-item — Yaad Mode: "where is my keys/bag?"
 * Checks the live frame against up to 4 saved belonging photos in ONE
 * multi-image vision call. Body: { image: dataURL, lang: "en"|"hi" }
 * → { found: boolean, name: string, spoken: string }
 */
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const timing = (label: string, ms?: number) =>
    console.log(
      `[find-item-timing] ${label}${ms !== undefined ? ` ${ms}ms` : ` ${Date.now() - t0}ms`}`
    );
  try {
    const body = (await req.json()) as FindItemBody;
    const image = typeof body?.image === "string" ? body.image : "";
    const lang: Lang = body?.lang === "hi" ? "hi" : "en";

    if (!image.startsWith("data:image/")) {
      return Response.json(
        { error: "Camera frame missing. Please capture an image first." },
        { status: 400 }
      );
    }

    const items = await db.knownMemory.findMany({
      where: { kind: "item" },
      orderBy: { createdAt: "desc" },
      take: MAX_REFS,
    });
    timing("items_loaded", Date.now() - t0);

    if (items.length === 0) {
      return Response.json({ found: false, name: "", spoken: EMPTY_SPOKEN[lang] });
    }

    // FIRST image = the live frame; then labeled reference photos.
    const content: VisionPart[] = [
      {
        type: "text",
        text: "You are Drishti, a vision assistant for a blind user. The FIRST image is what the user is looking at right now.",
      },
      { type: "image_url", image_url: { url: image } },
    ];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      content.push({
        type: "text",
        text: `Reference photo ${i + 1}: the user's belonging "${promptSafe(it.name)}"${
          it.note ? `, context "${promptSafe(it.note)}"` : ""
        }.`,
      });
      content.push({ type: "image_url", image_url: { url: it.image } });
    }
    content.push({
      type: "text",
      text: `Task: check whether ANY of the user's belongings appears in the FIRST image. Reply EXACTLY:\nNAME=<belonging name or NONE>\nSAY=<ONE short sentence, max 15 words, in ${
        lang === "hi" ? "Hindi written in Devanagari" : "English"
      }: if found — confirm which belonging is visible and roughly where (e.g. 'Aapki chabi table par dikhi rahi hai'); if not — say none of their things are visible>`,
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
      "Item search"
    );
    timing(`vlm ${items.length + 1}img`);

    const raw = res?.choices?.[0]?.message?.content;
    const contentStr =
      typeof raw === "string" ? raw : Array.isArray(raw) ? JSON.stringify(raw) : "";
    const { name, spoken, parsed } = extract(contentStr);
    if (!parsed) {
      console.warn("[find-item] unparseable VLM reply:", contentStr.slice(0, 200));
    }

    // Models don't always uppercase "NONE" — compare case-insensitively.
    const found = parsed && name.toUpperCase() !== "NONE" && name.length > 0;
    timing("total");
    return Response.json({
      found,
      name: found ? name : "NONE",
      spoken: spoken || (lang === "hi" ? "Aapki koi cheez nahi dikh rahi." : "None of your things are visible."),
    });
  } catch (err) {
    console.error("[find-item] error:", err);
    return Response.json(
      {
        error:
          err instanceof Error
            ? `Item search failed: ${err.message}`
            : "Item search failed. Please try again.",
      },
      { status: 500 }
    );
  }
}
