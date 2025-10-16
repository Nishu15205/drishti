import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withAI, withTimeout, ASR_TIMEOUT_MS } from "@/lib/drishti/ai-client";
import { askSystemPrompt } from "@/lib/drishti/prompts";
import { streamSpeechFromVision, ndjsonHeaders } from "@/lib/drishti/speech-stream";
import type { Lang } from "@/lib/drishti/constants";

export const runtime = "nodejs";
export const maxDuration = 120;

interface AskBody {
  audio?: string; // base64 WAV of the user's spoken question
  image?: string; // optional current camera frame (dataURL)
  lang?: Lang;
  thumb?: string;
  source?: string;
  speed?: number;
  ttsMode?: string; // "browser" → client speaks via its own Hindi voice
  history?: { role: "user" | "assistant"; content: string }[];
}

type ChatMsg =
  | { role: "assistant" | "user"; content: string }
  | {
      role: "user";
      content: (
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      )[];
    };

/**
 * Streaming ask: ASR → {"question"} → VLM (stream) → sentences → TTS → NDJSON.
 * Lines: {"question"} then {"audio":...}* then {"text","done":true} | {"error"}
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AskBody;
    const audio = body?.audio ?? "";
    const lang: Lang = body?.lang === "hi" ? "hi" : "en";
    const rawSpeed = Number(body?.speed ?? 1.25);
    const speed = Math.min(2, Math.max(0.5, Number.isFinite(rawSpeed) ? rawSpeed : 1.25));
    const image =
      typeof body?.image === "string" && body.image.startsWith("data:image/")
        ? body.image
        : null;

    if (!audio || audio.length < 200) {
      return Response.json(
        { error: "No audio recorded. Please hold the mic and speak." },
        { status: 400 }
      );
    }

    // ---- Step 1: ASR — speech → text ----
    const asrRes = await withTimeout(
      withAI((ai) => ai.audio.asr.create({ file_base64: audio })),
      ASR_TIMEOUT_MS,
      "Speech recognition"
    );
    const question = (asrRes?.text ?? "").trim();

    if (!question) {
      return Response.json(
        {
          error:
            lang === "hi"
              ? "आवाज़ समझ नहीं आई। दोबारा बोलिए।"
              : "Could not hear your question. Please try again.",
        },
        { status: 422 }
      );
    }

    // ---- Step 2: LLM + VLM — answer with camera context, streamed ----
    const history: ChatMsg[] = Array.isArray(body?.history)
      ? body.history
          .filter(
            (m) =>
              m &&
              (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string" &&
              m.content.trim().length > 0
          )
          .slice(-4)
          .map((m) => ({ role: m.role, content: m.content.slice(0, 800) }))
      : [];

    const userContent: (
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    )[] = [{ type: "text", text: `The user asks: "${question}"` }];
    if (image) {
      userContent.push({
        type: "image_url",
        image_url: { url: image },
      });
    }

    const visionBody = withAI((ai) =>
      ai.chat.completions.createVision({
        model: "",
        messages: [
          { role: "assistant", content: askSystemPrompt(lang) },
          ...history,
          { role: "user", content: userContent },
        ],
        stream: true,
        thinking: { type: "disabled" },
      })
    );

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
      preamble: [{ question }],
      onText: (answer) => {
        // Persist to history — fire-and-forget
        void db.scanLog
          .create({
            data: {
              kind: "ask",
              mode: "ask",
              language: lang,
              question: question.slice(0, 1000),
              answer: answer.slice(0, 4000),
              thumb,
              source,
            },
          })
          .catch((dbErr) => console.error("[ask] history save failed:", dbErr));
      },
    });

    return new Response(stream, { headers: ndjsonHeaders() });
  } catch (err) {
    console.error("[ask] error:", err);
    return Response.json(
      {
        error:
          err instanceof Error
            ? `Could not answer: ${err.message}`
            : "Could not answer. Please try again.",
      },
      { status: 500 }
    );
  }
}
