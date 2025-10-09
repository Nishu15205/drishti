import { NextRequest } from "next/server";
import { toSpeakable } from "@/lib/drishti/transliterate";
import {
  HINDI_TTS_MIME,
  splitHindiChunks,
  synthesizeHindi,
} from "@/lib/drishti/hindi-tts";
import { synthesizeCloudWithFallback } from "@/lib/drishti/cloud-tts";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_CHUNKS = 6;
const CHUNK_LIMIT = 100; // target: ~1 sentence per chunk → first audio ASAP
const API_LIMIT = 1000; // TTS API hard cap is 1024 chars — stay safely under

function cleanForSpeech(raw: string): string {
  return raw
    .replace(/[*_#`>|~]/g, " ")
    .replace(/\s*[\r\n]+\s*/g, ". ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Split text into small TTS-safe chunks on sentence boundaries.
// Chunks synthesize in parallel and stream back in order, so the first
// chunk is short and comes back within a couple of seconds.
function chunkText(text: string): string[] {
  const sentences = text.match(/[^.!?।]+[.!?।]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";

  const push = (s: string) => {
    if (s.trim()) chunks.push(s.trim());
  };

  for (const sentence of sentences) {
    if (sentence.length > API_LIMIT) {
      // Absurdly long single sentence — hard split at API-safe boundaries
      push(current);
      current = "";
      for (let i = 0; i < sentence.length; i += API_LIMIT) {
        push(sentence.slice(i, i + API_LIMIT));
      }
      continue;
    }
    if ((current + sentence).length <= CHUNK_LIMIT) {
      current += sentence;
    } else {
      push(current);
      current = sentence; // a longer sentence becomes its own whole chunk
    }
  }
  push(current);

  while (chunks.length > MAX_CHUNKS) {
    const last = chunks.pop() ?? "";
    chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${last}`;
  }
  return chunks;
}

/**
 * Streams audio as newline-delimited JSON:
 *   {"audio":"<base64>","mime":"audio/mpeg","rate":true}   (Hindi — native Google
 *        हिन्दी voice, MP3; client applies playbackRate for speed)
 *   {"audio":"<base64 wav>"}   (English — cloud voice, speed baked in)
 *   {"done":true,"format":"mp3"|"wav"}
 *   {"error":"..."}            (terminal, on failure)
 *
 * Hindi goes through Google's native Hindi voice (pure Indian accent, reads
 * Devanagari directly); if that API fails mid-run we fall back to the cloud
 * voice reading romanized Hindi. English goes through Google's en-IN voice
 * (Indian English). Chunks synthesize sequentially and stream back in
 * playback order, so the client starts speaking after the first
 * sentence instead of waiting for the whole readout.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      text?: string;
      speed?: number;
      lang?: string;
    };
    const rawText = cleanForSpeech(body?.text ?? "");
    const lang = body?.lang === "hi" ? "hi" : "en";

    if (!rawText) {
      return Response.json({ error: "Nothing to speak." }, { status: 400 });
    }

    const rawSpeed = Number(body?.speed ?? 1);
    const speed = Math.min(2, Math.max(0.5, Number.isFinite(rawSpeed) ? rawSpeed : 1));
    // English speaks a notch slower (user request): the client plays EN
    // Google chunks at rate ≈ speed×0.8 (pieces carry rate:true). ttsSpeed
    // here is unused by the current chain (kept for future voices) — Hindi
    // keeps its own pace.
    const ttsSpeed = lang === "en" ? Math.max(0.5, speed * 0.8) : speed;

    // Hindi stays in Devanagari — Google's Hindi voice reads it natively.
    // English goes to Google's en-IN voice — proper INDIAN English (user
    // request) — with a per-piece fallback to the neutral "en" voice.
    // the cloud voice is banned from the English path (accent must stay Indian).
    const chunks =
      lang === "hi"
        ? splitHindiChunks(rawText)
        : chunkText(rawText).map((c) => toSpeakable(c, lang));
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) =>
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));

        // Worker pool — synthesis runs strictly sequentially; the client
        // overlaps playback of chunk N with the synthesis of chunk N+1,
        // which keeps first-audio latency low.
        const CONCURRENCY = 1;
        interface AudioLine {
          audio: string;
          mime?: string;
          rate?: boolean;
        }
        const results: (AudioLine[] | undefined)[] = new Array(chunks.length);
        const deferred = chunks.map(() => {
          let resolve!: () => void;
          const promise = new Promise<void>((r) => {
            resolve = r;
          });
          return { promise, resolve };
        });
        let synthError: unknown = null;
        let cursor = 0;

        let hindiApiBroken = false;
        const synthesize = async (chunk: string): Promise<AudioLine[]> => {
          if (lang === "hi" && !hindiApiBroken) {
            try {
              return [
                {
                  audio: await synthesizeHindi(chunk),
                  mime: HINDI_TTS_MIME,
                  rate: true, // client applies playbackRate (speed)
                },
              ];
            } catch (err) {
              hindiApiBroken = true;
              console.warn(
                "[speak] Hindi TTS API failed → cloud voice fallback:",
                err instanceof Error ? err.message : err
              );
            }
          }
          // cloud path with full fallback chain (English: en-IN → en;
          // Hindi: cloud voice → retry → Google voice). Hindi must be
          // romanized first (voices can't read Devanagari — they garble it
          // into Chinese). The fallback may return multiple pieces
          // (Google's ~200-char cap) — play in order.
          const text = lang === "hi" ? toSpeakable(chunk, "hi") : chunk;
          const pieces = await synthesizeCloudWithFallback(text, ttsSpeed, lang);
          return pieces.map((p) => ({ audio: p.b64, mime: p.mime, rate: p.rate }));
        };

        const runWorker = async () => {
          while (cursor < chunks.length) {
            const i = cursor++;
            try {
              results[i] = await synthesize(chunks[i]);
            } catch (err) {
              synthError = synthError ?? err;
              deferred.forEach((d) => d.resolve()); // unblock the ordered flusher
              return;
            }
            deferred[i].resolve();
          }
        };
        const workers = Promise.all(
          Array.from(
            { length: Math.min(CONCURRENCY, chunks.length) },
            () => runWorker()
          )
        );
        void workers;

        try {
          // Flush audio in playback order as each chunk finishes
          for (let i = 0; i < chunks.length; i++) {
            await deferred[i].promise;
            if (synthError) throw synthError;
            for (const line of results[i] ?? []) send(line);
          }
          if (synthError) throw synthError;
          // English always streams Google MP3 pieces now (en-IN Indian
          // English); Hindi is MP3 via the native Google हिन्दी voice unless
          // that API broke mid-run (then the cloud fallback emits WAV).
          send({
            done: true,
            format: lang === "en" ? "mp3" : hindiApiBroken ? "wav" : "mp3",
          });
        } catch (err) {
          console.error("[speak] error:", err);
          send({
            error:
              err instanceof Error
                ? `Speech failed: ${err.message}`
                : "Speech failed. Please try again.",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error("[speak] setup error:", err);
    return Response.json(
      {
        error:
          err instanceof Error
            ? `Speech failed: ${err.message}`
            : "Speech failed. Please try again.",
      },
      { status: 500 }
    );
  }
}
