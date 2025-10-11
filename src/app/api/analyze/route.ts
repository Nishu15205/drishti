import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withAI } from "@/lib/drishti/ai-client";
import { describeInstruction } from "@/lib/drishti/prompts";
import { streamSpeechFromVision, ndjsonHeaders } from "@/lib/drishti/speech-stream";
import type { Lang, ModeId } from "@/lib/drishti/constants";

export const runtime = "nodejs";
export const maxDuration = 120;

const VALID_MODES: ModeId[] = ["scene", "currency", "medicine", "text"];

interface AnalyzeBody {
  image?: string;
  mode?: ModeId;
  lang?: Lang;
  thumb?: string;
  source?: string;
  speed?: number;
  ttsMode?: string; // "browser" → client speaks via its own Hindi voice
}

/**
 * Streaming describe: VLM (stream) → sentences → TTS → NDJSON.
 * The client hears the first sentence while later ones still synthesize.
 * Lines: {"audio":...}* then {"text","done":true} | {"error"}
 */
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const timing = (label: string, ms?: number) =>
    console.log(
      `[analyze-timing] ${label}${ms !== undefined ? ` ${ms}ms` : ` ${Date.now() - t0}ms`}`
    );
  try {
    const body = (await req.json()) as AnalyzeBody;
    timing("body_parsed");
    const image = body?.image ?? "";
    const mode: ModeId = VALID_MODES.includes(body?.mode as ModeId)
      ? (body?.mode as ModeId)
      : "scene";
    const lang: Lang = body?.lang === "hi" ? "hi" : "en";
    const rawSpeed = Number(body?.speed ?? 1.25);
    const speed = Math.min(2, Math.max(0.5, Number.isFinite(rawSpeed) ? rawSpeed : 1.25));

    if (!image.startsWith("data:image/")) {
      return Response.json(
        { error: "Camera frame missing. Please capture an image first." },
        { status: 400 }
      );
    }

    // One silent retry on the connect step — a transient vision hiccup
    // (auth rotation, network blip) used to surface to a blind user as a
    // dead "Analysis failed" scan. The retry usually lands within a second.
    const makeVision = () =>
      withAI((ai) =>
        ai.chat.completions.createVision({
          model: "",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: describeInstruction(mode, lang) },
                { type: "image_url", image_url: { url: image } },
              ],
            },
          ],
          stream: true,
          thinking: { type: "disabled" },
        })
      );
    const visionBody = makeVision().catch((firstErr) => {
      console.warn(
        "[analyze] vision connect failed once — retrying:",
        firstErr instanceof Error ? firstErr.message : firstErr
      );
      return makeVision();
    });

    const source =
      typeof body?.source === "string" && body.source.length < 100
        ? body.source
        : "camera";
    const thumb =
      typeof body?.thumb === "string" &&
      body.thumb.startsWith("data:image/") &&
      body.thumb.length < 60000
        ? body.thumb
        : null;

    const stream = await streamSpeechFromVision(visionBody, {
      speed,
      lang,
      // Device Hindi voice available → stream say-lines, skip cloud TTS
      sayOnly: body?.ttsMode === "browser" && lang === "hi",
      onTiming: (label, ms) => timing(label, ms),
      onText: (text) => {
        // Persist to history — fire-and-forget, never blocks playback
        void db.scanLog
          .create({
            data: {
              kind: "describe",
              mode,
              language: lang,
              answer: text.slice(0, 4000),
              thumb,
              source,
            },
          })
          .catch((dbErr) =>
            console.error("[analyze] history save failed:", dbErr)
          );
      },
    });

    return new Response(stream, { headers: ndjsonHeaders() });
  } catch (err) {
    console.error("[analyze] error:", err);
    return Response.json(
      {
        error:
          err instanceof Error
            ? `Analysis failed: ${err.message}`
            : "Analysis failed. Please try again.",
      },
      { status: 500 }
    );
  }
}
