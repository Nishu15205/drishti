import { NextRequest } from "next/server";
import { withAI, withTimeout } from "@/lib/drishti/ai-client";
import { liveInstruction } from "@/lib/drishti/prompts";
import type { Lang } from "@/lib/drishti/constants";

export const runtime = "nodejs";
export const maxDuration = 60;

// Live Feedback ticks fire every ~3s per client — this must answer FAST and
// never wedge. 12s is generous for a one-sentence glance; on failure the
// client silently skips the tick and the next one comes in 3s anyway.
const VLM_TIMEOUT_MS = 12_000;

interface LiveBody {
  image?: string;
  lang?: Lang;
}

/**
 * POST /api/live — Live Feedback ("Turant Nazar"): har ~3 sec ka quick
 * glance. SINGLE image, DB-free, JSON-only (no TTS here — the client speaks
 * the sentence via /api/speak, so identical observations can be deduped
 * BEFORE any audio is generated).
 * Body: { image: dataURL, lang: "en"|"hi" }
 * → { spoken: string }   ("" when nothing worth saying)
 */
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const timing = (label: string, ms?: number) =>
    console.log(
      `[live-timing] ${label}${ms !== undefined ? ` ${ms}ms` : ` ${Date.now() - t0}ms`}`
    );
  try {
    const body = (await req.json()) as LiveBody;
    const image = typeof body?.image === "string" ? body.image : "";
    const lang: Lang = body?.lang === "hi" ? "hi" : "en";

    if (!image.startsWith("data:image/")) {
      return Response.json(
        { error: "Camera frame missing. Please capture an image first." },
        { status: 400 }
      );
    }

    const makeVision = () =>
      withAI((ai) =>
        ai.chat.completions.createVision({
          model: "",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: liveInstruction(lang) },
                { type: "image_url", image_url: { url: image } },
              ],
            },
          ],
          stream: false,
          thinking: { type: "disabled" },
        })
      );

    // One silent retry — a transient vision-connect hiccup must not cost a
    // live tick (the retry usually lands within a second).
    let res;
    try {
      res = await withTimeout(makeVision(), VLM_TIMEOUT_MS, "Live glance");
    } catch (firstErr) {
      console.warn(
        "[live] vision attempt 1 failed — retrying:",
        firstErr instanceof Error ? firstErr.message : firstErr
      );
      res = await withTimeout(makeVision(), VLM_TIMEOUT_MS, "Live glance");
    }
    timing("vlm");

    const raw = res?.choices?.[0]?.message?.content;
    const contentStr =
      typeof raw === "string" ? raw : Array.isArray(raw) ? JSON.stringify(raw) : "";

    // One sentence only: first line, markdown/quotes stripped, length-capped.
    const spoken = contentStr
      .replace(/[*_#`>|~]/g, " ")
      .replace(/[""'']/g, "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)[0]
      ?.slice(0, 140)
      .trim();

    timing("total");
    return Response.json({ spoken: spoken ?? "" });
  } catch (err) {
    console.error("[live] error:", err);
    // Live ticks are best-effort — the client just skips this one.
    return Response.json(
      {
        error:
          err instanceof Error
            ? `Live glance failed: ${err.message}`
            : "Live glance failed. Please try again.",
      },
      { status: 500 }
    );
  }
}
