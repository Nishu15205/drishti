import { NextRequest } from "next/server";
import { withAI, withTimeout } from "@/lib/drishti/ai-client";
import type { Lang } from "@/lib/drishti/constants";

export const runtime = "nodejs";
export const maxDuration = 60;

const VLM_TIMEOUT_MS = 30_000;

interface WatchBody {
  image?: string;
  lang?: Lang;
}

/**
 * POST /api/watch — Nazar Mode: silent safety watch.
 * Fires every ~5s per client, so this is a SINGLE-image, DB-free call that
 * answers "SKIP" for safe scenes and one urgent sentence for hazards.
 * Body: { image: dataURL, lang: "en"|"hi" }
 * → { alert: boolean, spoken: string }   (spoken === "" when safe)
 */
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const timing = (label: string, ms?: number) =>
    console.log(
      `[watch-timing] ${label}${ms !== undefined ? ` ${ms}ms` : ` ${Date.now() - t0}ms`}`
    );
  try {
    const body = (await req.json()) as WatchBody;
    const image = typeof body?.image === "string" ? body.image : "";
    const lang: Lang = body?.lang === "hi" ? "hi" : "en";

    if (!image.startsWith("data:image/")) {
      return Response.json(
        { error: "Camera frame missing. Please capture an image first." },
        { status: 400 }
      );
    }

    const res = await withTimeout(
      withAI((ai) =>
        ai.chat.completions.createVision({
          model: "",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `You are Drishti's safety watchman for a blind user whose phone camera is streaming. You receive one frame every few seconds. If the scene is SAFE and nothing important changed, reply with exactly: SKIP\nOtherwise reply with ONE urgent warning sentence, max 12 words, in ${
                    lang === "hi" ? "Hindi (Devanagari)" : "English"
                  }, ONLY for: obstacles blocking the path, stairs/steps/holes, a vehicle approaching, a person very close or moving straight toward the user, spills/water/fire/stove, open glass doors, low ceilings. No greetings, no description, no punctuation beyond the sentence.`,
                },
                { type: "image_url", image_url: { url: image } },
              ],
            },
          ],
          stream: false,
          thinking: { type: "disabled" },
        })
      ),
      VLM_TIMEOUT_MS,
      "Safety watch"
    );
    timing("vlm");

    const raw = res?.choices?.[0]?.message?.content;
    const contentStr =
      typeof raw === "string" ? raw : Array.isArray(raw) ? JSON.stringify(raw) : "";
    const cleaned = contentStr.trim();

    // Safe scene → the model answers SKIP (allow stray whitespace/punctuation).
    if (!cleaned || /^skip[\s.!,]*$/i.test(cleaned)) {
      timing("total");
      return Response.json({ alert: false, spoken: "" });
    }

    const spoken = cleaned.split("\n")[0].trim().slice(0, 200);
    timing("total");
    return Response.json({ alert: Boolean(spoken), spoken });
  } catch (err) {
    console.error("[watch] error:", err);
    return Response.json(
      {
        error:
          err instanceof Error
            ? `Safety watch failed: ${err.message}`
            : "Safety watch failed. Please try again.",
      },
      { status: 500 }
    );
  }
}
